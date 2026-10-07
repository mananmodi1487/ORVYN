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
 * - No signing secret → nothing is recorded. See `recordUsage` for why that is
 *   the only correct response.
 *
 * The secret / service-role key is never used, and neither is a direct table
 * write. The browser holds the same Supabase session the server does, so any
 * policy that permits a client insert is a policy the client can satisfy itself.
 * Instead every row is signed here with a server-only HMAC and handed to
 * `private.ai_usage_record`, which verifies the signature and writes the row.
 * A client calling that function directly has no way to produce a valid one.
 */
import { assertServerOnly } from "./server-only";
import {
  MONTHLY_FREE_POOL_TARGET_TOKENS,
  type UsageRecord,
  type UsageTotals,
} from "./usage";
import {
  newUsageNonce,
  resolveUsageSigningSecret,
  signUsagePayload,
  usageSigningPayload,
} from "./usage-signing";

/** The only write path. Exists outside `public` and is unreachable as a table. */
const RECORD_FUNCTION = "ai_usage_record";

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
 * Persists one provider-reported reading for the signed-in user.
 *
 * The user id is read from the session and never passed in, the token counts come
 * from the provider response, and the row is signed before it is sent. An unsigned
 * write is never attempted: without a secret there is no legitimate way to write,
 * so the honest outcome is no row and "usage unavailable", not a fallback path that
 * a client could reach instead.
 *
 * Best-effort by design: a usage row is bookkeeping, and failing a completed
 * answer because the counter could not be written would be the worse outcome.
 * Returns whether the row was written.
 */
/**
 * Writes a single safe diagnostic line for a usage-recording failure.
 *
 * This exists only to make a silent failure diagnosable. It deliberately logs
 * nothing that could be replayed, forged, or used to reconstruct a secret:
 *
 *   - the signing secret is never read here and never logged;
 *   - the HMAC signature is generated downstream and never reaches this logger;
 *   - the request nonce is unique per response and is not logged;
 *   - token counts are usage data, not credentials, but they are also not needed
 *     to identify *why* a write failed, so they stay out;
 *   - the user id is PII and is not logged.
 *
 * What is logged is the smallest set that distinguishes the known failure modes:
 * a stable category, the Supabase RPC error code and message when one exists,
 * and the provider/model identifier so an operator can correlate a failing
 * model with the accounting gap.
 *
 * This does not change which writes succeed or fail, and it does not change the
 * caller's return value. It is additive and server-side only.
 */
function logUsageFailure(
  category: "signing_secret_missing" | "supabase_unconfigured" | "no_session" | "rpc_rejected",
  provider: string,
  modelId: string,
  detail: string,
): void {
  // Structured, one line, JSON-shaped so it is grep-able without parsing prose.
  console.error(JSON.stringify({
    event: "usage_record_failed",
    category,
    provider,
    modelId,
    detail,
    at: new Date().toISOString(),
  }));
}

export async function recordUsage(record: UsageRecord): Promise<boolean> {
  const secret = resolveUsageSigningSecret();
  if (secret === null) {
    logUsageFailure(
      "signing_secret_missing",
      record.provider,
      record.modelId,
      "ORVYN_USAGE_SIGNING_SECRET is not set",
    );
    return false;
  }

  const client = await getClient();
  if (client === null) {
    logUsageFailure(
      "supabase_unconfigured",
      record.provider,
      record.modelId,
      "Supabase is not configured",
    );
    return false;
  }

  // The user id comes from the session JWT's claims, which the client
  // verifies against the project's cached JWKS — the same identity
  // getUser() establishes, without a GoTrue round trip on every
  // completed response.
  const { data: claimsData, error: claimsError } = await client.auth.getClaims();
  const userId = claimsData?.claims?.sub ?? null;
  if (claimsError !== null || userId === null) {
    logUsageFailure(
      "no_session",
      record.provider,
      record.modelId,
      claimsError === null ? "no authenticated session" : claimsError.message,
    );
    return false;
  }

  const nonce = newUsageNonce();
  const payload = usageSigningPayload({
    userId,
    provider: record.provider,
    modelId: record.modelId,
    inputTokens: record.inputTokens,
    outputTokens: record.outputTokens,
    nonce,
  });

  const { error: rpcError } = await client.rpc(RECORD_FUNCTION, {
    p_provider: record.provider,
    p_model_id: record.modelId,
    p_input_tokens: record.inputTokens,
    p_output_tokens: record.outputTokens,
    p_nonce: nonce,
    p_signature: signUsagePayload(secret, payload),
  });

  if (rpcError !== null) {
    logUsageFailure(
      "rpc_rejected",
      record.provider,
      record.modelId,
      rpcError.message,
    );
  }

  return rpcError === null;
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

export function readTotals(data: unknown, error: unknown): UsageTotals | null {
  if (error !== null || !Array.isArray(data) || data.length === 0) return null;
  const row = data[0];
  if (typeof row !== "object" || row === null) return null;

  /**
   * Reads one aggregate column into a safe non-negative integer.
   *
   * PostgreSQL `bigint`/`int8` aggregates can arrive as decimal strings, so a
   * strict `typeof value === "number"` check rejected every real total and the
   * UI fell back to "usage unavailable" even though the RPCs executed fine.
   *
   * Acceptance is narrow on purpose: a value must be either a finite JavaScript
   * number that is a safe non-negative integer, or a decimal string of one —
   * so `"1204"` is accepted and `"1.5"`, `"-3"`, `"abc"`, `null`, `true`,
   * and `1.5` are all rejected. The string is only converted to a number
   * *after* it is confirmed to be a safe integer, which is what keeps the
   * conversion lossless.
   */
  const read = (key: string): number | null => {
    const value = (row as Record<string, unknown>)[key];
    if (typeof value === "number") {
      return Number.isFinite(value) && Number.isInteger(value) && value >= 0 ? value : null;
    }
    if (typeof value === "string") {
      // No trimming: a padded or embedded-whitespace string is not a bigint
      // value, and accepting it would let a malformed aggregate through.
      if (!/^[0-9]+$/.test(value)) return null;
      const asNumber = Number(value);
      if (!Number.isSafeInteger(asNumber)) return null;
      return asNumber;
    }
    return null;
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