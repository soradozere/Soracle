-- Add tier snapshot columns to matches table
ALTER TABLE matches ADD COLUMN IF NOT EXISTS red_tiers INTEGER[] DEFAULT NULL;
ALTER TABLE matches ADD COLUMN IF NOT EXISTS blue_tiers INTEGER[] DEFAULT NULL;
