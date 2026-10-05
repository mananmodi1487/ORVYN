import { createServerClient } from "@supabase/ssr";
import { type NextRequest, NextResponse } from "next/server";
import { getSupabaseEnv, isSupabaseConfigured } from "./env";

/**
 * Keeps the Supabase session fresh for every matched request.
 *
 * This is the only layer able to write cookies *and* response headers, which is
 * why the refresh lives here rather than in a Server Component. Supabase passes
 * cache-control headers alongside any cookie write; forwarding them prevents a
 * CDN or reverse proxy from caching a response that carries a session token.
 *
 * There is no authentication, no route protection and no data access here yet.
 * It is wired so that when auth is added, cookie refresh and `no-store` headers
 * are already correct.
 *
 * When Supabase is not configured the request passes straight through instead of
 * throwing, so the app stays usable before `.env.local` exists. Anything that
 * actually needs Supabase calls `getSupabaseEnv()` and fails loudly there.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  if (!isSupabaseConfigured()) {
    return NextResponse.next();
  }

  let response = NextResponse.next({ request });

  const { url, publishableKey } = getSupabaseEnv();

  const supabase = createServerClient(url, publishableKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // Mutate the request jar first so later reads in this pass see the
        // refreshed token, then rebuild the response from it.
        cookiesToSet.forEach(({ name, value }) => {
          request.cookies.set(name, value);
        });

        response = NextResponse.next({ request });

        cookiesToSet.forEach(({ name, value, options }) => {
          response.cookies.set(name, value, options);
        });

        Object.entries(headers).forEach(([name, value]) => {
          response.headers.set(name, value);
        });
      },
    },
  });

  // No-op without a session; performs the refresh path when one exists.
  await supabase.auth.getClaims();

  return response;
}