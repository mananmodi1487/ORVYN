/**
 * Server-side usage persistence.
 *
 * The AI layer knows what a provider reported; only this module decides where
 * that number is kept. It depends on Supabase and on an authenticated user, and
 * it degrades to "unavailable" rather than to a fabricated figure:
 *
 * - Supabase not configured → nothing is recorded and totals are unavailable.
 * - No signed-in user → nothing is recorded, because usage has to be attributable
 *   to someone; anonymous traffic reports unavailable instead of being pooled
 *   into a total no one can audit.
 *
 * The secret / service-role key is never used. Writes go through the caller's own
 * session, so the `ai_usage` RLS policies are the only gate.
 */
import { assertServerOnly } from "./server-only";
import { MONTHLY_FREE_POOL_TARGET_TOKENS, type UsageTotals } from "./usage";

/** One provider-reported reading to persist. */
export interface UsageRecord {
  readonly provider: string;
  readonly modelId: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
}

export interface UsageSummary {
  /** `null` when ORVYN cannot attribute usage to a user. */
  readonly userDaily: UsageTotals | null;
  /** `null` when the store is unavailable. */
  readonly globalMonth: UsageTotals | null;
  /** ORVYN's own monthly ceiling. Not an upstream capacity guarantee. */
  readonly monthlyTargetTokens: number;
}

/** Shown when there is no store, so the UI can say "unavailable" and mean it. */
export const UNAVAILABLE_SUMMARY: UsageSummary = {
  userDaily: null,
  globalMonth: null,
  monthlyTargetTokens: MONTHLY_FREE_POOL_TARGET_TOKENS,
};

/**
 * Whether usage can be recorded right now.
 *
 * Checked before every write so an unconfigured deployment never turns a missing
 * project into a 500 on an otherwise successful chat response.
 */
export async function canRecordUsage(): Promise<boolean> {
  assertServerOnly("@/lib/ai/usage-store");
  const client = await getClient();
  if (client === null) return false;
  const { data, error } = await client.auth.getUser();
  return error === null && data.user !== null;
}

/**
 * Persists one provider-reported reading for the signed-in user.
 *
 * Best-effort by design: a usage row is bookkeeping, and failing a completed
 * answer because the counter could not be written would be the worse outcome.
 * Returns whether the row was written.
 */
export async function recordUsage(record: UsageRecord): Promise<boolean> {
  const client = await getClient();
  if (client === null) return false;

  const { data, error } = await client.auth.getUser();
  if (error !== null || data.user === null) return false;

  const { error: insertError } = await client.from("ai_usage").insert({
    user_id: data.user.id,
    provider: record.provider,
    model_id: record.modelId,
    input_tokens: record.inputTokens,
    output_tokens: record.outputTokens,
  });

  return insertError === null;
}

/**
 * Reads the caller's daily total and the global month-to-date total.
 *
 * Either side is independently `null`: the migration may not have been applied,
 * or a query may fail, and a partial answer is still better than an invented one.
 */
export async function readUsageSummary(): Promise<UsageSummary> {
  const client = await getClient();
  if (client === null) return UNAVAILABLE_SUMMARY;

  const [daily, month] = await Promise.all([
    client.rpc("ai_usage_daily_total"),
    client.rpc("ai_usage_month_total"),
  ]);

  return {
    userDaily: readTotals(daily.data, daily.error),
    globalMonth: readTotals(month.data, month.error),
    monthlyTargetTokens: MONTHLY_FREE_POOL_TARGET_TOKENS,
  };
}

/**
 * The Supabase client, or `null` when the project is not configured.
 *
 * A null client is a normal state for this app, so it is returned rather than
 * thrown; `getSupabaseEnv` still throws for callers that genuinely require it.
 */
async function getClient() {
  assertServerOnly("@/lib/ai/usage-store");
  const { isSupabaseConfigured } = await import("@/utils/supabase/env");
  if (!isSupabaseConfigured()) return null;

  const { createClient } = await import("@/utils/supabase/server");
  try {
    return await createClient();
  } catch {
    // Session/cookie access can fail in contexts where cookies are unavailable.
    return null;
  }
}

function readTotals(data: unknown, error: unknown): UsageTotals | null {
  if (error !== null || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0];
  if (typeof row !== "object" || row === null) return null;

  const read = (key: string): number | null => {
    const value = (row as Record<string, unknown>)[key];
    return typeof value === "number" && Number.isFinite(value) ? value : null;
  };

  const inputTokens = read("input_tokens");
  const outputTokens = read("output_tokens");
  const requestCount = read("request_count");
  if (inputTokens === null || outputTokens === null || requestCount === null) return null;

  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    requestCount,
  };
}