import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createGatewayProviders } from "@/lib/ai/providers";
import { DeclarationSet } from "@/lib/ai/declarations";
import { FREELLMAPI_PROVIDER_ID } from "@/lib/ai/providers/freellm";
import { OMNIROUTE_PROVIDER_ID } from "@/lib/ai/providers/omniroute";
import { createProviderRegistry } from "@/lib/ai/registry";
import { AiGateway } from "@/lib/ai/gateway";

function env(values: Record<string, string>): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("createGatewayProviders", () => {
  it("creates both gateways, in spec order, with no environment at all", () => {
    const providers = createGatewayProviders({ env: env({ }) });
    assert.deepEqual(
      providers.map((provider) => provider.info.id),
      ["omniroute", "freellmapi"],
    );
    assert.deepEqual(
      providers.map((provider) => provider.info.configured),
      [false, false],
    );
  });

  it("explains which variables are missing, without echoing any value", () => {
    const providers = createGatewayProviders({ env: env({ OMNIROUTE_API_KEY: "secret" }) });
    const omni = providers.find((provider) => provider.info.id === OMNIROUTE_PROVIDER_ID);
    assert.match(omni?.info.configurationDetail ?? "", /OMNIROUTE_BASE_URL/);
    assert.equal((omni?.info.configurationDetail ?? "").includes("secret"), false);
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

  it("ships no model declarations, so nothing is eligible until declared", async () => {
    const providers = createGatewayProviders({
      env: env({
        OMNIROUTE_BASE_URL: "https://omni.example.test/v1",
        OMNIROUTE_API_KEY: "k",
        FREE_LLM_API_BASE_URL: "https://free.example.test/v1",
        FREE_LLM_API_KEY: "k2",
      }),
      fetchImpl: async () =>
        new Response(JSON.stringify({ data: [{ id: "some-model" }] }), { status: 200 }),
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([...providers]) });
    const catalog = await gateway.catalog();

    assert.deepEqual(
      catalog.entries.flatMap((entry) => entry.models.map((model) => model.modelId)),
      ["some-model", "some-model"],
    );
    assert.deepEqual(catalog.eligible, []);
    assert.deepEqual(
      catalog.excluded.map((entry) => entry.reason),
      ["model-disabled", "model-disabled"],
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
});