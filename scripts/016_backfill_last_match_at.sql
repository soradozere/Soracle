-- 016_backfill_last_match_at.sql
--
-- players.last_match_at was added in 003 and read by lib/fetch-players-db.ts
-- (isPlayerInactive: manually inactive OR no match in 27 days), but nothing ever
-- WROTE it — no code path, no trigger. The values froze at an old backfill, so
-- active players drifted into the Tier List's "Inactive Players" section (11 of
-- them at the time of writing, including players who had played that same day).
--
-- app/admin/actions.ts now stamps last_match_at whenever a match is logged
-- (touchLastMatchAt). This script repairs the existing rows once.
--
-- A player's true last match = the newest match whose red_team/blue_team contains
-- their name. Players who have never appeared in a match keep NULL, which
-- isPlayerInactive already treats as "never played", not "inactive".
--
-- Idempotent: safe to re-run.

begin;

update public.players p
set last_match_at = m.last_played
from (
  select
    name,
    max(created_at) as last_played
  from public.matches,
       lateral unnest(coalesce(red_team, '{}'::text[]) || coalesce(blue_team, '{}'::text[])) as name
  group by name
) m
where p.name = m.name
  and (p.last_match_at is null or p.last_match_at < m.last_played);

commit;

-- Verify (expect 0 rows): players whose stored value trails their true last match.
-- select p.name, p.last_match_at, m.last_played
-- from public.players p
-- join (
--   select name, max(created_at) as last_played
--   from public.matches,
--        lateral unnest(coalesce(red_team, '{}'::text[]) || coalesce(blue_team, '{}'::text[])) as name
--   group by name
-- ) m on m.name = p.name
-- where p.last_match_at is null or p.last_match_at < m.last_played;
