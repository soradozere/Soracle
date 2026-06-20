-- 012_add_in_game_name_to_match_stats.sql
--
-- Persist the raw in-game scoreboard name on each per-player stats row. Until now
-- the CSV importer collapsed an in-game name straight to a player_id and threw the
-- name away, so aliases could never be audited or learned retroactively. Storing
-- it going forward makes the name → player mapping auditable and lets the alias
-- system (player_aliases) reason about real data.
--
-- Nullable: existing rows stay NULL (their original names were never recorded);
-- only rows written after this migration carry a name. Idempotent.

alter table public.match_stats
  add column if not exists in_game_name text;
