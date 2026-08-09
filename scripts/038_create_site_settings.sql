-- 038_create_site_settings.sql
--
-- A one-row-per-key store for small pieces of site configuration an admin needs
-- to change without a deploy. First and currently only use: the homepage's
-- featured video.
--
-- The homepage normally shows the newest upload from youtube.com/@jk2ctf, read
-- from that channel's Atom feed (lib/youtube-feed.ts). That is the right default
-- and needs no configuration -- but when a player puts a frag movie on their OWN
-- channel there is nothing for the feed to find, so an admin needs to be able to
-- pin a specific video and later hand control back to the feed. Setting
-- 'featured_video' to a video id pins it; clearing the row returns to auto.
--
-- Deliberately generic: a settings key/value table earns its keep the second
-- time it's used, and hardcoding a single-purpose "featured_video" table would
-- guarantee another migration for the next flag.
--
-- Authorization: SELECT is public (the homepage reads it anonymously, through the
-- cached anon client). Writes go through a server action on the service-role
-- client which checks the admin session first -- the same shape as every other
-- admin write in this codebase -- so there is no write policy here at all.
--
-- Idempotent.

begin;

create table if not exists public.site_settings (
  key        text primary key,
  -- Free-form text rather than jsonb: every value so far is a short scalar, and
  -- jsonb would mean quoting a bare id ('"abc123"') for no gain. A future
  -- structured setting can store JSON in here as text and parse it.
  value      text,
  updated_at timestamptz not null default now(),
  -- Who last touched it, for the audit trail admin writes elsewhere also keep.
  updated_by uuid
);

alter table public.site_settings enable row level security;

drop policy if exists "site_settings_select_all" on public.site_settings;
create policy "site_settings_select_all" on public.site_settings for select using (true);

comment on table public.site_settings is
  'Small admin-editable site configuration. Writes are service-role only, via server actions.';
comment on column public.site_settings.value is
  'NULL or absent row = feature is in its default/automatic state.';

commit;
