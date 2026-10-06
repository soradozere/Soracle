-- October 2026's season was named mid-month: the "Season 4 — TBC" scaffold
-- (ids s2026-10-1 … s2026-10-5) became "Halloween 2026" (bones, fent-zombie,
-- vampire, forsaken, reaper) in lib/titles.ts. Seasonal titles bank LIVE on
-- the match-save path, so any October rows recorded before the rename carry
-- the scaffold ids and placeholder names — this remaps them in place.
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
    season_name = 'Halloween 2026'
from (values
  ('s2026-10-1', 'bones',       'Bones',        'common'),
  ('s2026-10-2', 'fent-zombie', 'Fent Zombie',  'rare'),
  ('s2026-10-3', 'vampire',     'Vampire',      'epic'),
  ('s2026-10-4', 'forsaken',    'Forsaken',     'legendary'),
  ('s2026-10-5', 'reaper',      'The Reaper',   'mythic')
) as m(old_id, new_id, new_title, new_rarity)
where player_titles.title_id = m.old_id
  and player_titles.season_key = '2026-10';

update public.players
set title = m.new_id
from (values
  ('s2026-10-1', 'bones'),
  ('s2026-10-2', 'fent-zombie'),
  ('s2026-10-3', 'vampire'),
  ('s2026-10-4', 'forsaken'),
  ('s2026-10-5', 'reaper')
) as m(old_id, new_id)
where players.title = m.old_id;
