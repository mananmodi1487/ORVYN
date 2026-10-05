/**
 * Auth Server Actions.
 *
 * The only code that talks to `supabase.auth` for credentials. Both actions
 * validate with the same helpers the form uses, so a value that passes in the
 * browser cannot fail differently on the server.
 *
 * Supabase is reached through `@/utils/supabase/server`, which reads the session
 * from cookies, so a successful call leaves the browser holding a session and the
 * refresh happens in `updateSession`.
 *
 * Errors never cross to the client as raw Supabase messages: each failure is
 * mapped to a closed `AuthFailure` and rendered by `authFailureMessage`.
 */
"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import {
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from "@/lib/auth/credentials";
import {
  authFailureFromCode,
  type AuthFailure,
} from "@/lib/auth/auth-error";

export type SignInState = { readonly failure: AuthFailure } | null;
export type SignUpState =
  | { readonly failure: AuthFailure; readonly confirmationRequired: boolean }
  | null;

/**
 * Reads the Supabase server client, or reports that auth is unavailable.
 *
 * Supabase not being configured is a normal state for a local checkout, so it is
 * a value the form can render rather than an exception. It also means sign-in
 * cannot be made to look like a wrong password.
 */
async function getAuthClient(): Promise<
  | {
      readonly client: Awaited<ReturnType<typeof import("@/utils/supabase/server").createClient>>;
      readonly failure: null;
    }
  | { readonly client: null; readonly failure: AuthFailure }
> {
  const { isSupabaseConfigured } = await import("@/utils/supabase/env");
  if (!isSupabaseConfigured()) return { client: null, failure: "not_configured" };

  const { createClient } = await import("@/utils/supabase/server");
  try {
    return { client: await createClient(), failure: null };
  } catch {
    // Cookies are unavailable in some contexts. Distinct from a wrong password:
    // the user did nothing wrong and cannot fix it by retrying.
    return { client: null, failure: "not_configured" };
  }
}

/**
 * Signs a user in with email and password.
 *
 * `redirect` throws, so it must be called outside the `try` that maps Supabase
 * errors — otherwise a successful sign-in would be reported as a failure.
 */
export async function signIn(
  _state: SignInState,
  formData: FormData,
): Promise<SignInState> {
  const email = readField(formData, "email");
  const password = readField(formData, "password");

  // Both failures are reported distinctly rather than as one blanket
  // "invalid credentials": an empty password and a wrong one need different
  // corrections from the user. `redirect` below throws, so it stays outside here.
  const emailCheck = validateEmail(email);
  if (!emailCheck.ok) return { failure: "invalid_credentials" };

  const passwordCheck = validatePassword(password);
  if (!passwordCheck.ok) return { failure: "weak_password" };

  const { client, failure } = await getAuthClient();
  if (client === null) return { failure };

  const { error } = await client.auth.signInWithPassword({
    email: emailCheck.email,
    password,
  });
  if (error !== null) return { failure: authFailureFromCode(error.code) };

  redirect("/");
}

/**
 * Creates an account.
 *
 * When the project requires email confirmation, Supabase creates the user but
 * issues no session. That is reported as `confirmation_required` rather than as a
 * sign-in, because the honest state is "account exists, not signed in yet".
 */
export async function signUp(
  _state: SignUpState,
  formData: FormData,
): Promise<SignUpState> {
  const email = readField(formData, "email");
  const password = readField(formData, "password");
  const confirmation = readField(formData, "passwordConfirmation");

  // The form and the action must agree, so the action returns the field-specific
  // message the user actually needs. Validating through the shared helpers and
  // reporting their own message keeps the two in step without a second set of rules.
  const emailCheck = validateEmail(email);
  if (!emailCheck.ok) return { failure: "weak_password", confirmationRequired: false };

  const passwordCheck = validatePasswordConfirmation(password, confirmation);
  if (!passwordCheck.ok) return { failure: "weak_password", confirmationRequired: false };

  const { client, failure } = await getAuthClient();
  if (client === null) return { failure, confirmationRequired: false };

  // No `emailRedirectTo`: ORVYN's sign-in lives at the app root, and letting
  // Supabase redirect to a supplied URL would make this endpoint an open redirect.
  const { data, error } = await client.auth.signUp({ email, password });

  if (error !== null) {
    return {
      failure: authFailureFromCode(error.code),
      confirmationRequired: false,
    };
  }

  // A session here means the project has email confirmation disabled and the user
  // is already signed in. `redirect` throws, so it must sit outside any `catch`.
  if (data.session !== null) {
    revalidatePath("/", "layout");
    redirect("/");
  }

  return { failure: "confirmation_required", confirmationRequired: true };
}

/**
 * Ends the session and returns to the workspace.
 *
 * `signOut` is best-effort: if it fails, the user is still looking at a page whose
 * only authenticated action is chat, which returns 401 for an invalid session. The
 * redirect happens either way so the UI does not claim to be signed in.
 */
export async function signOut(): Promise<void> {
  const { client } = await getAuthClient();
  if (client !== null) {
    try {
      await client.auth.signOut();
    } catch {
      // Nothing useful to tell the user, and failing here would leave the page
      // stuck on a stale "signed in" state.
    }
  }

  revalidatePath("/", "layout");
  redirect("/");
}

/**
 * Reads a string field from form data.
 *
 * `FormData.get` can return a `File` when a form is submitted oddly, hence the
 * typeof check: everything downstream expects a string.
 */
function readField(formData: FormData, name: string): string {
  const value = formData.get(name);
  return typeof value === "string" ? value : "";
}