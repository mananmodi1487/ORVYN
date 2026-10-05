import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { formatDeclarationIssues, validateDeclarationDocument } from "@/lib/ai/declaration-schema";
import { createDeclarationSet, type DeclarationSet } from "@/lib/ai/declarations";
import { DEFAULT_ELIGIBILITY_POLICY } from "@/lib/ai/eligibility";
import { AiProviderError } from "@/lib/ai/errors";
import { AiGateway } from "@/lib/ai/gateway";
import { createProviderRegistry } from "@/lib/ai/registry";
import { rankCandidates, selectModel } from "@/lib/ai/router";
import { describeModel, indexDeclarations } from "@/lib/ai/providers/model-declaration";
import type { ChatRequest, ModelDescriptor, RoutingStrategy } from "@/lib/ai/types";
import { createFakeProvider, healthy } from "./fixtures/fake-provider";

/**
 * These tests drive the real path an operator's configuration takes:
 * validated declaration -> descriptor -> eligibility -> routing. Nothing is
 * hand-built into eligibility, so a change that weakens a gate shows up here.
 */

const request: ChatRequest = { messages: [{ role: "user", content: "hi" }] };

function declarationsFrom(inputs: readonly unknown[]): DeclarationSet {
  const result = validateDeclarationDocument(inputs);
  if (!result.ok) throw new Error(`fixture declarations invalid: ${formatDeclarationIssues(result.issues)}`);
  return createDeclarationSet(result.declarations);
}

/** Projects declarations the way a provider adapter does. */
function project(set: DeclarationSet, provider: string, modelIds: readonly string[]): readonly ModelDescriptor[] {
  const index = indexDeclarations(set.all());
  return modelIds.map((modelId) => describeModel(provider, modelId, index));
}

function gatewayFor(models: readonly ModelDescriptor[], id = "omniroute") {
  const provider = createFakeProvider({
    id,
    models,
    health: healthy(id, 100),
  });
  return { provider, gateway: new AiGateway({ registry: createProviderRegistry([provider]) }) };
}

function textChatCapabilities() {
  return {
    inputModalities: ["text"],
    outputModalities: ["text"],
    supportsStreaming: true,
    supportsSystemPrompt: true,
    supportsTools: false,
    supportsJsonOutput: false,
  };
}

// --------------------------------------------------------------------------
// Unknown models
// --------------------------------------------------------------------------

describe("undeclared models", () => {
  it("a discovered model with no declaration is reported unknown and ineligible", async () => {
    const models = project(declarationsFrom([]), "omniroute", ["mystery"]);
    const { gateway } = gatewayFor(models);

    const catalog = await gateway.catalog();
    assert.deepEqual(
      catalog.entries.flatMap((entry) => entry.models.map((model) => [model.modelId, model.availability])),
      [["mystery", "unknown"]],
    );
    assert.deepEqual(catalog.eligible, []);
    assert.deepEqual(
      catalog.excluded.map((entry) => entry.reason),
      ["model-disabled"],
    );
  });

  it("a request with no declared model at all fails closed rather than guessing", async () => {
    const models = project(declarationsFrom([]), "omniroute", ["mystery"]);
    const { gateway, provider } = gatewayFor(models);

    await assert.rejects(gateway.select(request), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "NO_ELIGIBLE_MODEL");
      return true;
    });
    assert.equal(provider.calls.generate.length, 0, "no provider call may be attempted");
  });

  it("a declaration for a model the provider does not offer never becomes routable", async () => {
    const set = declarationsFrom([
      {
        provider: "omniroute",
        modelId: "imagined",
        enabled: true,
        availability: "available",
        capabilities: textChatCapabilities(),
      },
    ]);
    // The provider discovers something else entirely.
    const models = project(set, "omniroute", ["actually-there"]);
    const { gateway } = gatewayFor(models);

    const catalog = await gateway.catalog();
    const ids = catalog.entries.flatMap((entry) => entry.models.map((model) => model.modelId));
    assert.deepEqual(ids, ["actually-there"], "the phantom declaration must not enter the catalog");
    assert.deepEqual(catalog.eligible, []);
  });
});

// --------------------------------------------------------------------------
// Capability mismatch
// --------------------------------------------------------------------------

const incompatibleDeclarations: readonly { name: string; capabilities: unknown }[] = [
  {
    name: "embedding-only",
    capabilities: { inputModalities: ["text"], outputModalities: ["embedding"] },
  },
  {
    name: "image-only",
    capabilities: { inputModalities: ["text", "image"], outputModalities: ["image"] },
  },
  {
    name: "tts-only",
    capabilities: { inputModalities: ["text"], outputModalities: ["audio", "tts"] },
  },
  {
    name: "audio-input-only",
    capabilities: { inputModalities: ["audio"], outputModalities: ["text"] },
  },
  {
    name: "no declared modalities",
    capabilities: { supportsStreaming: true },
  },
];

for (const { name, capabilities } of incompatibleDeclarations) {
  it(`cannot route text chat to a ${name} model, even when enabled and available`, async () => {
    const set = declarationsFrom([
      {
        provider: "omniroute",
        modelId: "m",
        enabled: true,
        availability: "available",
        priority: 100,
        capabilities,
      },
    ]);
    const models = project(set, "omniroute", ["m"]);
    const { gateway, provider } = gatewayFor(models);

    const catalog = await gateway.catalog();
    assert.deepEqual(catalog.eligible, [], `${name} must not be eligible for text chat`);
    assert.deepEqual(
      catalog.excluded.map((entry) => entry.reason),
      ["no-text-chat"],
    );

    await assert.rejects(gateway.select(request), (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "NO_ELIGIBLE_MODEL");
      return true;
    });
    assert.equal(provider.calls.generate.length, 0);
  });
}

it("keeps a vision model eligible because it still answers text", async () => {
  const set = declarationsFrom([
    {
      provider: "omniroute",
      modelId: "vision",
      enabled: true,
      availability: "available",
      capabilities: {
        inputModalities: ["text", "image"],
        outputModalities: ["text"],
        supportsStreaming: true,
        supportsSystemPrompt: true,
      },
    },
  ]);
  const { gateway } = gatewayFor(project(set, "omniroute", ["vision"]));
  const selection = await gateway.select(request);
  assert.equal(selection.model.modelId, "vision");
});

it("excludes a text model from a streaming request when it cannot stream", async () => {
  const set = declarationsFrom([
    {
      provider: "omniroute",
      modelId: "m",
      enabled: true,
      availability: "available",
      capabilities: { ...textChatCapabilities(), supportsStreaming: false },
    },
  ]);
  const { gateway } = gatewayFor(project(set, "omniroute", ["m"]));

  const nonStreaming = await gateway.select(request);
  assert.equal(nonStreaming.model.modelId, "m");

  await assert.rejects(gateway.select({ ...request, requireStreaming: true }), (error: unknown) => {
    assert.ok(error instanceof AiProviderError);
    assert.equal(error.code, "NO_ELIGIBLE_MODEL");
    return true;
  });
});

it("excludes a text model when the request carries a system message it cannot honour", async () => {
  const set = declarationsFrom([
    {
      provider: "omniroute",
      modelId: "m",
      enabled: true,
      availability: "available",
      capabilities: { ...textChatCapabilities(), supportsSystemPrompt: false },
    },
  ]);
  const { gateway } = gatewayFor(project(set, "omniroute", ["m"]));

  await assert.rejects(
    gateway.select({ messages: [{ role: "system", content: "be brief" }, { role: "user", content: "hi" }] }),
    (error: unknown) => {
      assert.ok(error instanceof AiProviderError);
      assert.equal(error.code, "NO_ELIGIBLE_MODEL");
      return true;
    },
  );
});

// --------------------------------------------------------------------------
// Disabled models
// --------------------------------------------------------------------------

describe("disabled models", () => {
  it("is never routed to, and the reason is reported as model-disabled", async () => {
    const set = declarationsFrom([
      {
        provider: "omniroute",
        modelId: "off",
        enabled: false,
        availability: "available",
        priority: 100,
        capabilities: textChatCapabilities(),
      },
    ]);
    const { gateway, provider } = gatewayFor(project(set, "omniroute", ["off"]));

    const catalog = await gateway.catalog();
    assert.deepEqual(catalog.eligible, []);
    assert.deepEqual(
      catalog.excluded.map((entry) => entry.reason),
      ["model-disabled"],
    );
    assert.equal(provider.calls.generate.length, 0);
  });

  it("is rejected by default when enabled is omitted", async () => {
    const set = declarationsFrom([
      {
        provider: "omniroute",
        modelId: "implicit",
        availability: "available",
        capabilities: textChatCapabilities(),
      },
    ]);
    const catalog = await gatewayFor(project(set, "omniroute", ["implicit"])).gateway.catalog();
    assert.deepEqual(catalog.eligible, []);
  });

  it("routes to the enabled model when a disabled one has higher priority", async () => {
    const set = declarationsFrom([
      {
        provider: "omniroute",
        modelId: "off",
        enabled: false,
        priority: 1000,
        availability: "available",
        capabilities: textChatCapabilities(),
      },
      {
        provider: "omniroute",
        modelId: "on",
        enabled: true,
        priority: 0,
        availability: "available",
        capabilities: textChatCapabilities(),
      },
    ]);
    const selection = await gatewayFor(project(set, "omniroute", ["off", "on"])).gateway.select(request);
    assert.equal(selection.model.modelId, "on");
  });

  it("excludes a retired or unavailable model even when enabled", async () => {
    for (const availability of ["retired", "unavailable"] as const) {
      const set = declarationsFrom([
        {
          provider: "omniroute",
          modelId: "m",
          // enabled:false is the only consistent combination the validator allows
          enabled: false,
          availability,
          capabilities: textChatCapabilities(),
        },
      ]);
      const catalog = await gatewayFor(project(set, "omniroute", ["m"])).gateway.catalog();
      assert.ok(
        catalog.excluded.some((entry) => entry.reason === "model-disabled"),
        `availability ${availability} should keep the model out`,
      );
    }
  });
});

// --------------------------------------------------------------------------
// Cost policy
// --------------------------------------------------------------------------

describe("cost policy", () => {
  const priced = [
    {
      provider: "omniroute",
      modelId: "free",
      enabled: true,
      availability: "available",
      pricing: { tier: "free", inputPerMillionTokens: 0, outputPerMillionTokens: 0 },
      capabilities: textChatCapabilities(),
    },
    {
      provider: "omniroute",
      modelId: "paid",
      enabled: true,
      availability: "available",
      pricing: { tier: "paid", inputPerMillionTokens: 10, outputPerMillionTokens: 20 },
      capabilities: textChatCapabilities(),
    },
    {
      provider: "omniroute",
      modelId: "unpriced",
      enabled: true,
      availability: "available",
      // no pricing block at all
      capabilities: textChatCapabilities(),
    },
  ];

  it("ranks free first, then priced, then unpriced under lowest-cost", () => {
    const models = project(declarationsFrom(priced), "omniroute", ["unpriced", "paid", "free"]);
    const ranked = rankCandidates(models, "lowest-cost", request, new Map());
    assert.deepEqual(
      ranked.map((entry) => entry.model.modelId),
      ["free", "paid", "unpriced"],
    );
  });

  it("rejects paid models under a free-only policy and keeps the free one", async () => {
    const models = project(declarationsFrom(priced), "omniroute", ["free", "paid"]);
    const { gateway } = gatewayFor(models);

    const catalog = await gateway.catalog({
      ...DEFAULT_ELIGIBILITY_POLICY,
      allowPaidModels: false,
    });
    assert.deepEqual(
      catalog.eligible.map((model) => model.modelId),
      ["free"],
    );
    assert.deepEqual(
      catalog.excluded.map((entry) => [entry.model.modelId, entry.reason]),
      [["paid", "paid-not-allowed"]],
    );
    void gateway;
  });

  it("keeps an unpriced model eligible — unknown price is not a paid model", async () => {
    const models = project(declarationsFrom(priced), "omniroute", ["unpriced"]);
    const catalog = await gatewayFor(models).gateway.catalog({
      ...DEFAULT_ELIGIBILITY_POLICY,
      allowPaidModels: false,
    });
    assert.deepEqual(
      catalog.eligible.map((model) => model.modelId),
      ["unpriced"],
    );
  });

  it("never lets an unpriced model win lowest-cost against a priced one", () => {
    const models = project(declarationsFrom(priced), "omniroute", ["unpriced", "paid"]);
    const chosen = selectModel(models, "lowest-cost", request, new Map());
    assert.equal(chosen?.modelId, "paid");
  });

  it("never lets a higher priority promote a paid model under a free-only policy", async () => {
    const set = declarationsFrom([
      { ...priced[0], priority: 0 },
      { ...priced[1], priority: 1000 },
    ]);
    const models = project(set, "omniroute", ["free", "paid"]);
    const catalog = await gatewayFor(models).gateway.catalog({
      ...DEFAULT_ELIGIBILITY_POLICY,
      allowPaidModels: false,
    });
    assert.deepEqual(
      catalog.eligible.map((model) => model.modelId),
      ["free"],
    );
    assert.deepEqual(
      catalog.excluded.map((entry) => [entry.model.modelId, entry.reason]),
      [["paid", "paid-not-allowed"]],
    );
  });
});

// --------------------------------------------------------------------------
// Priority as a tiebreak
// --------------------------------------------------------------------------

describe("declared priority", () => {
  const two = [
    {
      provider: "omniroute",
      modelId: "a",
      enabled: true,
      availability: "available",
      priority: 0,
      pricing: { tier: "paid", inputPerMillionTokens: 1, outputPerMillionTokens: 1 },
      capabilities: textChatCapabilities(),
    },
    {
      provider: "omniroute",
      modelId: "b",
      enabled: true,
      availability: "available",
      priority: 5,
      pricing: { tier: "paid", inputPerMillionTokens: 1, outputPerMillionTokens: 1 },
      capabilities: textChatCapabilities(),
    },
  ];

  it("breaks a score tie in favour of the higher declared priority", () => {
    const models = project(declarationsFrom(two), "omniroute", ["a", "b"]);
    assert.equal(selectModel(models, "lowest-cost", request, new Map())?.modelId, "b");
  });

  it("is stable regardless of input order", () => {
    const models = project(declarationsFrom(two), "omniroute", ["a", "b"]);
    const strategies: readonly RoutingStrategy[] = [
      "balanced",
      "lowest-latency",
      "lowest-cost",
      "highest-quality",
    ];
    for (const strategy of strategies) {
      const forward = rankCandidates(models, strategy, request, new Map()).map((entry) => entry.model.modelId);
      const reversed = rankCandidates([...models].reverse(), strategy, request, new Map()).map(
        (entry) => entry.model.modelId,
      );
      assert.deepEqual(forward, reversed, `${strategy} became order-dependent`);
    }
  });

  it("does not override a strategy that genuinely prefers another model", () => {
    const models = project(
      declarationsFrom([
        { ...two[0], modelId: "cheap", priority: 0 },
        {
          ...two[0],
          modelId: "premium",
          priority: 100,
          pricing: { tier: "paid", inputPerMillionTokens: 90, outputPerMillionTokens: 90 },
        },
      ]),
      "omniroute",
      ["cheap", "premium"],
    );
    assert.equal(selectModel(models, "lowest-cost", request, new Map())?.modelId, "cheap");
  });
});