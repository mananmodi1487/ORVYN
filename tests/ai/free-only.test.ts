import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DEFAULT_ELIGIBILITY_POLICY } from "@/lib/ai/eligibility";
import { AiProviderError } from "@/lib/ai/errors";
import { AiGateway } from "@/lib/ai/gateway";
import { createProviderRegistry } from "@/lib/ai/registry";
import type { ChatRequest, ModelDescriptor, ModelPricing } from "@/lib/ai/types";
import { createFakeProvider, healthy, makeModel } from "./fixtures/fake-provider";

/**
 * ORVYN is free-only. These tests hold that line at the routing boundary: the
 * only way a paid or unverifiable model can be reached is if eligibility lets it
 * through, so asserting on `provider.calls` proves the guarantee rather than the
 * intent.
 */

const request: ChatRequest = { messages: [{ role: "user", content: "hi" }] };

const FREE: ModelPricing = {
  currency: "USD",
  tier: "free",
  inputPerMillionTokens: 0,
  outputPerMillionTokens: 0,
};

const PAID: ModelPricing = {
  currency: "USD",
  tier: "paid",
  inputPerMillionTokens: 3,
  outputPerMillionTokens: 15,
};

const UNPRICED: ModelPricing = {
  currency: "USD",
  tier: "unknown",
  inputPerMillionTokens: null,
  outputPerMillionTokens: null,
};

/** Claims the free tier without publishing zero rates. */
const CLAIMED_FREE: ModelPricing = {
  currency: "USD",
  tier: "free",
  inputPerMillionTokens: null,
  outputPerMillionTokens: null,
};

/** Free tier, but output is billed. */
const METERED: ModelPricing = {
  currency: "USD",
  tier: "free",
  inputPerMillionTokens: 0,
  outputPerMillionTokens: 0.25,
};

function gatewayFor(models: readonly ModelDescriptor[], id = "p") {
  const provider = createFakeProvider({ id, models, health: healthy(id, 100) });
  return { provider, gateway: new AiGateway({ registry: createProviderRegistry([provider]) }) };
}

describe("default policy is free-only", () => {
  it("does not allow paid models unless an operator opts in", () => {
    assert.equal(
      DEFAULT_ELIGIBILITY_POLICY.allowPaidModels,
      false,
      "free-only must be the policy that applies when nothing is configured",
    );
  });
});

describe("paid models are never routed to", () => {
  it("excludes a paid model even when it is the only model", async () => {
    const { gateway, provider } = gatewayFor([
      makeModel({ provider: "p", modelId: "paid-only", pricing: PAID }),
    ]);

    await assert.rejects(() => gateway.select(request), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "NO_ELIGIBLE_MODEL");
      return true;
    });
    assert.equal(provider.calls.generate.length, 0);
    assert.equal(provider.calls.stream.length, 0);
  });

  it("routes to the free model and never calls the paid one", async () => {
    const free = makeModel({ provider: "p", modelId: "free", pricing: FREE });
    const { gateway, provider } = gatewayFor([
      makeModel({ provider: "p", modelId: "paid", pricing: PAID }),
      free,
    ]);

    const selection = await gateway.select(request);
    assert.equal(selection.model.modelId, "free");
    assert.deepEqual(selection.candidates.map((model) => model.modelId), ["free"]);

    await gateway.generate(request);
    await drain(gateway.stream(request));
    assert.deepEqual(
      provider.calls.stream.map((ref) => ref.modelId),
      ["free"],
      "only the free model may be called",
    );
  });

  it("never promotes a paid model by priority, cost or quality", async () => {
    const { gateway, provider } = gatewayFor([
      makeModel({
        provider: "p",
        modelId: "cheap-and-good",
        pricing: PAID,
        priority: 10_000,
        tags: ["quality:frontier"],
        context: { contextWindowTokens: 10_000_000, maxOutputTokens: 8192, source: "declared" },
      }),
      makeModel({ provider: "p", modelId: "free", pricing: FREE, priority: 0 }),
    ]);

    for (const strategy of ["balanced", "lowest-cost", "lowest-latency", "highest-quality"] as const) {
      const selection = await gateway.select({ ...request, strategy });
      assert.equal(selection.model.modelId, "free", `${strategy} must not select a paid model`);
    }
    assert.equal(provider.calls.generate.length, 0);
  });

  it("refuses a pinned paid model instead of substituting a free one", async () => {
    const { gateway } = gatewayFor([
      makeModel({ provider: "p", modelId: "free", pricing: FREE }),
      makeModel({ provider: "p", modelId: "paid", pricing: PAID }),
    ]);

    await assert.rejects(
      () => gateway.select({ ...request, pinnedModel: { provider: "p", modelId: "paid" } }),
      (error: unknown) => {
        assert.ok(error instanceof AiProviderError);
        // Silently answering with a different model would hide the pinning.
        assert.equal(error.code, "MODEL_UNAVAILABLE");
        assert.equal(error.modelId, "paid");
        return true;
      },
    );
  });

  it("returns only free models from rankedCandidates", async () => {
    const { gateway } = gatewayFor([
      makeModel({ provider: "p", modelId: "a-free", pricing: FREE }),
      makeModel({ provider: "p", modelId: "b-paid", pricing: PAID }),
      makeModel({ provider: "p", modelId: "c-unpriced", pricing: UNPRICED }),
      makeModel({ provider: "p", modelId: "d-claimed", pricing: CLAIMED_FREE }),
      makeModel({ provider: "p", modelId: "e-metered", pricing: METERED }),
      makeModel({ provider: "p", modelId: "f-free", pricing: FREE }),
    ]);

    const ranked = await gateway.rankedCandidates(request);
    assert.deepEqual(
      ranked.map((model) => model.modelId),
      ["a-free", "f-free"],
    );
  });
});

describe("unverifiable prices are excluded", () => {
  const cases: ReadonlyArray<readonly [string, ModelPricing]> = [
    ["unpriced", UNPRICED],
    ["free tier with no published rates", CLAIMED_FREE],
    ["free tier with a billed output rate", METERED],
  ];

  for (const [label, pricing] of cases) {
    it(`rejects ${label}`, async () => {
      const { gateway, provider } = gatewayFor([
        makeModel({ provider: "p", modelId: "m", pricing }),
      ]);
      const catalog = await gateway.catalog();

      assert.deepEqual(catalog.eligible, []);
      assert.deepEqual(
        catalog.excluded.map((entry) => entry.reason),
        [pricing.tier === "paid" ? "paid-not-allowed" : "unknown-pricing"],
      );
      assert.equal(provider.calls.generate.length, 0);
    });
  }

  it("reports the two reasons separately so an operator can tell them apart", async () => {
    const { gateway } = gatewayFor([
      makeModel({ provider: "p", modelId: "paid", pricing: PAID }),
      makeModel({ provider: "p", modelId: "unpriced", pricing: UNPRICED }),
    ]);
    const catalog = await gateway.catalog();

    assert.deepEqual(
      catalog.excluded.map((entry) => [entry.model.modelId, entry.reason]),
      [
        ["paid", "paid-not-allowed"],
        ["unpriced", "unknown-pricing"],
      ],
    );
  });
});

describe("opting back into paid models", () => {
  it("requires an explicit policy and then routes normally", async () => {
    // The escape hatch stays available, but it is a deliberate operator choice
    // rather than something a request can turn on.
    const { gateway } = gatewayFor([
      makeModel({ provider: "p", modelId: "paid", pricing: PAID }),
      makeModel({ provider: "p", modelId: "free", pricing: FREE }),
    ]);

    const selection = await gateway.select(request, {
      ...DEFAULT_ELIGIBILITY_POLICY,
      allowPaidModels: true,
    });
    assert.ok(["paid", "free"].includes(selection.model.modelId));
  });

  it("cannot be enabled by anything in the request body", async () => {
    const { gateway } = gatewayFor([makeModel({ provider: "p", modelId: "paid", pricing: PAID })]);
    const hacked = {
      ...request,
      allowPaidModels: true,
    } as unknown as ChatRequest;

    await assert.rejects(() => gateway.select(hacked), AiProviderError);
  });
});

describe("credentials come from the operator only", () => {
  it("contacts nothing when no provider is configured", async () => {
    const provider = createFakeProvider({
      id: "p",
      configured: false,
      configurationDetail: "P_API_KEY is not set",
      models: [makeModel({ provider: "p", modelId: "free", pricing: FREE })],
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });

    await assert.rejects(() => gateway.select(request), AiProviderError);
    assert.equal(provider.calls.listModels, 0, "an unconfigured provider must never be contacted");
    assert.equal(provider.calls.healthCheck, 0);
    assert.equal(provider.calls.generate.length, 0);
    assert.equal(provider.calls.stream.length, 0);
  });

  it("does not reach for a key when a declaration exists but credentials do not", async () => {
    // A declaration describes a model; it cannot conjure credentials for it.
    const provider = createFakeProvider({
      id: "p",
      configured: false,
      configurationDetail: "P_API_KEY is not set",
    });
    const gateway = new AiGateway({ registry: createProviderRegistry([provider]) });

    const catalog = await gateway.catalog();
    assert.deepEqual(catalog.eligible, []);
    assert.equal(
      catalog.states.get("p")?.configured,
      false,
      "configuration must stay operator-owned",
    );
  });
});

/** Consumes a stream to completion so the generator body actually runs. */
async function drain(stream: AsyncIterable<unknown>): Promise<void> {
  for await (const _ of stream) void _;
}