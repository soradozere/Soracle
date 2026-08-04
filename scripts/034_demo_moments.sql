-- 034_demo_moments.sql
--
-- Timestamped moments inside a demo: the dbs, the cap, the fail.
--
-- Stored as their own rows rather than as an array on demos, because they are
-- the kind of thing that gets added one at a time by whoever is watching, and
-- because a marker wants to know who put it there.
--
-- Position is milliseconds from the demo's first frame -- the same clock the
-- viewer's scrubber uses (JKD_GetElapsedTime), not the match clock, so a
-- marker lands where the timeline says it should.
--
-- Idempotent.

begin;

create table if not exists public.demo_moments (
  id          uuid primary key default gen_random_uuid(),
  demo_id     uuid not null references public.demos(id) on delete cascade,
  -- Milliseconds from the start of the recording.
  at_ms       integer not null check (at_ms >= 0),
  -- Short, optional: "double dbs", "the cap". The tag carries the category.
  label       text check (label is null or char_length(label) <= 60),
  -- Reuses the same vocabulary as demos.tags (lib/demo-tags.ts) so a moment
  -- can be coloured the same as the highlight badge it corresponds to.
  tag         text,
  created_by  uuid references public.players(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists demo_moments_demo_idx on public.demo_moments(demo_id, at_ms);

-- Public read, same as the demos they belong to; every write goes through a
-- server action holding the service role, which is where the "may this person
-- edit this demo" question is already answered.
alter table public.demo_moments enable row level security;

drop policy if exists "demo_moments_select_all" on public.demo_moments;
create policy "demo_moments_select_all" on public.demo_moments for select using (true);

commit;
