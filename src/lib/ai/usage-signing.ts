/**
 * Proof that a usage write really came from ORVYN's chat execution path.
 *
 * The database cannot tell the Next.js server apart from the browser: both reach
 * Supabase with the same signed-in user's session. Without something only the
 * server holds, any RLS policy that permits a write is a policy the user can
 * satisfy themselves. This module supplies that missing thing — an HMAC over the
 * exact row being written, keyed by a server-only secret.
 *
 * Two consequences worth stating plainly:
 *
 * - The browser never sees the signature. It is generated here, sent straight to
 *   the database, and never rendered, logged, or returned by any endpoint.
 * - Changing any field invalidates the signature, so a captured write cannot be
 *   replayed with a larger count. `requestNonce` additionally carries a unique
 *   constraint, so replaying the *identical* write is a no-op rather than a
 *   second row.
 *
 * The canonical string here must stay byte-identical to
 * `private.ai_usage_canonical_payload` in the migration. That pairing is what
 * makes a forged payload fail: the database recomputes the expected signature
 * from the row it is about to write, not from anything the caller supplied.
 */
import { createHmac, randomUUID } from "node:crypto";
import { assertServerOnly } from "./server-only";

/**
 * Server-only. Never `NEXT_PUBLIC_`-prefixed: a prefixed value is inlined into
 * the browser bundle, which would hand every user the ability to sign usage.
 */
export const USAGE_SIGNING_SECRET_VAR = "ORVYN_USAGE_SIGNING_SECRET";

/** Bumped if the canonical layout ever changes, so old signatures cannot replay. */
export const USAGE_PAYLOAD_VERSION = "orvyn-usage-v1";

/** Literal used for an unreported half, so a missing count is never read as 0. */
const NULL_COUNT = "null";

export interface UsageSigningInput {
  /** From the authenticated session. Never taken from a request body. */
  readonly userId: string;
  readonly provider: string;
  readonly modelId: string;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  /** Unique per completed response, so an identical replay collapses to a no-op. */
  readonly nonce: string;
}

/**
 * Builds the exact string that is signed.
 *
 * Newline-delimited with a version prefix. The separator is what makes this
 * unambiguous: no field may contain a newline, which is enforced here and again
 * in the database, so a model id cannot be crafted to imitate field boundaries.
 */
export function usageSigningPayload(input: UsageSigningInput): string {
  assertServerOnly("@/lib/ai/usage-signing");
  assertNoLineBreaks("provider", input.provider);
  assertNoLineBreaks("modelId", input.modelId);
  assertNoLineBreaks("nonce", input.nonce);

  return [
    USAGE_PAYLOAD_VERSION,
    input.userId,
    input.provider,
    input.modelId,
    input.inputTokens === null ? NULL_COUNT : String(input.inputTokens),
    input.outputTokens === null ? NULL_COUNT : String(input.outputTokens),
    input.nonce,
  ].join("\n");
}

/** Lowercase hex SHA-256, matching `encode(hmac(...), 'hex')` in Postgres. */
export function signUsagePayload(secret: string, payload: string): string {
  assertServerOnly("@/lib/ai/usage-signing");
  return createHmac("sha256", secret).update(payload, "utf8").digest("hex");
}

/**
 * A fresh nonce for one completed response.
 *
 * UUIDs are used because uniqueness is the only property that matters here —
 * the database rejects a duplicate outright.
 */
export function newUsageNonce(): string {
  return randomUUID();
}

/**
 * The configured signing secret, or `null` when there is none.
 *
 * An unset secret is a normal state for a development machine, and it fails
 * closed: `recordUsage` writes nothing and the UI reports usage as unavailable.
 * It never falls back to an unsigned write.
 */
export function resolveUsageSigningSecret(env: NodeJS.ProcessEnv = process.env): string | null {
  assertServerOnly("@/lib/ai/usage-signing");
  const trimmed = env[USAGE_SIGNING_SECRET_VAR]?.trim();
  return trimmed === undefined || trimmed === "" ? null : trimmed;
}

function assertNoLineBreaks(field: string, value: string): void {
  if (value.includes("\n") || value.includes("\r")) {
    throw new Error(`usage signing rejected: \`${field}\` must not contain a line break`);
  }
}