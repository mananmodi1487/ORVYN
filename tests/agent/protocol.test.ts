import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type {
  AgentEvent,
  AgentHealth,
  MissionHandle,
  MissionRequest,
} from "../../src/lib/agent/protocol";

describe("protocol types", () => {
  it("accepts a valid health response", () => {
    const health: AgentHealth = { status: "ok", timestamp: "2026-01-01T00:00:00Z" };
    assert.equal(health.status, "ok");
    assert.ok(typeof health.timestamp === "string");
  });

  it("accepts a valid mission request", () => {
    const request: MissionRequest = { prompt: "fix the bug", projectRoot: "/tmp" };
    assert.equal(request.prompt, "fix the bug");
    assert.equal(request.projectRoot, "/tmp");
  });

  it("accepts mission request without optional projectRoot", () => {
    const request: MissionRequest = { prompt: "hello" };
    assert.equal(request.prompt, "hello");
    assert.equal(request.projectRoot, undefined);
  });

  it("accepts a valid mission handle", () => {
    const handle: MissionHandle = {
      id: "mission-1",
      async start() {},
      cancel() {},
    };
    assert.equal(handle.id, "mission-1");
  });

  it("accepts a status event", () => {
    const event: AgentEvent = { t: "status", state: "working" };
    assert.equal(event.t, "status");
    assert.equal(event.state, "working");
  });

  it("accepts a tool event", () => {
    const event: AgentEvent = {
      t: "tool",
      id: "1",
      name: "read_file",
      args: { path: "src/foo.ts" },
    };
    assert.equal(event.t, "tool");
    assert.equal(event.name, "read_file");
  });

  it("accepts a result event", () => {
    const event: AgentEvent = { t: "result", id: "1", output: "hello" };
    assert.equal(event.t, "result");
    assert.equal(event.output, "hello");
  });

  it("accepts a diff event", () => {
    const event: AgentEvent = { t: "diff", file: "src/foo.ts", patch: "@@" };
    assert.equal(event.t, "diff");
    assert.equal(event.file, "src/foo.ts");
  });

  it("accepts a terminal event", () => {
    const event: AgentEvent = { t: "terminal", cmd: "npm test", output: "ok" };
    assert.equal(event.t, "terminal");
    assert.equal(event.cmd, "npm test");
  });

  it("accepts an error event", () => {
    const event: AgentEvent = { t: "error", code: "rate_limited", message: "too many" };
    assert.equal(event.t, "error");
    assert.equal(event.code, "rate_limited");
  });

  it("accepts a done event", () => {
    const event: AgentEvent = {
      t: "done",
      summary: { filesChanged: 2, testsRun: 4 },
    };
    assert.equal(event.t, "done");
    assert.equal(event.summary.filesChanged, 2);
  });

  it("excludes secrets from mission request shape", () => {
    const request: MissionRequest = { prompt: "do work" };
    assert.ok(!("secret" in request));
    assert.ok(!("apiKey" in request));
    assert.ok(!("token" in request));
  });
});
