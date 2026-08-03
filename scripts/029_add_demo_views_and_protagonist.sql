-- 029_add_demo_views_and_protagonist.sql
--
-- view_count: naive per-load counter (no dedup by viewer/session) -- good
-- enough for sorting "popular" demos, not an analytics-grade metric.
-- protagonist_player_id: the one player a demo is "about", for the library
-- card's avatar treatment. Nullable -- most demos won't set one.
--
-- Idempotent.

begin;

alter table public.demos add column if not exists view_count integer not null default 0;
alter table public.demos add column if not exists protagonist_player_id uuid references public.players(id) on delete set null;

create index if not exists demos_view_count_idx on public.demos(view_count desc);

-- Atomic increment via RPC rather than a read-then-write from the app --
-- two viewers loading the same demo at once would otherwise race and one
-- view could be lost. SECURITY DEFINER so the anon/authenticated caller can
-- bump a counter without a write policy on the whole table.
create or replace function public.increment_demo_views(demo_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.demos set view_count = view_count + 1 where id = demo_id;
$$;

grant execute on function public.increment_demo_views(uuid) to anon, authenticated;

commit;
