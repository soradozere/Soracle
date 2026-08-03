-- 028_add_demo_description.sql
--
-- Optional free-text description, editable by admins alongside title/map/
-- gametype/players. Idempotent.

begin;

alter table public.demos add column if not exists description text;

commit;
