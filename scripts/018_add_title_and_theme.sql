-- Equipped title + profile theme.
--
--   * title         — the id of the title the player currently wears, e.g.
--                     "achilles" or "distinguished". Only the CHOICE is stored;
--                     whether they're entitled to it is recomputed on render
--                     from the ladders in lib/titles.ts, so there is nothing to
--                     keep in sync and nothing to clean up when a season ends.
--                     A title the player no longer qualifies for is simply not
--                     displayed.
--
--   * profile_theme — one of "green" / "blue" / "purple" / "gold", recolouring
--                     the profile (starfield included). Gated the same way: the
--                     tier has to be unlocked by their all-time Achievement
--                     Score, checked at render, not at write time.
--
-- Both are nullable; null means "no title" / "default cyan theme", which is the
-- correct state for every player until an admin sets one.

alter table public.players
  add column if not exists title text,
  add column if not exists profile_theme text;

-- Guard against typos writing an unrenderable theme. Titles are deliberately
-- unconstrained: the catalogue changes every month with the season, and a
-- database constraint would have to be migrated each time.
alter table public.players
  drop constraint if exists players_profile_theme_check;
alter table public.players
  add constraint players_profile_theme_check
  check (profile_theme is null or profile_theme in ('green', 'blue', 'purple', 'gold'));
