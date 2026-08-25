-- 045_create_player_nwh_ids.sql
--
-- TomArrow's JSON scoreboard export carries a per-player `nwhIdInfo.nwhId` —
-- a persistent player identity that survives across matches, unlike the
-- per-session `guid` the kill matrix uses (037). This table stores confirmed
-- nwh_id -> player mappings so the importer can resolve a returning player
-- even when their display name is unrecognizable (JK2 players fake names).
--
-- Learned automatically when an admin approves a pending match: the nwh_id
-- from that match's JSON is paired with whatever player_id the admin
-- confirmed for that row (see learnNwhIdsFromApproval, app/admin/actions.ts).
-- There is no manual-add path in this pass — unlike player_aliases, which has
-- a 'manual' source for hand-added entries via roster tools, nwh_id mappings
-- are only ever learned. A genuine conflict (nwh_id claimed by two different
-- players) is left for direct DB correction; it should be rare.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists public.player_nwh_ids (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players (id) on delete cascade,
  nwh_id     text not null,
  -- 'learned' only for now — captured from an admin-approved scoreboard
  -- mapping. No manual-add UI exists yet (see note above).
  source     text not null default 'learned' check (source in ('learned')),
  created_at timestamptz not null default now()
);

-- One nwh_id resolves to at most one player. Unlike player_aliases_alias_unique,
-- this is NOT case-folded: nwh_id is a fixed-case hex string straight from
-- TomArrow's export (e.g. "69aa28d6"), never hand-typed or subject to the
-- casing drift a human-entered name would have.
create unique index if not exists player_nwh_ids_nwh_id_unique
  on public.player_nwh_ids (nwh_id);

-- Fast "all nwh ids for this player" lookups.
create index if not exists player_nwh_ids_player_id_idx
  on public.player_nwh_ids (player_id);

-- RLS: read with the anon key (the importer/review screen resolve names
-- client-side), write restricted to admins. Mirrors player_aliases (010).
alter table public.player_nwh_ids enable row level security;

drop policy if exists "player_nwh_ids_select_all" on public.player_nwh_ids;
create policy "player_nwh_ids_select_all" on public.player_nwh_ids
  for select using (true);

drop policy if exists "player_nwh_ids_insert_admin" on public.player_nwh_ids;
create policy "player_nwh_ids_insert_admin" on public.player_nwh_ids
  for insert to authenticated with check (public.is_admin());

drop policy if exists "player_nwh_ids_update_admin" on public.player_nwh_ids;
create policy "player_nwh_ids_update_admin" on public.player_nwh_ids
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "player_nwh_ids_delete_admin" on public.player_nwh_ids;
create policy "player_nwh_ids_delete_admin" on public.player_nwh_ids
  for delete to authenticated using (public.is_admin());

commit;
