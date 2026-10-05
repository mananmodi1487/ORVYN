import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ChatStreamEvent } from "@/lib/ai/chat-protocol";
import {
  selectChatModel,
  streamChatEvents,
  toChatStreamError,
} from "@/lib/ai/chat-service";
import { noEligibleModel, providerRequestFailed } from "@/lib/ai/errors";
import { AiGateway } from "@/lib/ai/gateway";
import { createProviderRegistry } from "@/lib/ai/registry";
import type { AiProvider } from "@/lib/ai/provider";
import type {
  ChatRequest,
  GenerationChunk,
  ModelDescriptor,
  TokenUsage,
} from "@/lib/ai/types";
import { createFakeProvider, makeModel, textChatCapabilities } from "./fixtures/fake-provider";

const request: ChatRequest = {
  messages: [{ role: "user", content: "hi" }],
  requireStreaming: true,
};

const model: ModelDescriptor = makeModel({
  provider: "p",
  modelId: "m1",
  displayName: "Model One",
});

async function collect(
  stream: AsyncIterable<ChatStreamEvent>,
): Promise<ChatStreamEvent[]> {
  const events: ChatStreamEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

function gatewayWith(provider: AiProvider): AiGateway {
  return new AiGateway({ registry: createProviderRegistry([provider]) });
}

/** Wraps a provider so `stream` yields a fixed script of chunks. */
function withStream(
  provider: AiProvider,
  script: () => AsyncGenerator<GenerationChunk>,
): AiProvider {
  return { ...provider, stream: () => script() };
}

describe("selectChatModel", () => {
  it("returns the routed model", async () => {
    const provider = createFakeProvider({ id: "p", models: [model] });
    const selected = await selectChatModel(gatewayWith(provider), request);
    assert.equal(selected.modelId, "m1");
    assert.equal(provider.calls.stream.length, 0, "selection must not start a generation");
  });

  it("throws before any provider call when nothing is eligible", async () => {
    const provider = createFakeProvider({ id: "p", models: [] });
    await assert.rejects(
      () => selectChatModel(gatewayWith(provider), request),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "NO_ELIGIBLE_MODEL");
        return true;
      },
    );
    assert.equal(provider.calls.stream.length, 0);
  });

  it("excludes a model that cannot stream", async () => {
    // The endpoint only ever streams, so a non-streaming model must be
    // ineligible rather than failing mid-answer.
    const nonStreaming = makeModel({
      provider: "p",
      modelId: "flat",
      capabilities: textChatCapabilities({ supportsStreaming: false }),
    });
    const provider = createFakeProvider({ id: "p", models: [nonStreaming, model] });
    const selected = await selectChatModel(gatewayWith(provider), request);
    assert.equal(selected.modelId, "m1");
  });

  it("rejects a pinned model that cannot stream, naming it", async () => {
    const nonStreaming = makeModel({
      provider: "p",
      modelId: "flat",
      capabilities: textChatCapabilities({ supportsStreaming: false }),
    });
    const provider = createFakeProvider({ id: "p", models: [nonStreaming] });
    await assert.rejects(
      () =>
        selectChatModel(gatewayWith(provider), {
          ...request,
          pinnedModel: { provider: "p", modelId: "flat" },
        }),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "MODEL_UNAVAILABLE");
        assert.equal((error as { modelId?: string }).modelId, "flat");
        return true;
      },
    );
  });
});

describe("streamChatEvents sequencing", () => {
  it("reports the model before any text", async () => {
    const provider = createFakeProvider({ id: "p", models: [model], chunks: ["Hel", "lo"] });
    const events = await collect(streamChatEvents(gatewayWith(provider), model, request));

    assert.equal(events[0]?.type, "meta");
    assert.deepEqual(events[0]?.type === "meta" ? events[0].model : null, {
      provider: "p",
      modelId: "m1",
      displayName: "Model One",
    });
    assert.deepEqual(
      events.map((event) => event.type),
      ["meta", "delta", "delta", "done"],
    );
  });

  it("concatenates deltas into one answer", async () => {
    const provider = createFakeProvider({ id: "p", models: [model], chunks: ["a", "b", "c"] });
    const events = await collect(streamChatEvents(gatewayWith(provider), model, request));
    const text = events
      .filter((event) => event.type === "delta")
      .map((event) => (event.type === "delta" ? event.text : ""))
      .join("");
    assert.equal(text, "abc");
  });

  it("reports a stop finish reason and no usage when the provider sends none", async () => {
    const provider = createFakeProvider({ id: "p", models: [model], chunks: ["ok"] });
    const events = await collect(streamChatEvents(gatewayWith(provider), model, request));
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    assert.equal(done?.type === "done" ? done.finishReason : null, "stop");
    assert.equal(done?.type === "done" ? done.usage : null, null);
  });

  it("forwards usage reported mid-stream", async () => {
    const usage: TokenUsage = { inputTokens: 12, outputTokens: 7 };
    const provider = withStream(createFakeProvider({ id: "p", models: [model] }), async function* () {
      yield { type: "text", delta: "hi" };
      yield { type: "usage", usage };
      yield { type: "done", finishReason: "length" };
    });

    const events = await collect(streamChatEvents(gatewayWith(provider), model, request));
    const done = events.at(-1);
    assert.equal(done?.type === "done" ? done.finishReason : null, "length");
    assert.deepEqual(done?.type === "done" ? done.usage : null, usage);
  });

  it("still reports the model when the answer is empty", async () => {
    const provider = createFakeProvider({ id: "p", models: [model], chunks: [] });
    const events = await collect(streamChatEvents(gatewayWith(provider), model, request));
    assert.deepEqual(
      events.map((event) => event.type),
      ["meta", "done"],
    );
  });
});

describe("streamChatEvents failures", () => {
  it("keeps text delivered before a mid-stream failure", async () => {
    // The socket dies after the first token. A real provider behaves this way,
    // so the frames already emitted must survive the failure.
    const provider = withStream(createFakeProvider({ id: "p", models: [model] }), async function* () {
      yield { type: "text", delta: "par" };
      yield { type: "text", delta: "tial" };
      throw providerRequestFailed("p", { status: 500 });
    });

    const events = await collect(streamChatEvents(gatewayWith(provider), model, request));
    assert.deepEqual(
      events.map((event) => event.type),
      ["meta", "delta", "delta", "error"],
      "a failure after text must not discard the text",
    );
    const failure = events.at(-1);
    assert.equal(failure?.type === "error" ? failure.error.code : null, "PROVIDER_REQUEST_FAILED");
  });

  it("marks an upstream 5xx as retryable", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [model],
      streamError: providerRequestFailed("p", { status: 503 }),
    });
    const events = await collect(streamChatEvents(gatewayWith(provider), model, request));
    const failure = events.at(-1);
    assert.equal(failure?.type === "error" ? failure.error.retryable : null, true);
  });

  it("refuses a model that cannot stream even on the pre-selected path", async () => {
    // Guards the lower-level entry point: skipping selection must not also skip
    // the streaming gate.
    const flat = makeModel({
      provider: "p",
      modelId: "flat",
      capabilities: textChatCapabilities({ supportsStreaming: false }),
    });
    const provider = createFakeProvider({ id: "p", models: [flat] });
    const events = await collect(streamChatEvents(gatewayWith(provider), flat, request));
    const failure = events.at(-1);
    assert.equal(failure?.type === "error" ? failure.error.code : null, "MODEL_UNAVAILABLE");
  });
});

describe("streamChatEvents cancellation", () => {
  it("emits only the model when the signal is already aborted", async () => {
    const provider = createFakeProvider({ id: "p", models: [model], chunks: ["x"] });
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      streamChatEvents(gatewayWith(provider), model, request, { signal: controller.signal }),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["meta"],
    );
    assert.equal(provider.calls.stream.length, 0, "an aborted request must not reach a provider");
  });

  it("ends without done or error when aborted mid-stream", async () => {
    // The provider stops the way a real one does when its socket is cancelled:
    // iteration just ends.
    const controller = new AbortController();
    const provider = withStream(createFakeProvider({ id: "p", models: [model] }), async function* () {
      yield { type: "text", delta: "partial" };
      controller.abort();
    });

    const events = await collect(
      streamChatEvents(gatewayWith(provider), model, request, { signal: controller.signal }),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["meta", "delta"],
      "a cancelled stream must not report a completed answer",
    );
  });

  it("swallows an abort that races a provider failure", async () => {
    const controller = new AbortController();
    const provider = withStream(createFakeProvider({ id: "p", models: [model] }), async function* () {
      yield { type: "text", delta: "partial" };
      controller.abort();
      throw providerRequestFailed("p", { status: 500 });
    });

    const events = await collect(
      streamChatEvents(gatewayWith(provider), model, request, { signal: controller.signal }),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      ["meta", "delta"],
      "a cancelled stream must not be reported as a failure",
    );
  });
});

describe("toChatStreamError", () => {
  it("keeps the code and retryability of an AI error", () => {
    const error = toChatStreamError(noEligibleModel("nothing declared"));
    assert.equal(error.code, "NO_ELIGIBLE_MODEL");
    assert.equal(error.retryable, false);
    assert.equal(error.detail, "nothing declared");
  });

  it("does not echo an unexpected internal error", () => {
    const error = toChatStreamError(new Error("secret prompt text leaked"));
    assert.equal(error.code, "PROVIDER_REQUEST_FAILED");
    assert.equal(error.retryable, true);
    assert.equal(error.detail, "unexpected internal failure");
    assert.equal(error.message.includes("secret"), false);
  });

  it("handles a non-Error throw", () => {
    assert.equal(toChatStreamError("boom").code, "PROVIDER_REQUEST_FAILED");
  });
});
