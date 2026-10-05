import { isStreamable, supportsSystemMessages, supportsTextChat } from "./capabilities";
import { isFreeModel } from "./pricing";
import type {
  ChatRequest,
  ModelDescriptor,
  ModelRef,
  ProviderHealth,
  ProviderId,
} from "./types";

/**
 * What we know about a provider at request time.
 *
 * `configured` is false when credentials or a base URL are missing. Such a
 * provider must never be contacted — that is the difference between "not wired
 * up yet" and "down".
 */
export interface ProviderState {
  readonly configured: boolean;
  readonly health: ProviderHealth | null;
}

export interface EligibilityPolicy {
  /** `null` allows every provider. Otherwise an explicit allowlist. */
  readonly allowedProviders: readonly ProviderId[] | null;
  /**
   * When false, only models ORVYN can prove are free are eligible. Both paid and
   * unknown-priced models are rejected, because an unverifiable price is not
   * evidence of a free one.
   */
  readonly allowPaidModels: boolean;
  /** Rejects models that cannot stream. */
  readonly requireStreaming: boolean;
  /** Rejects models that ignore a leading system message. */
  readonly requireSystemPrompt: boolean;
}

/**
 * Free-only, and that is the product's default rather than an opt-in.
 *
 * A paid model being reachable at all is the failure mode this prevents, so the
 * safe policy must be the one that applies when nobody has configured
 * anything. Setting `allowPaidModels` back to true is a deliberate act by an
 * operator who accepts billing, not something a request can turn on.
 */
export const DEFAULT_ELIGIBILITY_POLICY: EligibilityPolicy = {
  allowedProviders: null,
  allowPaidModels: false,
  requireStreaming: false,
  requireSystemPrompt: false,
};

/** The policy name a client-facing failure uses when nothing free is reachable. */
export const NO_FREE_MODEL_DETAIL =
  "no free model is eligible: declare a model with pricing tier free and both rates at 0, or with freeAllowance: true and both rates declared";

export type RejectionReason =
  | "provider-not-registered"
  | "provider-not-configured"
  | "provider-not-allowed"
  | "provider-unreachable"
  | "model-disabled"
  | "model-unavailable"
  | "no-text-chat"
  | "streaming-unsupported"
  | "system-prompt-unsupported"
  | "paid-not-allowed"
  | "unknown-pricing"
  | "allowance-not-declared";

export interface EligibilityDecision {
  readonly eligible: boolean;
  readonly reason: RejectionReason | null;
}

const ELIGIBLE: EligibilityDecision = { eligible: true, reason: null };

function reject(reason: RejectionReason): EligibilityDecision {
  return { eligible: false, reason };
}

/**
 * Whether a model is eligible under a free-only policy.
 *
 * Two distinct routes, kept separate on purpose:
 *
 * - `isFreeModel` — the model publishes zero rates and is genuinely free. It
 *   needs no operator declaration and no allowance.
 * - `freeAllowance` — the operator has declared this model is served out of a
 *   zero-cost allowance they fund. The model still publishes metered rates and
 *   is still `tier: "paid"` or `"unknown"`; the flag is what lets it through.
 *
 * The second route exists because some providers have no permanently-free
 * models but do offer a zero-cost daily allowance that stops rather than
 * bills. Treating those models as paid would exclude the only genuinely free
 * path to them; treating them as permanently free would be a lie about their
 * pricing. The allowance is the honest middle ground, and it is operator-owned.
 *
 * An allowance claim without published rates is rejected here too, not just at
 * declaration load time: the runtime guard is independent of the schema, so a
 * descriptor built directly (as in tests) cannot smuggle an unverifiable
 * allowance through the free-only gate.
 */
export function isFreeEligible(model: ModelDescriptor): boolean {
  if (isFreeModel(model.pricing)) return true;
  if (model.freeAllowance !== true) return false;
  return (
    model.pricing.inputPerMillionTokens !== null &&
    model.pricing.outputPerMillionTokens !== null
  );
}

/**
 * Availability states that may be routed to. `unknown` is treated as not
 * routable: a model we have never confirmed against a provider may not exist
 * upstream, and failing closed keeps the router from burning a request on it.
 */
const ROUTABLE_AVAILABILITIES: ReadonlySet<ModelDescriptor["availability"]> = new Set([
  "available",
  "degraded",
]);

export function evaluateModelEligibility(
  model: ModelDescriptor,
  states: ReadonlyMap<ProviderId, ProviderState>,
  policy: EligibilityPolicy,
): EligibilityDecision {
  const state = states.get(model.provider);
  if (state === undefined) return reject("provider-not-registered");
  if (!state.configured) return reject("provider-not-configured");
  if (policy.allowedProviders !== null && !policy.allowedProviders.includes(model.provider)) {
    return reject("provider-not-allowed");
  }
  if (state.health === null || !state.health.reachable) return reject("provider-unreachable");

  if (!model.enabled) return reject("model-disabled");
  if (!ROUTABLE_AVAILABILITIES.has(model.availability)) return reject("model-unavailable");
  if (!supportsTextChat(model.capabilities)) return reject("no-text-chat");
  if (policy.requireStreaming && !isStreamable(model.capabilities)) {
    return reject("streaming-unsupported");
  }
  if (policy.requireSystemPrompt && !supportsSystemMessages(model.capabilities)) {
    return reject("system-prompt-unsupported");
  }
  // Free-only is enforced here rather than in the router, so a paid or
  // unverifiable model is never a candidate at all. Ranking preferences cannot
  // promote something that was excluded.
  //
  // Two routes through the free-only gate, kept distinct:
  // - permanently free (zero rates) — needs no declaration,
  // - free-allowance (metered rates, operator-funded zero-cost budget).
  if (policy.allowPaidModels) return ELIGIBLE;
  if (isFreeEligible(model)) return ELIGIBLE;
  return reject(model.pricing.tier === "paid" ? "paid-not-allowed" : "unknown-pricing");
}

export interface EligibilityReport {
  readonly eligible: readonly ModelDescriptor[];
  /** Rejected models with the rule that rejected them, for diagnostics. */
  readonly rejected: readonly { readonly model: ModelDescriptor; readonly reason: RejectionReason }[];
}

export function partitionByEligibility(
  models: readonly ModelDescriptor[],
  states: ReadonlyMap<ProviderId, ProviderState>,
  policy: EligibilityPolicy,
): EligibilityReport {
  const eligible: ModelDescriptor[] = [];
  const rejected: { model: ModelDescriptor; reason: RejectionReason }[] = [];
  for (const model of models) {
    const decision = evaluateModelEligibility(model, states, policy);
    if (decision.eligible) {
      eligible.push(model);
    } else {
      rejected.push({ model, reason: decision.reason ?? "no-text-chat" });
    }
  }
  return { eligible, rejected };
}

/**
 * Derives the policy a request actually needs. `requireStreaming` and
 * `requireSystemPrompt` follow the request instead of operator config, because
 * a streaming request against a non-streaming model is a request that cannot be
 * satisfied.
 */
export function policyForRequest(
  request: ChatRequest,
  base: EligibilityPolicy = DEFAULT_ELIGIBILITY_POLICY,
): EligibilityPolicy {
  const hasSystemMessage = request.messages.some((message) => message.role === "system");
  return {
    ...base,
    requireStreaming: request.requireStreaming === true,
    requireSystemPrompt: base.requireSystemPrompt || hasSystemMessage,
  };
}

export function sameModel(a: ModelRef, b: ModelRef): boolean {
  return a.provider === b.provider && a.modelId === b.modelId;
}

export function isPinnedModel(model: ModelDescriptor, pinned: ModelRef | undefined): boolean {
  return pinned !== undefined && sameModel(model, pinned);
}