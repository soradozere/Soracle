-- 025_add_player_saber.sql
--
-- The lightsaber blade colour shown in a player's hand on their 3D model.
-- Stores a short colour id — e.g. 'blue' — from the catalogue in
-- lib/saber-colours.ts.
--
-- Same reasoning as 024_add_player_model.sql: an id, never a path. The blade
-- textures live in the PRIVATE Supabase Storage bucket and are served through
-- short-lived signed URLs from /api/model-url, which only signs ids it can find
-- in a catalogue. A stored path would hand that guarantee away.
--
-- NULL means "no saber" — the model renders unarmed. Unrecognised ids are
-- treated the same way, so retiring a colour can't break profiles still
-- pointing at it. The colour is also ignored on a model with no bolt points
-- baked in (see docs/jk2-model-conversion.md §7), which is the other way a
-- saber can quietly not appear.
--
-- Not gated on crests: anyone can pick any colour, same as the model itself.
--
-- No new RLS needed: the players table's admin-only write policies
-- (008_restrict_writes_to_admins.sql) already cover every column, and the
-- self-service player path goes through /api/player-profile, which validates
-- server-side.
--
-- Idempotent: safe to re-run.

alter table public.players
  add column if not exists saber text;
