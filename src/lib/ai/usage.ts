/**
 * Token accounting.
 *
 * Every number here originates from a provider response. Nothing is estimated,
 * inferred from character counts, or filled in from a default — a figure that
 * the upstream did not report stays absent, and the UI says so.
 *
 * That is why almost every function returns `null` rather than `0`. Zero is a
 * real measurement ("the provider reported zero tokens"), while `null` means
 * "the provider reported nothing", and conflating them would let a missing
 * reading silently become a number a user trusts.
 */
import type { TokenUsage } from "./types";

/**
 * Total for a single usage reading.
 *
 * Requires both halves. If either side is missing there is no total to report,
 * because adding an absent input to a known output would understate the cost.
 */
export function totalTokens(usage: TokenUsage): number | null {
  if (usage.inputTokens === null || usage.outputTokens === null) return null;
  return usage.inputTokens + usage.outputTokens;
}

/** True when a provider reported enough to show any number at all. */
export function hasUsage(usage: TokenUsage | null): usage is TokenUsage {
  return usage !== null && (usage.inputTokens !== null || usage.outputTokens !== null);
}

/**
 * Adds usage readings, ignoring absent halves rather than treating them as zero.
 *
 * Summing across a conversation would otherwise let one unreported response
 * quietly reduce the total, which reads as "these tokens were free".
 */
export function sumUsage(readings: readonly TokenUsage[]): TokenUsage {
  let inputTokens = 0;
  let outputTokens = 0;
  let inputComplete = true;
  let outputComplete = true;

  for (const reading of readings) {
    if (reading.inputTokens === null) inputComplete = false;
    else inputTokens += reading.inputTokens;
    if (reading.outputTokens === null) outputComplete = false;
    else outputTokens += reading.outputTokens;
  }

  return {
    inputTokens: inputComplete ? inputTokens : null,
    outputTokens: outputComplete ? outputTokens : null,
  };
}

/**
 * Every count ORVYN tracks, or `null` when the store has no trustworthy figure.
 *
 * `null` is a normal state, not an error: ORVYN runs without Supabase, and it
 * reports "unavailable" rather than a number it cannot stand behind.
 */
export interface UsageTotals {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens: number;
  readonly requestCount: number;
}

export const NO_TOTALS: UsageTotals = {
  inputTokens: 0,
  outputTokens: 0,
  totalTokens: 0,
  requestCount: 0,
};

/**
 * ORVYN's monthly free-pool target.
 *
 * This is a budget ORVYN sets for itself, not a capacity upstream has promised.
 * It exists so the free tier has a ceiling and so consumption is visible; it is
 * not a guarantee that any provider will serve 10B tokens, and nothing in the
 * product may present it as one.
 */
export const MONTHLY_FREE_POOL_TARGET_TOKENS = 10_000_000_000;

/** Token formatting: grouped digits for exact counts, no unit guessing. */
export function formatTokens(count: number): string {
  return count.toLocaleString("en-US");
}

/**
 * One completed response's usage, ready to be recorded.
 *
 * Both counts are nullable so a provider that reported only one side can be
 * stored faithfully, but at least one must be present — a row with neither
 * carries no information, and the database rejects it.
 */
export interface UsageRecord {
  readonly provider: string;
  readonly modelId: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}
