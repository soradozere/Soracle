import { findAchievementDef, type Rarity } from "@/lib/achievement-meta"

// The title catalogue. Titles are a progression axis of their own, sitting on top
// of the crests rather than mirroring them: their conditions read off the
// Achievement Score, the monthly badges, and the month's scoreboard total.
//
// Two shapes live here:
//
//  * PERMANENT ladders — once cleared, kept. Achievement Score only ever rises,
//    so these never need revoking.
//  * SEASONAL ladders — one per calendar month, on a theme, run off that month's
//    in-game score. The theme changes, so a season's titles must be RECORDED when
//    the month closes; they cannot be recomputed from a later catalogue.
//
// Thresholds are the tuned-against-real-data values from titles-catalogue.csv.
// Retuning is expected — treat that sheet as the source and this as its output.

export interface TitleTier {
  id: string
  title: string
  threshold: number
  rarity: Rarity
}

export interface TitleLadder {
  id: string
  label: string
  metric: "achievement_score" | "month_score"
  tiers: TitleTier[]
}

// Ranked by lifetime Achievement Score. Aspirational on purpose: the highest
// score in the game is currently 170, so the top two are unclaimed and will stay
// that way for a while.
export const SCORE_LADDER: TitleLadder = {
  id: "score",
  label: "Achievement Score",
  metric: "achievement_score",
  tiers: [
    { id: "decorated", title: "Decorated", threshold: 50, rarity: "common" },
    { id: "distinguished", title: "Distinguished", threshold: 100, rarity: "rare" },
    { id: "illustrious", title: "Illustrious", threshold: 200, rarity: "epic" },
    { id: "jk2-god", title: "JK2 God", threshold: 350, rarity: "legendary" },
  ],
}

// A season is a calendar month. Keyed "YYYY-MM"; the month with no entry simply
// has no seasonal ladder, which is the correct behaviour for a month whose theme
// hasn't been set yet.
export interface Season {
  key: string
  name: string
  ladder: TitleLadder
}

export const SEASONS: Record<string, Season> = {
  "2026-07": {
    key: "2026-07",
    name: "The Odyssey",
    ladder: {
      id: "s2026-07",
      label: "The Odyssey",
      metric: "month_score",
      tiers: [
        { id: "ithacan", title: "Ithacan", threshold: 5000, rarity: "common" },
        { id: "philosopher", title: "Philosopher", threshold: 12500, rarity: "rare" },
        { id: "agamemnon", title: "Agamemnon", threshold: 20000, rarity: "epic" },
        { id: "achilles", title: "Achilles", threshold: 27500, rarity: "legendary" },
        { id: "odysseus", title: "Odysseus", threshold: 35000, rarity: "mythic" },
      ],
    },
  },

  // Scaffolds for the next three months, thresholds pre-filled from July's
  // calibration. Swap `name` and the five `title`s for the month's theme; keep
  // each `id` unique across ALL seasons — an id is what a banked title is keyed
  // on in player_titles, so reusing one would collide with a past winner.
  // A month left as-is still works; it just runs under a placeholder name.
  "2026-08": {
    key: "2026-08",
    name: "Season 2 — TBC",
    ladder: {
      id: "s2026-08",
      label: "Season 2 — TBC",
      metric: "month_score",
      tiers: [
        { id: "s2026-08-1", title: "Tier One", threshold: 5000, rarity: "common" },
        { id: "s2026-08-2", title: "Tier Two", threshold: 12500, rarity: "rare" },
        { id: "s2026-08-3", title: "Tier Three", threshold: 20000, rarity: "epic" },
        { id: "s2026-08-4", title: "Tier Four", threshold: 27500, rarity: "legendary" },
        { id: "s2026-08-5", title: "Tier Five", threshold: 35000, rarity: "mythic" },
      ],
    },
  },
  "2026-09": {
    key: "2026-09",
    name: "Season 3 — TBC",
    ladder: {
      id: "s2026-09",
      label: "Season 3 — TBC",
      metric: "month_score",
      tiers: [
        { id: "s2026-09-1", title: "Tier One", threshold: 5000, rarity: "common" },
        { id: "s2026-09-2", title: "Tier Two", threshold: 12500, rarity: "rare" },
        { id: "s2026-09-3", title: "Tier Three", threshold: 20000, rarity: "epic" },
        { id: "s2026-09-4", title: "Tier Four", threshold: 27500, rarity: "legendary" },
        { id: "s2026-09-5", title: "Tier Five", threshold: 35000, rarity: "mythic" },
      ],
    },
  },
  "2026-10": {
    key: "2026-10",
    name: "Season 4 — TBC",
    ladder: {
      id: "s2026-10",
      label: "Season 4 — TBC",
      metric: "month_score",
      tiers: [
        { id: "s2026-10-1", title: "Tier One", threshold: 5000, rarity: "common" },
        { id: "s2026-10-2", title: "Tier Two", threshold: 12500, rarity: "rare" },
        { id: "s2026-10-3", title: "Tier Three", threshold: 20000, rarity: "epic" },
        { id: "s2026-10-4", title: "Tier Four", threshold: 27500, rarity: "legendary" },
        { id: "s2026-10-5", title: "Tier Five", threshold: 35000, rarity: "mythic" },
      ],
    },
  },
}

export const seasonFor = (iso: string): Season | null => SEASONS[iso.slice(0, 7)] ?? null

export interface LadderProgress {
  earned: TitleTier[]
  current: TitleTier | null // highest cleared
  next: TitleTier | null // null once the ladder is topped out
  value: number
  // 0..1 across the WHOLE ladder, so the bar reads as one journey rather than
  // resetting at each tier.
  pct: number
}

// ---------------------------------------------------------------------------
// Profile themes
// ---------------------------------------------------------------------------

// One theme per Achievement Score tier, so the colour a player wears is the one
// they've climbed to. Deliberately reuses the rarity palette — the same green /
// blue / purple / gold the crests and titles already use, so a gold profile
// reads as "legendary" without needing a legend.
export type ThemeId =
  | "green"
  | "blue"
  | "purple"
  | "gold"
  | "sith"
  | "void"
  | "nebula"
  | "mandalore"
  | "hoth"
  | "coruscant"
  | "bespin"
  | "geometry"
  | "slicer"
  | "hacker"

// The animated backdrop a profile theme paints behind the page. "starfield" is
// the default the app has always used; the rest are per-theme renderers in
// components/background-particles.tsx, selected via data-profile-bg on the root.
export type ProfileBackground =
  | "starfield"
  | "nebula"
  | "voidhole"
  | "embers"
  | "snow"
  | "city"
  | "clouds"
  | "shapes"
  | "coderain"
  | "hackerrain"

// The full colour set a rich theme repaints the profile with — the same roles as
// the site themes' CSS vars (--color-background, --color-surface, …). The accent
// is carried separately on `accent`. Absent on the original accent-only themes,
// which leave the profile's default dark slate untouched.
export interface ThemePalette {
  background: string
  surface: string
  surfaceElevated: string
  border: string
  text: string
  textBright: string
  textDim: string
  // The text colour that sits ON the primary accent (e.g. the tier chip). Defaults
  // to `background` (dark text on a bright accent) — light themes override it so
  // the chip stays legible when their accent is dark.
  onAccent?: string
}

// How a profile theme is unlocked: either an Achievement-Score tier (the original
// four accent themes) or a specific crest earned to at least a given rank. `tier`
// is 1-based to match AchievementView.rank (1 = first rank, 2 = second, …).
export type UnlockCondition =
  | { kind: "score"; tier: string } // a SCORE_LADDER tier id
  | { kind: "crest"; crest: string; tier: number } // achievement id + minimum rank

export interface ProfileTheme {
  id: ThemeId
  label: string
  accent: string
  // What unlocks it. null = no unlock assigned yet (admin-preview only).
  unlockedBy: UnlockCondition | null
  // The animated background; defaults to "starfield" when omitted.
  background?: ProfileBackground
  // "light" flips the profile onto a light ground (extra remaps in globals.css).
  // Defaults to "dark".
  mode?: "light" | "dark"
  // Present only for full-palette themes; accent-only themes omit it.
  palette?: ThemePalette
}

export const THEMES: ProfileTheme[] = [
  { id: "green", label: "Green", accent: "#3ddc84", unlockedBy: { kind: "score", tier: "decorated" } },
  { id: "blue", label: "Blue", accent: "#2f81f7", unlockedBy: { kind: "score", tier: "distinguished" } },
  { id: "purple", label: "Purple", accent: "#a855f7", unlockedBy: { kind: "score", tier: "illustrious" } },
  { id: "gold", label: "Gold", accent: "#f5c542", unlockedBy: { kind: "score", tier: "jk2-god" } },

  // Full-palette themes ported from the approved mockups. Each is unlocked by
  // earning a thematically-fitting crest to a given rank (checked in unlockedThemes).
  {
    id: "sith", label: "Sith", accent: "#ff2d4b", unlockedBy: { kind: "crest", crest: "rambo", tier: 1 }, background: "starfield",
    palette: { background: "#0f0002", surface: "#1c0407", surfaceElevated: "#2a060a", border: "#5c121c", text: "#ecd6d6", textBright: "#ffffff", textDim: "#a37d7d" },
  },
  {
    id: "void", label: "Void", accent: "#f2f2f4", unlockedBy: { kind: "crest", crest: "shutout-specialist", tier: 1 }, background: "voidhole",
    palette: { background: "#050506", surface: "#101012", surfaceElevated: "#191a1c", border: "#31333a", text: "#cdced4", textBright: "#ffffff", textDim: "#7d7f88" },
  },
  {
    id: "nebula", label: "Nebula", accent: "#c06bff", unlockedBy: { kind: "crest", crest: "1500-club", tier: 1 }, background: "nebula",
    palette: { background: "#08040f", surface: "#150b24", surfaceElevated: "#211436", border: "#3c2764", text: "#e7d6f2", textBright: "#ffffff", textDim: "#a493b6" },
  },
  {
    id: "mandalore", label: "Mandalore", accent: "#ff7a2a", unlockedBy: { kind: "crest", crest: "bounty-hunter", tier: 1 }, background: "embers",
    palette: { background: "#0c0e11", surface: "#151920", surfaceElevated: "#1f242d", border: "#353d49", text: "#d3dae2", textBright: "#ffffff", textDim: "#808a97" },
  },
  {
    id: "hoth", label: "Hoth", accent: "#86e0ff", unlockedBy: { kind: "crest", crest: "marathon-runner", tier: 1 }, background: "snow",
    palette: { background: "#0a1016", surface: "#121c25", surfaceElevated: "#1b2833", border: "#2d404f", text: "#d6e8f2", textBright: "#ffffff", textDim: "#8397a6" },
  },
  {
    id: "coruscant", label: "Coruscant", accent: "#ffd24a", unlockedBy: { kind: "crest", crest: "veteran", tier: 1 }, background: "city",
    palette: { background: "#060814", surface: "#0f1428", surfaceElevated: "#171d3a", border: "#2b3459", text: "#d8e0f2", textBright: "#ffffff", textDim: "#8792ad" },
  },

  // Light themes — they flip the profile onto a light ground, so they carry
  // mode:"light" (extra remaps in globals.css) and an onAccent so the tier chip
  // stays legible when the accent is dark.
  {
    id: "bespin", label: "Bespin", accent: "#bf5e2e", unlockedBy: { kind: "crest", crest: "giga-teammate", tier: 1 }, background: "clouds", mode: "light",
    palette: { background: "#e9dfce", surface: "#f5efe3", surfaceElevated: "#fbf6ec", border: "#cdbfa4", text: "#2f2a22", textBright: "#17120c", textDim: "#6d6353", onAccent: "#fff6ea" },
  },
  {
    id: "geometry", label: "Geometry", accent: "#111111", unlockedBy: { kind: "crest", crest: "doom", tier: 1 }, background: "shapes", mode: "light",
    palette: { background: "#ececec", surface: "#ffffff", surfaceElevated: "#ffffff", border: "#111111", text: "#141414", textBright: "#000000", textDim: "#6c6c6c", onAccent: "#ffffff" },
  },
  {
    id: "slicer", label: "Slicer", accent: "#00ff41", unlockedBy: { kind: "crest", crest: "nah-youre-hacking", tier: 1 }, background: "coderain",
    palette: { background: "#030803", surface: "#071007", surfaceElevated: "#0b170b", border: "#124a20", text: "#7dffa4", textBright: "#d6ffe2", textDim: "#3f7d54", onAccent: "#021206" },
  },
  {
    id: "hacker", label: "Hacker", accent: "#cf4bff", unlockedBy: { kind: "crest", crest: "nah-youre-hacking", tier: 2 }, background: "hackerrain",
    palette: { background: "#0a0410", surface: "#150a22", surfaceElevated: "#1f1236", border: "#3d2168", text: "#e6c2ff", textBright: "#f7ecff", textDim: "#8a6bb0", onAccent: "#0a0410" },
  },
]

// The full-palette themes. Admins can equip any of these to preview one on a
// profile regardless of whether that player has earned it (the editor offers them
// all, and an equipped one always renders). Normal players unlock them the real
// way — by earning the crest named in each theme's unlockedBy.
export const PREVIEW_THEME_IDS: ThemeId[] = [
  "sith", "void", "nebula", "mandalore", "hoth", "coruscant", "bespin", "geometry", "slicer", "hacker",
]

export const isPreviewTheme = (id: string | null | undefined): boolean =>
  !!id && PREVIEW_THEME_IDS.includes(id as ThemeId)

export const DEFAULT_ACCENT = "#66fcf1"

export const themeById = (id: string | null | undefined): ProfileTheme | null =>
  THEMES.find((t) => t.id === id) ?? null

// The themes a player is entitled to, from their Achievement Score plus the ranks
// they've earned per crest (id → highest earned rank, 1-based). A score theme needs
// its ladder threshold cleared; a crest theme needs that crest earned to at least
// its required rank.
export function unlockedThemes(achievementScore: number, earnedCrestRanks: Map<string, number>): ThemeId[] {
  return THEMES.filter((t) => {
    const c = t.unlockedBy
    if (!c) return false
    if (c.kind === "score") {
      const tier = SCORE_LADDER.tiers.find((x) => x.id === c.tier)
      return tier ? achievementScore >= tier.threshold : false
    }
    return (earnedCrestRanks.get(c.crest) ?? 0) >= c.tier
  }).map((t) => t.id)
}

// The name of the thing that unlocks a theme, for the "you need to earn X" notice
// on a locked theme. Uses the specific rank's title where the crest is tiered
// ("Community Stalwart", "Nah, You're DEFINITELY Hacking"), else the crest's own
// title, or the score-ladder tier's title for the accent themes.
export function unlockRequirementLabel(theme: ProfileTheme): string | null {
  const c = theme.unlockedBy
  if (!c) return null
  if (c.kind === "score") {
    return SCORE_LADDER.tiers.find((x) => x.id === c.tier)?.title ?? null
  }
  const def = findAchievementDef(c.crest)
  if (!def) return null
  return def.ranks?.[c.tier - 1]?.title ?? def.title
}

// ---------------------------------------------------------------------------
// Earned titles
// ---------------------------------------------------------------------------

export interface EarnedTitle extends TitleTier {
  source: string // which ladder it came from, for grouping the picker
}

// A seasonal title read back from player_titles. Self-describing on purpose:
// the row snapshots its own name / rarity / season, so a title stays wearable
// and correctly coloured long after its season leaves the catalogue above.
export interface RecordedTitle {
  titleId: string
  seasonKey: string
  seasonName: string
  title: string
  rarity: Rarity
  earnedAt: string
}

// Recorded titles merged into the live-computed pool, newest season first and
// deduped by id — a title still in the current catalogue must not appear twice.
export function mergeRecordedTitles(live: EarnedTitle[], recorded: RecordedTitle[]): EarnedTitle[] {
  const out = [...live]
  const seen = new Set(live.map((t) => t.id))
  for (const r of recorded) {
    if (seen.has(r.titleId)) continue
    seen.add(r.titleId)
    out.push({
      id: r.titleId,
      title: r.title,
      // Threshold is meaningless once recorded — the tier was already cleared,
      // and the season's ladder may no longer exist to compare against.
      threshold: 0,
      rarity: r.rarity,
      source: r.seasonName,
    })
  }
  return out
}

// Everything this player is currently entitled to wear. Recomputed on render,
// which is what lets the stored choice be a bare string with no bookkeeping.
export function earnedTitles(achievementScore: number, monthScore: number, season: Season | null): EarnedTitle[] {
  const out: EarnedTitle[] = []
  for (const t of progressFor(SCORE_LADDER, achievementScore).earned) {
    out.push({ ...t, source: SCORE_LADDER.label })
  }
  if (season) {
    for (const t of progressFor(season.ladder, monthScore).earned) {
      out.push({ ...t, source: season.name })
    }
  }
  return out
}

// Resolve a title id to its display info straight from the catalogue — the
// score ladder plus every season still defined. Returns null for a title whose
// season has since been removed; those live only in player_titles, so the bot
// path prefers that snapshot (see resolveEquippedTitle in lib/titles-server).
export function catalogueTitleById(id: string): { title: string; rarity: Rarity; source: string } | null {
  const scoreTier = SCORE_LADDER.tiers.find((t) => t.id === id)
  if (scoreTier) return { title: scoreTier.title, rarity: scoreTier.rarity, source: SCORE_LADDER.label }
  for (const season of Object.values(SEASONS)) {
    const tier = season.ladder.tiers.find((t) => t.id === id)
    if (tier) return { title: tier.title, rarity: tier.rarity, source: season.name }
  }
  return null
}

export function progressFor(ladder: TitleLadder, value: number): LadderProgress {
  const earned = ladder.tiers.filter((t) => value >= t.threshold)
  const current = earned.length ? earned[earned.length - 1] : null
  const next = ladder.tiers.find((t) => value < t.threshold) ?? null
  const top = ladder.tiers[ladder.tiers.length - 1].threshold
  return { earned, current, next, value, pct: Math.max(0, Math.min(1, value / top)) }
}
