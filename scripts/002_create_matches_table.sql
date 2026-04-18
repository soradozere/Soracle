-- Create matches table for match history logging
CREATE TABLE IF NOT EXISTS matches (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  red_team TEXT[] NOT NULL,
  blue_team TEXT[] NOT NULL,
  red_score INTEGER NOT NULL,
  blue_score INTEGER NOT NULL,
  match_type TEXT NOT NULL,
  balance_confidence INTEGER,
  notes TEXT
);

-- Enable Row Level Security
ALTER TABLE matches ENABLE ROW LEVEL SECURITY;

-- SELECT: Allow for all users (match history is public)
CREATE POLICY "matches_select_all" ON matches
  FOR SELECT
  USING (true);

-- INSERT: Admin only (authenticated users)
CREATE POLICY "matches_insert_authenticated" ON matches
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- UPDATE: Admin only (authenticated users)
CREATE POLICY "matches_update_authenticated" ON matches
  FOR UPDATE
  TO authenticated
  USING (true)
  WITH CHECK (true);

-- DELETE: Admin only (authenticated users)
CREATE POLICY "matches_delete_authenticated" ON matches
  FOR DELETE
  TO authenticated
  USING (true);

-- Create index for faster queries on created_at (for pagination)
CREATE INDEX IF NOT EXISTS matches_created_at_idx ON matches(created_at DESC);
