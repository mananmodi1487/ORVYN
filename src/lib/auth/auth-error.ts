/**
 * Supabase error translation for auth forms.
 *
 * Supabase reports failures in two shapes: a machine-readable `code` and a
 * human-readable `message`. ORVYN's rule is to branch on `code` and never on
 * message text, so every user-visible string here is derived from the code. That
 * keeps the wording stable regardless of what Supabase decides to put in `message`,
 * and it keeps internals out of the UI: an unrecognized code gets a generic
 * failure rather than passing a raw error through to the screen.
 */

/** Every failure an ORVYN auth form can report, as a closed set. */
export type AuthFailure =
  | "invalid_credentials"
  | "email_taken"
  | "email_exists"
  | "weak_password"
  | "rate_limited"
  | "confirmation_required"
  | "not_configured"
  | "unexpected";

/** A form-safe result: never carries a Supabase message across to the browser. */
export type AuthResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly failure: AuthFailure };

const FAILURE_MESSAGES: Readonly<Record<AuthFailure, string>> = {
  invalid_credentials: "That email and password combination is not correct.",
  email_taken: "An account already exists for that email. Sign in instead.",
  email_exists: "An account already exists for that email. Sign in instead.",
  // Deliberately vague about which rule failed. Repeating Supabase's requirement
  // here would let the message drift from the rule that is actually enforced.
  weak_password: "That password does not meet the requirements.",
  rate_limited: "Too many attempts. Wait a moment and try again.",
  confirmation_required: "Check your inbox to confirm your email, then sign in.",
  not_configured: "Authentication is not configured on this deployment.",
  unexpected: "Something went wrong. Try again.",
};

export function authFailureMessage(failure: AuthFailure): string {
  return FAILURE_MESSAGES[failure];
}

/**
 * Maps a Supabase auth error code onto ORVYN's closed set.
 *
 * Anything unrecognized becomes `unexpected`, which is the point: a new Supabase
 * code cannot leak its own wording into the UI by being unhandled.
 */
export function authFailureFromCode(code: string | undefined | null): AuthFailure {
  switch (code) {
    case "invalid_credentials":
      return "invalid_credentials";
    case "email_taken":
    case "email_exists":
      return "email_taken";
    case "weak_password":
      return "weak_password";
    case "over_request_rate_limit":
    case "over_email_send_rate_limit":
      return "rate_limited";
    case "email_not_confirmed":
      return "confirmation_required";
    default:
      return "unexpected";
  }
}