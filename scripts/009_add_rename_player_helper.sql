-- 009_add_rename_player_helper.sql
--
-- Safe player rename.
--
-- Editing players.name directly is NOT safe: matches store player names in the
-- red_team / blue_team text arrays (not ids), and nothing rewrites them on a rename. So a
-- raw rename orphans the player's match history, ELO, and win/loss — the new name looks
-- like a brand-new player while the old name lingers as a phantom in the leaderboard.
-- (match_stats is keyed by player_id, so the detailed CSV stats survive a rename; it's the
-- name-keyed match arrays + tier_changes that need patching.)
--
-- This function renames the player AND rewrites every match array + tier_changes row in a
-- single transaction, so the player's whole history follows the new name.
--
-- USAGE — run in the Supabase SQL editor:
--   select public.rename_player('OldName', 'NewName');
-- It returns a one-line summary of what changed, e.g.
--   Renamed "bob" -> "robert": 1 player row, 14 matches, 3 tier-change rows updated
--
-- It is NOT exposed to the anon/authenticated PostgREST API (execute is revoked from
-- PUBLIC) — it can only be run from the SQL editor / service role. Re-runnable.

create or replace function public.rename_player(old_name text, new_name text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  player_rows int;
  match_rows  int;
  change_rows int;
begin
  -- Validate inputs.
  if old_name is null or new_name is null or btrim(new_name) = '' then
    raise exception 'old_name and new_name are both required (new_name cannot be blank)';
  end if;
  if old_name = new_name then
    raise exception 'old_name and new_name are identical';
  end if;
  if not exists (select 1 from players where name = old_name) then
    raise exception 'no player named "%"', old_name;
  end if;
  if exists (select 1 from players where name = new_name) then
    raise exception 'a player named "%" already exists — pick a different name', new_name;
  end if;

  -- 1. The player row itself.
  update players set name = new_name where name = old_name;
  get diagnostics player_rows = row_count;

  -- 2. Every match that references the old name on either team.
  update matches
    set red_team  = array_replace(red_team,  old_name, new_name),
        blue_team = array_replace(blue_team, old_name, new_name)
    where old_name = any(red_team) or old_name = any(blue_team);
  get diagnostics match_rows = row_count;

  -- 3. Tier changelog entries (name-keyed).
  update tier_changes set player_name = new_name where player_name = old_name;
  get diagnostics change_rows = row_count;

  return format(
    'Renamed "%s" -> "%s": %s player row, %s matches, %s tier-change rows updated',
    old_name, new_name, player_rows, match_rows, change_rows
  );
end;
$$;

-- Lock it to the SQL editor / service role only — never callable through the public API.
revoke execute on function public.rename_player(text, text) from public;
