import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { estimateCost, estimateInputTokens, costScore } from "@/lib/ai/pricing";
import { rankCandidates, selectModel } from "@/lib/ai/router";
import type {
  ChatRequest,
  ModelDescriptor,
  ProviderHealth,
  ProviderId,
} from "@/lib/ai/types";
import { healthy, makeModel } from "./fixtures/fake-provider";

function healthMap(entries: Record<ProviderId, ProviderHealth | null>): ReadonlyMap<ProviderId, ProviderHealth> {
  const map = new Map<ProviderId, ProviderHealth>();
  for (const [id, value] of Object.entries(entries)) {
    if (value !== null) map.set(id, value);
  }
  return map;
}

const request: ChatRequest = {
  messages: [{ role: "user", content: "hello" }],
  maxOutputTokens: 100,
};

function priced(
  modelId: string,
  input: number,
  output: number,
  overrides: Partial<ModelDescriptor> = {},
): ModelDescriptor {
  return makeModel({
    modelId,
    provider: "p",
    pricing: {
      currency: "USD",
      tier: "paid",
      inputPerMillionTokens: input,
      outputPerMillionTokens: output,
    },
    ...overrides,
  });
}

describe("estimateInputTokens", () => {
  it("counts characters across every message", () => {
    const tokens = estimateInputTokens({
      messages: [
        { role: "system", content: "abcd" },
        { role: "user", content: "abcdefgh" },
      ],
    });
    assert.equal(tokens, 3);
  });

  it("returns zero for no messages", () => {
    assert.equal(estimateInputTokens({ messages: [] }), 0);
  });
});

describe("estimateCost", () => {
  it("prices input and output separately", () => {
    const model = priced("m", 1_000, 2_000);
    const cost = estimateCost(model, {
      messages: [{ role: "user", content: "a".repeat(400) }],
      maxOutputTokens: 1_000,
    });
    assert.equal(cost.basis, "priced");
    assert.equal(cost.usd, 0.1 + 2);
  });

  it("treats a free-tier model as exactly zero", () => {
    const model = makeModel({
      provider: "p",
      modelId: "m",
      pricing: { currency: "USD", tier: "free", inputPerMillionTokens: null, outputPerMillionTokens: null },
    });
    assert.deepEqual(estimateCost(model, request), { usd: 0, basis: "free" });
  });

  it("does not treat an unpriced model as free", () => {
    const model = makeModel({
      provider: "p",
      modelId: "m",
      pricing: { currency: "USD", tier: "unknown", inputPerMillionTokens: null, outputPerMillionTokens: null },
    });
    assert.deepEqual(estimateCost(model, request), { usd: null, basis: "unpriced" });
    assert.equal(costScore(model, request), Number.POSITIVE_INFINITY);
  });

  it("is unpriced when only one side of the price is published", () => {
    const model = makeModel({
      provider: "p",
      modelId: "m",
      pricing: { currency: "USD", tier: "paid", inputPerMillionTokens: 1, outputPerMillionTokens: null },
    });
    assert.equal(estimateCost(model, request).basis, "unpriced");
  });

  it("uses a fixed output allowance when the request sets no ceiling", () => {
    const model = priced("m", 1_000, 1_000);
    const withDefault = estimateCost(model, { messages: [] });
    const explicit = estimateCost(model, { messages: [], maxOutputTokens: 512 });
    assert.equal(withDefault.usd, explicit.usd);
  });
});

describe("rankCandidates by strategy", () => {
  it("lowest-latency picks the fastest measured provider", () => {
    const fast = makeModel({ provider: "fast", modelId: "fast" });
    const slow = makeModel({ provider: "slow", modelId: "slow" });
    const chosen = selectModel([slow, fast], "lowest-latency", request, healthMap({
      fast: healthy("fast", 90),
      slow: healthy("slow", 900),
    }));
    assert.equal(chosen?.modelId, "fast");
  });

  it("does not treat an unmeasured provider as fast", () => {
    const measured = makeModel({ provider: "measured", modelId: "measured" });
    const unmeasured = makeModel({ provider: "unmeasured", modelId: "unmeasured" });
    const chosen = selectModel([unmeasured, measured], "lowest-latency", request, healthMap({
      measured: healthy("measured", 800),
    }));
    assert.equal(chosen?.modelId, "measured");
  });

  it("lowest-cost picks the cheapest model, free first", () => {
    const free = makeModel({
      provider: "p",
      modelId: "free",
      pricing: { currency: "USD", tier: "free", inputPerMillionTokens: 0, outputPerMillionTokens: 0 },
    });
    const cheap = priced("cheap", 1, 1);
    const pricey = priced("pricey", 100, 100);
    const chosen = selectModel([pricey, cheap, free], "lowest-cost", request, new Map());
    assert.equal(chosen?.modelId, "free");
  });

  it("lowest-cost ranks a published price above an unknown one", () => {
    const unpriced = makeModel({
      provider: "p",
      modelId: "unpriced",
      pricing: { currency: "USD", tier: "unknown", inputPerMillionTokens: null, outputPerMillionTokens: null },
    });
    const chosen = selectModel([unpriced, priced("priced", 5, 5)], "lowest-cost", request, new Map());
    assert.equal(chosen?.modelId, "priced");
  });

  it("highest-quality prefers a declared frontier tag", () => {
    const basic = makeModel({ provider: "p", modelId: "basic", tags: ["quality:basic"] });
    const frontier = makeModel({ provider: "p", modelId: "frontier", tags: ["quality:frontier"] });
    const chosen = selectModel([basic, frontier], "highest-quality", request, new Map());
    assert.equal(chosen?.modelId, "frontier");
  });

  it("highest-quality breaks a tag tie on declared context window", () => {
    const small = makeModel({
      provider: "p",
      modelId: "small",
      tags: ["quality:standard"],
      context: { contextWindowTokens: 8_000, maxOutputTokens: 4_000, source: "declared" },
    });
    const large = makeModel({
      provider: "p",
      modelId: "large",
      tags: ["quality:standard"],
      context: { contextWindowTokens: 200_000, maxOutputTokens: 8_000, source: "declared" },
    });
    const chosen = selectModel([small, large], "highest-quality", request, new Map());
    assert.equal(chosen?.modelId, "large");
  });

  it("balanced still trades latency against cost instead of always picking one", () => {
    const cheapSlow = makeModel({
      provider: "slow",
      modelId: "cheap-slow",
      pricing: { currency: "USD", tier: "paid", inputPerMillionTokens: 0.01, outputPerMillionTokens: 0.01 },
    });
    const priceyFast = makeModel({
      provider: "fast",
      modelId: "pricey-fast",
      pricing: { currency: "USD", tier: "paid", inputPerMillionTokens: 500, outputPerMillionTokens: 500 },
    });
    const health = healthMap({ fast: healthy("fast", 50), slow: healthy("slow", 2_000) });

    assert.equal(selectModel([cheapSlow, priceyFast], "lowest-latency", request, health)?.modelId, "pricey-fast");
    assert.equal(selectModel([cheapSlow, priceyFast], "lowest-cost", request, health)?.modelId, "cheap-slow");
    // Latency is the heaviest balanced weight, but not strong enough to ignore cost.
    assert.equal(selectModel([cheapSlow, priceyFast], "balanced", request, health)?.modelId, "pricey-fast");
  });

  it("returns null when there is nothing to rank", () => {
    assert.equal(selectModel([], "balanced", request, new Map()), null);
  });
});

describe("determinism", () => {
  const models = [
    makeModel({ provider: "p1", modelId: "a" }),
    makeModel({ provider: "p1", modelId: "b" }),
    makeModel({ provider: "p2", modelId: "c" }),
  ];
  const health = healthMap({ p1: healthy("p1", 100), p2: healthy("p2", 100) });

  it("produces the same order regardless of input order", () => {
    const strategies = ["balanced", "lowest-latency", "lowest-cost", "highest-quality"] as const;
    for (const strategy of strategies) {
      const forward = rankCandidates(models, strategy, request, health).map((entry) => entry.model.modelId);
      const reversed = rankCandidates([...models].reverse(), strategy, request, health).map(
        (entry) => entry.model.modelId,
      );
      assert.deepEqual(forward, reversed, `strategy ${strategy} is order-dependent`);
    }
  });

  it("breaks exact ties on provider then model id", () => {
    const ranked = rankCandidates(models, "lowest-latency", request, health);
    assert.deepEqual(
      ranked.map((entry) => entry.model.modelId),
      ["a", "b", "c"],
    );
  });

  it("is stable across repeated calls", () => {
    const first = rankCandidates(models, "balanced", request, health).map((entry) => entry.model.modelId);
    const second = rankCandidates(models, "balanced", request, health).map((entry) => entry.model.modelId);
    assert.deepEqual(first, second);
  });
});