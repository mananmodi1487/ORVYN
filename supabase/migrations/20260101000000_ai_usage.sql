-- ORVYN token usage accounting.
--
-- Every row here originates from a usage figure a provider returned in its own
-- response. Nothing is estimated client-side, and a response with no reported
-- usage produces no row at all — an absent row means "unknown", never "zero".
--
-- Rows are written by the Next.js server using the signed-in user's own session,
-- never with the service-role key, so RLS is the only thing standing between a
-- caller and someone else's numbers.

create table if not exists public.ai_usage (
  id bigint generated always as identity primary key,

  -- Not nullable: usage is only attributed when there is a real user to
  -- attribute it to. Anonymous traffic is reported as unavailable rather than
  -- pooled into a number no one can audit.
  user_id uuid not null references auth.users (id) on delete cascade,

  provider text not null,
  model_id text not null,

  -- Nullable individually. A provider may report one side and not the other, and
  -- forcing a 0 in would understate the real figure.
  input_tokens integer check (input_tokens is null or input_tokens >= 0),
  output_tokens integer check (output_tokens is null or output_tokens >= 0),

  recorded_at timestamptz not null default now(),

  -- A generation always has at least one of the two counts, otherwise the row
  -- carries no information.
  constraint ai_usage_has_a_count check (
    input_tokens is not null or output_tokens is not null
  )
);

-- Daily rollups read a single user's recent rows.
create index if not exists ai_usage_user_recorded_idx
  on public.ai_usage (user_id, recorded_at desc);

-- The global pool rolls up every row in the current month.
create index if not exists ai_usage_recorded_idx
  on public.ai_usage (recorded_at desc);

alter table public.ai_usage enable row level security;

-- A user may read their own usage, and nothing else.
create policy "ai_usage_select_own"
  on public.ai_usage
  for select
  to authenticated
  using (user_id = (select auth.uid()));

-- Inserts are attributed to the caller, enforced by the same expression rather
-- than by trusting the client to send its own id.
create policy "ai_usage_insert_own"
  on public.ai_usage
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

-- No update or delete policy: usage is an append-only record of what a provider
-- reported. Correcting a figure means recording the truth elsewhere, not
-- rewriting history that a total was derived from.

-- Per-user daily total for a given day.
--
-- SECURITY INVOKER on purpose: this only ever returns the caller's own rows, so
-- the select policy above already restricts it.
create or replace function public.ai_usage_daily_total(
  target_day date default (now() at time zone 'utc')::date
)
returns table (
  input_tokens bigint,
  output_tokens bigint,
  request_count bigint
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    coalesce(sum(u.input_tokens), 0)::bigint,
    coalesce(sum(u.output_tokens), 0)::bigint,
    count(*)::bigint
  from public.ai_usage u
  where u.user_id = (select auth.uid())
    and (u.recorded_at at time zone 'utc')::date = target_day;
$$;

-- Global month-to-date total across every user.
--
-- SECURITY DEFINER is required because no single user may read everyone else's
-- rows. It exposes aggregate counts only — never prompts, ids, or model names —
-- so it reveals a number the product already shows on screen, not user data.
create or replace function public.ai_usage_month_total(
  target_month date default (date_trunc('month', now() at time zone 'utc')::date)
)
returns table (
  input_tokens bigint,
  output_tokens bigint,
  request_count bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(input_tokens), 0)::bigint,
    coalesce(sum(output_tokens), 0)::bigint,
    count(*)::bigint
  from public.ai_usage
  where (recorded_at at time zone 'utc')::date >= target_month;
$$;

grant execute on function public.ai_usage_daily_total(date) to authenticated;
grant execute on function public.ai_usage_month_total(date) to authenticated;

-- ---------------------------------------------------------------------------
-- Known limitation
--
-- Because rows are inserted with the user's own session, a determined signed-in
-- user could submit inflated counts. That is accepted here for two reasons:
-- ORVYN is free-only, so a false figure can never cause a charge, and the only
-- consequence is ORVYN believing it is closer to its own self-imposed ceiling —
-- which fails toward showing *less* remaining capacity, never more.
--
-- Binding usage to unforgeable facts requires a trusted writer (a Supabase Edge
-- Function holding the service-role key). That is deliberately not done here:
-- the service-role key must never be read by application code.
-- ---------------------------------------------------------------------------