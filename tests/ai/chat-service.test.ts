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

const PAID_PRICING = {
  currency: "USD",
  tier: "paid",
  inputPerMillionTokens: 3,
  outputPerMillionTokens: 15,
} as const;

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
    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));

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
    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));
    const text = events
      .filter((event) => event.type === "delta")
      .map((event) => (event.type === "delta" ? event.text : ""))
      .join("");
    assert.equal(text, "abc");
  });

  it("reports a stop finish reason and no usage when the provider sends none", async () => {
    const provider = createFakeProvider({ id: "p", models: [model], chunks: ["ok"] });
    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));
    const done = events.at(-1);
    assert.equal(done?.type, "done");
    assert.equal(done?.type === "done" ? done.finishReason : null, "stop");
    assert.equal(done?.type === "done" ? done.usage : null, null);
  });

  it("reports no usage when the provider sends none", async () => {
    // A provider that ignores `stream_options.include_usage` reports nothing, and
    // nothing gets recorded. This is the "usage unavailable" path end to end.
    const provider = createFakeProvider({ id: "p", models: [model], chunks: ["ok"] });
    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));

    const recorded = events
      .filter((event) => event.type === "done")
      .map((event) => (event.type === "done" ? event.usage : "missing"));
    assert.deepEqual(recorded, [null], "an unreported reading must not become a zero row");
  });

  it("forwards usage reported mid-stream, with a computed total", async () => {
    const usage: TokenUsage = { inputTokens: 12, outputTokens: 7 };
    const provider = withStream(createFakeProvider({ id: "p", models: [model] }), async function* () {
      yield { type: "text", delta: "hi" };
      yield { type: "usage", usage };
      yield { type: "done", finishReason: "length" };
    });

    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));
    const done = events.at(-1);
    assert.equal(done?.type === "done" ? done.finishReason : null, "length");
    // The total is derived from the two reported counts, not sent by the test.
    assert.deepEqual(done?.type === "done" ? done.usage : null, {
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 19,
    });
  });

  it("reports usage unavailable when the provider sends only one side", async () => {
    // A partial reading must not become "output only", which would read as a
    // total with an implied zero input.
    const provider = withStream(createFakeProvider({ id: "p", models: [model] }), async function* () {
      yield { type: "text", delta: "hi" };
      yield { type: "usage", usage: { inputTokens: null, outputTokens: 7 } };
      yield { type: "done", finishReason: "stop" };
    });

    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));
    const done = events.at(-1);
    assert.equal(done?.type === "done" ? done.usage : null, null);
  });

  it("records the provider's own counts and nothing invented", async () => {
    // This is the value the route hands to the signed write path, so it is the
    // last point where a forged figure could enter. The counts below come from the
    // provider chunk and nowhere else; the total is the sum, and no other field of
    // the record is derived from the request.
    const provider = withStream(createFakeProvider({ id: "p", models: [model] }), async function* () {
      yield { type: "text", delta: "hi" };
      yield { type: "usage", usage: { inputTokens: 1204, outputTokens: 88 } };
      yield { type: "done", finishReason: "stop" };
    });

    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));
    const meta = events.find((event) => event.type === "meta");
    const done = events.at(-1);
    assert.equal(done?.type === "done" ? done.usage?.totalTokens : null, 1292);

    const record = {
      provider: meta?.type === "meta" ? meta.model.provider : null,
      modelId: meta?.type === "meta" ? meta.model.modelId : null,
      inputTokens: done?.type === "done" ? (done.usage?.inputTokens ?? null) : null,
      outputTokens: done?.type === "done" ? (done.usage?.outputTokens ?? null) : null,
    };
    assert.deepEqual(record, {
      provider: "p",
      modelId: "m1",
      inputTokens: 1204,
      outputTokens: 88,
    });
  });

  it("still reports the model when the answer is empty", async () => {
    const provider = createFakeProvider({ id: "p", models: [model], chunks: [] });
    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));
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

    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));
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
    const events = await collect(streamChatEvents(gatewayWith(provider), [model], request));
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
    const events = await collect(streamChatEvents(gatewayWith(provider), [flat], request));
    const failure = events.at(-1);
    assert.equal(failure?.type === "error" ? failure.error.code : null, "MODEL_UNAVAILABLE");
  });
});

describe("free-only fallback", () => {
  const freeA = makeModel({ provider: "a", modelId: "m", displayName: "Free A" });
  const freeB = makeModel({ provider: "b", modelId: "m", displayName: "Free B" });

  /**
   * Two providers, so a fallback can be observed as a real second attempt rather
   * than a second model on the same endpoint.
   */
  function twoProviderGateway(options: { readonly a: AiProvider; readonly b: AiProvider }): AiGateway {
    return new AiGateway({ registry: createProviderRegistry([options.a, options.b]) });
  }

  function failingProvider(id: string, error: Error) {
    return createFakeProvider({ id, models: [id === "a" ? freeA : freeB], streamError: error });
  }

  const answering = createFakeProvider({ id: "b", models: [freeB], chunks: ["from", "b"] });

  for (const [label, status] of [
    ["timeout", 408],
    ["rate limit", 429],
    ["server error", 503],
  ] as const) {
    it(`falls back to the next free provider on ${label}`, async () => {
      const gateway = twoProviderGateway({
        a: failingProvider("a", providerRequestFailed("a", { status })),
        b: answering,
      });
      const events = await collect(
        streamChatEvents(gateway, [freeA, freeB], request),
      );

      assert.deepEqual(
        events.map((event) => event.type),
        ["meta", "delta", "delta", "done"],
      );
      const meta = events[0];
      assert.equal(
        meta?.type === "meta" ? meta.model.provider : null,
        "b",
        "meta must name the model that actually served",
      );
    });
  }

  it("does not retry a non-retryable failure", async () => {
    // A 400 describes the request, so every other candidate would fail the same
    // way; retrying would just multiply the error.
    const failing = failingProvider("a", providerRequestFailed("a", { status: 400 }));
    const gateway = twoProviderGateway({ a: failing, b: answering });
    const events = await collect(streamChatEvents(gateway, [freeA, freeB], request));

    assert.deepEqual(
      events.map((event) => event.type),
      ["error"],
    );
    assert.equal(failing.calls.stream.length, 1);
  });

  it("does not switch providers after the first token has been emitted", async () => {
    // Splicing two models into one partially-rendered answer would be worse than
    // reporting the failure.
    const partial = withStream(
      createFakeProvider({ id: "a", models: [freeA] }),
      async function* () {
        yield { type: "text", delta: "half " };
        throw providerRequestFailed("a", { status: 503 });
      },
    );
    const gateway = twoProviderGateway({ a: partial, b: answering });
    const events = await collect(streamChatEvents(gateway, [freeA, freeB], request));

    assert.deepEqual(
      events.map((event) => event.type),
      ["meta", "delta", "error"],
    );
    const meta = events[0];
    assert.equal(meta?.type === "meta" ? meta.model.provider : null, "a");
  });

  it("serves from the first candidate and never reaches the second", async () => {
    const first = createFakeProvider({ id: "a", models: [freeA], chunks: ["from", "a"] });
    const second = createFakeProvider({ id: "b", models: [freeB], chunks: ["from", "b"] });
    const gateway = twoProviderGateway({ a: first, b: second });

    const events = await collect(streamChatEvents(gateway, [freeA, freeB], request));
    const meta = events[0];
    assert.equal(meta?.type === "meta" ? meta.model.provider : null, "a");
    assert.equal(first.calls.stream.length, 1);
    assert.equal(second.calls.stream.length, 0, "an unbroken answer must not touch the fallback");
  });

  it("never falls back to a paid model, even when it is ranked next", async () => {
    const paid = makeModel({ provider: "p", modelId: "paid", pricing: PAID_PRICING });
    const paidProvider = createFakeProvider({ id: "p", models: [paid], chunks: ["billed"] });
    const failing = failingProvider("a", providerRequestFailed("a", { status: 503 }));
    const gateway = new AiGateway({ registry: createProviderRegistry([failing, paidProvider]) });

    // Even if a paid descriptor were handed straight to the stream, the
    // fallback loop must not walk it: eligibility is what keeps it off the list.
    const events = await collect(streamChatEvents(gateway, [freeA], request));
    assert.equal(events.at(-1)?.type, "error");
    assert.equal(paidProvider.calls.stream.length, 0);

    // And the paid model is never a candidate in the first place: the only
    // eligible entry is the free one on provider `a`.
    const ranked = await gateway.rankedCandidates(request);
    assert.deepEqual(
      ranked.map((candidate) => `${candidate.provider}/${candidate.modelId}`),
      ["a/m"],
    );
  });

  it("reports every model it tried when all of them fail", async () => {
    const gateway = twoProviderGateway({
      a: failingProvider("a", providerRequestFailed("a", { status: 503 })),
      b: failingProvider("b", providerRequestFailed("b", { status: 429 })),
    });
    const events = await collect(streamChatEvents(gateway, [freeA, freeB], request));

    assert.deepEqual(
      events.map((event) => event.type),
      ["error"],
    );
    const failure = events.at(-1);
    if (failure?.type !== "error") throw new Error("expected an error frame");
    assert.equal(failure.error.retryable, true, "an exhausted free pool is worth retrying later");
    assert.match(failure.error.detail ?? "", /a\/m/);
    assert.match(failure.error.detail ?? "", /b\/m/);
  });

  it("does not spend a second request on a model it already failed", async () => {
    const failing = failingProvider("a", providerRequestFailed("a", { status: 503 }));
    const gateway = twoProviderGateway({ a: failing, b: answering });
    await collect(streamChatEvents(gateway, [freeA, freeB, freeA], request));
    assert.equal(failing.calls.stream.length, 1, "a repeated candidate must not be retried");
  });
});

describe("streamChatEvents cancellation", () => {
  it("emits nothing when the signal is already aborted", async () => {
    const provider = createFakeProvider({ id: "p", models: [model], chunks: ["x"] });
    const controller = new AbortController();
    controller.abort();

    const events = await collect(
      streamChatEvents(gatewayWith(provider), [model], request, { signal: controller.signal }),
    );
    assert.deepEqual(
      events.map((event) => event.type),
      [],
      "an already-aborted request must not announce a model it will never use",
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
      streamChatEvents(gatewayWith(provider), [model], request, { signal: controller.signal }),
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
      streamChatEvents(gatewayWith(provider), [model], request, { signal: controller.signal }),
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
