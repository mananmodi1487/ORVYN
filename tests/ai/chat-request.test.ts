import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { MAX_TURNS, MAX_TURN_CHARS, parseChatRequest } from "@/lib/ai/chat-request";
import { AiProviderError } from "@/lib/ai/errors";

function turn(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "t1", role: "user", text: "hello", ...overrides };
}

function valid(turns: readonly unknown[], rest: Record<string, unknown> = {}): Record<string, unknown> {
  return { turns, ...rest };
}

/**
 * Asserts the body is rejected with `INVALID_REQUEST` and returns the detail so
 * a test can assert on the reason.
 */
function rejects(body: unknown): string {
  let captured: AiProviderError | undefined;
  try {
    parseChatRequest(body);
  } catch (error) {
    assert.ok(error instanceof AiProviderError, `expected AiProviderError, got ${String(error)}`);
    captured = error;
  }
  assert.ok(captured !== undefined, "expected parseChatRequest to reject this body");
  assert.equal(captured.code, "INVALID_REQUEST");
  // A malformed body fails identically on retry, so it must not be reported as
  // retryable or the client would keep resubmitting it.
  assert.equal(captured.retryable, false);
  return captured.detail ?? "";
}

describe("parseChatRequest shape", () => {
  it("accepts a single user turn and requires streaming", () => {
    const parsed = parseChatRequest(valid([turn()]));
    assert.deepEqual(parsed.messages, [{ role: "user", content: "hello" }]);
    assert.equal(parsed.requireStreaming, true);
  });

  it("keeps assistant turns in order", () => {
    const parsed = parseChatRequest(
      valid([turn({ id: "a" }), turn({ id: "b", role: "assistant", text: "hi" }), turn({ id: "c" })]),
    );
    assert.deepEqual(
      parsed.messages.map((message) => message.role),
      ["user", "assistant", "user"],
    );
  });

  it("passes through a supported strategy", () => {
    const parsed = parseChatRequest(valid([turn()], { strategy: "lowest-cost" }));
    assert.equal(parsed.strategy, "lowest-cost");
  });

  it("passes through a pinned model", () => {
    const parsed = parseChatRequest(
      valid([turn()], { pinnedModel: { provider: "omniroute", modelId: "m1" } }),
    );
    assert.deepEqual(parsed.pinnedModel, { provider: "omniroute", modelId: "m1" });
  });

  it("omits optional fields rather than setting them undefined", () => {
    const parsed = parseChatRequest(valid([turn()]));
    assert.equal("strategy" in parsed, false);
    assert.equal("pinnedModel" in parsed, false);
  });
});

describe("parseChatRequest rejects", () => {
  it("rejects a non-object body", () => {
    rejects("hi");
    rejects(null);
    rejects([]);
  });

  it("rejects a missing or empty turn list", () => {
    rejects({});
    rejects(valid([]));
    rejects({ turns: "hello" });
    rejects({ turns: 42 });
  });

  it("requires the conversation to start with the user", () => {
    const detail = rejects(valid([turn({ role: "assistant" })]));
    assert.match(detail, /start with a `user` turn/);
  });

  it("requires the conversation to end with the user", () => {
    const detail = rejects(
      valid([turn({ id: "a" }), turn({ id: "b", role: "assistant" })]),
    );
    assert.match(detail, /end with a `user` turn/);
  });

  it("rejects an assistant-only conversation", () => {
    rejects(valid([turn({ role: "assistant" })]));
  });

  it("rejects a malformed turn", () => {
    rejects(valid([turn({ role: "system" })]));
    rejects(valid([turn({ text: 42 })]));
    rejects(valid([turn({ text: "   " })]));
    rejects(valid([turn({ id: "" })]));
    rejects(valid([null]));
    rejects(valid(["hi"]));
  });

  it("rejects a turn that exceeds the per-message cap", () => {
    const detail = rejects(valid([turn({ text: "x".repeat(MAX_TURN_CHARS + 1) })]));
    assert.match(detail, /at most 8000 characters/);
  });

  it("accepts a turn exactly at the per-message cap", () => {
    const parsed = parseChatRequest(valid([turn({ text: "x".repeat(MAX_TURN_CHARS) })]));
    assert.equal(parsed.messages.length, 1);
  });

  it("rejects a conversation that exceeds the total cap", () => {
    const tooMany = Array.from({ length: MAX_TURNS + 1 }, (_, index) =>
      turn({ id: `t${index}`, role: index === 0 ? "user" : "assistant" }),
    );
    assert.match(rejects(valid(tooMany)), /at most 100 messages/);
  });

  it("rejects an unsupported strategy", () => {
    assert.match(rejects(valid([turn()], { strategy: "cheapest" })), /routing strategy/);
    rejects(valid([turn()], { strategy: 7 }));
  });

  it("rejects a malformed pinned model", () => {
    rejects(valid([turn()], { pinnedModel: { provider: "", modelId: "m" } }));
    rejects(valid([turn()], { pinnedModel: { provider: "p" } }));
    rejects(valid([turn()], { pinnedModel: "m" }));
  });

  it("treats a null pinned model as absent", () => {
    const parsed = parseChatRequest(valid([turn()], { pinnedModel: null }));
    assert.equal("pinnedModel" in parsed, false);
  });
});
