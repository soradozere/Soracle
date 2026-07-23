-- Add the 'nostalgia' image-background theme to the profile_theme allowlist.
--
-- Migration 021 widened players_profile_theme_check for the ten full-palette themes.
-- 'nostalgia' is a new image-background theme (lib/titles.ts → THEMES), so re-add the
-- constraint with it included. Kept as its own migration because 021 is already
-- applied in the live envs — editing 021 in place would not re-run there.
--
-- Keep this list in sync with the theme ids in lib/titles.ts (THEMES). Entitlement is
-- still enforced in the app (unlockedThemes / admin preview), not here: this only
-- guards against a typo writing a theme id that has no renderer.

alter table public.players
  drop constraint if exists players_profile_theme_check;
alter table public.players
  add constraint players_profile_theme_check
  check (
    profile_theme is null
    or profile_theme in (
      'green', 'blue', 'purple', 'gold',
      'sith', 'void', 'nebula', 'mandalore', 'hoth', 'coruscant',
      'bespin', 'geometry', 'slicer', 'hacker', 'nostalgia'
    )
  );
