import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import type { AgentEvent } from "../src/protocol";
import { createAgentServer } from "../src/server/agent";

type MissionStartRequest = {
  readonly prompt: string;
  readonly projectRoot?: string;
};

type TestProject = {
  readonly root: string;
  readonly cleanup: () => void;
};

function makeProject(files: Record<string, string>): TestProject {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "orvyn-agent-"));
  for (const [relativePath, content] of Object.entries(files)) {
    const target = path.join(root, relativePath);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content, "utf8");
  }
  return {
    root,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

function parseSseEvents(raw: string): AgentEvent[] {
  const events: AgentEvent[] = [];
  for (const frame of raw.split("\n\n")) {
    const line = frame.trim();
    if (!line.startsWith("data: ")) continue;
    events.push(JSON.parse(line.slice("data: ".length)) as AgentEvent);
  }
  return events;
}

async function createMission(
  port: number,
  request: MissionStartRequest,
): Promise<string> {
  const response = await fetch(`http://localhost:${port}/v1/mission/start`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  assert.equal(response.status, 200);
  const started = (await response.json()) as { missionId: string };
  return started.missionId;
}

async function collectStream(
  port: number,
  missionId: string,
): Promise<AgentEvent[]> {
  const response = await fetch(
    `http://localhost:${port}/v1/mission/${missionId}/stream`,
  );
  assert.equal(response.status, 200);
  return parseSseEvents(await response.text());
}

async function runMission(
  port: number,
  request: MissionStartRequest,
): Promise<AgentEvent[]> {
  const missionId = await createMission(port, request);
  return collectStream(port, missionId);
}

test("reads a valid file inside the project root", async () => {
  const project = makeProject({ "notes.txt": "hello from notes" });
  const agent = await createAgentServer(0, { projectRoot: project.root });
  try {
    const events = await runMission(agent.port, { prompt: "read notes.txt" });

    const tool = events.find(
      (event) =>
        event.t === "tool" &&
        event.name === "read_file" &&
        event.args?.path === "notes.txt",
    );
    assert.ok(tool, "expected a read_file tool event for notes.txt");

    const result = events.find(
      (event) =>
        event.t === "result" &&
        event.id === tool.id &&
        event.output === "hello from notes",
    );
    assert.ok(result, "expected the real file contents in a result event");

    assert.ok(
      events.some((event) => event.t === "done"),
      "expected a done event",
    );
    assert.ok(
      !events.some((event) => event.t === "error"),
      "expected no error events",
    );
  } finally {
    await agent.stop();
    project.cleanup();
  }
});

test("reads a nested file inside the project root", async () => {
  const project = makeProject({
    "src/deep/notes.md": "nested contents",
  });
  const agent = await createAgentServer(0, { projectRoot: project.root });
  try {
    const events = await runMission(agent.port, {
      prompt: "read src/deep/notes.md",
    });

    const tool = events.find(
      (event) =>
        event.t === "tool" &&
        event.name === "read_file" &&
        event.args?.path === "src/deep/notes.md",
    );
    assert.ok(tool, "expected a read_file tool event for the nested path");

    const result = events.find(
      (event) =>
        event.t === "result" &&
        event.id === tool.id &&
        event.output === "nested contents",
    );
    assert.ok(result, "expected the nested file contents in a result event");
  } finally {
    await agent.stop();
    project.cleanup();
  }
});

test("reports a structured error for a missing file", async () => {
  const project = makeProject({ "notes.txt": "hello" });
  const agent = await createAgentServer(0, { projectRoot: project.root });
  try {
    const events = await runMission(agent.port, {
      prompt: "read missing.txt",
    });

    const error = events.find(
      (event) => event.t === "error" && event.code === "read_failed",
    );
    assert.ok(error, "expected a read_failed error event");
    assert.ok(
      typeof error.message === "string" && error.message.length > 0,
      "expected a non-empty error message",
    );

    assert.ok(
      events.some((event) => event.t === "done"),
      "the mission should still terminate with done",
    );

    const health = await fetch(`http://localhost:${agent.port}/v1/health`);
    assert.equal(health.status, 200, "the agent must survive a failed read");
  } finally {
    await agent.stop();
    project.cleanup();
  }
});

test("rejects ../ traversal outside the project root", async () => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "orvyn-agent-parent-"),
  );
  const projectRoot = path.join(parent, "project");
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(parent, "secret.txt"), "top secret", "utf8");
  const agent = await createAgentServer(0, { projectRoot });
  try {
    const events = await runMission(agent.port, {
      prompt: "read ../secret.txt",
    });

    const error = events.find(
      (event) => event.t === "error" && event.code === "path_outside_root",
    );
    assert.ok(error, "expected a path_outside_root error event");
    assert.ok(
      !events.some(
        (event) => event.t === "result" && event.output === "top secret",
      ),
      "the file outside the root must not be read",
    );
  } finally {
    await agent.stop();
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("rejects an absolute path outside the project root", async () => {
  const project = makeProject({ "notes.txt": "hello" });
  const agent = await createAgentServer(0, { projectRoot: project.root });
  try {
    const outsidePath = path.join(
      path.parse(project.root).root,
      "absolute-secret.txt",
    );
    const events = await runMission(agent.port, {
      prompt: `read ${outsidePath}`,
    });

    const error = events.find(
      (event) => event.t === "error" && event.code === "path_outside_root",
    );
    assert.ok(error, "expected a path_outside_root error event");
    assert.ok(
      !events.some((event) => event.t === "result"),
      "an absolute path outside the root must not produce a result",
    );
  } finally {
    await agent.stop();
    project.cleanup();
  }
});

test("uses the projectRoot supplied by the mission request", async () => {
  const base = makeProject({
    "alpha/file.txt": "alpha contents",
    "beta/file.txt": "beta contents",
  });
  const agent = await createAgentServer(0, { projectRoot: base.root });
  try {
    const alphaEvents = await runMission(agent.port, {
      prompt: "read file.txt",
      projectRoot: "alpha",
    });
    assert.ok(
      alphaEvents.some(
        (event) => event.t === "result" && event.output === "alpha contents",
      ),
      "expected the alpha project file to be read",
    );
    assert.ok(
      !alphaEvents.some(
        (event) => event.t === "result" && event.output === "beta contents",
      ),
      "the alpha mission must not read the beta project",
    );

    const betaEvents = await runMission(agent.port, {
      prompt: "read file.txt",
      projectRoot: "beta",
    });
    assert.ok(
      betaEvents.some(
        (event) => event.t === "result" && event.output === "beta contents",
      ),
      "expected the beta project file to be read",
    );
    assert.ok(
      !betaEvents.some(
        (event) => event.t === "result" && event.output === "alpha contents",
      ),
      "the beta mission must not read the alpha project",
    );
  } finally {
    await agent.stop();
    base.cleanup();
  }
});

test("ignores an absolute projectRoot hint that escapes the configured root", async () => {
  const configured = makeProject({ "file.txt": "configured contents" });
  const outside = makeProject({ "file.txt": "outside contents" });
  const agent = await createAgentServer(0, { projectRoot: configured.root });
  try {
    const events = await runMission(agent.port, {
      prompt: "read file.txt",
      projectRoot: outside.root,
    });

    assert.ok(
      events.some(
        (event) => event.t === "result" && event.output === "configured contents",
      ),
      "expected the read to fall back to the configured root",
    );
    assert.ok(
      !events.some(
        (event) => event.t === "result" && event.output === "outside contents",
      ),
      "an absolute hint must not move the sandbox outside the configured root",
    );
  } finally {
    await agent.stop();
    configured.cleanup();
    outside.cleanup();
  }
});

test("rejects a symlink that escapes the project root", async (t) => {
  const parent = fs.mkdtempSync(
    path.join(os.tmpdir(), "orvyn-agent-symlink-"),
  );
  const projectRoot = path.join(parent, "project");
  fs.mkdirSync(projectRoot);
  fs.writeFileSync(path.join(parent, "secret.txt"), "top secret", "utf8");
  try {
    // Windows file symlinks need privileges; a directory junction
    // does not, so fall back to it and read through the link.
    let readPath: string | null = null;
    try {
      fs.symlinkSync(
        path.join(parent, "secret.txt"),
        path.join(projectRoot, "link.txt"),
        "file",
      );
      readPath = "link.txt";
    } catch {
      try {
        fs.mkdirSync(path.join(parent, "outside"));
        fs.writeFileSync(
          path.join(parent, "outside", "secret.txt"),
          "top secret",
          "utf8",
        );
        fs.symlinkSync(
          path.join(parent, "outside"),
          path.join(projectRoot, "linked"),
          "junction",
        );
        readPath = "linked/secret.txt";
      } catch {
        // no link type available on this platform
      }
    }
    if (readPath === null) {
      t.skip("symlinks and junctions are not supported on this platform");
      return;
    }

    const agent = await createAgentServer(0, { projectRoot });
    try {
      const events = await runMission(agent.port, {
        prompt: `read ${readPath}`,
      });

      const error = events.find(
        (event) => event.t === "error" && event.code === "path_outside_root",
      );
      assert.ok(
        error,
        "expected a path_outside_root error event for the link escape",
      );
      assert.ok(
        !events.some(
          (event) => event.t === "result" && event.output === "top secret",
        ),
        "the link target outside the root must not be read",
      );
    } finally {
      await agent.stop();
    }
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});

test("rejects a mission start request without a prompt", async () => {
  const agent = await createAgentServer(0);
  try {
    const response = await fetch(`http://localhost:${agent.port}/v1/mission/start`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectRoot: "somewhere" }),
    });
    assert.equal(response.status, 400);
  } finally {
    await agent.stop();
  }
});

test("defaults the configured root to the process working directory", async () => {
  const root = fs.mkdtempSync(path.join(process.cwd(), "orvyn-agent-cwd-"));
  const relative = path.relative(process.cwd(), root);
  fs.writeFileSync(path.join(root, "file.txt"), "cwd contents", "utf8");
  const agent = await createAgentServer(0);
  try {
    const events = await runMission(agent.port, {
      prompt: "read file.txt",
      projectRoot: relative,
    });
    assert.ok(
      events.some(
        (event) => event.t === "result" && event.output === "cwd contents",
      ),
      "expected the relative hint to resolve against process.cwd()",
    );
  } finally {
    await agent.stop();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("cancels a streaming mission before completion", async () => {
  const project = makeProject({ "notes.txt": "hello" });
  const agent = await createAgentServer(0, { projectRoot: project.root });
  try {
    const prompt = Array.from({ length: 8 }, () => "read notes.txt").join(
      "\n",
    );
    const missionId = await createMission(agent.port, { prompt });

    const response = await fetch(
      `http://localhost:${agent.port}/v1/mission/${missionId}/stream`,
    );
    assert.equal(response.status, 200);
    if (!response.body) throw new Error("stream response has no body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let received = "";
    const first = await reader.read();
    if (first.value !== undefined) {
      received += decoder.decode(first.value);
    }

    const cancelResponse = await fetch(
      `http://localhost:${agent.port}/v1/mission/${missionId}/cancel`,
      { method: "POST" },
    );
    assert.equal(cancelResponse.status, 200);

    const rest = await reader.read();
    if (rest.value !== undefined) {
      received += decoder.decode(rest.value);
    }

    assert.ok(
      !received.includes('"t":"done"'),
      "a cancelled stream must not emit done",
    );
  } finally {
    await agent.stop();
    project.cleanup();
  }
});
