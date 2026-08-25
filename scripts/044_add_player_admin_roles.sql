-- Attach an admin-equivalent role directly to a player's existing login,
-- instead of requiring a separate Supabase Auth account for someone who's
-- already a player here. 'full_admin' has the same access as a Supabase-Auth
-- admin; 'captain' mirrors the existing match_admins scope; 'player' is the
-- default (no elevation). Checked entirely in application code
-- (lib/player-role.ts) -- never in RLS, since player_credentials has no RLS
-- policies of its own (service-role only, per 019_add_player_credentials.sql).
alter table public.player_credentials
  add column if not exists role text not null default 'player';

alter table public.player_credentials
  drop constraint if exists player_credentials_role_check;
alter table public.player_credentials
  add constraint player_credentials_role_check
  check (role in ('player', 'captain', 'full_admin'));

-- Per-person audit for pending-match review actions taken by a player-login
-- captain/full-admin: reviewed_by has a hard FK to auth.users, which a
-- promoted player has no row in, so it can't be reused for them. Nullable,
-- parallel column -- exactly one of reviewed_by / reviewed_by_player_id is
-- set per row, never both.
alter table public.pending_matches
  add column if not exists reviewed_by_player_id uuid references public.players (id);
