-- 013_create_match_admins.sql
--
-- A scoped "Match Admin" role (e.g. team captains) who may approve/log/edit/delete
-- matches but nothing else — no roster edits, tier changes, settings, or admin
-- panel access.
--
-- Security model: this role grants NO direct table permissions. Every match write
-- still happens server-side through the match actions, which check
-- can_log_matches() and then perform the write with the service role. So a match
-- admin can do exactly what those actions allow and nothing more, even via the
-- raw API. Table RLS stays admin-only and is untouched.
--
-- Idempotent.

begin;

-- Allowlist of match admins, keyed by auth.users id (like public.admins). Locked
-- down to SQL/service-role writes; authenticated users may read it to self-check.
create table if not exists public.match_admins (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

alter table public.match_admins enable row level security;

drop policy if exists "match_admins_select_authenticated" on public.match_admins;
create policy "match_admins_select_authenticated" on public.match_admins
  for select to authenticated using (true);

-- Is the current request a match admin? SECURITY DEFINER so it can read the
-- allowlist regardless of caller RLS. False for anon.
create or replace function public.is_match_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.match_admins a where a.user_id = auth.uid()
  );
$$;

grant execute on function public.is_match_admin() to anon, authenticated;

-- Combined predicate used by the match actions: a full admin OR a match admin.
create or replace function public.can_log_matches()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_admin() or public.is_match_admin();
$$;

grant execute on function public.can_log_matches() to anon, authenticated;

commit;

-- Seed the shared "captains" account AFTER creating it in the dashboard
-- (Authentication -> Users -> Add user, e.g. captains@soracle.local). Re-runnable.
--
-- insert into public.match_admins (user_id, note)
-- select id, 'captains shared login'
-- from auth.users
-- where email = 'captains@soracle.local'
-- on conflict (user_id) do nothing;
