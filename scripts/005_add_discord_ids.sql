-- Add Discord user IDs to players in preparation for the Discord bot integration.
-- A player may have multiple Discord IDs, but a given Discord ID must map to at
-- most one player so the bot can resolve a queued Discord user to a single player.
--
-- Stored as text[] (not bigint[]) because Discord snowflake IDs are 17-19 digit
-- numbers that exceed the JavaScript / JSON safe integer range and must be
-- handled as strings everywhere.
alter table public.players
  add column if not exists discord_ids text[] not null default '{}';

-- GIN index for fast "which player owns this Discord ID" lookups, e.g.
--   select * from public.players where discord_ids @> array['198765432109876543'];
create index if not exists players_discord_ids_idx
  on public.players using gin (discord_ids);

-- Enforce cross-player uniqueness of Discord IDs at the database level.
-- (A simple unique constraint can't cover individual elements of an array, so we
-- use a trigger that rejects any insert/update whose discord_ids overlap another
-- player's. This is the hard guarantee; the Admin Panel and CSV import also check
-- up front to give friendlier error messages.)
create or replace function public.check_discord_ids_unique()
returns trigger as $$
declare
  conflict_name text;
begin
  if new.discord_ids is null or array_length(new.discord_ids, 1) is null then
    return new;
  end if;

  select p.name into conflict_name
  from public.players p
  where p.id <> new.id
    and p.discord_ids && new.discord_ids
  limit 1;

  if conflict_name is not null then
    raise exception 'Discord ID already assigned to player %', conflict_name
      using errcode = 'unique_violation';
  end if;

  return new;
end;
$$ language plpgsql;

drop trigger if exists players_discord_ids_unique on public.players;
create trigger players_discord_ids_unique
  before insert or update on public.players
  for each row
  execute function public.check_discord_ids_unique();
