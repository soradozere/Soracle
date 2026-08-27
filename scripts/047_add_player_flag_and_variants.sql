-- 047_add_player_flag_and_variants.sql
--
-- Adds the carried CTF flag to the profile loadout for the first time (model,
-- saber and mines already had columns from 023-026), plus a cosmetic variant
-- column each for the flag and the trip mine — the "transparent" and
-- "nightmare" treatments in components/carried-flag.tsx / lib/prop-assets.ts.
--
-- `flag`: a team id from lib/prop-assets.ts (FLAG_TEAMS) — 'red' or 'blue'.
-- Same reasoning as 024_add_player_model.sql: an id, never a path. NULL means
-- "no flag" — the model carries nothing. Not gated: any player may carry
-- either team's flag, same as they may pick any model.
--
-- `flag_variant` / `mine_variant`: a variant id from lib/prop-assets.ts
-- (FLAG_VARIANTS / MINE_VARIANTS). Meaningless without `flag` / a mines-armed
-- `saber` respectively, same relationship `skin` has to `model`. UNLIKE model,
-- skin, saber and the base flag/mine, these two ARE gated on entitlement —
-- see FLAG_VARIANT_UNLOCK / MINE_VARIANT_UNLOCK in lib/prop-assets.ts and the
-- re-validation in /api/player-profile. NULL/unrecognised means "default", so
-- a profile predating this column (everyone, at ship time) keeps behaving
-- exactly as before.
--
-- No new RLS needed: the players table's admin-only write policies
-- (008_restrict_writes_to_admins.sql) already cover every column, and the
-- self-service player path goes through /api/player-profile, which validates
-- (including the new entitlement check) server-side.
--
-- Idempotent: safe to re-run.

alter table public.players
  add column if not exists flag text,
  add column if not exists flag_variant text,
  add column if not exists mine_variant text;
