import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_ELIGIBILITY_POLICY } from "@/lib/ai/eligibility";
import { AiProviderError } from "@/lib/ai/errors";
import { AiGateway, describeExclusions } from "@/lib/ai/gateway";
import { createProviderRegistry } from "@/lib/ai/registry";
import type { ChatRequest, GenerationChunk, ModelCapabilities } from "@/lib/ai/types";
import {
  createFakeProvider,
  healthy,
  makeModel,
  unreachable,
} from "./fixtures/fake-provider";

const request: ChatRequest = { messages: [{ role: "user", content: "hi" }] };

async function collect(stream: AsyncIterable<GenerationChunk>): Promise<GenerationChunk[]> {
  const chunks: GenerationChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

describe("gateway catalog", () => {
  it("never lists models from an unconfigured provider", async () => {
    const configured = createFakeProvider({
      id: "on",
      models: [makeModel({ provider: "on", modelId: "m1" })],
    });
    const unconfigured = createFakeProvider({
      id: "off",
      configured: false,
      configurationDetail: "OMNIROUTE_API_KEY is not set",
      models: [makeModel({ provider: "off", modelId: "m2" })],
    });
    const gateway = new AiGateway({
      registry: createProviderRegistry([unconfigured, configured]),
    });

    const catalog = await gateway.catalog();
    assert.deepEqual(
      catalog.entries.map((entry) => entry.provider),
      ["on"],
    );
    assert.equal(unconfigured.calls.listModels, 0, "unconfigured provider was contacted");
  });

  it("reports unconfigured providers as down without probing them", async () => {
    const unconfigured = createFakeProvider({ id: "off", configured: false });
    const gateway = new AiGateway({ registry: createProviderRegistry([unconfigured]) });
    const health = await gateway.health();
    assert.equal(health.get("off")?.reachable, false);
    assert.equal(health.get("off")?.status, "down");
  });

  it("records why each model was excluded", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [
        makeModel({ provider: "p", modelId: "good" }),
        makeModel({ provider: "p", modelId: "off", enabled: false }),
      ],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    const catalog = await gateway.catalog();
    assert.deepEqual(
      catalog.excluded.map((entry) => [entry.model.modelId, entry.reason]),
      [["off", "model-disabled"]],
    );
  });
});

describe("gateway selection", () => {
  it("routes to the only eligible model", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [makeModel({ provider: "p", modelId: "m1" })],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    const selection = await gateway.select(request);
    assert.equal(selection.model.modelId, "m1");
  });

  it("throws NO_ELIGIBLE_MODEL rather than contacting an unreachable provider", async () => {
    const provider = createFakeProvider({
      id: "p",
      health: unreachable("p"),
      models: [makeModel({ provider: "p", modelId: "m1" })],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    await assert.rejects(gateway.select(request), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "NO_ELIGIBLE_MODEL");
      assert.match(error.detail ?? "", /provider-unreachable/);
      return true;
    });
    assert.equal(provider.calls.generate.length, 0);
  });

  it("fails with NO_ELIGIBLE_MODEL when nothing is registered at all", async () => {
    const gateway = new AiGateway({ registry: createProviderRegistry([]) });
    await assert.rejects(gateway.select(request), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "NO_ELIGIBLE_MODEL");
      return true;
    });
  });

  it("honours the provider allowlist", async () => {
    const a = createFakeProvider({ id: "a", models: [makeModel({ provider: "a", modelId: "m" })] });
    const b = createFakeProvider({ id: "b", models: [makeModel({ provider: "b", modelId: "m" })] });
    const gateway = new AiGateway({
      registry: createProviderRegistry([a, b]),
      policy: { ...DEFAULT_ELIGIBILITY_POLICY, allowedProviders: ["b"] },
    });
    const selection = await gateway.select(request);
    assert.equal(selection.model.provider, "b");
  });

  it("rejects a streaming request against a model that cannot stream", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [makeModel({ provider: "p", modelId: "no-stream", capabilities: nonStreaming() })],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    await assert.rejects(gateway.select({ ...request, requireStreaming: true }), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "NO_ELIGIBLE_MODEL");
      assert.match(error.detail ?? "", /streaming-unsupported/);
      return true;
    });
    assert.equal(provider.calls.stream.length, 0);
  });
});

function nonStreaming(): ModelCapabilities {
  return {
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsStreaming: false,
    supportsSystemPrompt: true,
    supportsTools: false,
    supportsJsonOutput: false,
  };
}

describe("pinned models", () => {
  it("uses the pinned model and skips strategy selection", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [
        makeModel({ provider: "p", modelId: "cheap", tags: ["quality:basic"] }),
        makeModel({ provider: "p", modelId: "frontier", tags: ["quality:frontier"] }),
      ],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    const selection = await gateway.select({
      ...request,
      pinnedModel: { provider: "p", modelId: "cheap" },
      strategy: "highest-quality",
    });
    assert.equal(selection.model.modelId, "cheap");
  });

  it("fails with MODEL_UNAVAILABLE instead of silently falling back", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [makeModel({ provider: "p", modelId: "real" })],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    await assert.rejects(
      gateway.select({ ...request, pinnedModel: { provider: "p", modelId: "imagined" } }),
      (error: unknown) => {
        assert.ok(error instanceof AiProviderError);
        assert.equal(error.code, "MODEL_UNAVAILABLE");
        assert.equal(error.modelId, "imagined");
        return true;
      },
    );
    assert.equal(provider.calls.generate.length, 0);
  });

  it("reports the eligibility reason for a pinned model that exists but is ineligible", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [makeModel({ provider: "p", modelId: "off", enabled: false })],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    await assert.rejects(
      gateway.select({ ...request, pinnedModel: { provider: "p", modelId: "off" } }),
      (error: unknown) => {
        assert.ok(error instanceof AiProviderError);
        assert.equal(error.code, "MODEL_UNAVAILABLE");
        assert.match(error.detail ?? "", /model-disabled/);
        return true;
      },
    );
  });

  it("reports PROVIDER_UNAVAILABLE when the pinned provider is not configured", async () => {
    const provider = createFakeProvider({
      id: "p",
      configured: false,
      models: [makeModel({ provider: "p", modelId: "m1" })],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    await assert.rejects(
      gateway.select({ ...request, pinnedModel: { provider: "p", modelId: "m1" } }),
      (error: unknown) => {
        assert.ok(error instanceof AiProviderError);
        assert.equal(error.code, "PROVIDER_UNAVAILABLE");
        return true;
      },
    );
  });
});

describe("gateway generation and streaming", () => {
  it("routes generate to the selected model", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [makeModel({ provider: "p", modelId: "m1" })],
      content: "answer",
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    const result = await gateway.generate(request);
    assert.equal(result.content, "answer");
    assert.deepEqual(provider.calls.generate, [{ provider: "p", modelId: "m1" }]);
  });

  it("requires streaming support before starting a stream", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [makeModel({ provider: "p", modelId: "no-stream", capabilities: nonStreaming() })],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    await assert.rejects(collect(gateway.stream(request)), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "NO_ELIGIBLE_MODEL");
      return true;
    });
    assert.equal(provider.calls.stream.length, 0, "stream started against a non-streaming model");
  });

  it("forwards chunks in order and ends with done", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [makeModel({ provider: "p", modelId: "m1" })],
      chunks: ["he", "llo"],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    assert.deepEqual(await collect(gateway.stream(request)), [
      { type: "text", delta: "he" },
      { type: "text", delta: "llo" },
      { type: "done", finishReason: "stop" },
    ]);
  });
});

describe("describeExclusions", () => {
  it("groups reasons and includes provider and model ids", () => {
    const summary = describeExclusions([
      { model: makeModel({ provider: "a", modelId: "m1" }), reason: "model-disabled" },
      { model: makeModel({ provider: "b", modelId: "m2" }), reason: "model-disabled" },
      { model: makeModel({ provider: "c", modelId: "m3" }), reason: "no-text-chat" },
    ]);
    assert.equal(
      summary,
      "model-disabled: a/m1, b/m2; no-text-chat: c/m3",
    );
  });

  it("says so plainly when nothing was rejected", () => {
    assert.equal(describeExclusions([]), "no providers are registered or configured");
  });
});

describe("gateway health", () => {
  it("reports latency as observed rather than assumed", async () => {
    const provider = createFakeProvider({ id: "p", health: healthy("p", 42) });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    const health = await gateway.health();
    assert.equal(health.get("p")?.latencyMs, 42);
  });
});