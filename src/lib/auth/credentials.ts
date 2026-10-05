/**
 * Email / password validation.
 *
 * Rules live here rather than in the route handler or the form so the client can
 * reject a bad address before a round trip and the server can reject it again
 * without trusting that first check. Both sides must accept the same values, or
 * a form that "passed" validation will fail on submit.
 *
 * Supabase is the authority on whether an address is deliverable and on its own
 * password rules. These checks only catch input that cannot possibly be valid, so
 * they never substitute for that.
 */
import { invalidRequest } from "@/lib/ai/errors";

/**
 * Bounds chosen from what Supabase itself accepts, not from preference. Its
 * documented limit is 256 characters for an address; anything longer is either a
 * typo or an attempt to make the field an arbitrary payload.
 */
export const MAX_EMAIL_CHARS = 254;

/**
 * Upper bound on password length, to keep the cost of hashing a submitted
 * password bounded regardless of what a caller sends.
 */
export const MAX_PASSWORD_CHARS = 128;

/**
 * Minimum password length.
 *
 * Eight is the floor, not a recommendation. Length is what actually resists
 * guessing, so this deliberately does not encode a false sense of strength.
 */
export const MIN_PASSWORD_CHARS = 8;

/**
 * Deliberately not enforced: composition rules (one uppercase, one symbol, and so
 * on). They push people toward predictable substitutions like `Password1!` while
 * doing nothing against a targeted attack, so ORVYN does not impose them.
 */

export type EmailValidation =
  | { readonly ok: true; readonly email: string }
  | { readonly ok: false; readonly message: string };

export type PasswordValidation =
  | { readonly ok: true }
  | { readonly ok: false; readonly message: string };

/**
 * Normalizes and checks an email address.
 *
 * Returns the normalized value on success so callers store exactly what was
 * validated rather than re-trimming and risking a different string reaching
 * Supabase.
 *
 * The pattern is intentionally loose — a local part, an `@`, and a dotted domain —
 * because a stricter regex rejects valid addresses. Supabase decides whether an
 * address is real; ORVYN only rejects shapes that cannot work.
 */
export function validateEmail(raw: unknown): EmailValidation {
  if (typeof raw !== "string") return { ok: false, message: "Enter your email address." };

  const email = raw.trim().toLowerCase();
  if (email.length === 0) return { ok: false, message: "Enter your email address." };
  if (email.length > MAX_EMAIL_CHARS) {
    return { ok: false, message: `Email must be at most ${MAX_EMAIL_CHARS} characters.` };
  }

  // A space anywhere is a copy-paste artefact, and Supabase would reject it later
  // with a far less specific message.
  if (/\s/.test(email)) {
    return { ok: false, message: "Email must not contain spaces." };
  }

  const at = email.lastIndexOf("@");
  // `lastIndexOf` rather than `indexOf`: a quoted local part may legally contain
  // an `@`, so the last one is the separator.
  if (at <= 0 || at === email.length - 1) {
    return { ok: false, message: "Enter a valid email address." };
  }

  const domain = email.slice(at + 1);
  if (!domain.includes(".")) return { ok: false, message: "Enter a valid email address." };

  // Each label must start and end with an alphanumeric. Without this,
  // `user@-example.com` and `user@exa_mple.com` both pass: a DNS label cannot
  // begin or end with a hyphen, and an underscore is not valid in a host name.
  const labels = domain.split(".");
  for (const label of labels) {
    if (label.length === 0) return { ok: false, message: "Enter a valid email address." };
    if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(label)) {
      return { ok: false, message: "Enter a valid email address." };
    }
  }

  // The TLD must be letters. Anything else here is a typo or an attempt to smuggle
  // a path or a port through the field.
  const tld = labels[labels.length - 1];
  if (tld === undefined || !/^[a-z]{2,}$/.test(tld)) {
    return { ok: false, message: "Enter a valid email address." };
  }

  return { ok: true, email };
}

/** Checks a password's length without judging its strength. */
export function validatePassword(raw: unknown): PasswordValidation {
  if (typeof raw !== "string") return { ok: false, message: "Enter your password." };
  if (raw.length === 0) return { ok: false, message: "Enter your password." };
  if (raw.length < MIN_PASSWORD_CHARS) {
    return {
      ok: false,
      message: `Password must be at least ${MIN_PASSWORD_CHARS} characters.`,
    };
  }
  if (raw.length > MAX_PASSWORD_CHARS) {
    return {
      ok: false,
      message: `Password must be at most ${MAX_PASSWORD_CHARS} characters.`,
    };
  }
  return { ok: true };
}

/** Confirms the two password fields match, for the sign-up form only. */
export function validatePasswordConfirmation(
  password: unknown,
  confirmation: unknown,
): PasswordValidation {
  const check = validatePassword(password);
  if (!check.ok) return check;
  if (typeof confirmation !== "string" || confirmation !== password) {
    return { ok: false, message: "Passwords do not match." };
  }
  return { ok: true };
}

/**
 * Throws `AiProviderError` with code `INVALID_REQUEST` for invalid credentials.
 *
 * Reused by the route handler so an auth failure reaches the client in the same
 * shape as every other request error, rather than as an untyped exception.
 */
export function assertValidCredentials(email: string, password: string): void {
  const checked = validateEmail(email);
  if (!checked.ok) throw invalidRequest(checked.message);

  const strong = validatePassword(password);
  if (!strong.ok) throw invalidRequest(strong.message);
}