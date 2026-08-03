-- 030_demo_comments_tags_feed.sql
--
-- Three additions to the demo library:
--
--   * comments, so a demo can be talked about on its own page
--   * highlight tags (DBS, DFA, Cap, ...), so the library can be filtered down
--     to a kind of moment rather than just a map or a month
--   * a flag controlling whether an upload announces itself on the homepage
--
-- Same authorization shape as 027: players are not Supabase Auth users, so
-- there are no player-facing write policies. Every write goes through a server
-- action on the service-role client, which checks the soracle_player cookie or
-- the admin session first. RLS only has to cover public SELECT.
--
-- Idempotent.

begin;

-- Free text against a demo, by a logged-in player.
create table if not exists public.demo_comments (
  id         uuid primary key default gen_random_uuid(),
  demo_id    uuid not null references public.demos(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 2000),
  created_at timestamptz not null default now()
);

alter table public.demo_comments enable row level security;

drop policy if exists "demo_comments_select_all" on public.demo_comments;
create policy "demo_comments_select_all" on public.demo_comments for select using (true);

create index if not exists demo_comments_demo_idx on public.demo_comments(demo_id, created_at);

-- Highlight tags. An array column rather than a join table: the vocabulary is
-- fixed in code (lib/demo-tags.ts) and validated in the upload/edit action, the
-- whole list is read on every card anyway, and the library filters client-side
-- over a few dozen rows -- a join table would buy nothing here.
alter table public.demos add column if not exists tags text[] not null default '{}';

create index if not exists demos_tags_idx on public.demos using gin (tags);

-- Whether an upload shows up in the homepage activity feed.
--
-- New demos announce themselves; the ones already in the library at the time
-- this ran were bulk-seeded from a folder of old recordings and were never
-- "news", so they are marked as already known. Wrapped in the existence check
-- so re-running the file cannot retroactively silence demos uploaded since.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'demos' and column_name = 'announce_in_feed'
  ) then
    alter table public.demos add column announce_in_feed boolean not null default true;
    update public.demos set announce_in_feed = false;
  end if;
end $$;

commit;
