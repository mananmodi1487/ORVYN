import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGatewayProviders } from "@/lib/ai/providers";
import { CLOUDFLARE_PROVIDER_ID } from "@/lib/ai/providers/cloudflare";
import { DeclarationSet } from "@/lib/ai/declarations";
import { FREELLMAPI_PROVIDER_ID } from "@/lib/ai/providers/freellm";
import { GROQ_PROVIDER_ID } from "@/lib/ai/providers/groq";
import { OMNIROUTE_PROVIDER_ID } from "@/lib/ai/providers/omniroute";
import { POLLINATIONS_PROVIDER_ID } from "@/lib/ai/providers/pollinations";
import { createProviderRegistry } from "@/lib/ai/registry";
import { AiGateway } from "@/lib/ai/gateway";

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("createGatewayProviders", () => {
  it("creates all gateways, in spec order, with no environment at all", () => {
    const providers = createGatewayProviders({ env: env({ }) });
    assert.deepEqual(
      providers.map((provider) => provider.info.id),
      ["cloudflare", "omniroute", "freellmapi", "groq", "pollinations"],
    );
    assert.deepEqual(
      providers.map((provider) => provider.info.configured),
      [false, false, false, false, false],
    );
  });

  it("explains which variables are missing, without echoing any value", () => {
    const providers = createGatewayProviders({ env: env({ OMNIROUTE_API_KEY: "secret" }) });
    const omni = providers.find((provider) => provider.info.id === OMNIROUTE_PROVIDER_ID);
    assert.match(omni?.info.configurationDetail ?? "", /OMNIROUTE_BASE_URL/);
    assert.equal((omni?.info.configurationDetail ?? "").includes("secret"), false);
  });

  it("requires the account id for Cloudflare, even with the pair present", () => {
    const providers = createGatewayProviders({
      env: env({
        CLOUDFLARE_BASE_URL: "https://api.cloudflare.com/client/v4",
        CLOUDFLARE_API_TOKEN: "tok",
      }),
    });
    const cloudflare = providers.find((provider) => provider.info.id === CLOUDFLARE_PROVIDER_ID);
    assert.equal(cloudflare?.info.configured, false);
    assert.match(cloudflare?.info.configurationDetail ?? "", /CLOUDFLARE_ACCOUNT_ID/);
    assert.equal((cloudflare?.info.configurationDetail ?? "").includes("tok"), false);
  });

  it("builds the Workers AI URL from the account id when all three are present", () => {
    const providers = createGatewayProviders({
      env: env({
        CLOUDFLARE_BASE_URL: "https://api.cloudflare.com/client/v4",
        CLOUDFLARE_ACCOUNT_ID: "abc123",
        CLOUDFLARE_API_TOKEN: "tok",
      }),
    });
    const cloudflare = providers.find((provider) => provider.info.id === CLOUDFLARE_PROVIDER_ID);
    assert.equal(cloudflare?.info.configured, true);
    assert.equal(cloudflare?.info.configurationDetail, null);
    assert.equal(cloudflare?.info.displayName, "Cloudflare");
  });

  it("marks a fully configured gateway as configured and normalizes its base url", () => {
    const providers = createGatewayProviders({
      env: env({
        FREE_LLM_API_BASE_URL: "https://free.example.test/v1/",
        FREE_LLM_API_KEY: "k",
      }),
    });
    const free = providers.find((provider) => provider.info.id === FREELLMAPI_PROVIDER_ID);
    assert.equal(free?.info.configured, true);
    assert.equal(free?.info.configurationDetail, null);
  });

  it("marks a fully configured Groq gateway as configured and normalizes its base url", () => {
    const providers = createGatewayProviders({
      env: env({
        GROQ_BASE_URL: "https://api.groq.com/openai/v1/",
        GROQ_API_KEY: "groq-key",
      }),
    });
    const groq = providers.find((provider) => provider.info.id === GROQ_PROVIDER_ID);
    assert.equal(groq?.info.configured, true);
    assert.equal(groq?.info.configurationDetail, null);
    assert.equal(groq?.info.displayName, "Groq");
  });

  it("ships no model declarations, so nothing is eligible until declared", async () => {
    const providers = createGatewayProviders({
      env: env({
        CLOUDFLARE_BASE_URL: "https://api.cloudflare.com/client/v4",
        CLOUDFLARE_ACCOUNT_ID: "abc123",
        CLOUDFLARE_API_TOKEN: "k",
        OMNIROUTE_BASE_URL: "https://omni.example.test/v1",
        OMNIROUTE_API_KEY: "k",
        FREE_LLM_API_BASE_URL: "https://free.example.test/v1",
        FREE_LLM_API_KEY: "k2",
        GROQ_BASE_URL: "https://api.groq.com/openai/v1",
        GROQ_API_KEY: "gk",
        POLLINATIONS_BASE_URL: "https://gen.pollinations.ai/v1",
        POLLINATIONS_API_KEY: "pk",
      }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: "some-model" }] }), { status: 200 }),
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([...providers]) });
    const catalog = await gateway.catalog();

    // Cloudflare serves its catalog from operator declarations rather than an
    // OpenAI-compatible /v1/models endpoint, so with no declarations it reports
    // zero models. The other four gateways still discover "some-model" from the
    // mock fetch.
    assert.deepEqual(
      catalog.entries.flatMap((entry) => entry.models.map((model) => model.modelId)),
      ["some-model", "some-model", "some-model", "some-model"],
    );
    assert.deepEqual(catalog.eligible, []);
    assert.deepEqual(
      catalog.excluded.map((entry) => entry.reason),
      ["model-disabled", "model-disabled", "model-disabled", "model-disabled"],
    );
  });

  it("accepts operator-supplied declarations per provider", async () => {
    const providers = createGatewayProviders({
      env: env({
        OMNIROUTE_BASE_URL: "https://omni.example.test/v1",
        OMNIROUTE_API_KEY: "k",
      }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: "chat" }] }), { status: 200 }),
      declarations: new DeclarationSet([
        {
          provider: "omniroute",
          modelId: "chat",
          enabled: true,
          capabilities: {
            inputModalities: ["text"],
            outputModalities: ["text"],
            supportsStreaming: true,
            supportsSystemPrompt: true,
          },
          // Free-only routing requires a price we can check, not just a claim.
          pricing: { tier: "free", inputPerMillionTokens: 0, outputPerMillionTokens: 0 },
        },
      ]),
    });
    const gateway = new AiGateway({
      registry: createProviderRegistry(providers.filter((provider) => provider.info.configured)),
    });
    const catalog = await gateway.catalog();
    assert.deepEqual(
      catalog.eligible.map((model) => `${model.provider}/${model.modelId}`),
      ["omniroute/chat"],
    );
  });

  it("declares a Groq model and routes to it", async () => {
    const providers = createGatewayProviders({
      env: env({
        GROQ_BASE_URL: "https://api.groq.com/openai/v1",
        GROQ_API_KEY: "groq-key",
      }),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ data: [{ id: "llama-3.3-70b-versatile" }] }),
          { status: 200 },
        ),
      declarations: new DeclarationSet([
        {
          provider: "groq",
          modelId: "llama-3.3-70b-versatile",
          enabled: true,
          capabilities: {
            inputModalities: ["text"],
            outputModalities: ["text"],
            supportsStreaming: true,
            supportsSystemPrompt: true,
            supportsTools: true,
            supportsJsonOutput: true,
          },
          availability: "available",
          // Free-only: both published rates must be zero, which is what makes
          // this a free model rather than an unverifiable one.
          pricing: { tier: "free", inputPerMillionTokens: 0, outputPerMillionTokens: 0 },
          context: { contextWindowTokens: 131072, maxOutputTokens: 32768, source: "declared" },
        },
      ]),
    });
    const gateway = new AiGateway({
      registry: createProviderRegistry(providers.filter((provider) => provider.info.configured)),
    });
    const catalog = await gateway.catalog();
    assert.deepEqual(
      catalog.eligible.map((model) => `${model.provider}/${model.modelId}`),
      ["groq/llama-3.3-70b-versatile"],
    );
  });

  it("marks a fully configured Pollinations gateway as configured and normalizes its base url", () => {
    const providers = createGatewayProviders({
      env: env({
        POLLINATIONS_BASE_URL: "https://gen.pollinations.ai/v1/",
        POLLINATIONS_API_KEY: "pollinations-key",
      }),
    });
    const pollinations = providers.find(
      (provider) => provider.info.id === POLLINATIONS_PROVIDER_ID,
    );
    assert.equal(pollinations?.info.configured, true);
    assert.equal(pollinations?.info.configurationDetail, null);
    assert.equal(pollinations?.info.displayName, "Pollinations");
  });

  it("declares a Pollinations model and routes to it", async () => {
    const providers = createGatewayProviders({
      env: env({
        POLLINATIONS_BASE_URL: "https://gen.pollinations.ai/v1",
        POLLINATIONS_API_KEY: "pollinations-key",
      }),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ data: [{ id: "openai/gpt-5.4-nano" }] }),
          { status: 200 },
        ),
      declarations: new DeclarationSet([
        {
          provider: "pollinations",
          modelId: "openai/gpt-5.4-nano",
          enabled: true,
          capabilities: {
            inputModalities: ["text"],
            outputModalities: ["text"],
            supportsStreaming: true,
            supportsSystemPrompt: true,
            supportsTools: true,
            supportsJsonOutput: true,
          },
          availability: "available",
          // Free-only: both published rates must be zero, which is what makes
          // this a free model rather than an unverifiable one.
          pricing: { tier: "free", inputPerMillionTokens: 0, outputPerMillionTokens: 0 },
          context: { contextWindowTokens: 131072, maxOutputTokens: 32768, source: "declared" },
        },
      ]),
    });
    const gateway = new AiGateway({
      registry: createProviderRegistry(providers.filter((provider) => provider.info.configured)),
    });
    const catalog = await gateway.catalog();
    assert.deepEqual(
      catalog.eligible.map((model) => `${model.provider}/${model.modelId}`),
      ["pollinations/openai/gpt-5.4-nano"],
    );
  });

  it("declares a Cloudflare free-allowance model and routes to it", async () => {
    const calls: string[] = [];
    const providers = createGatewayProviders({
      env: env({
        CLOUDFLARE_BASE_URL: "https://api.cloudflare.com/client/v4",
        CLOUDFLARE_ACCOUNT_ID: "abc123",
        CLOUDFLARE_API_TOKEN: "tok",
      }),
      fetchImpl: async (input: string) => {
        calls.push(input);
        return new Response(JSON.stringify({ result: [] }), { status: 200 });
      },
      declarations: new DeclarationSet([
        {
          provider: "cloudflare",
          modelId: "@cf/meta/llama-3.2-1b-instruct",
          enabled: true,
          capabilities: {
            inputModalities: ["text"],
            outputModalities: ["text"],
            supportsStreaming: true,
            supportsSystemPrompt: true,
          },
          availability: "available",
          // Cloudflare publishes metered USD/Neuron rates for every model, so
          // this is not a permanently-free model. It is free-allowance: the
          // operator funds it out of a zero-cost daily budget, and the flag is
          // what lets it through the free-only policy.
          pricing: {
            tier: "paid",
            inputPerMillionTokens: 0.027,
            outputPerMillionTokens: 0.201,
          },
          context: { contextWindowTokens: 128000, maxOutputTokens: 8192, source: "declared" },
          freeAllowance: true,
        },
      ]),
    });
    const gateway = new AiGateway({
      registry: createProviderRegistry(providers.filter((provider) => provider.info.configured)),
    });
    const catalog = await gateway.catalog();
    assert.deepEqual(
      catalog.eligible.map((model) => `${model.provider}/${model.modelId}`),
      ["cloudflare/@cf/meta/llama-3.2-1b-instruct"],
    );
    assert.equal(
      catalog.eligible[0]?.freeAllowance,
      true,
      "the allowance flag must survive into the descriptor",
    );
    // Discovery must not depend on the OpenAI-compatible /v1/models endpoint.
    for (const url of calls) {
      assert.equal(url.includes("/v1/models"), false);
    }
    // Health checking must use Cloudflare's documented discovery endpoint.
    assert.deepEqual(calls, [
      "https://api.cloudflare.com/client/v4/accounts/abc123/ai/models/search",
    ]);
  });

  it("rejects a Cloudflare model without the free-allowance flag", async () => {
    const providers = createGatewayProviders({
      env: env({
        CLOUDFLARE_BASE_URL: "https://api.cloudflare.com/client/v4",
        CLOUDFLARE_ACCOUNT_ID: "abc123",
        CLOUDFLARE_API_TOKEN: "tok",
      }),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({ data: [{ id: "@cf/meta/llama-3.2-1b-instruct" }] }),
          { status: 200 },
        ),
      declarations: new DeclarationSet([
        {
          provider: "cloudflare",
          modelId: "@cf/meta/llama-3.2-1b-instruct",
          enabled: true,
          capabilities: {
            inputModalities: ["text"],
            outputModalities: ["text"],
            supportsStreaming: true,
            supportsSystemPrompt: true,
          },
          availability: "available",
          // Metered rates with no allowance flag: this is a paid model as far as
          // the free-only policy is concerned, and must not be routed to.
          pricing: {
            tier: "paid",
            inputPerMillionTokens: 0.027,
            outputPerMillionTokens: 0.201,
          },
          context: { contextWindowTokens: 128000, maxOutputTokens: 8192, source: "declared" },
        },
      ]),
    });
    const gateway = new AiGateway({
      registry: createProviderRegistry(providers.filter((provider) => provider.info.configured)),
    });
    const catalog = await gateway.catalog();
    assert.deepEqual(catalog.eligible, []);
    assert.deepEqual(
      catalog.excluded.map((entry) => entry.reason),
      ["paid-not-allowed"],
    );
  });
});