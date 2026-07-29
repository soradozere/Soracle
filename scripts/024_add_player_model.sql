-- 024_add_player_model.sql
--
-- The JK2 3D player model shown on a player's profile (and, later, the homepage
-- panel). Stores a short model id — e.g. 'kyle' — not a URL or a file path.
--
-- Why an id rather than a path: the .glb files live in a PRIVATE Supabase
-- Storage bucket and are served through short-lived signed URLs minted by
-- /api/model-url. That route only signs ids it can find in the catalogue in
-- lib/player-models.ts, so a crafted value here can never be turned into a
-- reference to some other object in the bucket. A stored path would hand that
-- guarantee away.
--
-- NULL means "no model chosen" — the profile just doesn't render the panel.
-- Unrecognised ids are treated the same way, so retiring a model can't break
-- profiles that still point at it.
--
-- No new RLS needed: the players table's admin-only write policies
-- (008_restrict_writes_to_admins.sql) already cover every column, and the
-- self-service player path goes through /api/player-profile, which validates
-- server-side. Reads are public via players_select_all.
--
-- Idempotent: safe to re-run.

alter table public.players
  add column if not exists model text;
