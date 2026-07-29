-- Achievements: teleport kills ("Otherworldly" — crush an enemy into another
-- dimension). Best-effort header spelling like DFA-ATTEMPTS/BLOCKS-ENEMY
-- (migration 015) — nullable with a 0 default so existing rows and any CSV
-- build that lacks the column are unaffected.

ALTER TABLE match_stats ADD COLUMN IF NOT EXISTS tele_kills INTEGER NOT NULL DEFAULT 0;
