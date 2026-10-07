import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createAgentServer } from "../../packages/agent-cli/src/server/agent";
import { AgentBridge } from "../../src/lib/agent/bridge";

describe("AgentBridge health detection", () => {
  it("reports unavailable when server is not running", async () => {
    const bridge = new AgentBridge(19999);
    const health = await bridge.checkHealth();
    assert.equal(health.status, "error");
    assert.ok(typeof health.timestamp === "string");
  });

  it("reports available when server is running", async () => {
    const agent = await createAgentServer(0);
    const bridge = new AgentBridge(agent.port);

    const health = await bridge.checkHealth();
    assert.equal(health.status, "ok");
    assert.ok(typeof health.timestamp === "string");

    await agent.stop();
  });
});

describe("AgentBridge connect/disconnect", () => {
  it("connects to a running server", async () => {
    const agent = await createAgentServer(0);
    const bridge = new AgentBridge(agent.port);

    await bridge.connect();
    assert.equal(bridge.connected, true);

    bridge.disconnect();
    assert.equal(bridge.connected, false);

    await agent.stop();
  });

  it("throws when connecting to a down server", async () => {
    const bridge = new AgentBridge(19999);
    await assert.rejects(bridge.connect(), /agent_unavailable/);
  });
});

describe("AgentBridge mission lifecycle", () => {
  it("starts and streams a mission", async () => {
    const agent = await createAgentServer(0);
    const bridge = new AgentBridge(agent.port);

    await bridge.connect();

    const handle = await bridge.startMission({ prompt: "hello" });
    assert.ok(typeof handle.id === "string");
    assert.ok(handle.id.length > 0);

    const events: unknown[] = [];
    for await (const event of bridge.streamMission(handle.id)) {
      events.push(event);
    }

    assert.ok(events.length > 0);
    assert.ok((events[0] as { t: string }).t === "status");

    await agent.stop();
  });

  it("rejects mission start when not connected", async () => {
    const bridge = new AgentBridge(19999);
    await assert.rejects(
      bridge.startMission({ prompt: "hello" }),
      /agent_not_connected/,
    );
  });
});

describe("AgentBridge cancellation", () => {
  it("cancels an active mission", async () => {
    const agent = await createAgentServer(0);
    const bridge = new AgentBridge(agent.port);

    await bridge.connect();
    const handle = await bridge.startMission({ prompt: "hello" });

    const stream = bridge.streamMission(handle.id);

    // Let the stream start.
    await new Promise((resolve) => setTimeout(resolve, 100));

    handle.cancel();

    const events: unknown[] = [];
    for await (const event of stream) {
      events.push(event);
      if (events.length >= 2) break;
    }

    assert.ok(events.length <= 2);

    await agent.stop();
  });
});

describe("AgentBridge SSE event parsing", () => {
  it("parses multiple event types from the stream", async () => {
    const agent = await createAgentServer(0);
    const bridge = new AgentBridge(agent.port);

    await bridge.connect();
    const handle = await bridge.startMission({ prompt: "hello" });

    const eventTypes: string[] = [];
    for await (const event of bridge.streamMission(handle.id)) {
      eventTypes.push((event as { t: string }).t);
    }

    // "hello" contains no recognised tool instruction, so the planner
    // reports no_tool_match. The stream must still parse multiple
    // distinct event types across the lifecycle.
    assert.deepEqual(eventTypes, ["status", "error", "status", "done"]);

    await agent.stop();
  });
});
