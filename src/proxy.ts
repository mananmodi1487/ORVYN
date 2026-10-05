import type { NextRequest } from "next/server";
import { updateSession } from "@/utils/supabase/proxy";

/**
 * Next.js 16 renamed `middleware.ts` to `proxy.ts`. The export must be named
 * `proxy` (or exported as default).
 */
export async function proxy(request: NextRequest) {
  return await updateSession(request);
}

export const config = {
  // Run on every navigation, but skip static assets and image optimisation so
  // the proxy stays out of the hot path.
  matcher: [
    "/((?!_next/static|_next/image|favicon\\.ico|icon\\.svg|.*\\.(?:svg|png|jpg|jpeg|gif|webp|avif|ico|woff2?|ttf|css|js|map)$).*)",
  ],
};