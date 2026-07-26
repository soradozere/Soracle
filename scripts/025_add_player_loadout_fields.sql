-- 025_add_player_loadout_fields.sql
--
-- Rounds out the 3D model loadout started in 023/024: which skin the chosen
-- model wears, and which idle/action animation clips it plays.
--
-- Same reasoning as 023_add_player_model.sql and 024_add_player_saber.sql: an
-- id, never a path or a raw clip name. Skins resolve through
-- lib/player-models.ts (findModelSkin, checked against the player's CHOSEN
-- model — a skin id only means something paired with the model it belongs to),
-- and animation ids resolve through lib/animations.ts. All three ultimately
-- become inputs to /api/model-url or to <ModelViewer>, so a crafted value here
-- can only ever be one of these catalogues' ids or nothing.
--
-- NULL means "use the default" for skin (the model's own baked-in textures) and
-- "use the fallback" for the animations (idle-regex / random action, same as
-- before this migration existed) — so a profile set up before this column
-- existed keeps behaving exactly as it did. Unrecognised ids are treated the
-- same way, so retiring a skin or a clip can't break a profile still pointing
-- at it.
--
-- Not gated on crests: anyone can pick any skin or animation, same as the
-- model and saber columns.
--
-- No new RLS needed: the players table's admin-only write policies
-- (008_restrict_writes_to_admins.sql) already cover every column, and the
-- self-service player path goes through /api/player-profile, which validates
-- server-side.
--
-- Idempotent: safe to re-run.

alter table public.players
  add column if not exists skin text,
  add column if not exists idle_animation text,
  add column if not exists action_animation text;
