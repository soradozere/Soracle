-- Create players table to store all player data
create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  name text not null unique,
  tier_value integer not null default 0,
  mic boolean not null default false,
  capper_rating integer not null default 0,
  chase_rating integer not null default 0,
  camp_rating integer not null default 0,
  cleaner_rating integer not null default 0,
  support_rating integer not null default 0,
  tooltip text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now()
);

-- Enable Row Level Security
alter table public.players enable row level security;

-- Create policies for public read access (anyone can view players)
create policy "players_select_all"
  on public.players for select
  using (true);

-- Create policies for authenticated users to manage players
create policy "players_insert_authenticated"
  on public.players for insert
  to authenticated
  with check (true);

create policy "players_update_authenticated"
  on public.players for update
  to authenticated
  using (true);

create policy "players_delete_authenticated"
  on public.players for delete
  to authenticated
  using (true);

-- Create index for faster name lookups
create index if not exists players_name_idx on public.players(name);

-- Create function to update the updated_at timestamp
create or replace function public.update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

-- Create trigger to automatically update updated_at
drop trigger if exists update_players_updated_at on public.players;
create trigger update_players_updated_at
  before update on public.players
  for each row
  execute function public.update_updated_at_column();
