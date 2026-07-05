-- 014_add_profile_fields.sql
--
-- Player-profile presentation fields, editable by admins from the profile page:
--   * avatar_url    — custom avatar image (overrides the initials placeholder;
--                     also the manual fallback until in-game 3D model avatars land)
--   * spotlight_url — a Vimeo or YouTube link to the player's chosen highlight clip,
--                     rendered as a responsive embed on the profile
--
-- The slogan is NOT here — it reuses the existing players.tooltip column (the
-- Balancer tooltip), which the profile editor also writes.
--
-- No new RLS needed: the players table's admin-only write policies
-- (008_restrict_writes_to_admins.sql) already cover every column, so admins can
-- update these and nobody else can. Reads are public via players_select_all.
--
-- Idempotent: safe to re-run.

alter table public.players
  add column if not exists avatar_url text,
  add column if not exists spotlight_url text;
