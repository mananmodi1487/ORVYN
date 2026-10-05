/**
 * Gate for server code that must only run for a signed-in user.
 *
 * `readSession` answers "is there a session"; this answers "may this request
 * proceed", and returns the user either way so a caller does not have to read the
 * session twice.
 *
 * Anonymous users are refused rather than served anonymously. Chat calls a real
 * provider and costs real tokens, and ORVYN's usage accounting can only be
 * authoritative if every generation is attributable to an account.
 */
import { readSession, type AuthenticatedUser, type SessionState } from "./session";

export type AuthCheck =
  | { readonly allowed: true; readonly user: AuthenticatedUser; readonly session: SessionState }
  | { readonly allowed: false; readonly session: SessionState };

/** Reads the session and decides whether the request may proceed. */
export async function requireUser(): Promise<AuthCheck> {
  const session: SessionState = await readSession();
  if (session.status !== "authenticated") {
    return { allowed: false, session };
  }
  return { allowed: true, user: session.user, session };
}

/**
 * The unauthenticated response.
 *
 * 401 rather than 403: the request was not identified at all, which is distinct
 * from being identified and refused. `no-store` because the answer depends on the
 * caller's cookies and must never be cached for anyone else.
 */
export function unauthorizedResponse(): Response {
  return Response.json(
    { error: { code: "UNAUTHORIZED", message: "Sign in to use ORVYN." } },
    {
      status: 401,
      headers: { "Cache-Control": "no-store, no-transform" },
    },
  );
}