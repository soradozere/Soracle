-- Demo reactions, replacing the 1-5 star rating.
--
-- Stars asked the wrong question of a highlight clip. "How good is this out of
-- five" is a review; what people actually want to say about a 20-second DBS is
-- closer to "that was funny" or "how did that even happen". Six reactions, one
-- per player per demo, no ordering between them.
--
-- The 15 existing star ratings are dropped rather than mapped. A star and a
-- reaction aren't the same statement, so any mapping would be inventing an
-- opinion nobody expressed. THIS DELETES DATA and is not reversible.

drop view if exists public.demo_rating_summary;
drop table if exists public.demo_ratings;

create table if not exists public.demo_reactions (
  demo_id    uuid not null references public.demos(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  -- Constrained here as well as in the app: the summary view pivots on these
  -- exact strings, so a typo'd reaction would silently vanish from every count
  -- rather than fail loudly. Keep in sync with DEMO_REACTIONS in
  -- lib/demo-reactions.ts.
  reaction   text not null check (reaction in ('like', 'love', 'dislike', 'funny', 'wow', 'mindblown')),
  created_at timestamptz not null default now(),
  -- One reaction per player per demo. Changing your mind is an upsert on this
  -- key, not a second row.
  primary key (demo_id, player_id)
);

create index if not exists demo_reactions_demo_idx on public.demo_reactions (demo_id);

alter table public.demo_reactions enable row level security;

-- Anyone may read the counts; writes go through the service role in
-- app/(main)/demos/actions.ts, which is where the player session is verified.
drop policy if exists "demo_reactions_select_all" on public.demo_reactions;
create policy "demo_reactions_select_all" on public.demo_reactions for select using (true);

-- Live aggregate rather than denormalised columns, for the same reason the star
-- summary was a view: at this scale the join costs nothing and it can never
-- drift out of sync. One row per demo, with a count per reaction plus a total
-- for the "Most reacts" sort.
create or replace view public.demo_reaction_summary as
select
  demo_id,
  count(*)                                            as total,
  count(*) filter (where reaction = 'like')           as like_count,
  count(*) filter (where reaction = 'love')           as love_count,
  count(*) filter (where reaction = 'dislike')        as dislike_count,
  count(*) filter (where reaction = 'funny')          as funny_count,
  count(*) filter (where reaction = 'wow')            as wow_count,
  count(*) filter (where reaction = 'mindblown')      as mindblown_count
from public.demo_reactions
group by demo_id;
