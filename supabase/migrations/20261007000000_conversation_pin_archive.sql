-- Conversation pinning and archiving.
--
-- `pinned_at` and `archived_at` are nullable timestamps where
-- null is the default state: not pinned, not archived. Both are
-- written only through the server-side conversation API, which
-- scopes every write to the owning user; the existing
-- `conversations_update_own` policy already covers these
-- columns, so no policy changes are needed and RLS isolation
-- is unchanged.
--
-- Every statement is guarded with `if not exists`, so the file
-- is safe to re-run: a fresh database, a partially applied
-- migration, or one that already ran all end at the same state.

alter table public.conversations
  add column if not exists pinned_at timestamptz null;

alter table public.conversations
  add column if not exists archived_at timestamptz null;

-- Sidebar list: the signed-in user's active (unarchived)
-- conversations, pinned ones first, both groups newest
-- first. Both indexes lead with user_id, so a plan for one
-- user's rows can never reach another user's ordering.
create index if not exists conversations_user_active_idx
  on public.conversations (user_id, updated_at desc)
  where archived_at is null;

create index if not exists conversations_user_pinned_idx
  on public.conversations (user_id, pinned_at desc)
  where pinned_at is not null;
