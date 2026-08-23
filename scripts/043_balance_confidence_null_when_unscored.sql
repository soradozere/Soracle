-- 043_balance_confidence_null_when_unscored.sql
--
-- matches.balance_confidence holds the balancer's raw evaluator score, where
-- LOWER IS BETTER and 0 is the value of a flawless split. Every code path that
-- logged a match WITHOUT running the balancer -- hand-picked games, reviewed
-- scoreboards, approved bot uploads -- wrote a literal 0 to mean "not
-- applicable", which on that scale reads as "perfectly balanced".
--
-- Nothing renders the column today, so no board has been showing a wrong
-- figure, but the spreadsheet export dumps it and any future reader would
-- inherit the lie. The write paths now send NULL (see the components listed
-- above and app/admin/actions.ts); this backfills the rows already stored.
--
-- Safe because 0 has only ever meant "no score captured": across the history at
-- the time of writing, the lowest score a real balancer run ever produced was
-- 16, and a genuine 0 would require every weighted penalty term to land exactly
-- on zero at once. Even in that case NULL ("unknown") is a far smaller error
-- than 100% ("flawless").
--
-- 119 rows at time of writing (93 manual, 26 algorithm). Idempotent.

begin;

-- The write paths now send NULL, so the column must accept it. No-op if it is
-- already nullable.
alter table if exists public.matches
  alter column balance_confidence drop not null;

update public.matches
  set balance_confidence = null
  where balance_confidence = 0;

comment on column public.matches.balance_confidence is
  'Raw balancer evaluator score (LOWER IS BETTER, unbounded above); NULL when no '
  'balancer ran. Never 0 for "unknown" -- 0 is a real score meaning a flawless '
  'split. Convert to the displayed percentage with balanceConfidencePct() in '
  'lib/balance-confidence.ts.';

commit;
