import type { ChatRequest, ModelDescriptor, ModelPricing } from "./types";

/** One million, the unit provider price sheets are published in. */
const TOKENS_PER_MILLION = 1_000_000;

/**
 * A rough request size used to compare models on price. Exact prompt
 * accounting belongs to the provider; routing only needs a consistent basis, so
 * this counts ~4 characters per token.
 */
const APPROX_CHARS_PER_TOKEN = 4;

export function estimateInputTokens(request: ChatRequest): number {
  let chars = 0;
  for (const message of request.messages) chars += message.content.length;
  return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
}

/**
 * Blanket allowance for ranking models of different sizes against each other.
 * The real ceiling comes from `request.maxOutputTokens` when the caller set one.
 */
const DEFAULT_ASSUMED_OUTPUT_TOKENS = 512;

export interface CostEstimate {
  /** USD, or `null` when the provider published no usable price. */
  readonly usd: number | null;
  readonly basis: "priced" | "free" | "unpriced";
}

/**
 * A model ORVYN is permitted to route to: no charge, ever.
 *
 * This is deliberately stricter than `tier === "free"`. A tier label is an
 * operator's assertion; the two published rates are a claim we can actually
 * check. Both must say zero, because either side could be billed and a missing
 * rate is not evidence of a free one.
 *
 * Failing closed here is the whole point: an unverifiable model is excluded
 * rather than trusted, so the worst case is a missing feature instead of an
 * unexpected charge.
 */
export function isFreeModel(pricing: ModelPricing): boolean {
  return (
    pricing.tier === "free" &&
    pricing.inputPerMillionTokens === 0 &&
    pricing.outputPerMillionTokens === 0
  );
}

/**
 * Deliberately conservative about missing prices. An unpriced model is not
 * free, so it loses to anything with a published rate under cost routing
 * instead of winning by default.
 */
export function estimateCost(model: ModelDescriptor, request: ChatRequest): CostEstimate {
  const pricing: ModelPricing = model.pricing;
  if (pricing.tier === "free") return { usd: 0, basis: "free" };

  const inputRate = pricing.inputPerMillionTokens;
  const outputRate = pricing.outputPerMillionTokens;
  if (inputRate === null || outputRate === null) return { usd: null, basis: "unpriced" };

  const inputTokens = estimateInputTokens(request);
  const outputTokens = request.maxOutputTokens ?? DEFAULT_ASSUMED_OUTPUT_TOKENS;
  const usd =
    (inputTokens / TOKENS_PER_MILLION) * inputRate +
    (outputTokens / TOKENS_PER_MILLION) * outputRate;

  return { usd, basis: "priced" };
}

/**
 * Sortable cost score. Lower is cheaper. Unpriced models sort last so they can
 * never be chosen for being "free".
 */
export function costScore(model: ModelDescriptor, request: ChatRequest): number {
  const { usd } = estimateCost(model, request);
  return usd === null ? Number.POSITIVE_INFINITY : usd;
}