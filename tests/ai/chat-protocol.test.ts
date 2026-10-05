import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ERROR_STATUS, parseChatStreamEvent } from "@/lib/ai/chat-protocol";
import { AI_ERROR_CODES } from "@/lib/ai/errors";

describe("parseChatStreamEvent", () => {
  it("parses a meta frame", () => {
    const event = parseChatStreamEvent({
      type: "meta",
      model: { provider: "omniroute", modelId: "m1", displayName: "Model One" },
    });
    assert.deepEqual(event, {
      type: "meta",
      model: { provider: "omniroute", modelId: "m1", displayName: "Model One" },
    });
  });

  it("falls back to the model id when no display name is present", () => {
    const event = parseChatStreamEvent({
      type: "meta",
      model: { provider: "p", modelId: "m1" },
    });
    assert.equal(event?.type === "meta" ? event.model.displayName : null, "m1");
  });

  it("parses a delta frame", () => {
    assert.deepEqual(parseChatStreamEvent({ type: "delta", text: "hi" }), {
      type: "delta",
      text: "hi",
    });
  });

  it("drops an empty delta rather than rendering nothing", () => {
    assert.equal(parseChatStreamEvent({ type: "delta", text: "" }), null);
  });

  it("parses a done frame and defaults the finish reason", () => {
    assert.deepEqual(parseChatStreamEvent({ type: "done", finishReason: "length" }), {
      type: "done",
      finishReason: "length",
      usage: null,
    });

    const bare = parseChatStreamEvent({ type: "done" });
    assert.equal(bare?.type === "done" ? bare.finishReason : null, "stop");
  });

  it("parses an error frame", () => {
    const event = parseChatStreamEvent({
      type: "error",
      error: {
        code: "NO_ELIGIBLE_MODEL",
        message: "No AI model is available yet.",
        retryable: false,
        detail: "model-unknown: p/m1",
      },
    });
    assert.deepEqual(event, {
      type: "error",
      error: {
        code: "NO_ELIGIBLE_MODEL",
        message: "No AI model is available yet.",
        retryable: false,
        detail: "model-unknown: p/m1",
      },
    });
  });

  it("defaults retryable to false and detail to null", () => {
    const event = parseChatStreamEvent({ type: "error", error: { code: "INVALID_REQUEST" } });
    assert.equal(event?.type === "error" ? event.error.retryable : null, false);
    assert.equal(event?.type === "error" ? event.error.detail : null, null);
  });

  it("rejects frames it cannot understand", () => {
    assert.equal(parseChatStreamEvent(null), null);
    assert.equal(parseChatStreamEvent("hi"), null);
    assert.equal(parseChatStreamEvent([]), null);
    assert.equal(parseChatStreamEvent({ type: "unknown" }), null);
    assert.equal(parseChatStreamEvent({ type: "meta" }), null);
    assert.equal(parseChatStreamEvent({ type: "meta", model: { provider: "p" } }), null);
    assert.equal(parseChatStreamEvent({ type: "error", error: {} }), null);
    assert.equal(parseChatStreamEvent({ type: "error" }), null);
  });
});

describe("ERROR_STATUS", () => {
  it("covers every error code the layer can produce", () => {
    assert.deepEqual(Object.keys(ERROR_STATUS).sort(), [...AI_ERROR_CODES].sort());
  });

  it("separates client mistakes from operator and upstream failures", () => {
    // A malformed body and a pinned model the operator has withdrawn are the
    // client's problem: retrying the identical request cannot help.
    assert.equal(ERROR_STATUS.INVALID_REQUEST, 400);
    assert.equal(ERROR_STATUS.MODEL_UNAVAILABLE, 422);

    // Nothing configured and a failed upstream call are both worth retrying
    // once an operator fixes the environment.
    assert.equal(ERROR_STATUS.NO_ELIGIBLE_MODEL, 503);
    assert.equal(ERROR_STATUS.PROVIDER_UNAVAILABLE, 503);
    assert.equal(ERROR_STATUS.PROVIDER_REQUEST_FAILED, 502);
  });
});
