import type { Rarity } from "@/lib/achievement-meta"

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
export type ThemeId = "green" | "blue" | "purple" | "gold"

export interface ProfileTheme {
  id: ThemeId
  label: string
  accent: string
  // The score tier that unlocks it — same thresholds as the title ladder.
  unlockedBy: string
}

export const THEMES: ProfileTheme[] = [
  { id: "green", label: "Green", accent: "#3ddc84", unlockedBy: "decorated" },
  { id: "blue", label: "Blue", accent: "#2f81f7", unlockedBy: "distinguished" },
  { id: "purple", label: "Purple", accent: "#a855f7", unlockedBy: "illustrious" },
  { id: "gold", label: "Gold", accent: "#f5c542", unlockedBy: "jk2-god" },
]

export const DEFAULT_ACCENT = "#66fcf1"

export const themeById = (id: string | null | undefined): ProfileTheme | null =>
  THEMES.find((t) => t.id === id) ?? null

// A theme is available once its tier's score threshold has been cleared.
export function unlockedThemes(achievementScore: number): ThemeId[] {
  return THEMES.filter((t) => {
    const tier = SCORE_LADDER.tiers.find((x) => x.id === t.unlockedBy)
    return tier ? achievementScore >= tier.threshold : false
  }).map((t) => t.id)
}

// ---------------------------------------------------------------------------
// Earned titles
// ---------------------------------------------------------------------------

export interface EarnedTitle extends TitleTier {
  source: string // which ladder it came from, for grouping the picker
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

export function progressFor(ladder: TitleLadder, value: number): LadderProgress {
  const earned = ladder.tiers.filter((t) => value >= t.threshold)
  const current = earned.length ? earned[earned.length - 1] : null
  const next = ladder.tiers.find((t) => value < t.threshold) ?? null
  const top = ladder.tiers[ladder.tiers.length - 1].threshold
  return { earned, current, next, value, pct: Math.max(0, Math.min(1, value / top)) }
}
