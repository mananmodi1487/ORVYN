/**
 * Supabase environment access.
 *
 * Only the two `NEXT_PUBLIC_` values are read, and only the *publishable* key is
 * ever accepted. The secret / service-role key must never be referenced from
 * application code — it belongs in server-only tooling and must not be prefixed
 * with `NEXT_PUBLIC_`, which would inline it into the browser bundle.
 *
 * Resolution is deferred to call time rather than module scope so a missing
 * value produces an actionable error instead of breaking `next build`.
 */

export type SupabaseEnv = {
  url: string;
  publishableKey: string;
};

const MISSING_ENV_MESSAGE =
  "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
  "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in .env.local (see .env.example), then restart the dev server.";

/**
 * Whether both public values are present. Use this to gate optional wiring that
 * must not take the app down — the proxy does, so an unconfigured project still
 * serves traffic.
 */
export function isSupabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/**
 * Reads the public Supabase values, throwing if they are absent. Use this at the
 * point a client is actually created so misconfiguration surfaces loudly instead
 * of silently returning a broken client.
 */
export function getSupabaseEnv(): SupabaseEnv {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  if (!url || !publishableKey) {
    throw new Error(MISSING_ENV_MESSAGE);
  }

  return { url, publishableKey };
}