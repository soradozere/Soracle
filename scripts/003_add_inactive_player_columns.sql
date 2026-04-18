-- Add inactive player tracking columns to the players table
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS last_match_at TIMESTAMP WITH TIME ZONE DEFAULT NULL;
ALTER TABLE public.players ADD COLUMN IF NOT EXISTS manually_inactive BOOLEAN DEFAULT false;

-- Create index for faster inactive player queries
CREATE INDEX IF NOT EXISTS players_last_match_at_idx ON public.players(last_match_at);
CREATE INDEX IF NOT EXISTS players_manually_inactive_idx ON public.players(manually_inactive);
