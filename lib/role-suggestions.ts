import type { TierMove } from "@/lib/calibration"
import type { Job, ProductionBoard, ProductionRow } from "@/lib/production-rating"

/*
 * Role Rating Suggestions — an advisory read-out, not a setter.
 *
 * The tier calibrator (lib/calibration.ts) moves a player's OVERALL tier on
 * production evidence and never touches the five hand-set per-role ratings
 * (capper_rating, chase_rating, camp_rating, cleaner_rating, support_rating)
 * that the balancer reads for role coverage and the capper/chase split. This
 * module surfaces, per player per role, that hand rating against a
 * production-implied one, so an admin editing the roster can see where the two
 * disagree — especially for a player the calibrator is also moving, since a
 * tier move is a strong prior that at least one of the roles they actually play
 * is mis-rated.
 *
 * NOTHING HERE IS APPLIED AUTOMATICALLY. It renders in the admin panel next to
 * the tier Rank Suggestions; the admin makes any change by hand in Player
 * Management. Consequences of that:
 *
 *  - There is no role_changes table, so editing a hand role rating does NOT
 *    reset that role's evidence window the way a tier edit resets the
 *    calibrator's. Fine for a review aid; would need building for auto-apply.
 *  - THE `returns` JOB CANNOT TELL CHASE FROM CAMP. Both an aggressive chaser
 *    and a home-base camp returner rack up returns and assists, and the
 *    scoreboard records no location, so `returns` production is "returning
 *    ability" — it is fitted against and compared to max(chase_rating,
 *    camp_rating), and a flagged row is labelled with whichever the player
 *    actually holds. An early cut mapped `returns` to Chase alone and told
 *    every camp returner they were an unrated chaser.
 *  - CAMP still has no job of its own beyond the above. `camp_rating` DOES track
 *    returns production (r≈0.77 measured), which is a different question from the
 *    20 Aug audit's camp-vs-base-cleaning finding (r≈0.02).
 *  - The fitted line regresses to the mean at the ends of each role's range, so
 *    a rating-10 player almost always "should" come down a touch on it. That is
 *    an artefact, not a finding: MIN_GAP swallows the ±1 of it, and EXTREME_PCT
 *    blocks any down-suggestion for a top-quartile producer outright.
 *  - Suggested ratings are whole numbers — role ratings are integers.
 *  - roleRatings rests on detectRole, which matches a player's declared main
 *    role only ~57% of the time. A single flag is a prompt to look, not a
 *    verdict.
 */

/** Every per-role hand-rating column on `players`. */
export type RoleName = "Capper" | "Chase" | "Camp" | "Cleaner" | "Support"

/**
 * The hand-rating column(s) each production job speaks to. `returns` covers two —
 * a chaser and a camp returner produce the same stat line — so it is judged
 * against whichever of the pair the player holds (see the module header).
 */
export const JOB_RATING_COLUMNS: Record<Job, RoleName[]> = {
  cap: ["Capper"],
  base: ["Cleaner"],
  returns: ["Chase", "Camp"],
  support: ["Support"],
}

const JOBS: Job[] = ["cap", "base", "returns", "support"]

/** The player's rating for a job — the higher of the mapped columns. */
function ratingForJob(ratings: Record<RoleName, number>, job: Job): number {
  return Math.max(...JOB_RATING_COLUMNS[job].map((c) => ratings[c] ?? 0))
}

/** What to call a job on a card: the column(s) the player is actually rated for,
 *  or the whole pair when they are rated for none of it. */
function roleLabelForJob(ratings: Record<RoleName, number>, job: Job): string {
  const cols = JOB_RATING_COLUMNS[job]
  const rated = cols.filter((c) => (ratings[c] ?? 0) > 0)
  if (rated.length === 0) return cols.join(" / ")
  const top = Math.max(...rated.map((c) => ratings[c]))
  return rated.filter((c) => ratings[c] === top).join(" / ")
}

export const ROLE_SUGGESTION = {
  /** Matches detected in a role before its rating is judged. computeProductionBoard's
   *  own roleRatings gate (MIN_ROLE_GAMES = 3) is fine for a leaderboard cell but
   *  too thin to move a rating on. */
  MIN_GAMES_IN_ROLE: 10,
  /** A higher bar for the separate "plays this role plenty, still rated 0" flag —
   *  a 0 is the roster's "doesn't play it" sentinel, so contradicting it wants
   *  more evidence than nudging an existing number. */
  MIN_UNRATED_GAMES: 15,
  /** The unrated flag ALSO only fires for a player's main detected role or one
   *  they play a big share of the time — role detection is ~57% accurate, so a
   *  handful of misclassified games in a role they never really play would
   *  otherwise flag half the roster as "unrated". */
  UNRATED_MAIN_SHARE: 0.35,
  /** Roster players who play a role enough to sit in its scale fit. Below this the
   *  role gets no suggested number this run (it can still surface via a tier move). */
  MIN_FIT_SAMPLE: 6,
  /**
   * Minimum |correlation| between the roster's hand ratings and their production
   * for a role, before production is trusted to suggest a number there.
   *
   * This is the guard that keeps Support out. Measured over 180 days:
   * Capper r = 0.72, Cleaner 0.71, returns-vs-max(chase,camp) 0.90 — but Support
   * only 0.41, because the scoreboard records almost nothing support does (see
   * project-impact-leaderboard), so its cohort ratings bunch in a narrow band and
   * the fitted line just drags everyone toward the middle: the best supports in
   * the game came out as "bring them down", an average one as "bring them up". A
   * role below this bar shows nothing but unrated / tier-move context.
   */
  MIN_FIT_R: 0.6,
  /** On the 0–10 rating scale, integers. A gap of 1 is inside the noise of this
   *  whole approach; 2+ is a suggestion — unless it agrees with a pending tier
   *  move, which is independent corroboration. */
  MIN_GAP: 2,
  /**
   * Production's own extremes are not argued with. A player in the top quartile
   * of a role's production cohort is never suggested DOWN, nor one in the bottom
   * quartile suggested UP — at the ends of the range the fitted line always
   * pulls toward the mean (rating-10 players sit below their own rating on it),
   * and that is an artefact of the line, not a real disagreement.
   */
  EXTREME_PCT: 0.25,
  /** computeProductionBoard qualification: total statted games to appear at all. */
  BOARD_MIN_GAMES: 8,
} as const

export type RoleSuggestion = {
  name: string
  /** The hand-rating column(s) this row is about — usually one, "Chase / Camp"
   *  when the `returns` job could be either. */
  role: string
  job: Job
  /** "divergence" — has a rating, production disagrees. "unrated" — plays the role
   *  a lot but the rating is still 0. */
  kind: "divergence" | "unrated"
  /** Hand rating, 0–10 — the higher of the job's mapped columns. 0 only when
   *  kind === "unrated". */
  currentRating: number
  /** Raw cohort figure from roleRatings — 50/12 scale, 50 is an average performer
   *  at this job. */
  cohortRating: number
  /** Plain-language reading of cohortRating, for display. */
  band: string
  /** Fitted from the roster's own (hand rating ↔ cohort rating) relationship, a
   *  whole number 1–10 — role ratings are integers. Null when the role has no
   *  usable fit this run. */
  suggestedRating: number | null
  /** suggestedRating − currentRating. Null when suggestedRating is. */
  gap: number | null
  gamesInRole: number
  /** Sign of a pending calibrator tier move for this player: −1 down, +1 up, 0 none. */
  tierMove: -1 | 0 | 1
}

/** A role's fitted rating scale, plus the cohort ratings it was fitted from (so a
 *  player's standing within the role can be checked). */
type Fit = { a: number; b: number; r: number; n: number; cohortValues: number[] }

const clamp = (lo: number, hi: number, x: number) => Math.max(lo, Math.min(hi, x))

/** 50/12 cohort rating → a word. Thresholds mirror the leaderboard's own "62 is a
 *  standard deviation above" framing. */
export function bandOf(cohortRating: number): string {
  if (cohortRating >= 62) return "elite"
  if (cohortRating >= 54) return "strong"
  if (cohortRating >= 46) return "average"
  if (cohortRating >= 38) return "below average"
  return "weak"
}

/** −1 / 0 / +1: whether the cohort rating sits clearly below, around, or above an
 *  average performer at the job. Used when there is no fit to put a number on it. */
function bandDir(cohortRating: number): -1 | 0 | 1 {
  if (cohortRating >= 54) return 1
  if (cohortRating <= 46) return -1
  return 0
}

/**
 * Least-squares line of y on x, plus the Pearson correlation. Null unless there
 * are enough points, x actually varies, the slope is positive, and |r| clears
 * the bar — a weak correlation means production cannot order the players in this
 * role, so any line through it just regresses everyone to the mean.
 */
function fitLine(
  points: Array<{ x: number; y: number }>,
  minSample: number,
  minR: number,
): Fit | null {
  const n = points.length
  if (n < minSample) return null
  const mx = points.reduce((s, p) => s + p.x, 0) / n
  const my = points.reduce((s, p) => s + p.y, 0) / n
  let sxx = 0
  let syy = 0
  let sxy = 0
  for (const p of points) {
    sxx += (p.x - mx) ** 2
    syy += (p.y - my) ** 2
    sxy += (p.x - mx) * (p.y - my)
  }
  if (!(sxx > 1e-9) || !(syy > 1e-9)) return null
  const b = sxy / sxx
  const r = sxy / Math.sqrt(sxx * syy)
  if (!(b > 0) || Math.abs(r) < minR) return null
  return { a: my - b * mx, b, r, n, cohortValues: points.map((p) => p.x).sort((u, v) => u - v) }
}

/**
 * One linear map per job, translating a 50/12 cohort rating into the roster's
 * 0–10 hand-rating scale, fitted from players who currently carry a hand rating
 * for that role and have played it enough.
 *
 * Rating 0 is excluded on purpose: it is the roster's "doesn't play this role"
 * marker, not a low score, so it would drag the intercept down and flatten the
 * slope. A role whose fit is too weak (see MIN_FIT_R) maps to null.
 */
export function fitRoleScales(
  rows: ProductionRow[],
  handRatings: Map<string, Record<RoleName, number>>,
  opts: typeof ROLE_SUGGESTION = ROLE_SUGGESTION,
): Map<Job, Fit | null> {
  const out = new Map<Job, Fit | null>()
  for (const job of JOBS) {
    const points: Array<{ x: number; y: number }> = []
    for (const row of rows) {
      const cohort = row.roleRatings[job]
      const ratings = handRatings.get(row.name)
      if (cohort == null || !ratings) continue
      const hand = ratingForJob(ratings, job)
      if (hand <= 0) continue
      if (row.rolesPlayed[job] < opts.MIN_GAMES_IN_ROLE) continue
      points.push({ x: cohort, y: hand })
    }
    out.set(job, fitLine(points, opts.MIN_FIT_SAMPLE, opts.MIN_FIT_R))
  }
  return out
}

/** Fraction of the cohort at or below this rating, 0..1. */
function percentileIn(sortedValues: number[], value: number): number {
  if (sortedValues.length === 0) return 0.5
  let atOrBelow = 0
  for (const v of sortedValues) if (v <= value) atOrBelow++
  return atOrBelow / sortedValues.length
}

/**
 * Which (player, role) pairs are worth an admin's eye, and what production
 * suggests the rating should be.
 *
 * A pair is emitted when the gap clears MIN_GAP, OR when it points the same way
 * as a pending tier move (a weaker bar, because the tier move is independent
 * evidence that something about this player is over/under-rated) — but never
 * when it only contradicts production's own ranking at the extremes (EXTREME_PCT).
 * "unrated" rows — a role played a lot with the rating still at 0 — are emitted
 * regardless of any fit. A role whose fit is too weak (Support, today) yields no
 * numbers at all.
 *
 * Sort: players with a pending tier move first (that is the case this exists
 * for), then by gap size, then name/role for a stable order between refreshes.
 */
export function computeRoleSuggestions(
  board: ProductionBoard,
  handRatings: Map<string, Record<RoleName, number>>,
  tierMoves: TierMove[],
  opts: typeof ROLE_SUGGESTION = ROLE_SUGGESTION,
): RoleSuggestion[] {
  const fits = fitRoleScales(board.rows, handRatings, opts)
  const moveDir = new Map<string, -1 | 0 | 1>()
  for (const m of tierMoves) moveDir.set(m.name, Math.sign(m.to - m.from) as -1 | 0 | 1)

  const out: RoleSuggestion[] = []

  for (const row of board.rows) {
    const ratings = handRatings.get(row.name)
    if (!ratings) continue
    const tierMove = moveDir.get(row.name) ?? 0
    const totalRoleGames = JOBS.reduce((t, j) => t + row.rolesPlayed[j], 0)

    for (const job of JOBS) {
      const cohort = row.roleRatings[job]
      if (cohort == null) continue
      const role = roleLabelForJob(ratings, job)
      const games = row.rolesPlayed[job]
      const current = ratingForJob(ratings, job)

      if (current <= 0) {
        const isMainish =
          job === row.mainRole || games >= opts.UNRATED_MAIN_SHARE * totalRoleGames
        if (games < opts.MIN_UNRATED_GAMES || !isMainish) continue
        out.push({
          name: row.name,
          role,
          job,
          kind: "unrated",
          currentRating: 0,
          cohortRating: cohort,
          band: bandOf(cohort),
          suggestedRating: null,
          gap: null,
          gamesInRole: games,
          tierMove,
        })
        continue
      }

      if (games < opts.MIN_GAMES_IN_ROLE) continue

      const fit = fits.get(job) ?? null
      const suggestedRating = fit ? Math.round(clamp(1, 10, fit.a + fit.b * cohort)) : null
      const gap = suggestedRating == null ? null : suggestedRating - current

      // Production's own extremes are not argued with: a top-quartile producer is
      // never pushed down, a bottom-quartile one never pushed up. At the ends the
      // fitted line always leans toward the mean, so that disagreement is the
      // line's artefact, not a real one.
      if (fit && gap != null && gap !== 0) {
        const pct = percentileIn(fit.cohortValues, cohort)
        if (gap < 0 && pct >= 1 - opts.EXTREME_PCT) continue
        if (gap > 0 && pct <= opts.EXTREME_PCT) continue
      }

      // Direction production pulls this rating: the sign of the fitted gap, or —
      // with no fit — which side of an average performer the cohort rating sits.
      const dir: number = gap != null ? Math.sign(gap) : bandDir(cohort)
      const bigEnough = gap != null && Math.abs(gap) >= opts.MIN_GAP
      const agreesWithTier = tierMove !== 0 && dir === tierMove

      if (!bigEnough && !agreesWithTier) continue

      out.push({
        name: row.name,
        role,
        job,
        kind: "divergence",
        currentRating: current,
        cohortRating: cohort,
        band: bandOf(cohort),
        suggestedRating,
        gap,
        gamesInRole: games,
        tierMove,
      })
    }
  }

  out.sort(
    (a, b) =>
      (b.tierMove !== 0 ? 1 : 0) - (a.tierMove !== 0 ? 1 : 0) ||
      Math.abs(b.gap ?? 0) - Math.abs(a.gap ?? 0) ||
      a.name.localeCompare(b.name) ||
      a.role.localeCompare(b.role),
  )

  return out
}
