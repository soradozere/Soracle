-- 042_add_tier_change_source.sql
--
-- The auto-calibrator (lib/calibration.ts) writes tier changes just like an
-- admin does, and the changelog must be able to say which is which. One column:
-- 'admin' (the default, so every existing row and every existing write path
-- keeps its meaning without code changes) or 'auto'.
--
-- tier_changes itself predates the numbered migrations (created out-of-band;
-- referenced by 008/009), hence the IF EXISTS guard.
--
-- Idempotent.

begin;

alter table if exists public.tier_changes
  add column if not exists source text not null default 'admin'
  check (source in ('admin', 'auto'));

comment on column public.tier_changes.source is
  'admin = a human changed the tier; auto = the calibrator moved it from results.';

commit;
