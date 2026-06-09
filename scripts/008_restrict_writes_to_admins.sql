-- 008_restrict_writes_to_admins.sql
--
-- Closes the "any signed-in user is an admin" hole. Before this migration, every write
-- policy on players / matches / match_stats / tier_changes granted INSERT/UPDATE/DELETE to
-- the `authenticated` role with `using (true)` — so anyone who signed up could wipe the
-- roster and match history via the anon-key PostgREST API.
--
-- After this migration:
--   * SELECT stays public (the app reads everything with the anon key).
--   * INSERT / UPDATE / DELETE require membership in the new `public.admins` allowlist.
--
-- Run this in the Supabase SQL editor (it executes as a privileged role). It is idempotent
-- and drops ALL existing policies on each table by name before recreating them, so any
-- old/renamed permissive policies are removed too — no guessing leftover policy names.
--
-- AFTER running this, also disable public sign-up:
--   Dashboard -> Authentication -> Sign In / Providers -> "Allow new users to sign up" = OFF
-- RLS protects the data; turning off sign-up stops new accounts being minted at all.

begin;

-- 1. Allowlist of admin users, keyed by their auth.users id.
create table if not exists public.admins (
  user_id uuid primary key references auth.users (id) on delete cascade,
  note    text,
  created_at timestamptz not null default now()
);

-- Lock the table down: enable RLS and add NO write policies, so the table can only be
-- modified via SQL editor / service role — never through the anon or authenticated APIs.
-- Authenticated users may read it (handy if you ever surface "am I admin" from the row),
-- but cannot add themselves.
alter table public.admins enable row level security;

drop policy if exists "admins_select_authenticated" on public.admins;
create policy "admins_select_authenticated" on public.admins
  for select to authenticated using (true);

-- 2. Helper: is the current request an admin?
-- SECURITY DEFINER so it can read public.admins regardless of the caller's RLS context.
-- Returns false for anon (auth.uid() is null).
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.admins a where a.user_id = auth.uid()
  );
$$;

grant execute on function public.is_admin() to anon, authenticated;

-- 3. Reset and recreate policies on each protected table.
-- For every table: drop ALL existing policies, then add public SELECT + admin-only writes.
do $$
declare
  tbl  text;
  pol  record;
begin
  foreach tbl in array array['players', 'matches', 'match_stats', 'tier_changes']
  loop
    -- Skip tables that don't exist in this project (defensive).
    if to_regclass('public.' || tbl) is null then
      continue;
    end if;

    -- Make sure RLS is on (it is a no-op if already enabled).
    execute format('alter table public.%I enable row level security', tbl);

    -- Drop every existing policy on the table so no permissive leftover survives.
    for pol in
      select policyname from pg_policies
      where schemaname = 'public' and tablename = tbl
    loop
      execute format('drop policy if exists %I on public.%I', pol.policyname, tbl);
    end loop;

    -- Public read.
    execute format(
      'create policy %I on public.%I for select using (true)',
      tbl || '_select_all', tbl
    );

    -- Admin-only writes.
    execute format(
      'create policy %I on public.%I for insert to authenticated with check (public.is_admin())',
      tbl || '_insert_admin', tbl
    );
    execute format(
      'create policy %I on public.%I for update to authenticated using (public.is_admin()) with check (public.is_admin())',
      tbl || '_update_admin', tbl
    );
    execute format(
      'create policy %I on public.%I for delete to authenticated using (public.is_admin())',
      tbl || '_delete_admin', tbl
    );
  end loop;
end $$;

commit;

-- 4. Seed your admin account(s). Run AFTER the block above, replacing the email with the
-- address you log into Soracle with. Re-runnable: on conflict it does nothing.
--
-- insert into public.admins (user_id, note)
-- select id, 'first admin'
-- from auth.users
-- where email = 'you@example.com'
-- on conflict (user_id) do nothing;
--
-- Verify the allowlist:
--   select a.user_id, u.email, a.note from public.admins a join auth.users u on u.id = a.user_id;
