-- 011_create_pending_matches.sql
--
-- The "Approval needed" queue. The Discord bot POSTs every end-of-match scoreboard
-- CSV to /api/bot/scoreboard; Soracle parses it, resolves in-game names to players,
-- and parks the result here for an admin to review, edit and approve in the Match
-- History tab. Approving creates a real `matches` (+ `match_stats`) row; until then
-- nothing here counts toward stats, win rates or leaderboards.
--
-- The bot writes via the service role (bypasses RLS). Admins read/update through
-- the app. Idempotent: safe to re-run.

begin;

create table if not exists public.pending_matches (
  id         uuid primary key default gen_random_uuid(),
  source     text not null default 'discord_bot',

  -- Discord provenance (all nullable — a manual/test upload may omit them).
  guild_id      text,
  channel_id    text,
  message_id    text,
  uploader_id   text,
  uploader_name text,

  -- Raw CSV in the private pending-scoreboards bucket (canonical source).
  csv_path     text not null,
  csv_filename text,

  -- Parsed headline data for the bin list.
  match_played_at  timestamptz,
  distinct_players integer not null,
  red_score        integer not null default 0,
  blue_score       integer not null default 0,

  -- Full resolved snapshot: per-row in-game name, team, raw CSV row, and the
  -- suggested player_id + match method. Lets the review modal hydrate instantly
  -- without re-parsing; the CSV remains the canonical fallback.
  parsed jsonb not null,

  status      text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by uuid references auth.users (id),
  reviewed_at timestamptz,
  match_id    uuid references public.matches (id) on delete set null,

  created_at timestamptz not null default now()
);

-- Idempotency, not content dedup: one Discord message maps to at most one entry,
-- so a bot retry of the same upload is a no-op. Genuinely re-posted games carry a
-- different message_id and still create a new entry (admins reject duplicates).
create unique index if not exists pending_matches_message_id_unique
  on public.pending_matches (message_id) where message_id is not null;

create index if not exists pending_matches_status_idx
  on public.pending_matches (status);

-- RLS: internal review queue, not public. Admin-only for every verb; the bot's
-- service-role client bypasses RLS entirely. Mirrors the is_admin() shape from
-- 008_restrict_writes_to_admins.sql.
alter table public.pending_matches enable row level security;

drop policy if exists "pending_matches_select_admin" on public.pending_matches;
create policy "pending_matches_select_admin" on public.pending_matches
  for select to authenticated using (public.is_admin());

drop policy if exists "pending_matches_insert_admin" on public.pending_matches;
create policy "pending_matches_insert_admin" on public.pending_matches
  for insert to authenticated with check (public.is_admin());

drop policy if exists "pending_matches_update_admin" on public.pending_matches;
create policy "pending_matches_update_admin" on public.pending_matches
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "pending_matches_delete_admin" on public.pending_matches;
create policy "pending_matches_delete_admin" on public.pending_matches
  for delete to authenticated using (public.is_admin());

-- Private bucket for the raw scoreboard CSVs awaiting approval. No storage
-- policies are added, so only the service role can read/write the objects; the
-- app reads them server-side (Phase 3) via the service-role client.
insert into storage.buckets (id, name, public)
values ('pending-scoreboards', 'pending-scoreboards', false)
on conflict (id) do nothing;

commit;
