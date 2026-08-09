-- August 2026's season was named mid-month: the "Season 2 — TBC" scaffold
-- (ids s2026-08-1 … s2026-08-5) became "Fire & Blood" (silverwing, meraxes,
-- vermithor, vhagar, balerion) in lib/titles.ts. Seasonal titles bank LIVE on
-- the match-save path, so any August rows recorded before the rename carry the
-- scaffold ids and placeholder names — this remaps them in place.
--
-- Also remaps players.title for anyone who had already equipped a scaffold id,
-- so their choice survives the rename instead of dangling.
--
-- Idempotent: every statement matches only the old ids, so re-running is a
-- no-op once they're gone. Safe to run even if no scaffold rows were ever
-- banked.

update public.player_titles
set title_id = m.new_id,
    title = m.new_title,
    rarity = m.new_rarity,
    season_name = 'Fire & Blood'
from (values
  ('s2026-08-1', 'silverwing', 'Silverwing', 'common'),
  ('s2026-08-2', 'meraxes',    'Meraxes',    'rare'),
  ('s2026-08-3', 'vermithor',  'Vermithor',  'epic'),
  ('s2026-08-4', 'vhagar',     'Vhagar',     'legendary'),
  ('s2026-08-5', 'balerion',   'Balerion',   'mythic')
) as m(old_id, new_id, new_title, new_rarity)
where player_titles.title_id = m.old_id
  and player_titles.season_key = '2026-08';

update public.players
set title = m.new_id
from (values
  ('s2026-08-1', 'silverwing'),
  ('s2026-08-2', 'meraxes'),
  ('s2026-08-3', 'vermithor'),
  ('s2026-08-4', 'vhagar'),
  ('s2026-08-5', 'balerion')
) as m(old_id, new_id)
where players.title = m.old_id;
