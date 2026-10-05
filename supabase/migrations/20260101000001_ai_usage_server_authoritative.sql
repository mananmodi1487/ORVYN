-- ORVYN token usage accounting: server-authoritative writes.
--
-- The problem this migration solves
-- --------------------------------
-- The previous version let each request write its own usage row using the
-- caller's session, gated only by an RLS policy of `user_id = auth.uid()`.
--
-- That policy proves *whose* row it is. It proves nothing about the numbers in
-- it. Because the browser holds the same signed-in session the server does,
-- PostgREST is reachable directly, so a user could `POST` to `/rest/v1/ai_usage`
-- and insert a row with any token counts they liked. Nothing in that request
-- needed to touch ORVYN at all.
--
-- The fix
-- -------
-- The browser never writes to this table. There is no INSERT/UPDATE/DELETE
-- policy and no grant for `anon` or `authenticated`, so a direct PostgREST write
-- is rejected by Postgres regardless of what the caller claims.
--
-- The only write path is `ai_usage_record`, a SECURITY DEFINER function that
-- verifies an HMAC over the exact row it is about to insert, keyed by a secret
-- held only in the server environment. The signature covers the user id,
-- provider, model, both token counts and a unique nonce, so:
--
--   - the caller cannot choose different counts after the fact;
--   - the caller cannot attribute a row to another user, because the user id is
--     read from `auth.uid()` rather than taken as a parameter;
--   - replaying a captured call either fails the signature check or, if it is
--     byte-identical, collides on the unique nonce and inserts nothing.
--
-- A row therefore exists only if the Next.js chat route put it there after
-- reading a usage block out of a real provider response.

create extension if not exists pgcrypto with schema extensions;

-- Helpers and the signing secret live outside `public` so PostgREST's default
-- exposure never reaches them as callable objects.
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

-- `ai_usage_record` itself must live in `public`, because that is the only schema
-- PostgREST exposes by default and the server reaches it as an RPC. Being
-- callable is not the same as being usable: the function verifies an HMAC before
-- it writes anything, so exposing it grants no capability a client does not
-- already lack. Every helper it depends on stays in `private` and is revoked from
-- every client role, so the only reachable surface is the one guarded function.

-- ---------------------------------------------------------------------------
-- Secret storage
-- ---------------------------------------------------------------------------

create table if not exists private.ai_usage_signing_secret (
  id boolean primary key default true,
  secret text not null,
  -- One row only: a second key would be ambiguous about which one signed a row.
  constraint ai_usage_signing_secret_singleton check (id)
);

revoke all on private.ai_usage_signing_secret from public, anon, authenticated;
alter table private.ai_usage_signing_secret enable row level security;
-- No policy at all: `authenticated` cannot read the key even if it guesses the
-- table name. Only the definer of the functions below can.

comment on table private.ai_usage_signing_secret is
  'HMAC key for usage writes. Set with select private.set_usage_signing_secret(...). Never readable by clients.';

-- Provisioning / rotation, from the SQL editor or a migration runner only.
--
-- Revoked from every client role, so this is not callable through PostgREST. It
-- exists so the secret can be rotated without hand-editing the table.
create or replace function private.set_usage_signing_secret(new_secret text)
returns void
language plpgsql
security definer
set search_path = public, extensions
as $$
begin
  if new_secret is null or length(new_secret) < 32 then
    raise exception 'usage signing secret must be at least 32 characters';
  end if;

  insert into private.ai_usage_signing_secret (id, secret)
  values (true, new_secret)
  on conflict (id) do update set secret = excluded.secret;
end;
$$;

revoke all on function private.set_usage_signing_secret(text) from public, anon, authenticated;

-- Constant-time comparison of two hex digests.
--
-- A plain `=` would leak, through response timing, how many leading characters of
-- a guessed digest matched. Both digests here are fixed-length SHA-256 hex, so
-- the length check leaks nothing.
create or replace function private.constant_time_equals(a text, b text)
returns boolean
language sql
immutable
as $$
  select case
    when a is null or b is null then false
    when octet_length(a) <> octet_length(b) then false
    else (
      select bool_and(get_byte(a, i) = get_byte(b, i))
      from generate_series(0, octet_length(a) - 1) as i
    )
  end;
$$;

revoke all on function private.constant_time_equals(text, text) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Replay protection
-- ---------------------------------------------------------------------------

alter table public.ai_usage add column if not exists request_nonce text;

-- A nonce may only be set by the signed write path, and only once.
create unique index if not exists ai_usage_request_nonce_idx
  on public.ai_usage (request_nonce)
  where request_nonce is not null;

-- ---------------------------------------------------------------------------
-- The single write path
-- ---------------------------------------------------------------------------

-- The exact string the server signs. Must stay byte-identical to
-- `usageSigningPayload` in `src/lib/ai/usage-signing.ts`.
--
-- `p_user_id` is an input to the *signature*, not to the *insert*: the identity
-- written to the row is always `auth.uid()`, so a valid signature for user A
-- cannot be replayed by user B.
create or replace function private.ai_usage_canonical_payload(
  p_user_id uuid,
  p_provider text,
  p_model_id text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_nonce text
)
returns text
language sql
immutable
as $$
  select string_agg(part, chr(10))
  from unnest(array[
    'orvyn-usage-v1',
    p_user_id::text,
    p_provider,
    p_model_id,
    coalesce(p_input_tokens::text, 'null'),
    coalesce(p_output_tokens::text, 'null'),
    p_nonce
  ]) as part;
$$;

revoke all on function private.ai_usage_canonical_payload(uuid, text, text, integer, integer, text)
  from public, anon, authenticated;

-- Records one provider-reported reading.
--
-- In `public` because the server reaches it as a PostgREST RPC, and `public` is
-- the only schema exposed by default.
--
-- SECURITY DEFINER because it must insert despite the table having no INSERT
-- grant for `authenticated`. That is safe only because of what it verifies first:
-- a signature no client can produce. `search_path` is pinned so a malicious
-- object in the caller's schema cannot be substituted for `hmac`.
create or replace function public.ai_usage_record(
  p_provider text,
  p_model_id text,
  p_input_tokens integer,
  p_output_tokens integer,
  p_nonce text,
  p_signature text
)
returns bigint
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_user_id uuid := auth.uid();
  v_secret text;
  v_expected text;
  v_row_id bigint;
begin
  if v_user_id is null then
    raise exception 'usage recording requires an authenticated session'
      using errcode = '42501';
  end if;

  -- Reject before touching the secret: a malformed call should not be able to
  -- spend time in the key comparison.
  if p_input_tokens is null and p_output_tokens is null then
    raise exception 'usage recording requires at least one reported token count';
  end if;

  if (p_input_tokens is not null and p_input_tokens < 0)
     or (p_output_tokens is not null and p_output_tokens < 0) then
    raise exception 'usage token counts must not be negative';
  end if;

  if p_provider is null or length(p_provider) = 0 or length(p_provider) > 128 then
    raise exception 'usage provider must be 1-128 characters';
  end if;

  if p_model_id is null or length(p_model_id) = 0 or length(p_model_id) > 256 then
    raise exception 'usage model id must be 1-256 characters';
  end if;

  if p_nonce is null or length(p_nonce) < 16 or length(p_nonce) > 128 then
    raise exception 'usage nonce must be 16-128 characters';
  end if;

  -- The canonical form is newline-delimited, so a field containing a newline
  -- could imitate a field boundary and make one payload verify as another.
  if position(chr(10) in p_provider) > 0
     or position(chr(10) in p_model_id) > 0
     or position(chr(10) in p_nonce) > 0 then
    raise exception 'usage fields must not contain line breaks';
  end if;

  select secret into v_secret from private.ai_usage_signing_secret where id;
  if v_secret is null then
    raise exception 'usage recording is not configured'
      using errcode = '42501';
  end if;

  v_expected := encode(
    hmac(
      private.ai_usage_canonical_payload(
        v_user_id, p_provider, p_model_id, p_input_tokens, p_output_tokens, p_nonce
      ),
      v_secret,
      'sha256'
    ),
    'hex'
  );

  if not private.constant_time_equals(p_signature, v_expected) then
    -- Deliberately vague: a caller learns that the write was refused, not which
    -- field was wrong.
    raise exception 'usage write rejected'
      using errcode = '42501';
  end if;

  insert into public.ai_usage (
    user_id, provider, model_id, input_tokens, output_tokens, request_nonce
  )
  values (
    v_user_id, p_provider, p_model_id, p_input_tokens, p_output_tokens, p_nonce
  )
  on conflict (request_nonce) do nothing
  returning id into v_row_id;

  -- A replayed identical write collides on the nonce and inserts nothing; report
  -- the row that already exists so the caller still sees a stable result.
  if v_row_id is null then
    select id into v_row_id
    from public.ai_usage
    where request_nonce = p_nonce and user_id = v_user_id;
  end if;

  return v_row_id;
end;
$$;

revoke all on function public.ai_usage_record(text, text, integer, integer, text, text)
  from public, anon, authenticated;

-- `authenticated` only, never `anon`. Without a valid signature this function
-- refuses, so the grant alone grants nothing — it exists solely so the server
-- can present its session and a signature together.
grant execute on function public.ai_usage_record(text, text, integer, integer, text, text)
  to authenticated;

-- ---------------------------------------------------------------------------
-- Removing the forgeable write path
-- ---------------------------------------------------------------------------

drop policy if exists "ai_usage_insert_own" on public.ai_usage;

revoke insert, update, delete on table public.ai_usage from anon, authenticated;

-- Reads are unchanged: a user sees their own rows and nothing else. There is
-- still no UPDATE or DELETE policy, so a recorded figure cannot be rewritten or
-- removed by the account that owns it.
drop policy if exists "ai_usage_update_own" on public.ai_usage;
drop policy if exists "ai_usage_delete_own" on public.ai_usage;

-- ---------------------------------------------------------------------------
-- Trusted aggregates
-- ---------------------------------------------------------------------------

-- The aggregates are already correct from the previous migration and are left
-- untouched here. Both matter to this change, so they are restated as the
-- invariant being preserved:
--
--   ai_usage_daily_total  — SECURITY INVOKER. It returns only the caller's own
--     rows, so the select policy already restricts them; DEFINER would be a
--     needless privilege.
--
--   ai_usage_month_total  — SECURITY DEFINER, because no single user may read
--     everyone else's rows. It is computed inside the database from rows that
--     only the signed write path can create, which is what makes the global
--     figure server-authoritative. It returns counts only — never a prompt,
--     model id, or user id — so it exposes a number the product already shows on
--     screen rather than user data.
--
-- With writes now restricted to `ai_usage_record`, neither aggregate can be
-- influenced by a client: there is no row for a client to add, change, or
-- remove.

-- ---------------------------------------------------------------------------
-- Resulting trust model
--
--   Browser                     Server                       Database
--   -------                     ------                       --------
--   cannot INSERT/UPDATE/DELETE  signs the row after reading   ai_usage_record verifies
--   (no grant, no policy)        a provider usage block        the HMAC, then inserts
--   can read own rows via        can read aggregates            aggregates computed from
--   ai_usage_select_own                                       rows only this path creates
--
-- The remaining known limitation, unchanged: a client can read its own usage,
-- which it already could. It cannot change any figure, and the global monthly
-- total is not client-writable at all.
-- ---------------------------------------------------------------------------