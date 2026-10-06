import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiGateway } from "@/lib/ai/gateway";
import { createProviderRegistry } from "@/lib/ai/registry";
import {
  CLOUDFLARE_ACCOUNT_PREFIX,
  CLOUDFLARE_PROVIDER_ID,
  cloudflareHealthCheckUrl,
  createCloudflareProvider,
} from "@/lib/ai/providers/cloudflare";
import type { ChatRequest } from "@/lib/ai/types";
import { DeclarationSet } from "@/lib/ai/declarations";

/** A fetch that records every URL it was asked for. */
function recordingFetch(): {
  readonly calls: () => readonly string[];
  readonly fetch: (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  ) => Promise<Response>;
} {
  const calls: string[] = [];
  const fetch = async (input: string): Promise<Response> => {
    calls.push(input);
    // Cloudflare's documented discovery endpoint returns a 200 with a body we
    // discard; health checking only cares that the call succeeded.
    return new Response(JSON.stringify({ result: [] }), { status: 200 });
  };
  return { calls: () => calls, fetch };
}

const DECLARED_MODEL = "@cf/meta/llama-3.2-1b-instruct";

const DECLARATIONS = new DeclarationSet([
  {
    provider: "cloudflare",
    modelId: DECLARED_MODEL,
    enabled: true,
    capabilities: {
      inputModalities: ["text"],
      outputModalities: ["text"],
      supportsStreaming: true,
      supportsSystemPrompt: true,
    },
    availability: "available",
    pricing: {
      tier: "paid",
      inputPerMillionTokens: 0.027,
      outputPerMillionTokens: 0.201,
    },
    context: { contextWindowTokens: 128000, maxOutputTokens: 8192, source: "declared" },
    freeAllowance: true,
  },
]);

function configuredCloudflare(
  fetchImpl: (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  ) => Promise<Response>,
) {
  return createCloudflareProvider({
    configured: true,
    apiKey: "tok",
    accountId: "abc123",
    accountPrefix: CLOUDFLARE_ACCOUNT_PREFIX,
    fetchImpl,
    declarations: DECLARATIONS.forProvider(CLOUDFLARE_PROVIDER_ID),
  });
}

describe("cloudflareHealthCheckUrl", () => {
  it("points at the documented discovery endpoint, not /v1/models", () => {
    assert.equal(
      cloudflareHealthCheckUrl(CLOUDFLARE_ACCOUNT_PREFIX, "abc123"),
      "https://api.cloudflare.com/client/v4/accounts/abc123/ai/models/search",
    );
  });
});

describe("Cloudflare model discovery", () => {
  it("serves the declared model from local declarations without calling /v1/models", async () => {
    const recorded = recordingFetch();
    const provider = configuredCloudflare(recorded.fetch);
    const models = await provider.listModels();

    assert.deepEqual(
      models.map((model) => model.modelId),
      [DECLARED_MODEL],
    );
    assert.equal(recorded.calls().length, 0, "no network call was made for model discovery");
  });

  it("does not depend on GET /v1/models for discovery", async () => {
    const recorded = recordingFetch();
    const provider = configuredCloudflare(recorded.fetch);
    await provider.listModels();

    const asked = recorded.calls();
    assert.equal(asked.length, 0);
    for (const url of asked) {
      assert.equal(url.includes("/v1/models"), false);
    }
  });
});

describe("Cloudflare health checking", () => {
  it("probes the documented Cloudflare endpoint rather than /v1/models", async () => {
    const recorded = recordingFetch();
    const provider = configuredCloudflare(recorded.fetch);
    const health = await provider.healthCheck();

    assert.equal(health.reachable, true);
    assert.equal(health.status, "up");
    assert.deepEqual(recorded.calls(), [
      "https://api.cloudflare.com/client/v4/accounts/abc123/ai/models/search",
    ]);
  });

  it("reports down when the documented endpoint is unreachable", async () => {
    const fetch = async (): Promise<Response> => {
      throw new Error("connection refused");
    };
    const provider = configuredCloudflare(fetch);
    const health = await provider.healthCheck();

    assert.equal(health.reachable, false);
    assert.equal(health.status, "down");
  });
});

describe("Cloudflare routing", () => {
  const request: ChatRequest = { messages: [{ role: "user", content: "hi" }] };

  it("makes the declared model an eligible candidate when credentials are configured", async () => {
    const recorded = recordingFetch();
    const provider = configuredCloudflare(recorded.fetch);
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    const catalog = await gateway.catalog();

    assert.deepEqual(
      catalog.eligible.map((model) => `${model.provider}/${model.modelId}`),
      [`cloudflare/${DECLARED_MODEL}`],
    );
    assert.equal(catalog.eligible[0]?.freeAllowance, true);
    // Eligibility must not have required a discovery call.
    assert.equal(recorded.calls().length, 1, "only the health probe ran");
  });

  it("routes to the declared model through the real provider", async () => {
    const recorded = recordingFetch();
    const provider = configuredCloudflare(recorded.fetch);
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    const selection = await gateway.select(request);

    assert.equal(selection.model.modelId, DECLARED_MODEL);
    assert.equal(selection.model.freeAllowance, true);
  });

  it("still rejects a paid Cloudflare model that has no freeAllowance flag", async () => {
    const declarations = new DeclarationSet([
      {
        provider: "cloudflare",
        modelId: DECLARED_MODEL,
        enabled: true,
        capabilities: {
          inputModalities: ["text"],
          outputModalities: ["text"],
          supportsStreaming: true,
          supportsSystemPrompt: true,
        },
        availability: "available",
        pricing: {
          tier: "paid",
          inputPerMillionTokens: 0.027,
          outputPerMillionTokens: 0.201,
        },
        context: { contextWindowTokens: 128000, maxOutputTokens: 8192, source: "declared" },
      },
    ]);
    const recorded = recordingFetch();
    const provider = createCloudflareProvider({
      configured: true,
      apiKey: "tok",
      accountId: "abc123",
      accountPrefix: CLOUDFLARE_ACCOUNT_PREFIX,
      fetchImpl: recorded.fetch,
      declarations: declarations.forProvider(CLOUDFLARE_PROVIDER_ID),
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });
    const catalog = await gateway.catalog();

    assert.deepEqual(catalog.eligible, []);
    assert.deepEqual(
      catalog.excluded.map((entry) => entry.reason),
      ["paid-not-allowed"],
    );
  });
});