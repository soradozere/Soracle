-- 027_create_demos_tables.sql
--
-- Public demo library: recorded .dm_15 matches, watchable in the browser demo
-- viewer (components/demo-viewer.tsx), browsable via a searchable grid
-- instead of a hand-typed ?demo= URL.
--
-- Players are never Supabase Auth users (lib/player-auth.ts is a separate
-- HMAC-signed cookie session, see player_credentials), so -- same as that
-- table -- there are no player-facing INSERT/UPDATE/DELETE policies here.
-- Every write (upload, rating, tagging) goes through a server action using
-- the service-role client, which checks the soracle_player cookie or the
-- admin session itself before writing. RLS only needs to cover public SELECT.
--
-- Idempotent.

begin;

create table if not exists public.demos (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(title) >= 3),
  map text not null,
  gametype text not null check (gametype in ('CTF', 'FFA', 'TeamFFA')),
  recorded_at date,

  -- Nullable: an admin-seeded demo may have no specific uploader. `source`
  -- mirrors pending_matches's provenance flag -- distinguishes "an admin
  -- added this" from "a player published it themselves" without a fake
  -- player row.
  uploader_player_id uuid references public.players(id) on delete set null,
  source text not null default 'player_upload' check (source in ('player_upload', 'admin')),

  -- Storage object key in the 'demos' bucket, not a full URL -- resolved via
  -- supabase.storage.from('demos').getPublicUrl() so nothing here hardcodes
  -- the project URL. Provisional: likely moves to Cloudflare/R2 later: only
  -- this column and the upload/read call sites would need to change.
  file_path text not null,
  file_size_bytes bigint,
  duration_ms integer,

  created_at timestamptz not null default now()
);

alter table public.demos enable row level security;

drop policy if exists "demos_select_all" on public.demos;
create policy "demos_select_all" on public.demos for select using (true);

create index if not exists demos_map_idx on public.demos(map);
create index if not exists demos_gametype_idx on public.demos(gametype);
create index if not exists demos_created_at_idx on public.demos(created_at desc);

-- Registered Soracle players tagged as appearing in a demo.
create table if not exists public.demo_players (
  demo_id   uuid not null references public.demos(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  primary key (demo_id, player_id)
);

alter table public.demo_players enable row level security;

drop policy if exists "demo_players_select_all" on public.demo_players;
create policy "demo_players_select_all" on public.demo_players for select using (true);

create index if not exists demo_players_player_idx on public.demo_players(player_id);

-- One rating per (demo, player); re-rating is an upsert on this key rather
-- than a second row.
create table if not exists public.demo_ratings (
  demo_id    uuid not null references public.demos(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  rating     smallint not null check (rating between 1 and 5),
  created_at timestamptz not null default now(),
  primary key (demo_id, player_id)
);

alter table public.demo_ratings enable row level security;

drop policy if exists "demo_ratings_select_all" on public.demo_ratings;
create policy "demo_ratings_select_all" on public.demo_ratings for select using (true);

-- Live aggregate rather than a denormalized column + trigger: at this scale
-- (a browse page listing dozens of demos) the join costs nothing, and it can
-- never drift out of sync with demo_ratings the way a cached column could.
create or replace view public.demo_rating_summary as
select demo_id, round(avg(rating)::numeric, 2) as avg_rating, count(*) as rating_count
from public.demo_ratings
group by demo_id;

-- Public bucket for the .dm_15 files. Public (unlike pending-scoreboards,
-- which is private) because the engine already fetches a demo by plain URL
-- client-side, and a match recording isn't the sensitive asset here -- the
-- game data is, and that's served from a separate origin entirely (see
-- NEXT_PUBLIC_DEMO_ENGINE_URL), never through this bucket.
insert into storage.buckets (id, name, public)
values ('demos', 'demos', true)
on conflict (id) do nothing;

commit;
