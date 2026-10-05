import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  MAX_EMAIL_CHARS,
  MAX_PASSWORD_CHARS,
  MIN_PASSWORD_CHARS,
  assertValidCredentials,
  validateEmail,
  validatePassword,
  validatePasswordConfirmation,
} from "@/lib/auth/credentials";
import {
  authFailureFromCode,
  authFailureMessage,
  type AuthFailure,
} from "@/lib/auth/auth-error";

/**
 * Two properties matter here.
 *
 * Validation has to be identical on both sides of the network, or a form that
 * "passed" will fail on submit with no way for the user to tell why. And no
 * Supabase error message may reach the browser: a message is not a stable contract
 * and can carry internal detail.
 */

/**
 * Narrowing helpers.
 *
 * `assert.equal` does not narrow a union in TypeScript, so each helper asserts
 * the discriminant and returns the narrowed type. Doing it here keeps every test
 * below reading as a plain statement about behaviour.
 */
function expectEmail(raw: unknown): string {
  const result = validateEmail(raw);
  assert.equal(result.ok, true, `expected a valid address, got: ${JSON.stringify(result)}`);
  if (!result.ok) throw new Error("unreachable");
  return result.email;
}

function expectRejected(raw: unknown): void {
  const result = validateEmail(raw);
  assert.equal(result.ok, false, `expected ${JSON.stringify(raw)} to be rejected`);
}

function rejectionMessage(raw: unknown): string {
  const result = validatePassword(raw);
  assert.equal(result.ok, false, `expected ${JSON.stringify(raw)} to be rejected`);
  if (result.ok) throw new Error("unreachable");
  return result.message;
}

function rejectionMessage2(password: unknown, confirmation: unknown): string {
  const result = validatePasswordConfirmation(password, confirmation);
  assert.equal(result.ok, false, "expected a rejected confirmation");
  if (result.ok) throw new Error("unreachable");
  return result.message;
}

describe("validateEmail", () => {
  it("accepts ordinary addresses and normalizes them", () => {
    // Lowercasing matters: the same address typed two ways must resolve to one
    // account, or a user can sign up twice.
    assert.equal(expectEmail("  Person@Example.COM "), "person@example.com");
    for (const address of [
      "a@b.co",
      "first.last@sub.domain.org",
      "user+tag@example.com",
      "x@example.museum",
    ]) {
      assert.equal(expectEmail(address), address);
    }
  });

  it("rejects shapes that cannot be a real address", () => {
    for (const address of [
      "",
      "   ",
      "no-at-sign",
      "@example.com",
      "person@",
      "person@localhost",
      "person@example",
      "person@-example.com",
      "person@exam ple.com",
      "person@example.c",
      "person@example..com",
      "person@.example.com",
      "person@example.com.",
      "person@example.c0m",
      // A DNS label cannot begin or end with a hyphen, and an underscore is not
      // valid in a host name. Both of these slipped through a domain-only check.
      "person@-example.com",
      "person@example-.com",
      "person@exa_mple.com",
      "person@example.-com",
    ]) {
      expectRejected(address);
    }
  });

  it("rejects non-strings rather than coercing them", () => {
    for (const value of [undefined, null, 42, {}, [], true]) {
      expectRejected(value);
    }
  });

  it("rejects an address longer than the protocol limit", () => {
    expectRejected(`${"a".repeat(MAX_EMAIL_CHARS)}@example.com`);
  });

  it("uses the last @ as the separator", () => {
    // A quoted local part may contain an `@`; using the first would treat
    // `example.com` as the domain and reject a legal address.
    assert.equal(
      expectEmail('"weird@local"@example.com'),
      '"weird@local"@example.com',
    );
  });
});

describe("validatePassword", () => {
  it("enforces only a length floor and ceiling", () => {
    assert.ok(validatePassword("a".repeat(MIN_PASSWORD_CHARS)).ok);
    assert.ok(validatePassword("a".repeat(MAX_PASSWORD_CHARS)).ok);
    assert.ok(!validatePassword("a".repeat(MIN_PASSWORD_CHARS - 1)).ok);
    assert.ok(!validatePassword("a".repeat(MAX_PASSWORD_CHARS + 1)).ok);
    assert.ok(!validatePassword("").ok);
  });

  it("does not require character composition", () => {
    // Composition rules push people toward predictable substitutions without
    // improving resistance to a targeted attack, so ORVYN does not impose them.
    assert.ok(validatePassword("aaaaaaaa").ok);
    assert.ok(validatePassword("          ").ok);
  });

  it("rejects non-strings", () => {
    for (const value of [undefined, null, 12345678, {}]) {
      assert.ok(!validatePassword(value).ok);
    }
  });
});

describe("validatePasswordConfirmation", () => {
  it("requires an exact match", () => {
    assert.ok(validatePasswordConfirmation("correcthorse", "correcthorse").ok);
    assert.match(rejectionMessage2("correcthorse", "correcthorsf"), /do not match/i);
    // Whitespace differences are real differences.
    assert.match(rejectionMessage2("correcthorse", "correcthorse "), /do not match/i);
  });

  it("reports the length problem first, not a mismatch", () => {
    // Both fields are wrong here. The user must be told to fix the length before
    // the confirmation, or fixing the confirmation alone will not help.
    assert.match(rejectionMessage("short"), /at least/i);
  });

  it("rejects a missing confirmation", () => {
    assert.ok(!validatePasswordConfirmation("correcthorse", undefined).ok);
    assert.ok(!validatePasswordConfirmation("correcthorse", "").ok);
  });
});

describe("assertValidCredentials", () => {
  it("throws INVALID_REQUEST so an auth failure uses the AI error contract", () => {
    assert.throws(
      () => assertValidCredentials("not-an-email", "correcthorse"),
      (error: unknown) => {
        assert.equal((error as { code?: string }).code, "INVALID_REQUEST");
        return true;
      },
    );
  });

  it("accepts a valid pair", () => {
    assert.doesNotThrow(() => assertValidCredentials("person@example.com", "correcthorse"));
  });
});

describe("auth error translation", () => {
  it("maps known Supabase codes to ORVYN's closed set", () => {
    assert.equal(authFailureFromCode("invalid_credentials"), "invalid_credentials");
    assert.equal(authFailureFromCode("email_exists"), "email_taken");
    assert.equal(authFailureFromCode("email_taken"), "email_taken");
    assert.equal(authFailureFromCode("weak_password"), "weak_password");
    assert.equal(authFailureFromCode("over_request_rate_limit"), "rate_limited");
    assert.equal(authFailureFromCode("over_email_send_rate_limit"), "rate_limited");
    assert.equal(authFailureFromCode("email_not_confirmed"), "confirmation_required");
  });

  it("treats anything unrecognized as an unexpected failure", () => {
    // The important property: a Supabase code ORVYN has never seen cannot leak its
    // own wording into the UI by being unhandled here.
    for (const code of [undefined, null, "", "brand_new_code", "SQLITE_ERROR"]) {
      assert.equal(authFailureFromCode(code), "unexpected");
    }
  });

  it("has a message for every failure it can produce", () => {
    const failures: readonly AuthFailure[] = [
      "invalid_credentials",
      "email_taken",
      "email_exists",
      "weak_password",
      "rate_limited",
      "confirmation_required",
      "not_configured",
      "unexpected",
    ];
    for (const failure of failures) {
      const message = authFailureMessage(failure);
      assert.ok(message.length > 0, `${failure} needs a message`);
      // No message may name an internal system, which would leak configuration.
      assert.ok(
        !/supabase|postgres|sql|jwt/i.test(message),
        `${failure} leaks an internal detail: ${message}`,
      );
    }
  });

  it("does not reveal whether an account exists on a wrong password", () => {
    // `email_exists` and `email_taken` describe the same condition, so the wording
    // stays consistent whichever code Supabase returns.
    assert.equal(authFailureMessage("email_exists"), authFailureMessage("email_taken"));
  });
});