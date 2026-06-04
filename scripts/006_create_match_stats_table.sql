-- Create match_stats table for per-player match statistics (CSV upload)
CREATE TABLE IF NOT EXISTS match_stats (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  match_id UUID NOT NULL REFERENCES matches(id) ON DELETE CASCADE,
  player_id UUID NOT NULL REFERENCES players(id),
  team TEXT NOT NULL CHECK (team IN ('Red', 'Blue')),
  played_partial BOOLEAN NOT NULL DEFAULT false,

  -- Flag stats
  captures INTEGER NOT NULL DEFAULT 0,
  returns INTEGER NOT NULL DEFAULT 0,
  base_cleaner INTEGER NOT NULL DEFAULT 0,
  assists INTEGER NOT NULL DEFAULT 0,
  flag_grabs INTEGER NOT NULL DEFAULT 0,
  flag_hold_ms BIGINT NOT NULL DEFAULT 0,

  -- Combat
  kills INTEGER NOT NULL DEFAULT 0,
  deaths INTEGER NOT NULL DEFAULT 0,

  -- Saber kills
  red_kills INTEGER NOT NULL DEFAULT 0,
  yellow_kills INTEGER NOT NULL DEFAULT 0,
  blue_kills INTEGER NOT NULL DEFAULT 0,
  dfa_kills INTEGER NOT NULL DEFAULT 0,
  ydfa_kills INTEGER NOT NULL DEFAULT 0,
  bs_kills INTEGER NOT NULL DEFAULT 0,
  dbs_kills INTEGER NOT NULL DEFAULT 0,
  blubs_kills INTEGER NOT NULL DEFAULT 0,
  upcut_kills INTEGER NOT NULL DEFAULT 0,

  -- Saber returns
  red_returns INTEGER NOT NULL DEFAULT 0,
  yellow_returns INTEGER NOT NULL DEFAULT 0,
  blue_returns INTEGER NOT NULL DEFAULT 0,
  dfa_returns INTEGER NOT NULL DEFAULT 0,
  ydfa_returns INTEGER NOT NULL DEFAULT 0,
  bs_returns INTEGER NOT NULL DEFAULT 0,
  dbs_returns INTEGER NOT NULL DEFAULT 0,
  blubs_returns INTEGER NOT NULL DEFAULT 0,
  upcut_returns INTEGER NOT NULL DEFAULT 0,

  -- Other kill types
  mine_kills INTEGER NOT NULL DEFAULT 0,
  mine_returns INTEGER NOT NULL DEFAULT 0,
  doom_kills INTEGER NOT NULL DEFAULT 0,
  turret_kills INTEGER NOT NULL DEFAULT 0,
  idle_kills INTEGER NOT NULL DEFAULT 0,

  -- Mines
  mine_grabs_red INTEGER NOT NULL DEFAULT 0,
  mine_grabs_blue INTEGER NOT NULL DEFAULT 0,

  -- Network
  time_played INTEGER,

  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
);

-- Indexes for lookups by match and by player
CREATE INDEX IF NOT EXISTS match_stats_match_id_idx ON match_stats(match_id);
CREATE INDEX IF NOT EXISTS match_stats_player_id_idx ON match_stats(player_id);

-- Enable Row Level Security
ALTER TABLE match_stats ENABLE ROW LEVEL SECURITY;

-- SELECT: Allow for all users (stats are public)
DROP POLICY IF EXISTS "match_stats_select_all" ON match_stats;
CREATE POLICY "match_stats_select_all" ON match_stats
  FOR SELECT
  USING (true);

-- INSERT: Admin only (authenticated users)
DROP POLICY IF EXISTS "match_stats_insert_authenticated" ON match_stats;
CREATE POLICY "match_stats_insert_authenticated" ON match_stats
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE: Admin only (authenticated users)
DROP POLICY IF EXISTS "match_stats_update_authenticated" ON match_stats;
CREATE POLICY "match_stats_update_authenticated" ON match_stats
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- DELETE: Admin only (authenticated users)
DROP POLICY IF EXISTS "match_stats_delete_authenticated" ON match_stats;
CREATE POLICY "match_stats_delete_authenticated" ON match_stats
  FOR DELETE
  TO authenticated
  USING (true);

-- Add stats-related columns to matches
ALTER TABLE matches ADD COLUMN IF NOT EXISTS stats_csv_uploaded_at TIMESTAMPTZ;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS match_played_at TIMESTAMPTZ;
