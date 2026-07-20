-- Player logins: one row per player who has been issued a password by an
-- admin. Completely separate from Supabase Auth (auth.users) — players never
-- get an account in the system the admin signs into, so there's no session,
-- table, or API surface a player could use to find the admin's email or
-- reach anything auth-gated.
--
-- No RLS policies are added on purpose: the table is readable/writable only
-- by the service-role client (lib/supabase/admin.ts), which the login and
-- password-reset API routes use server-side. Neither the anon nor an
-- authenticated-admin Supabase session can touch it directly.
create table if not exists public.player_credentials (
  player_id uuid primary key references public.players(id) on delete cascade,
  password_hash text not null,
  failed_attempts int not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.player_credentials enable row level security;
