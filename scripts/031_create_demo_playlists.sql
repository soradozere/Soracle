-- 031_create_demo_playlists.sql
--
-- Curated collections of demos -- the point being a monthly highlights reel:
-- an admin picks the good clips from a month and files them under one name.
--
-- Distinct from the tags added in 030. A tag says what a demo *is* ("this is a
-- DBS clip") and every uploader can apply one; a playlist says someone chose
-- it, in an order, for a reason. Neither replaces the other.
--
-- Same authorization shape as the rest of the demo tables: no player-facing
-- write policies, every write goes through an admin-checked server action on
-- the service-role client. RLS only covers public SELECT.
--
-- Idempotent.

begin;

create table if not exists public.demo_playlists (
  id          uuid primary key default gen_random_uuid(),
  -- Stable, human-readable, and what the public URL is built from, so it is
  -- generated once at creation and never follows a later title edit.
  slug        text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  title       text not null check (char_length(btrim(title)) >= 3),
  description text,
  created_at  timestamptz not null default now()
);

alter table public.demo_playlists enable row level security;

drop policy if exists "demo_playlists_select_all" on public.demo_playlists;
create policy "demo_playlists_select_all" on public.demo_playlists for select using (true);

-- Membership. A demo may sit in several playlists (a clip can be both a
-- monthly highlight and part of a "best caps" reel), hence the composite key
-- rather than a column on demos.
create table if not exists public.demo_playlist_items (
  playlist_id uuid not null references public.demo_playlists(id) on delete cascade,
  demo_id     uuid not null references public.demos(id) on delete cascade,
  -- Curated order. Ties are broken by added_at so the list never jitters.
  position    integer not null default 0,
  added_at    timestamptz not null default now(),
  primary key (playlist_id, demo_id)
);

alter table public.demo_playlist_items enable row level security;

drop policy if exists "demo_playlist_items_select_all" on public.demo_playlist_items;
create policy "demo_playlist_items_select_all" on public.demo_playlist_items for select using (true);

create index if not exists demo_playlist_items_demo_idx on public.demo_playlist_items(demo_id);
create index if not exists demo_playlist_items_order_idx on public.demo_playlist_items(playlist_id, position, added_at);

commit;
