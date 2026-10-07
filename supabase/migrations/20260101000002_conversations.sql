-- ORVYN conversation persistence.
--
-- Each signed-in user owns their own conversations and messages. RLS ensures
-- a caller can only read or write rows that belong to them.

create table if not exists public.conversations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  title text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations (id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null,
  created_at timestamptz not null default now()
);

alter table public.conversations enable row level security;
alter table public.messages enable row level security;

create policy "conversations_select_own"
  on public.conversations
  for select
  to authenticated
  using (user_id = (select auth.uid()));

create policy "conversations_insert_own"
  on public.conversations
  for insert
  to authenticated
  with check (user_id = (select auth.uid()));

create policy "conversations_update_own"
  on public.conversations
  for update
  to authenticated
  using (user_id = (select auth.uid()));

create policy "conversations_delete_own"
  on public.conversations
  for delete
  to authenticated
  using (user_id = (select auth.uid()));

create policy "messages_select_own"
  on public.messages
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and c.user_id = (select auth.uid())
    )
  );

create policy "messages_insert_own"
  on public.messages
  for insert
  to authenticated
  with check (
    exists (
      select 1
      from public.conversations c
      where c.id = conversation_id
        and c.user_id = (select auth.uid())
    )
  );

create index if not exists messages_conversation_id_idx
  on public.messages (conversation_id, created_at);
