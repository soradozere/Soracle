-- 046_create_title_changes.sql
--
-- A changelog for a player's EQUIPPED title (the "Title" column on /players),
-- so the Discord bot can ping when someone changes theirs — the title-side
-- counterpart to tier_changes, which has backed the same ping for tiers since
-- before the numbered migrations.
--
-- Written from the two — and only two — places that set players.title:
--   - app/api/player-profile/route.ts     (a player equipping their own title)
--   - app/admin/player-actions.ts         (updatePlayerProfileAsAdmin)
-- Both already use the service-role client, which bypasses RLS, so no insert
-- policy is needed for the write paths below; the admin policies exist for
-- parity with player_nwh_ids (045) and for hand-correction via an admin session.
--
-- NOT backfilled, and not backfillable: nothing recorded title history before
-- this table, so a title equipped yesterday leaves no row. History starts at
-- deploy and the bot's first polls will legitimately return nothing.
--
-- Why the display strings and not just the ids: seasonal titles LAPSE out of
-- lib/titles.ts when their month rolls over, at which point catalogueTitleById
-- can no longer resolve them and an id-only row renders as nothing. Same
-- reasoning player_titles already snapshots its own title/rarity (see 020).
-- The ids are kept alongside purely so a row can be traced back to a ladder.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists public.title_changes (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players (id) on delete cascade,
  -- Denormalized so an entry is announceable without a join, matching
  -- tier_changes.player_name. scripts/009's rename helper does NOT rewrite this
  -- one; the bot route prefers the live players.name and treats this as a
  -- fallback, so a rename shows the new name rather than a stale row.
  player_name  text not null,
  -- Null on either side is meaningful: old_title null = they had no title
  -- equipped (first one), new_title null = they unequipped it entirely.
  old_title_id text,
  old_title    text,
  new_title_id text,
  new_title    text,
  -- Rarity of the NEW title, for the bot's embed colour. Null when unequipping.
  new_rarity   text check (
    new_rarity is null
    or new_rarity in ('common', 'rare', 'epic', 'legendary', 'mythic', 'oneofone')
  ),
  changed_at   timestamptz not null default now()
);

-- The only query this table has: "everything after <timestamp>, oldest first".
create index if not exists title_changes_changed_at_idx
  on public.title_changes (changed_at);

-- Fast "this player's title history", for a future profile view.
create index if not exists title_changes_player_id_idx
  on public.title_changes (player_id);

-- RLS: readable with the anon key (the bot route reads it through the
-- anon-backed server client, same as tier_changes), writes admin-only.
alter table public.title_changes enable row level security;

drop policy if exists "title_changes_select_all" on public.title_changes;
create policy "title_changes_select_all" on public.title_changes
  for select using (true);

drop policy if exists "title_changes_insert_admin" on public.title_changes;
create policy "title_changes_insert_admin" on public.title_changes
  for insert to authenticated with check (public.is_admin());

drop policy if exists "title_changes_update_admin" on public.title_changes;
create policy "title_changes_update_admin" on public.title_changes
  for update to authenticated using (public.is_admin()) with check (public.is_admin());

drop policy if exists "title_changes_delete_admin" on public.title_changes;
create policy "title_changes_delete_admin" on public.title_changes
  for delete to authenticated using (public.is_admin());

commit;
