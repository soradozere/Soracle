-- 049_create_award_votes_2026.sql
--
-- One row per (voter, category) for the 2026 Player Awards
-- (/player-awards-2026). A vote is either a nominee pick (the nine roster
-- categories) or, for Quote of the year, the quote text itself -- Best
-- Highlight and Render of the year aren't open yet and get no rows until
-- they are.
--
-- The unique constraint is what "one vote per category" means here:
-- submitting again for a category you've already voted in UPDATES that row
-- (see the upsert in award-actions.ts) rather than adding a second one, so a
-- player can change their pick any time before voting closes on 27 Nov 2026.
--
-- Player auth is the cookie-session system (lib/player-auth.ts), not Supabase
-- Auth, so there's no auth.uid() to write a player-scoped RLS policy against.
-- Every write goes through the service-role client in
-- app/(main)/player-awards-2026/award-actions.ts, which re-derives
-- voter_player_id from the verified session cookie -- a client can never
-- submit a vote on someone else's behalf. The RLS policies below are for the
-- admin-panel read, and to keep the table unreadable by the anon key -- a
-- running tally shouldn't be public before voting closes.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists public.award_votes_2026 (
  id                uuid primary key default gen_random_uuid(),
  category          text not null,
  voter_player_id   uuid not null references public.players (id) on delete cascade,
  nominee_player_id uuid references public.players (id) on delete cascade,
  quote_text        text,
  comment           text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint award_votes_2026_one_per_voter_category unique (voter_player_id, category),
  -- A vote is a nominee pick or a quote, never neither.
  constraint award_votes_2026_has_a_pick check (nominee_player_id is not null or quote_text is not null)
);

create index if not exists award_votes_2026_category_idx on public.award_votes_2026 (category);

alter table public.award_votes_2026 enable row level security;

-- Admin reads go through the service-role client (app/admin/player-awards-2026),
-- which bypasses RLS entirely -- same reasoning as 046's title_changes, since a
-- player-session full_admin has no auth.uid() for "authenticated" to match.
-- These policies exist for parity and for a real Supabase Auth admin session.
drop policy if exists "award_votes_2026_select_admin" on public.award_votes_2026;
create policy "award_votes_2026_select_admin" on public.award_votes_2026
  for select to authenticated using (public.is_admin());

drop policy if exists "award_votes_2026_admin_write" on public.award_votes_2026;
create policy "award_votes_2026_admin_write" on public.award_votes_2026
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

commit;
