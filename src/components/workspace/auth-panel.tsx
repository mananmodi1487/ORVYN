"use client";

import { useActionState, useState } from "react";
import { Button } from "@/components/ui";
import { signIn, signUp, type SignInState, type SignUpState } from "@/lib/auth/actions";
import { authFailureMessage, type AuthFailure } from "@/lib/auth/auth-error";
import { MIN_PASSWORD_CHARS } from "@/lib/auth/credentials";
import { brand } from "@/config/workspace";
import { cn } from "@/lib/utils";
import { BrandMark } from "./icons";

/**
 * Sign in / create account.
 *
 * Two forms on one screen rather than two routes: the decision between them is
 * small and reversible, so a user who chose wrong sees the alternative
 * immediately instead of navigating to find it.
 *
 * A client component because `useActionState` reports the pending state and the
 * returned failure. The actions themselves are Server Actions, so credentials go
 * to ORVYN's own origin and Supabase is only ever called from the server.
 */
export function AuthPanel() {
  const [mode, setMode] = useState<"signin" | "signup">("signin");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-10 px-5 py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <BrandMark className="size-7 text-ink-subtle" />
        <h1 className="text-[26px] leading-tight font-medium tracking-[-0.02em] text-ink">
          {brand.name}
        </h1>
        <p className="text-[15px] leading-relaxed text-ink-muted">{brand.tagline}</p>
      </div>

      <div className="w-full max-w-sm">
        {mode === "signin" ? (
          <SignInForm onSwitch={() => setMode("signup")} />
        ) : (
          <SignUpForm onSwitch={() => setMode("signin")} />
        )}
      </div>

      <p className="max-w-sm text-center text-xs leading-relaxed text-ink-subtle">
        ORVYN is free. An account exists so your usage is measured against your own
        history — nothing is charged.
      </p>
    </main>
  );
}

function SignInForm({ onSwitch }: { readonly onSwitch: () => void }) {
  // Both actions share a shape — `(state, formData) => state` — which is what lets
  // one hook type serve both branches. The union is resolved here rather than
  // asserted, so a change to either action's state shape surfaces here.
  const [state, action, pending] = useActionState<SignInState, FormData>(signIn, null);
  const failure = state?.failure ?? null;

  return (
    <AuthForm
      title="Sign in"
      action={action}
      pending={pending}
      failure={failure}
      confirmations={[]}
    >
      <Field
        id="signin-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
      />
      <Field
        id="signin-password"
        name="password"
        type="password"
        label="Password"
        autoComplete="current-password"
        required
      />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? "Signing in…" : "Sign in"}
      </Button>
      <SwitchPrompt onSwitch={onSwitch} lead="No account?" action="Create one" />
    </AuthForm>
  );
}

function SignUpForm({ onSwitch }: { readonly onSwitch: () => void }) {
  const [state, action, pending] = useActionState<SignUpState, FormData>(signUp, null);
  const failure = state?.failure ?? null;
  // Confirmation pending is a success state, not an error: the account exists and
  // the only thing left is the user's inbox. Rendering it in the alert slot would
  // tell them something went wrong.
  const awaitingConfirmation = failure === "confirmation_required";

  return (
    <AuthForm
      title="Create account"
      action={action}
      pending={pending}
      failure={awaitingConfirmation ? null : failure}
      confirmations={
        awaitingConfirmation
          ? ["Account created. Check your email to confirm it, then sign in."]
          : []
      }
    >
      <Field
        id="signup-email"
        name="email"
        type="email"
        label="Email"
        autoComplete="email"
        required
      />
      <Field
        id="signup-password"
        name="password"
        type="password"
        label="Password"
        autoComplete="new-password"
        minLength={MIN_PASSWORD_CHARS}
        required
        hint={`At least ${MIN_PASSWORD_CHARS} characters.`}
      />
      <Field
        id="signup-password-confirmation"
        name="passwordConfirmation"
        type="password"
        label="Confirm password"
        autoComplete="new-password"
        required
      />
      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={pending}>
        {pending ? "Creating account…" : "Create account"}
      </Button>
      <SwitchPrompt
        onSwitch={onSwitch}
        lead="Already have an account?"
        action="Sign in"
      />
    </AuthForm>
  );
}

/**
 * The shared shell: a bordered panel, the failure message, and any confirmations.
 *
 * `role="alert"` on the failure so it is announced when it appears — a message
 * that only changes colour is invisible to a screen reader.
 */
function AuthForm({
  title,
  action,
  pending,
  failure,
  confirmations,
  children,
}: {
  readonly title: string;
  readonly action: (formData: FormData) => void;
  readonly pending: boolean;
  readonly failure: AuthFailure | null;
  readonly confirmations: readonly string[];
  readonly children: React.ReactNode;
}) {
  return (
    <form action={action} className="flex flex-col gap-5">
      <div className="rounded-xl border border-line bg-surface p-6">
        <h2 className="mb-5 text-[15px] font-medium text-ink">{title}</h2>

        {/* Disabled while submitting so a double submit cannot create two
            accounts or send two sign-in attempts. */}
        <fieldset disabled={pending} className="flex flex-col gap-4">
          <legend className="sr-only">{title}</legend>
          {children}
        </fieldset>
      </div>

      {failure === null ? null : (
        <p
          role="alert"
          className="rounded-lg border border-danger/40 bg-danger/8 px-3.5 py-2.5 text-[13px] text-danger"
        >
          {authFailureMessage(failure)}
        </p>
      )}

      {confirmations.map((message) => (
        <p
          key={message}
          role="status"
          className="rounded-lg border border-line bg-surface px-3.5 py-2.5 text-[13px] text-ink-muted"
        >
          {message}
        </p>
      ))}
    </form>
  );
}

function Field({
  id,
  name,
  type,
  label,
  hint,
  ...rest
}: {
  readonly id: string;
  readonly name: string;
  readonly type: "email" | "password";
  readonly label: string;
  readonly hint?: string | undefined;
} & Omit<React.ComponentPropsWithRef<"input">, "id" | "name" | "type" | "aria-label">) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] text-ink-muted">
        {label}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        aria-describedby={hint === undefined ? undefined : `${id}-hint`}
        className={cn(
          "h-10 w-full rounded-md border border-line bg-surface-inset px-3 text-sm text-ink",
          "transition-colors duration-150 placeholder:text-ink-subtle",
          "focus:border-line-strong focus:outline-none",
        )}
        {...rest}
      />
      {hint === undefined ? null : (
        <p id={`${id}-hint`} className="text-[11px] text-ink-subtle">
          {hint}
        </p>
      )}
    </div>
  );
}

/**
 * A sentence whose final clause is the button.
 *
 * The clickable target is exactly the action — "Create one" / "Sign in" — rather
 * than the whole line. Underlining only the clickable half makes it unambiguous
 * what the control is, which matters more here than a larger hit area.
 */
function SwitchPrompt({
  onSwitch,
  lead,
  action: label,
}: {
  readonly onSwitch: () => void;
  readonly lead: string;
  readonly action: string;
}) {
  return (
    <p className="pt-1 text-center text-[13px] text-ink-subtle">
      {lead}{" "}
      <button
        type="button"
        onClick={onSwitch}
        className="text-ink underline underline-offset-4"
      >
        {label}
      </button>
    </p>
  );
}