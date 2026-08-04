-- 035_demo_trims.sql
--
-- What a trim replaced, and where the original went.
--
-- Trimming swaps a demo's file and copies the old one to the trash/ prefix in
-- R2, which has a 7-day expiry on it. Without this table the only record of
-- what a trash/ UUID *was* is inference -- so noticing a bad cut on day three
-- means guessing which anonymous object to restore, and after day seven there
-- is nothing to guess at.
--
-- Written on every trim, kept after the file itself expires: even once the
-- object is gone, "this demo was 2:00 and someone cut 0:54-1:02 out of it on
-- Tuesday" is the difference between a conversation and a mystery.
--
-- Idempotent.

begin;

create table if not exists public.demo_trims (
  id            uuid primary key default gen_random_uuid(),
  demo_id       uuid not null references public.demos(id) on delete cascade,
  -- The R2 key the original was moved to, under trash/. Kept as the bare
  -- filename, matching demos.file_path -- lib/r2.ts is the only thing that
  -- knows about prefixes.
  old_file_path text not null,
  new_file_path text not null,
  -- The window that was kept, in milliseconds from the original's first frame.
  start_ms      integer not null check (start_ms >= 0),
  end_ms        integer not null check (end_ms > start_ms),
  -- Length before the cut, where it was known. Null on demos that never had a
  -- duration recorded, which is most of the early library.
  old_duration_ms integer,
  trimmed_by    uuid references public.players(id) on delete set null,
  created_at    timestamptz not null default now()
);

create index if not exists demo_trims_demo_idx on public.demo_trims(demo_id, created_at desc);

-- Admin-only reading: this is an audit trail, not something a visitor needs,
-- and it names who cut what. Every write goes through a server action holding
-- the service role, which is where "may this person edit this demo" is already
-- answered.
alter table public.demo_trims enable row level security;

drop policy if exists "demo_trims_select_admin" on public.demo_trims;
create policy "demo_trims_select_admin" on public.demo_trims
  for select to authenticated using (public.is_admin());

commit;
