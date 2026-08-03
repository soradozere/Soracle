-- 032_dedupe_demo_views.sql
--
-- Make a view count mean something.
--
-- 029 incremented a counter on every render of the demo page, so a refresh
-- counted, a bot counted, and an afternoon of development counted several
-- hundred times. This replaces that with one row per (demo, viewer, day):
-- re-watching tomorrow counts again, hammering refresh today does not.
--
-- The viewer key is an opaque id from a cookie the app sets -- not an IP, not
-- a fingerprint. It identifies a browser well enough to deduplicate and
-- nothing else, which is all a view count needs.
--
-- Idempotent, including the reset of the old inflated numbers.

begin;

create table if not exists public.demo_views (
  demo_id    uuid not null references public.demos(id) on delete cascade,
  viewer_key text not null,
  -- Deliberately a date, not a timestamp: the primary key is the dedupe rule,
  -- so "one view per viewer per day" is enforced by the key itself rather than
  -- by a query that has to remember the window.
  viewed_on  date not null default (now() at time zone 'utc')::date,
  primary key (demo_id, viewer_key, viewed_on)
);

-- No policies at all: nothing public reads this, and only the server action
-- (service role, which bypasses RLS) writes it. Enabling RLS with no policy is
-- how a table says "not through PostgREST".
alter table public.demo_views enable row level security;

create index if not exists demo_views_demo_idx on public.demo_views(demo_id);

-- Records a view and reports whether it was a new one. demos.view_count stays
-- a denormalized counter -- the library sorts by it, and counting rows on
-- every card would be a join per demo for a number nobody needs to the second.
create or replace function public.record_demo_view(p_demo_id uuid, p_viewer_key text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  inserted integer;
begin
  insert into public.demo_views (demo_id, viewer_key)
  values (p_demo_id, p_viewer_key)
  on conflict do nothing;

  get diagnostics inserted = row_count;
  if inserted = 0 then
    return false;
  end if;

  update public.demos set view_count = view_count + 1 where id = p_demo_id;
  return true;
end;
$$;

-- The old entry point counted page loads and was callable by anyone holding
-- the public key. Both of those are the bug, so it goes.
drop function if exists public.increment_demo_views(uuid);

-- Existing counts are not salvageable -- they are mostly development reloads,
-- with no record of who viewed what to rebuild from. Zeroed once, on the way
-- in, so re-running this file cannot wipe counts accumulated since.
do $$
begin
  if not exists (select 1 from public.demo_views) then
    update public.demos set view_count = 0 where view_count <> 0;
  end if;
end $$;

commit;
