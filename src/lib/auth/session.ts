/**
 * The signed-in user, as the server knows them.
 *
 * Reads through `@/utils/supabase/server`, so the session comes from the
 * request's own cookies. The identity is established from the session
 * JWT's claims: `getClaims()` verifies the token's signature against the
 * project's JWKS (fetched once per process and cached), so the `sub` it
 * returns is cryptographically verified rather than merely asserted by a
 * cookie. `getSession` would only read whatever the cookie claims, and
 * `getUser()` would validate the same token against GoTrue on every call
 * — a network round trip that establishes no property the signature
 * check does not already establish.
 */

/** A session user, reduced to the fields ORVYN actually displays. */
export type AuthenticatedUser = {
  readonly id: string;
  readonly email: string;
};

export type SessionState =
  | { readonly status: "unauthenticated" }
  | { readonly status: "authenticated"; readonly user: AuthenticatedUser };

export const NO_SESSION: SessionState = { status: "unauthenticated" };

/**
 * Reads the current session, or reports none.
 *
 * Never throws: "no session" and "Supabase is not configured" both mean the
 * user is not signed in, and the caller renders the same thing either way. A
 * sign-in form behind an unconfigured project is more useful than an error page.
 */
export async function readSession(): Promise<SessionState> {
  const { isSupabaseConfigured } = await import("@/utils/supabase/env");
  if (!isSupabaseConfigured()) return NO_SESSION;

  const { createClient } = await import("@/utils/supabase/server");

  let claims: { readonly sub: string; readonly email?: string } | null = null;
  try {
    const client = await createClient();
    const { data, error } = await client.auth.getClaims();
    // `getClaims` answers `{ data: null, error: null }` when there is no
    // session, so both failure shapes collapse to "no claims".
    claims = error === null ? (data?.claims ?? null) : null;
  } catch {
    // Cookies are unavailable in some contexts, which is indistinguishable from
    // having no session as far as the caller is concerned.
    return NO_SESSION;
  }

  const id = claims?.sub;
  if (id === undefined || id === null) return NO_SESSION;

  // Supabase allows a user with no address (an OAuth-only identity, or one created
  // by an admin). The UI must not render "undefined" for an account state, so the
  // id stands in and is labelled as such at the point of display.
  const email = claims?.email;
  return {
    status: "authenticated",
    user: { id, email: email === undefined || email === "" ? NO_EMAIL_LABEL : email },
  };
}

/**
 * What the shell shows when an account has no address.
 *
 * Phrased as a state rather than a dash, because "no email on file" is a
 * real account condition and should read as one.
 */
const NO_EMAIL_LABEL = "Signed in";

/**
 * A short label for the account button: the local part when there is an address,
 * the whole address when there is not.
 *
 * Truncation happens in CSS, not here — a shortened email in the DOM would be
 * copied on paste and could read as a different account.
 */
export function accountLabel(user: AuthenticatedUser): string {
  const local = user.email.split("@")[0];
  return local !== undefined && local !== "" ? local : "Signed in";
}