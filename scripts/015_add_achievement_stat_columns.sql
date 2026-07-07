-- Achievements: two extra per-player scoreboard counters that the current CSV
-- pipeline does not yet ingest. Both back an achievement (Cheese's Dream = DFA
-- accuracy; Blocked! = enemy blocks) and are additive/forward-only: existing
-- rows stay 0, and they only start accruing once scoreboards that carry these
-- columns are uploaded. Nullable with a 0 default so old uploads are unaffected.

ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS dfa_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS blocks_enemy INTEGER NOT NULL DEFAULT 0;
