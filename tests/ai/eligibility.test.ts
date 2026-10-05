import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  DEFAULT_ELIGIBILITY_POLICY,
  evaluateModelEligibility,
  isPinnedModel,
  partitionByEligibility,
  policyForRequest,
  sameModel,
  type EligibilityPolicy,
  type ProviderState,
} from "@/lib/ai/eligibility";
import type { ProviderId } from "@/lib/ai/types";
import {
  createFakeProvider,
  healthy,
  makeModel,
  textChatCapabilities,
  unreachable,
} from "./fixtures/fake-provider";

function states(entries: Record<ProviderId, ProviderState>): ReadonlyMap<ProviderId, ProviderState> {
  return new Map(Object.entries(entries));
}

const up: ProviderState = { configured: true, health: healthy("p") };

describe("evaluateModelEligibility", () => {
  it("accepts a configured, reachable, enabled text-chat model", () => {
    const model = makeModel({ provider: "p", modelId: "m1" });
    const decision = evaluateModelEligibility(
      model,
      states({ p: up }),
      DEFAULT_ELIGIBILITY_POLICY,
    );
    assert.deepEqual(decision, { eligible: true, reason: null });
  });

  it("rejects a model whose provider is not registered", () => {
    const model = makeModel({ provider: "missing", modelId: "m1" });
    const decision = evaluateModelEligibility(model, states({}), DEFAULT_ELIGIBILITY_POLICY);
    assert.equal(decision.reason, "provider-not-registered");
  });

  it("rejects an unconfigured provider before any health lookup matters", () => {
    const model = makeModel({ provider: "p", modelId: "m1" });
    const decision = evaluateModelEligibility(
      model,
      states({ p: { configured: false, health: healthy("p") } }),
      DEFAULT_ELIGIBILITY_POLICY,
    );
    assert.equal(decision.reason, "provider-not-configured");
  });

  it("rejects an unreachable provider", () => {
    const model = makeModel({ provider: "p", modelId: "m1" });
    const decision = evaluateModelEligibility(
      model,
      states({ p: { configured: true, health: unreachable("p") } }),
      DEFAULT_ELIGIBILITY_POLICY,
    );
    assert.equal(decision.reason, "provider-unreachable");
  });

  it("rejects a provider with no health observation", () => {
    const model = makeModel({ provider: "p", modelId: "m1" });
    const decision = evaluateModelEligibility(
      model,
      states({ p: { configured: true, health: null } }),
      DEFAULT_ELIGIBILITY_POLICY,
    );
    assert.equal(decision.reason, "provider-unreachable");
  });

  it("honours the provider allowlist", () => {
    const policy: EligibilityPolicy = { ...DEFAULT_ELIGIBILITY_POLICY, allowedProviders: ["other"] };
    const decision = evaluateModelEligibility(makeModel({ provider: "p", modelId: "m1" }), states({ p: up }), policy);
    assert.equal(decision.reason, "provider-not-allowed");
  });

  it("rejects a disabled model", () => {
    const model = makeModel({ provider: "p", modelId: "m1", enabled: false });
    const decision = evaluateModelEligibility(model, states({ p: up }), DEFAULT_ELIGIBILITY_POLICY);
    assert.equal(decision.reason, "model-disabled");
  });

  it("fails closed on an unknown availability", () => {
    const model = makeModel({ provider: "p", modelId: "m1", availability: "unknown" });
    const decision = evaluateModelEligibility(model, states({ p: up }), DEFAULT_ELIGIBILITY_POLICY);
    assert.equal(decision.reason, "model-unavailable");
  });

  it("routes to a degraded model, since degraded still answers", () => {
    const model = makeModel({ provider: "p", modelId: "m1", availability: "degraded" });
    const decision = evaluateModelEligibility(model, states({ p: up }), DEFAULT_ELIGIBILITY_POLICY);
    assert.equal(decision.eligible, true);
  });

  for (const availability of ["unavailable", "retired"] as const) {
    it(`rejects a model marked ${availability}`, () => {
      const model = makeModel({ provider: "p", modelId: "m1", availability });
      const decision = evaluateModelEligibility(model, states({ p: up }), DEFAULT_ELIGIBILITY_POLICY);
      assert.equal(decision.reason, "model-unavailable");
    });
  }

  it("rejects a model with no text-chat capability", () => {
    const model = makeModel({
      provider: "p",
      modelId: "embed-1",
      capabilities: textChatCapabilities({
        inputModalities: ["text"],
        outputModalities: ["embedding"],
      }),
    });
    const decision = evaluateModelEligibility(model, states({ p: up }), DEFAULT_ELIGIBILITY_POLICY);
    assert.equal(decision.reason, "no-text-chat");
  });

  it("rejects a model that cannot stream when streaming is required", () => {
    const policy: EligibilityPolicy = { ...DEFAULT_ELIGIBILITY_POLICY, requireStreaming: true };
    const model = makeModel({
      provider: "p",
      modelId: "m1",
      capabilities: textChatCapabilities({ supportsStreaming: false }),
    });
    const decision = evaluateModelEligibility(model, states({ p: up }), policy);
    assert.equal(decision.reason, "streaming-unsupported");
  });

  it("rejects a model that ignores system prompts when one is required", () => {
    const policy: EligibilityPolicy = { ...DEFAULT_ELIGIBILITY_POLICY, requireSystemPrompt: true };
    const model = makeModel({
      provider: "p",
      modelId: "m1",
      capabilities: textChatCapabilities({ supportsSystemPrompt: false }),
    });
    const decision = evaluateModelEligibility(model, states({ p: up }), policy);
    assert.equal(decision.reason, "system-prompt-unsupported");
  });

  it("rejects a paid model under a free-only policy", () => {
    const policy: EligibilityPolicy = { ...DEFAULT_ELIGIBILITY_POLICY, allowPaidModels: false };
    const decision = evaluateModelEligibility(makeModel({ provider: "p", modelId: "m1" }), states({ p: up }), policy);
    assert.equal(decision.reason, "paid-not-allowed");
  });

  it("accepts a free model under a free-only policy", () => {
    const policy: EligibilityPolicy = { ...DEFAULT_ELIGIBILITY_POLICY, allowPaidModels: false };
    const model = makeModel({
      provider: "p",
      modelId: "m1",
      pricing: { currency: "USD", tier: "free", inputPerMillionTokens: 0, outputPerMillionTokens: 0 },
    });
    assert.equal(evaluateModelEligibility(model, states({ p: up }), policy).eligible, true);
  });

  it("reports only the first failing rule, in a fixed order", () => {
    const policy: EligibilityPolicy = {
      allowedProviders: [],
      allowPaidModels: false,
      requireStreaming: true,
      requireSystemPrompt: true,
    };
    // Disabled + unreachable + disallowed: the provider-level rules come first,
    // so the reason is stable rather than dependent on object key order.
    const model = makeModel({ provider: "p", modelId: "m1", enabled: false });
    const decision = evaluateModelEligibility(
      model,
      states({ p: { configured: true, health: unreachable("p") } }),
      policy,
    );
    assert.equal(decision.reason, "provider-not-allowed");
  });
});

describe("partitionByEligibility", () => {
  it("splits models and keeps the reason for each rejection", () => {
    const models = [
      makeModel({ provider: "p", modelId: "good" }),
      makeModel({ provider: "p", modelId: "disabled", enabled: false }),
      makeModel({ provider: "q", modelId: "elsewhere" }),
    ];
    const report = partitionByEligibility(
      models,
      states({ p: up, q: { configured: true, health: healthy("q") } }),
      DEFAULT_ELIGIBILITY_POLICY,
    );
    assert.deepEqual(
      report.eligible.map((model) => model.modelId),
      ["good", "elsewhere"],
    );
    assert.deepEqual(
      report.rejected.map((entry) => [entry.model.modelId, entry.reason]),
      [["disabled", "model-disabled"]],
    );
  });
});

describe("policyForRequest", () => {
  const base: EligibilityPolicy = DEFAULT_ELIGIBILITY_POLICY;

  it("turns on the streaming requirement only when the request asks for it", () => {
    assert.equal(policyForRequest({ messages: [] }, base).requireStreaming, false);
    assert.equal(
      policyForRequest({ messages: [], requireStreaming: true }, base).requireStreaming,
      true,
    );
  });

  it("requires system-prompt support when the request carries a system message", () => {
    const withSystem = policyForRequest(
      { messages: [{ role: "system", content: "be brief" }] },
      base,
    );
    assert.equal(withSystem.requireSystemPrompt, true);
  });

  it("keeps the system-prompt requirement when the base policy already sets it", () => {
    const policy: EligibilityPolicy = { ...base, requireSystemPrompt: true };
    assert.equal(policyForRequest({ messages: [] }, policy).requireSystemPrompt, true);
  });

  it("preserves unrelated policy fields", () => {
    const policy: EligibilityPolicy = { ...base, allowedProviders: ["p"], allowPaidModels: false };
    const derived = policyForRequest({ messages: [] }, policy);
    assert.deepEqual(derived.allowedProviders, ["p"]);
    assert.equal(derived.allowPaidModels, false);
  });
});

describe("pinned model helpers", () => {
  it("compares provider and model id together", () => {
    assert.equal(sameModel({ provider: "a", modelId: "m" }, { provider: "a", modelId: "m" }), true);
    assert.equal(sameModel({ provider: "a", modelId: "m" }, { provider: "b", modelId: "m" }), false);
    assert.equal(sameModel({ provider: "a", modelId: "m" }, { provider: "a", modelId: "n" }), false);
  });

  it("treats an absent pin as matching nothing", () => {
    assert.equal(isPinnedModel(makeModel({ provider: "p", modelId: "m" }), undefined), false);
  });
});

describe("fake provider fixture", () => {
  it("reports models it was given, so eligibility tests use real descriptors", async () => {
    const provider = createFakeProvider({
      id: "p",
      models: [makeModel({ provider: "p", modelId: "m1" })],
    });
    const models = await provider.listModels();
    assert.deepEqual(
      models.map((model) => model.modelId),
      ["m1"],
    );
    assert.equal(provider.calls.listModels, 1);
  });
});