import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { AiGateway } from "@/lib/ai/gateway";
import { AiProviderError } from "@/lib/ai/errors";
import { createProviderRegistry } from "@/lib/ai/registry";
import {
  CLOUDFLARE_ACCOUNT_PREFIX,
  CLOUDFLARE_PROVIDER_ID,
  cloudflareBaseUrl,
  createCloudflareProvider,
} from "@/lib/ai/providers/cloudflare";
import type { ChatRequest } from "@/lib/ai/types";
import { createFakeProvider, healthy, makeModel } from "./fixtures/fake-provider";

describe("cloudflareBaseUrl", () => {
  it("interpolates the account id into the Workers AI path", () => {
    assert.equal(
      cloudflareBaseUrl(CLOUDFLARE_ACCOUNT_PREFIX, "abc123"),
      "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1",
    );
  });

  it("strips trailing slashes from the prefix and leading slashes from the id", () => {
    assert.equal(
      cloudflareBaseUrl("https://api.cloudflare.com/client/v4/", "/abc123/"),
      "https://api.cloudflare.com/client/v4/accounts/abc123/ai/v1",
    );
  });
});

describe("createCloudflareProvider", () => {
  it("reports unconfigured when the account id is missing", () => {
    const provider = createCloudflareProvider({
      configured: false,
      configurationDetail: "CLOUDFLARE_ACCOUNT_ID is not set",
      apiKey: "",
      accountId: "",
      accountPrefix: CLOUDFLARE_ACCOUNT_PREFIX,
    });
    assert.equal(provider.info.id, CLOUDFLARE_PROVIDER_ID);
    assert.equal(provider.info.configured, false);
    assert.match(provider.info.configurationDetail ?? "", /CLOUDFLARE_ACCOUNT_ID/);
  });

  it("builds the endpoint from the account id when configured", () => {
    const provider = createCloudflareProvider({
      configured: true,
      apiKey: "tok",
      accountId: "abc123",
      accountPrefix: CLOUDFLARE_ACCOUNT_PREFIX,
    });
    assert.equal(provider.info.configured, true);
    assert.equal(provider.info.displayName, "Cloudflare");
  });

  it("reports down without contacting the network when unconfigured", async () => {
    const provider = createCloudflareProvider({
      configured: false,
      configurationDetail: "not configured",
      apiKey: "",
      accountId: "",
      accountPrefix: CLOUDFLARE_ACCOUNT_PREFIX,
    });
    const health = await provider.healthCheck();
    assert.equal(health.reachable, false);
    assert.equal(health.detail, "not configured");
    // The gateway filters unconfigured providers out before routing, so a
    // configured:false provider must not be contacted for its model list.
    await assert.rejects(() => provider.listModels(), /not configured/);
  });

  it("reports the provider kind as a gateway", () => {
    const provider = createCloudflareProvider({
      configured: false,
      apiKey: "",
      accountId: "",
      accountPrefix: CLOUDFLARE_ACCOUNT_PREFIX,
    });
    assert.equal(provider.info.kind, "gateway");
  });
});

describe("Cloudflare free-allowance routing", () => {
  const request: ChatRequest = { messages: [{ role: "user", content: "hi" }] };

  function gatewayFor(models: readonly ReturnType<typeof makeModel>[] = []) {
    const provider = createFakeProvider({
      id: CLOUDFLARE_PROVIDER_ID,
      models,
      health: healthy(CLOUDFLARE_PROVIDER_ID, 100),
    });
    return { provider, gateway: new AiGateway({ registry: createProviderRegistry([provider]) }) };
  }

  it("routes to a free-allowance model even though it is tier paid", async () => {
    const { gateway } = gatewayFor([
      makeModel({
        provider: CLOUDFLARE_PROVIDER_ID,
        modelId: "@cf/meta/llama-3.2-1b-instruct",
        pricing: {
          currency: "USD",
          tier: "paid",
          inputPerMillionTokens: 0.027,
          outputPerMillionTokens: 0.201,
        },
        freeAllowance: true,
      }),
    ]);
    const selection = await gateway.select(request);
    assert.equal(selection.model.modelId, "@cf/meta/llama-3.2-1b-instruct");
    assert.equal(selection.model.freeAllowance, true);
  });

  it("rejects the same model without the allowance flag", async () => {
    const { gateway } = gatewayFor([
      makeModel({
        provider: CLOUDFLARE_PROVIDER_ID,
        modelId: "@cf/meta/llama-3.2-1b-instruct",
        pricing: {
          currency: "USD",
          tier: "paid",
          inputPerMillionTokens: 0.027,
          outputPerMillionTokens: 0.201,
        },
        freeAllowance: false,
      }),
    ]);
    await assert.rejects(() => gateway.select(request), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal((error as AiProviderError).code, "NO_ELIGIBLE_MODEL");
      return true;
    });
  });
});