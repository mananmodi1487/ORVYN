import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiProviderError } from "@/lib/ai/errors";
import { humanizeModelId, type ModelDeclaration } from "@/lib/ai/providers/model-declaration";
import {
  createOpenAiCompatibleProvider,
  parseSseDataLine,
  readSseLines,
} from "@/lib/ai/providers/openai-provider";
import type { FetchLike } from "@/lib/ai/providers/openai-compatible";
import { createFreeLlmApiProvider } from "@/lib/ai/providers/freellm";
import { createOmniRouteProvider } from "@/lib/ai/providers/omniroute";
import type { ChatRequest } from "@/lib/ai/types";

const request: ChatRequest = { messages: [{ role: "user", content: "hi" }], maxOutputTokens: 64 };

const info = {
  id: "omniroute",
  kind: "gateway" as const,
  displayName: "OmniRoute",
  configured: true,
  configurationDetail: null,
};

interface Call {
  readonly url: string;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

function recorder(
  responder: (call: Call) => Response | Promise<Response>,
): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl: FetchLike = async (url, init) => {
    const call: Call = {
      url,
      method: init?.method ?? "GET",
      headers: init?.headers ?? {},
      body: init?.body === undefined ? undefined : (JSON.parse(init.body) as unknown),
    };
    calls.push(call);
    return responder(call);
  };
  return { fetchImpl, calls };
}

function json(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function sse(lines: readonly string[]): Response {
  const body = lines.map((line) => `${line}\n`).join("");
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/event-stream" },
  });
}

const declarations: ModelDeclaration[] = [
  {
    provider: "omniroute",
    modelId: "chat-large",
    displayName: "Chat Large",
    enabled: true,
    availability: "available",
    priority: 10,
    capabilities: {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsStreaming: true,
      supportsSystemPrompt: true,
    },
    pricing: { tier: "paid", inputPerMillionTokens: 3, outputPerMillionTokens: 15 },
    context: { contextWindowTokens: 200_000, maxOutputTokens: 8_000 },
  },
];

describe("humanizeModelId", () => {
  it("splits separators and camel case without inventing capitals", () => {
    assert.equal(humanizeModelId("gpt-4o-mini"), "gpt 4o mini");
    assert.equal(humanizeModelId("claude-3.5_sonnet"), "claude 3 5 sonnet");
  });

  it("leaves an already-capitalized token alone", () => {
    assert.equal(humanizeModelId("TTS-model"), "TTS model");
  });
});

describe("model listing", () => {
  it("maps reported ids onto descriptors and merges declarations", async () => {
    const { fetchImpl, calls } = recorder(() =>
      json({ data: [{ id: "chat-large" }, { id: "chat-unknown" }] }),
    );
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
      declarations,
    });

    const models = await provider.listModels();
    assert.deepEqual(
      models.map((model) => model.modelId),
      ["chat-large", "chat-unknown"],
    );
    const declared = models[0];
    assert.equal(declared?.displayName, "Chat Large");
    assert.equal(declared?.enabled, true);
    assert.equal(declared?.availability, "available");
    assert.deepEqual(declared?.capabilities.inputModalities, ["text"]);
    assert.equal(declared?.pricing.outputPerMillionTokens, 15);
    assert.equal(declared?.context.contextWindowTokens, 200_000);
    assert.equal(calls[0]?.url, "https://api.example.test/v1/models");
  });

  it("reports an undeclared model as unverified rather than assuming chat capability", async () => {
    const { fetchImpl } = recorder(() => json({ data: [{ id: "mystery" }] }));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
      declarations,
    });

    const [model] = await provider.listModels();
    assert.deepEqual(model?.capabilities.inputModalities, []);
    assert.equal(model?.availability, "unknown");
    assert.equal(model?.enabled, false, "an undeclared model must not be enabled by default");
    assert.equal(model?.pricing.tier, "unknown");
    assert.equal(model?.context.contextWindowTokens, null);
  });

  it("falls back to configured ids when the list endpoint returns nothing usable", async () => {
    const { fetchImpl } = recorder(() => json({ data: [] }));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
      declarations,
      fallbackModelIds: ["chat-large"],
    });
    const models = await provider.listModels();
    assert.deepEqual(
      models.map((model) => model.modelId),
      ["chat-large"],
    );
  });

  it("skips malformed entries instead of surfacing broken descriptors", async () => {
    const { fetchImpl } = recorder(() => json({ data: [{ id: "" }, null, 7, { id: "ok" }] }));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    assert.deepEqual((await provider.listModels()).map((model) => model.modelId), ["ok"]);
  });

  it("translates an http failure into PROVIDER_REQUEST_FAILED", async () => {
    const { fetchImpl } = recorder(() => json({ error: { message: "invalid api key" } }, 401));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "bad",
      fetchImpl,
    });
    await assert.rejects(provider.listModels(), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "PROVIDER_REQUEST_FAILED");
      assert.equal(error.status, 401);
      assert.equal(error.retryable, false);
      assert.match(error.detail ?? "", /invalid api key/);
      return true;
    });
  });

  it("translates a transport failure without leaking the api key", async () => {
    const fetchImpl: FetchLike = async () => {
      throw new TypeError("fetch failed");
    };
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "super-secret",
      fetchImpl,
    });
    await assert.rejects(provider.listModels(), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "PROVIDER_REQUEST_FAILED");
      assert.equal(error.message.includes("super-secret"), false);
      return true;
    });
  });
});

describe("authentication and request shape", () => {
  it("sends the bearer token and a json body", async () => {
    const { fetchImpl, calls } = recorder(() =>
      json({ id: "r1", choices: [{ message: { content: "ok" }, finish_reason: "stop" }] }),
    );
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "secret-key",
      fetchImpl,
    });
    await provider.generate(request, { provider: "omniroute", modelId: "chat-large" });

    const call = calls[0];
    assert.equal(call?.method, "POST");
    assert.equal(call?.url, "https://api.example.test/v1/chat/completions");
    assert.equal(call?.headers["authorization"], "Bearer secret-key");
    assert.deepEqual(call?.body, {
      model: "chat-large",
      messages: [{ role: "user", content: "hi" }],
      stream: false,
      max_tokens: 64,
    });
  });

  it("omits optional fields the request did not set", async () => {
    const { fetchImpl, calls } = recorder(() => json({ choices: [] }));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    await provider.generate({ messages: [] }, { provider: "omniroute", modelId: "m" });
    const body = calls[0]?.body as Record<string, unknown>;
    assert.equal("max_tokens" in body, false);
    assert.equal("temperature" in body, false);
  });
});

describe("generation results", () => {
  it("reads content, finish reason, usage and request id", async () => {
    const { fetchImpl } = recorder(() =>
      json({
        id: "req-9",
        model: "chat-large",
        choices: [{ message: { content: "hello" }, finish_reason: "length" }],
        usage: { prompt_tokens: 11, completion_tokens: 22 },
      }),
    );
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
      declarations,
    });
    const result = await provider.generate(request, { provider: "omniroute", modelId: "chat-large" });
    assert.equal(result.content, "hello");
    assert.equal(result.finishReason, "length");
    assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 22 });
    assert.equal(result.providerRequestId, "req-9");
    assert.equal(result.model.modelId, "chat-large");
  });

  it("joins content parts when the gateway returns an array", async () => {
    const { fetchImpl } = recorder(() =>
      json({ choices: [{ message: { content: [{ text: "a" }, { text: "b" }] } }] }),
    );
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.generate(request, { provider: "omniroute", modelId: "m" });
    assert.equal(result.content, "ab");
  });

  it("falls back to stop for an unrecognized finish reason and empty content", async () => {
    const { fetchImpl } = recorder(() => json({ choices: [{ finish_reason: "mystery" }] }));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    const result = await provider.generate(request, { provider: "omniroute", modelId: "m" });
    assert.equal(result.finishReason, "stop");
    assert.equal(result.content, "");
    assert.equal(result.usage, null);
  });

  it("rejects a non-object completion payload", async () => {
    const { fetchImpl } = recorder(() => json(["not", "an", "object"]));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    await assert.rejects(
      provider.generate(request, { provider: "omniroute", modelId: "m" }),
      (error: unknown) => {
        assert.ok(error instanceof AiProviderError);
        assert.equal(error.code, "PROVIDER_REQUEST_FAILED");
        assert.match(error.detail ?? "", /malformed/);
        return true;
      },
    );
  });

  it("rejects a non-json success body", async () => {
    const fetchImpl: FetchLike = async () => new Response("<html>oops</html>", { status: 200 });
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    await assert.rejects(provider.generate(request, { provider: "omniroute", modelId: "m" }), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.match(error.detail ?? "", /non-JSON/);
      return true;
    });
  });
});

describe("health check", () => {
  it("reports up with no latency when the clock is fixed", async () => {
    const { fetchImpl } = recorder(() => json({ data: [] }));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });
    const health = await provider.healthCheck();
    assert.equal(health.reachable, true);
    assert.equal(health.status, "up");
    assert.equal(health.latencyMs, 0);
    assert.equal(health.checkedAt, "2026-01-01T00:00:00.000Z");
  });

  it("reports down with a detail when the endpoint fails", async () => {
    const { fetchImpl } = recorder(() => json({ error: { message: "down" } }, 503));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    const health = await provider.healthCheck();
    assert.equal(health.reachable, false);
    assert.equal(health.status, "down");
    assert.equal(health.latencyMs, null);
    assert.match(health.detail ?? "", /Request to provider "omniroute" failed/);
  });

  it("never calls the network for an unconfigured provider", async () => {
    const { fetchImpl, calls } = recorder(() => json({ data: [] }));
    const provider = createOpenAiCompatibleProvider({
      info: { ...info, configured: false, configurationDetail: "OMNIROUTE_API_KEY is not set" },
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    const health = await provider.healthCheck();
    assert.equal(health.reachable, false);
    assert.equal(health.detail, "OMNIROUTE_API_KEY is not set");
    assert.equal(calls.length, 0);
  });
});

describe("sse parsing", () => {
  it("parses data lines and ignores everything else", () => {
    assert.deepEqual(parseSseDataLine('data: {"a":1}'), { a: 1 });
    assert.equal(parseSseDataLine("data: [DONE]"), null);
    assert.equal(parseSseDataLine(""), null);
    assert.equal(parseSseDataLine(": comment"), null);
    assert.equal(parseSseDataLine("event: ping"), null);
    assert.equal(parseSseDataLine("data: not json"), null);
  });

  it("splits a byte stream on newlines, including across chunk boundaries", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"a\""));
        controller.enqueue(encoder.encode(":1}\ndata: [DONE]\n"));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of readSseLines(stream)) lines.push(line);
    assert.deepEqual(lines, ['data: {"a":1}', "data: [DONE]"]);
  });

  it("handles a final line with no trailing newline", async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("data: {\"a\":1}"));
        controller.close();
      },
    });
    const lines: string[] = [];
    for await (const line of readSseLines(stream)) lines.push(line);
    assert.deepEqual(lines, ['data: {"a":1}']);
  });
});

describe("streaming", () => {
  it("emits text deltas, usage and a terminal done chunk", async () => {
    const { fetchImpl, calls } = recorder(() =>
      sse([
        'data: {"choices":[{"delta":{"content":"he"}}]}',
        'data: {"choices":[{"delta":{"content":"llo"}}]}',
        'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":4}}',
        "data: [DONE]",
      ]),
    );
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });

    const chunks: unknown[] = [];
    for await (const chunk of provider.stream(request, { provider: "omniroute", modelId: "m" })) {
      chunks.push(chunk);
    }
    assert.deepEqual(chunks, [
      { type: "text", delta: "he" },
      { type: "text", delta: "llo" },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 4 } },
      { type: "done", finishReason: "stop" },
    ]);
    assert.equal((calls[0]?.body as Record<string, unknown>)["stream"], true);
  });

  it("defaults the finish reason to stop when the stream never reports one", async () => {
    const { fetchImpl } = recorder(() => sse(['data: {"choices":[{"delta":{"content":"x"}}]}']));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    const chunks: unknown[] = [];
    for await (const chunk of provider.stream(request, { provider: "omniroute", modelId: "m" })) {
      chunks.push(chunk);
    }
    assert.deepEqual(chunks, [
      { type: "text", delta: "x" },
      { type: "done", finishReason: "stop" },
    ]);
  });

  it("fails before the first chunk when the endpoint rejects the stream", async () => {
    const { fetchImpl } = recorder(() => json({ error: { message: "no" } }, 429));
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    await assert.rejects(drain(provider.stream(request, { provider: "omniroute", modelId: "m" })), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "PROVIDER_REQUEST_FAILED");
      assert.equal(error.status, 429);
      assert.equal(error.retryable, true);
      return true;
    });
  });

  it("fails when the response has no body", async () => {
    const fetchImpl: FetchLike = async () =>
      new Response(null, { status: 200, headers: { "content-type": "text/event-stream" } });
    const provider = createOpenAiCompatibleProvider({
      info,
      baseUrl: "https://api.example.test/v1",
      apiKey: "k",
      fetchImpl,
    });
    await assert.rejects(
      drain(provider.stream(request, { provider: "omniroute", modelId: "m" })),
      (error: unknown) => {
        assert.ok(error instanceof AiProviderError);
        assert.match(error.detail ?? "", /empty stream/);
        return true;
      },
    );
  });
});

/** Consumes a stream so a rejection surfaces, and counts what arrived first. */
async function drain(stream: AsyncIterable<unknown>): Promise<number> {
  const iterator = stream[Symbol.asyncIterator]();
  let count = 0;
  for (let next = await iterator.next(); next.done !== true; next = await iterator.next()) {
    count += 1;
  }
  return count;
}

describe("gateway-specific providers", () => {
  it("omniRoute and freeLlmApi share the adapter and differ only in identity", async () => {
    const omni = createOmniRouteProvider({
      configured: true,
      baseUrl: "https://omni.example.test/v1",
      apiKey: "k1",
      fetchImpl: async () => json({ data: [{ id: "chat-large" }] }),
      declarations,
    });
    const free = createFreeLlmApiProvider({
      configured: true,
      baseUrl: "https://free.example.test/v1",
      apiKey: "k2",
      fetchImpl: async () => json({ data: [{ id: "chat-large" }] }),
      declarations,
    });

    assert.equal(omni.info.id, "omniroute");
    assert.equal(free.info.id, "freellmapi");
    assert.equal(omni.info.kind, "gateway");
    assert.deepEqual(
      (await omni.listModels()).map((model) => model.provider),
      ["omniroute"],
    );
    assert.deepEqual(
      (await free.listModels()).map((model) => model.provider),
      ["freellmapi"],
    );
  });

  it("carries the configuration detail into an unconfigured provider's identity", () => {
    const provider = createOmniRouteProvider({
      configured: false,
      configurationDetail: "OMNIROUTE_BASE_URL is not set",
      baseUrl: "https://omni.example.test/v1",
      apiKey: "",
    });
    assert.equal(provider.info.configured, false);
    assert.equal(provider.info.configurationDetail, "OMNIROUTE_BASE_URL is not set");
  });
});