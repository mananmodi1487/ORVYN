import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { getSupabaseEnv } from "./env";

/**
 * Supabase client for Server Components, Server Actions and Route Handlers.
 *
 * Cookies are read from the request and written back through the same store.
 * A Server Component cannot mutate cookies, so the `catch` branch is expected
 * there: `src/proxy.ts` runs first and performs the session refresh, which is
 * why this client normally only ever reads.
 */
export async function createClient() {
  const { url, publishableKey } = getSupabaseEnv();
  const cookieStore = await cookies();

  return createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options),
          );
        } catch {
          // Read-only cookie store (Server Component). Session refresh is owned
          // by the proxy, which has a writable response.
        }
      },
    },
  });
}