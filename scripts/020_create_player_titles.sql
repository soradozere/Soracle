-- Permanent record of earned SEASONAL titles.
--
-- Seasonal entitlement is computed against one month's scoreboard and one
-- month's catalogue, so it cannot be recomputed later: once August's season
-- replaces July's in lib/titles.ts, July's Odyssey ladder is gone from the
-- code and "Odysseus" would silently vanish from the profile of whoever
-- earned it. Recording the unlock is the only way it survives.
--
-- The row therefore SNAPSHOTS how the title should render (name, rarity,
-- season it came from) rather than pointing back into the catalogue. A title
-- earned in July still displays correctly in November.
--
-- Permanent score-ladder titles (Decorated → JK2 God) are deliberately NOT
-- stored here: Achievement Score only rises, so they can't lapse, and leaving
-- them live-computed means renaming one propagates everywhere instead of
-- leaving stale copies on old rows.
create table if not exists public.player_titles (
  player_id uuid not null references public.players(id) on delete cascade,
  title_id text not null,
  season_key text not null,   -- "2026-07"
  season_name text not null,  -- "The Odyssey"
  title text not null,        -- "Odysseus"
  rarity text not null,       -- "mythic" — drives the display colour
  earned_at timestamptz not null default now(),
  primary key (player_id, title_id)
);

alter table public.player_titles enable row level security;

-- Public read: titles are shown on public profiles and the players board.
-- No insert/update/delete policies — recording happens through the
-- service-role client only (lib/titles-server.ts, on match save).
drop policy if exists player_titles_select_all on public.player_titles;
create policy player_titles_select_all
  on public.player_titles for select
  using (true);
