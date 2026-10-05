import { readSession } from "@/lib/auth/session";
import { AuthPanel, WorkspaceShell } from "@/components/workspace";

export const dynamic = "force-dynamic";

/**
 * The workspace, or the sign-in screen.
 *
 * Both are rendered from the server because the session comes from request
 * cookies. Deciding this in a client component instead would briefly render the
 * workspace before redirecting, which both flashes private layout to an
 * anonymous visitor and starts a `fetch("/api/usage")` that is bound to fail.
 *
 * `force-dynamic` is required, not decorative. `readSession` reaches `cookies()`
 * through a dynamic import inside a helper, which static analysis does not follow,
 * so the build would otherwise prerender this page once at build time — bake in
 * the signed-out state, and serve it to everyone. Same rule as `/api/usage`.
 */
export default async function HomePage() {
  const session = await readSession();

  if (session.status !== "authenticated") return <AuthPanel />;

  return <WorkspaceShell user={session.user} />;
}