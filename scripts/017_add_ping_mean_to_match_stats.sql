-- Average ping for the match (scoreboard's PING-MEAN column), added to the CSV
-- pipeline to back the Amor Special secret achievement (avg ping > score).
-- Column already exists live (added out-of-band); this just brings the schema
-- history in the repo up to date. Nullable: every row before this ships is 0
-- because the parser never wrote it, and NULL (not 0, a real reading) is what
-- "no data yet" should mean here.

ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS ping_mean NUMERIC;
