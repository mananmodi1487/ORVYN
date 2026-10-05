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