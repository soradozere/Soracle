-- 037_create_match_kills.sql
--
-- Per-opponent kill/return breakdown for a match: one row per (killer, victim)
-- pair, as reported by TomArrow's JSON scoreboard (`playerData[].killed[]`).
--
-- Why this table exists: `match_stats.returns` counts returns a player MADE.
-- Nothing in the CSV ever recorded returns made AGAINST a player — how many
-- times they were caught carrying the flag — which is the number the top-capper
-- stat needs (caps / (caps + timesReturned)). It only exists in the JSON, so
-- this cannot be backfilled: CSV-era matches have no matrix and never will.
--
-- Written from `killed[]` only. `killedBy[]` is the same data mirrored, so
-- recording both would double-count; times-returned for a player is read as the
-- sum of `rets` where they are the VICTIM.
--
-- Idempotent: safe to re-run.

begin;

create table if not exists public.match_kills (
  id       uuid primary key default gen_random_uuid(),
  match_id uuid not null references public.matches (id) on delete cascade,

  killer_player_id uuid not null references public.players (id),
  victim_player_id uuid not null references public.players (id),

  -- Total kills of victim by killer in this match. `rets` is the SUBSET of
  -- those that were returns (the victim was carrying the flag), so rets <= kills.
  kills integer not null default 0,
  rets  integer not null default 0,

  -- Style breakdowns, straight from the JSON: {"RED": 2, "DFA": 1}. Kept as
  -- jsonb rather than columns because the key set is open — the 8 Aug export
  -- carried BLU/BLUBS/BS/DBS/DFA/IDLE/MINE/RED/TUR/UNKN/WEIRD/YEL, and TELE and
  -- others appear only when they happen.
  kill_types jsonb not null default '{}'::jsonb,
  ret_types  jsonb not null default '{}'::jsonb,

  created_at timestamptz not null default now(),

  -- A pair can only appear once per match; makes a re-approval a no-op rather
  -- than a silent doubling.
  constraint match_kills_unique_pair unique (match_id, killer_player_id, victim_player_id),
  -- Self-kills aren't a thing here: /kill credits nobody.
  constraint match_kills_not_self check (killer_player_id <> victim_player_id)
);

create index if not exists match_kills_match_id_idx on public.match_kills (match_id);
create index if not exists match_kills_killer_idx   on public.match_kills (killer_player_id);
-- The top-capper stat reads this one: sum(rets) grouped by victim.
create index if not exists match_kills_victim_idx   on public.match_kills (victim_player_id);

-- RLS mirrors match_stats: stats are public, writes are admin/service-role.
alter table public.match_kills enable row level security;

drop policy if exists "match_kills_select_all" on public.match_kills;
create policy "match_kills_select_all" on public.match_kills
  for select using (true);

drop policy if exists "match_kills_insert_authenticated" on public.match_kills;
create policy "match_kills_insert_authenticated" on public.match_kills
  for insert to authenticated with check (true);

drop policy if exists "match_kills_delete_authenticated" on public.match_kills;
create policy "match_kills_delete_authenticated" on public.match_kills
  for delete to authenticated using (true);

commit;
