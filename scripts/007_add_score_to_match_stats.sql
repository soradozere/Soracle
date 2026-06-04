-- Persist the in-game scoreboard score (SCORE-SUM column from the stats CSV).
-- Existing rows default to 0; only matches uploaded after this migration carry a
-- real score.
ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS score INTEGER NOT NULL DEFAULT 0;
