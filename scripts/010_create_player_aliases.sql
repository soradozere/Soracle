-- 010_create_player_aliases.sql
--
-- Known alternate in-game names for players, so the scoreboard-CSV importer can
-- resolve names that don't match a player's Soracle name directly. Two cases this
-- handles that plain fuzzy matching cannot:
--   * clan-tag variants — "{FoU} Original", "[DBD] Ewok" — though many of these are
--     also caught at parse time by the app-side normalizer (lib/name-match.ts),
--   * genuinely different names a player uses regularly — e.g. "Original" also
--     playing as "DarkJedi" — which fuzzy matching has no way to know.
--
-- Aliases are learned automatically when an admin corrects a mapping while
-- approving a pending match (source = 'learned'), or added by hand (source =
-- 'manual'). The stored alias is the raw in-game name as seen; richer matching
-- (clan-tag stripping, ^colour-code stripping, case folding) happens in the app.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists public.player_aliases (
  id         uuid primary key default gen_random_uuid(),
  player_id  uuid not null references public.players (id) on delete cascade,
  alias      text not null,
  -- 'manual'  — added by an admin in the roster tools
  -- 'learned' — captured from an admin-approved scoreboard mapping
  source     text not null default 'manual' check (source in ('manual', 'learned')),
  created_at timestamptz not null default now()
);

-- One alias resolves to at most one player: enforce global uniqueness on the
-- case- and whitespace-folded alias so the importer never has to guess between
-- two players for the same in-game name.
create unique index if not exists player_aliases_alias_unique
  on public.player_aliases (lower(btrim(alias)));

-- Fast "all aliases for this player" lookups (roster UI, approval learning).
create index if not exists player_aliases_player_id_idx
  on public.player_aliases (player_id);

-- RLS: aliases are read with the anon key (the importer/modal resolve names
-- client-side), but only admins may write. Mirrors the policy shape used for
-- players / matches / match_stats in 008_restrict_writes_to_admins.sql.
alter table public.player_aliases enable row level security;

drop policy if exists "player_aliases_select_all" on public.player_aliases;
create policy "player_aliases_select_all" on public.player_aliases
  for select using (true);

drop policy if exists "player_aliases_insert_admin" on public.player_aliases;
create policy "player_aliases_insert_admin" on public.player_aliases
  for insert to authenticated with check (public.is_admin());

drop policy if exists "player_aliases_update_admin" on public.player_aliases;
create policy "player_aliases_update_admin" on public.player_aliases
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "player_aliases_delete_admin" on public.player_aliases;
create policy "player_aliases_delete_admin" on public.player_aliases
  for delete to authenticated using (public.is_admin());

commit;
