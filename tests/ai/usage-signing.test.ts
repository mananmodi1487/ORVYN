import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";

import { parseChatRequest } from "@/lib/ai/chat-request";
import {
  USAGE_PAYLOAD_VERSION,
  USAGE_SIGNING_SECRET_VAR,
  newUsageNonce,
  resolveUsageSigningSecret,
  signUsagePayload,
  usageSigningPayload,
} from "@/lib/ai/usage-signing";
import { recordUsage } from "@/lib/ai/usage-store";

/**
 * Usage rows must be unforgeable.
 *
 * The threat these tests exist to close: a signed-in user holds the same Supabase
 * session the server does, so any database policy a client can satisfy is a
 * policy the client can satisfy *itself*. The fix is an HMAC the client has no
 * key for. These tests pin the properties that make that work — the signature
 * covers every field, the request body cannot influence what is signed, and the
 * migration really does remove the write grants.
 */

const SECRET = "a".repeat(64);

const signingInput = {
  userId: "11111111-1111-4111-8111-111111111111",
  provider: "omniroute",
  modelId: "free-large",
  inputTokens: 1204,
  outputTokens: 88,
  nonce: "22222222-2222-4222-8222-222222222222",
};

describe("usage signing", () => {
  it("produces a stable digest for identical input", () => {
    const first = signUsagePayload(SECRET, usageSigningPayload(signingInput));
    const second = signUsagePayload(SECRET, usageSigningPayload(signingInput));
    assert.equal(first, second);
    assert.match(first, /^[0-9a-f]{64}$/, "must be lowercase hex sha256");
  });

  it("matches an independently computed HMAC of the canonical payload", () => {
    // Recomputed the way Postgres does it, so a divergence between the TS
    // implementation and `private.ai_usage_canonical_payload` is a test failure
    // rather than a silent rejection of every legitimate write.
    const expected = createHmac("sha256", SECRET)
      .update(
        [
          USAGE_PAYLOAD_VERSION,
          signingInput.userId,
          signingInput.provider,
          signingInput.modelId,
          "1204",
          "88",
          signingInput.nonce,
        ].join("\n"),
        "utf8",
      )
      .digest("hex");

    assert.equal(signUsagePayload(SECRET, usageSigningPayload(signingInput)), expected);
  });

  it("changes when any single field changes", () => {
    const base = signUsagePayload(SECRET, usageSigningPayload(signingInput));

    const mutations = [
      { ...signingInput, userId: "33333333-3333-4333-8333-333333333333" },
      { ...signingInput, provider: "freellmapi" },
      { ...signingInput, modelId: "free-small" },
      { ...signingInput, inputTokens: 1205 },
      { ...signingInput, outputTokens: 89 },
      { ...signingInput, inputTokens: 99_999_999 },
      { ...signingInput, nonce: newUsageNonce() },
    ];

    for (const mutated of mutations) {
      assert.notEqual(
        signUsagePayload(SECRET, usageSigningPayload(mutated)),
        base,
        `signature must not survive changing ${JSON.stringify(
          Object.keys(signingInput).filter((key) => signingInput[key as keyof typeof signingInput] !== mutated[key as keyof typeof mutated]),
        )}`,
      );
    }
  });

  it("rejects a payload whose field boundaries were forged with a line break", () => {
    // The canonical form is newline-delimited. Without this guard, a model id of
    // "x\nomniroute" could be arranged to reproduce the digest of a different
    // field split.
    assert.throws(
      () => usageSigningPayload({ ...signingInput, modelId: "free-large\n0" }),
      /line break/,
    );
    assert.throws(() => usageSigningPayload({ ...signingInput, provider: "a\rb" }), /line break/);
    assert.throws(() => usageSigningPayload({ ...signingInput, nonce: "abc\ndef" }), /line break/);
  });

  it("encodes an unreported half as the literal 'null', never as 0", () => {
    const payload = usageSigningPayload({ ...signingInput, inputTokens: null });
    assert.ok(payload.includes("\nnull\n"), `unexpected payload: ${payload}`);
    assert.ok(!payload.includes("\n0\n"), "a missing count must never look like zero");
  });

  it("distinguishes null from zero in the digest", () => {
    const missing = usageSigningPayload({ ...signingInput, outputTokens: null });
    const zero = usageSigningPayload({ ...signingInput, outputTokens: 0 });
    assert.notEqual(signUsagePayload(SECRET, missing), signUsagePayload(SECRET, zero));
  });
});

describe("signing secret resolution", () => {
  const env = (record: Record<string, string | undefined>) => record as NodeJS.ProcessEnv;

  it("treats an absent or blank secret as unconfigured", () => {
    // Failing closed is the point: no secret means no signed write, so the row
    // is simply not recorded and the UI says "usage unavailable".
    assert.equal(resolveUsageSigningSecret(env({})), null);
    assert.equal(resolveUsageSigningSecret(env({ ORVYN_USAGE_SIGNING_SECRET: "" })), null);
    assert.equal(resolveUsageSigningSecret(env({ ORVYN_USAGE_SIGNING_SECRET: "   " })), null);
  });

  it("reads a configured secret", () => {
    assert.equal(resolveUsageSigningSecret(env({ ORVYN_USAGE_SIGNING_SECRET: SECRET })), SECRET);
  });
});

describe("the client cannot choose what gets recorded", () => {
  it("ignores token counts in the request body", () => {
    // A caller may send anything. What matters is that none of it survives
    // validation into a `ChatRequest`, because that request is the only thing the
    // server acts on.
    const parsed = parseChatRequest({
      turns: [{ id: "1", role: "user", text: "hi" }],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      inputTokens: 999_999_999,
      outputTokens: 999_999_999,
      provider: "freellmapi",
      modelId: "attacker-model",
    });

    assert.deepEqual(Object.keys(parsed).sort(), [
      "messages",
      "requireStreaming",
    ]);
    const serialized = JSON.stringify(parsed);
    assert.ok(!serialized.includes("999999999"), "no client value may reach the gateway request");
  });

  it("cannot name the model it wants billed", () => {
    // `pinnedModel` is the one routing field a client legitimately controls, and
    // it is constrained to declared, free, streamable models. Nothing else from
    // the body survives.
    const parsed = parseChatRequest({
      turns: [{ id: "1", role: "user", text: "hi" }],
      pinnedModel: { provider: "omniroute", modelId: "declared-model" },
    });
    assert.deepEqual(parsed.pinnedModel, {
      provider: "omniroute",
      modelId: "declared-model",
    });
  });
});

describe("migration removes every client write path", () => {
  const sql = readFileSync(
    new URL("../../supabase/migrations/20260101000001_ai_usage_server_authoritative.sql", import.meta.url),
    "utf8",
  );

  it("revokes insert, update and delete from anon and authenticated", () => {
    assert.match(
      sql,
      /revoke insert, update, delete on table public\.ai_usage from anon, authenticated;/,
    );
  });

  it("drops the insert-own policy that permitted self-reported counts", () => {
    // This policy was the actual hole: `user_id = auth.uid()` proves ownership
    // but says nothing about the numbers.
    assert.match(sql, /drop policy if exists "ai_usage_insert_own" on public\.ai_usage;/);
  });

  it("creates no replacement insert policy", () => {
    const insertPolicies = sql.match(/create policy[^;]*for insert[^;]*;/gi) ?? [];
    assert.deepEqual(insertPolicies, [], "no policy may re-open writes for clients");
  });

  it("keeps the signing secret and the helpers out of the public schema", () => {
    assert.match(sql, /create schema if not exists private;/);
    assert.match(sql, /revoke all on private\.ai_usage_signing_secret from public, anon, authenticated;/);
    assert.match(sql, /revoke all on function private\.set_usage_signing_secret\(text\) from public, anon, authenticated;/);
    // The only thing that may be reachable is the one guarded function. If a
    // helper lived in `public` it would become a callable object in its own right.
    for (const helper of [
      "private.ai_usage_canonical_payload",
      "private.constant_time_equals",
    ]) {
      assert.match(
        sql,
        // `\s` rather than `[^)]*`: a long signature wraps across lines, and the
        // revocation has to be found wherever it was formatted.
        new RegExp(
          `revoke all on function ${helper.replace(".", "\\.")}\\([\\s\\S]*?\\)\\s+from public, anon, authenticated;`,
        ),
        `${helper} must not be reachable`,
      );
    }
  });

  it("exposes exactly one write surface, and only to authenticated", () => {
    // The record function has to be in `public` for PostgREST to route the RPC,
    // but it must be granted once, to `authenticated`, and never to `anon`.
    assert.match(sql, /create or replace function public\.ai_usage_record\(/);
    const grants = sql.match(/grant execute on function public\.ai_usage_record[^;]*;/gi) ?? [];
    assert.equal(grants.length, 1, "the record function is granted exactly once");
    assert.ok(!/to anon/i.test(grants[0] ?? ""), "anon must never reach the write path");

    // And no other function anywhere may write to the table.
    const writers = sql.match(/insert into public\.ai_usage/gi) ?? [];
    assert.equal(writers.length, 1, "exactly one statement may insert usage rows");
  });

  it("takes the row identity from the session, never from a parameter", () => {
    // The signature covers a user id, but the inserted value must come from
    // `auth.uid()`: otherwise a valid signature for user A becomes a way to write
    // rows attributed to someone else.
    const body = sql.slice(sql.indexOf("create or replace function public.ai_usage_record"));
    assert.match(body, /v_user_id uuid := auth\.uid\(\);/);
    assert.match(body, /values \(\s*v_user_id,/);
    assert.ok(
      !/p_user_id/.test(body),
      "the record function must not accept a user id parameter",
    );
  });

  it("verifies the signature before inserting", () => {
    const body = sql.slice(sql.indexOf("create or replace function public.ai_usage_record"));
    const verifyAt = body.indexOf("private.constant_time_equals(p_signature, v_expected)");
    const insertAt = body.indexOf("insert into public.ai_usage");
    assert.ok(verifyAt > -1, "the signature must be checked");
    assert.ok(insertAt > verifyAt, "the insert must come after the check, never before");
  });

  it("pins search_path on the definer function", () => {
    // SECURITY DEFINER without a pinned search_path would let a caller who can
    // create objects in a schema on the path substitute their own `hmac`.
    const body = sql.slice(sql.indexOf("create or replace function public.ai_usage_record"));
    assert.match(body, /set search_path = public, extensions/);
  });

  it("rejects counts that are negative or entirely absent", () => {
    const body = sql.slice(sql.indexOf("create or replace function public.ai_usage_record"));
    assert.match(body, /requires at least one reported token count/);
    assert.match(body, /must not be negative/);
  });

  it("makes a replayed identical write a no-op", () => {
    assert.match(sql, /create unique index if not exists ai_usage_request_nonce_idx/);
    assert.match(sql, /on conflict \(request_nonce\) do nothing/);
  });
});

describe("the write store refuses to record anything it cannot sign", () => {
  const store = readFileSync(
    new URL("../../src/lib/ai/usage-store.ts", import.meta.url),
    "utf8",
  );

  it("records nothing when no signing secret is configured", async () => {
    // The important property is the early return: without a key there is no
    // signature, so there is no legitimate write. It must not fall back to one
    // the database would have to accept.
    const previous = process.env[USAGE_SIGNING_SECRET_VAR];
    delete process.env[USAGE_SIGNING_SECRET_VAR];
    try {
      assert.equal(
        await recordUsage({
          provider: "omniroute",
          modelId: "free-large",
          inputTokens: 1204,
          outputTokens: 88,
        }),
        false,
      );
    } finally {
      if (previous === undefined) delete process.env[USAGE_SIGNING_SECRET_VAR];
      else process.env[USAGE_SIGNING_SECRET_VAR] = previous;
    }
  });

  it("never writes to the table directly", () => {
    // A direct insert would be subject to RLS as the caller, which is the whole
    // hole being closed. The only statement that writes is the RPC.
    assert.ok(
      !/\.from\(\s*["']ai_usage["']\s*\)\s*\.\s*insert/.test(store),
      "usage must not be inserted through the client",
    );
    assert.match(store, /client\.rpc\(RECORD_FUNCTION/);
  });

  it("takes the user id from the session and never from the record", () => {
    // `UsageRecord` carries no identity, so there is nothing for a caller to
    // supply even accidentally.
    const usage = readFileSync(new URL("../../src/lib/ai/usage.ts", import.meta.url), "utf8");
    const start = usage.indexOf("export interface UsageRecord");
    const body = usage.slice(start, usage.indexOf("}", start));
    assert.ok(!/user_id|userId/.test(body), "UsageRecord must not accept an identity");
    assert.match(store, /usageSigningPayload\(\{\s*userId: data\.user\.id/);
  });

  it("signs over the same values it sends", () => {
    // If the signed payload and the RPC arguments could disagree, a caller could
    // send one row while proving another.
    const signed = store.slice(store.indexOf("const payload = usageSigningPayload("));
    const body = signed.slice(0, signed.indexOf("const { error: rpcError }"));
    for (const value of [
      "provider: record.provider",
      "modelId: record.modelId",
      "inputTokens: record.inputTokens",
      "outputTokens: record.outputTokens",
      "nonce",
    ]) {
      assert.ok(body.includes(value), `signed payload must include ${value}`);
    }
    assert.match(store, /p_signature: signUsagePayload\(secret, payload\)/);
  });
});