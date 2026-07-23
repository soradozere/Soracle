-- Widen the profile_theme allowlist for the full-palette themes.
--
-- Migration 018 added a CHECK constraint restricting profile_theme to the four
-- original accent themes (green/blue/purple/gold) as a typo-guard against writing
-- an unrenderable theme. The new full-palette themes (sith/void/nebula/mandalore/
-- hoth/coruscant) are also valid values now, so the admin's direct write to
-- players.profile_theme was failing the old constraint.
--
-- Keep this list in sync with the theme ids in lib/titles.ts (THEMES). Entitlement
-- is still enforced in the app, not here: this only guards against a typo writing a
-- theme that has no renderer. (Whether a given player may WEAR a theme is checked at
-- render/save time from unlockedThemes(); the preview themes are admin-only there.)

alter table public.players
  drop constraint if exists players_profile_theme_check;
alter table public.players
  add constraint players_profile_theme_check
  check (
    profile_theme is null
    or profile_theme in (
      'green', 'blue', 'purple', 'gold',
      'sith', 'void', 'nebula', 'mandalore', 'hoth', 'coruscant',
      'bespin', 'geometry', 'slicer', 'hacker'
    )
  );
