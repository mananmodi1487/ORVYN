import { createBrowserClient } from "@supabase/ssr";
import { getSupabaseEnv } from "./env";

/**
 * Supabase client for Client Components and browser code.
 *
 * Call this inside a client component or event handler — it reads
 * `document.cookie`, so it must never be invoked during server rendering.
 */
export function createClient() {
  const { url, publishableKey } = getSupabaseEnv();

  return createBrowserClient(url, publishableKey);
}