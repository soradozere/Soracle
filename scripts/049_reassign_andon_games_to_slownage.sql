-- 049_reassign_andon_games_to_slownage.sql
--
-- Slownage's games have been landing on Andon. Andon hasn't played in months,
-- so every Andon appearance after the cutoff below is really Slownage. This
-- moves those games across and stops it happening again.
--
-- The likely cause is a learned mapping: an admin once approved a scoreboard
-- with Slownage's row mapped to Andon, which taught the importer either an
-- alias or an nwh id pointing at Andon (lib/name-match.ts checks nwh ids first,
-- so one bad nwh mapping auto-fills Andon on every scoreboard after it). Any
-- alias or nwh id Andon picked up after the cutoff came from Slownage's games,
-- so those move too.
--
-- STEP 1 — preview. Run this on its own first and pick the cutoff: the date
-- after Andon's real last game and before the first wrongly-logged one.
--
--   select m.created_at, m.match_type, m.red_score, m.blue_score
--   from public.matches m
--   where 'andon' = any(m.red_team) or 'andon' = any(m.blue_team)
--   order by m.created_at desc;
--
-- Names are looked up case-insensitively (the live roster has "andon"), and
-- the exact stored spelling is then used for the name-keyed team arrays.
--
-- STEP 2 — set the cutoff at the top of the `params` table below, then run the
-- rest of the file. It raises (and rolls back) if either player is missing or
-- if Slownage is already on a team in an affected match.
--
-- Matches are name-keyed (red_team / blue_team text arrays), so ELO and
-- win/loss follow automatically. match_stats and match_kills are id-keyed and
-- are rewritten for the same matches only.

begin;

create temporary table params on commit drop as
select
  timestamptz '2026-08-01 00:00:00+00' as cutoff,   -- <-- EDIT ME after step 1
  a.id as andon_id,    a.name as andon_name,
  s.id as slownage_id, s.name as slownage_name
from (select 1) x
left join public.players a on lower(btrim(a.name)) = 'andon'
left join public.players s on lower(btrim(s.name)) = 'slownage';

do $$
declare
  p record;
  clash int;
begin
  if (select count(*) from params) > 1 then
    raise exception 'more than one player matches "andon" or "slownage" ignoring case — fix by hand';
  end if;
  select * into p from params;
  if p.andon_id is null then raise exception 'no player named "Andon"'; end if;
  if p.slownage_id is null then raise exception 'no player named "Slownage" — create the player first'; end if;

  select count(*) into clash
  from public.matches m
  where m.created_at >= p.cutoff
    and (p.andon_name = any(m.red_team) or p.andon_name = any(m.blue_team))
    and (p.slownage_name = any(m.red_team) or p.slownage_name = any(m.blue_team));
  if clash > 0 then
    raise exception '% match(es) after the cutoff have both Andon and Slownage — fix those by hand', clash;
  end if;
end $$;

create temporary table affected on commit drop as
select m.id
from public.matches m, params p
where m.created_at >= p.cutoff
  and (p.andon_name = any(m.red_team) or p.andon_name = any(m.blue_team));

-- 1. Team rosters (drives ELO, win/loss, match history).
update public.matches m
set red_team  = array_replace(m.red_team,  p.andon_name, p.slownage_name),
    blue_team = array_replace(m.blue_team, p.andon_name, p.slownage_name)
from params p
where m.id in (select id from affected);

-- 2. Per-match scoreboard stats.
update public.match_stats s
set player_id = p.slownage_id
from params p
where s.player_id = p.andon_id
  and s.match_id in (select id from affected);

-- 3. Kill matrix, both directions.
update public.match_kills k
set killer_player_id = p.slownage_id
from params p
where k.killer_player_id = p.andon_id
  and k.match_id in (select id from affected);

update public.match_kills k
set victim_player_id = p.slownage_id
from params p
where k.victim_player_id = p.andon_id
  and k.match_id in (select id from affected);

-- 4. The root cause: learned identities Andon picked up from Slownage's games.
update public.player_nwh_ids n
set player_id = p.slownage_id
from params p
where n.player_id = p.andon_id
  and n.created_at >= p.cutoff;

update public.player_aliases a
set player_id = p.slownage_id
from params p
where a.player_id = p.andon_id
  and (a.created_at >= p.cutoff or lower(btrim(a.alias)) like '%slownage%');

-- 5. Recompute last-played for both from the corrected rosters.
update public.players pl
set last_match_at = (
  select max(m.created_at)
  from public.matches m
  where pl.name = any(m.red_team) or pl.name = any(m.blue_team)
)
where pl.id in (select andon_id from params union select slownage_id from params);

-- Summary of what moved.
select
  (select count(*) from affected) as matches_moved,
  (select count(*) from public.player_nwh_ids n, params p where n.player_id = p.slownage_id) as slownage_nwh_ids,
  (select count(*) from public.player_aliases a, params p where a.player_id = p.slownage_id) as slownage_aliases;

commit;
