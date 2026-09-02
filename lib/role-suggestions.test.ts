import { describe, expect, it } from "vitest"
import {
  bandOf,
  computeRoleSuggestions,
  fitRoleScales,
  ROLE_SUGGESTION,
  type RoleName,
} from "@/lib/role-suggestions"
import type { Job, ProductionBoard, ProductionRow } from "@/lib/production-rating"
import type { TierMove } from "@/lib/calibration"

/*
 * Role Rating Suggestions is advisory: it fits the roster's own (hand rating ↔
 * production) line and flags where a player sits far off it, with pending tier
 * moves pushed to the top. These tests pin the behaviours a reader would notice
 * if they broke — the rating-0 sentinel is never a low score, the `returns` job
 * is judged against Chase OR Camp, suggestions are whole numbers, a role
 * production can't rank (Support) yields no numbers, and production's own
 * extremes are never argued down.
 */

const ZERO_JOBS: Record<Job, number> = { cap: 0, base: 0, returns: 0, support: 0 }

function row(
  name: string,
  over: {
    roleRatings?: Partial<Record<Job, number | null>>
    rolesPlayed?: Partial<Record<Job, number>>
    mainRole?: Job
  } = {},
): ProductionRow {
  return {
    name,
    tier: 5,
    rating: 50,
    value: 0,
    jobs: { ...ZERO_JOBS },
    jobRatings: { ...ZERO_JOBS },
    jobPlayed: { cap: false, base: false, returns: false, support: false },
    topJob: "cap",
    mainRole: over.mainRole ?? "cap",
    rolesPlayed: { ...ZERO_JOBS, ...over.rolesPlayed },
    roleRatings: { cap: null, base: null, returns: null, support: null, ...over.roleRatings },
    games: 20,
    minutes: 800,
    wins: 10,
    losses: 10,
    draws: 0,
    winPct: 50,
    winAdjustment: 0,
    captures: 0,
    grabs: 0,
    returns: 0,
    assists: 0,
    clears: 0,
    mineKills: 0,
    homeMines: 0,
    awayMines: 0,
    mineReturns: 0,
  }
}

const board = (rows: ProductionRow[]): ProductionBoard => ({
  rows,
  minGames: ROLE_SUGGESTION.BOARD_MIN_GAMES,
  stattedMatches: 60,
  totalMatches: 60,
})

const ratings = (
  entries: Array<[string, Partial<Record<RoleName, number>>]>,
): Map<string, Record<RoleName, number>> =>
  new Map(entries.map(([name, r]) => [name, { Capper: 0, Chase: 0, Camp: 0, Cleaner: 0, Support: 0, ...r }]))

/** A cohort of Chase players whose hand rating tracks production on a clean line
 *  — rating = cohort/6 − 10/3, i.e. (50, 5) and (62, 7) — plus whatever extra
 *  rows the test adds. */
function chaseCohort(): { rows: ProductionRow[]; hands: Array<[string, Partial<Record<RoleName, number>>]> } {
  const pairs: Array<[string, number, number]> = [
    ["c1", 38, 3],
    ["c2", 44, 4],
    ["c3", 50, 5],
    ["c4", 56, 6],
    ["c5", 62, 7],
    ["c6", 68, 8],
    ["c7", 74, 9],
  ]
  return {
    rows: pairs.map(([n, cohort]) => row(n, { roleRatings: { returns: cohort }, rolesPlayed: { returns: 20 } })),
    hands: pairs.map(([n, , hand]) => [n, { Chase: hand }]),
  }
}

describe("bandOf", () => {
  it("reads the 50/12 scale into words", () => {
    expect(bandOf(64)).toBe("elite")
    expect(bandOf(50)).toBe("average")
    expect(bandOf(30)).toBe("weak")
  })
})

describe("fitRoleScales", () => {
  it("recovers a known linear relationship", () => {
    const { rows, hands } = chaseCohort()
    const fit = fitRoleScales(rows, ratings(hands)).get("returns")
    expect(fit).not.toBeNull()
    expect(fit!.b).toBeCloseTo(1 / 6, 5)
    expect(fit!.a).toBeCloseTo(-10 / 3, 4)
    expect(fit!.r).toBeGreaterThan(0.99)
  })

  it("returns null for a role with too few rated players", () => {
    const rows = [
      row("a", { roleRatings: { cap: 50 }, rolesPlayed: { cap: 20 } }),
      row("b", { roleRatings: { cap: 60 }, rolesPlayed: { cap: 20 } }),
    ]
    expect(fitRoleScales(rows, ratings([["a", { Capper: 5 }], ["b", { Capper: 6 }]])).get("cap")).toBeNull()
  })

  it("excludes rating-0 players from the fit", () => {
    const { rows, hands } = chaseCohort()
    rows.push(row("c8", { roleRatings: { returns: 44 }, rolesPlayed: { returns: 30 } }))
    const withZero = fitRoleScales(rows, ratings([...hands, ["c8", { Chase: 0 }]])).get("returns")
    const withoutZero = fitRoleScales(chaseCohort().rows, ratings(chaseCohort().hands)).get("returns")
    expect(withZero!.b).toBeCloseTo(withoutZero!.b, 6)
  })

  it("returns null when the slope is not positive", () => {
    const rows = Array.from({ length: 7 }, (_, i) =>
      row(`p${i}`, { roleRatings: { base: 40 + i * 5 }, rolesPlayed: { base: 20 } }),
    )
    const hands = rows.map((r, i) => [r.name, { Cleaner: 9 - i }] as [string, Partial<Record<RoleName, number>>])
    expect(fitRoleScales(rows, ratings(hands)).get("base")).toBeNull()
  })

  it("returns null when the correlation is too weak (the Support case)", () => {
    const cohorts = [40, 44, 48, 52, 56, 60, 64, 68]
    const hands = [5, 6, 4, 7, 5, 7, 5, 8] // weakly positive, |r| < MIN_FIT_R
    const rows = cohorts.map((c, i) => row(`s${i}`, { roleRatings: { support: c }, rolesPlayed: { support: 20 } }))
    const handMap = rows.map((r, i) => [r.name, { Support: hands[i] }] as [string, Partial<Record<RoleName, number>>])
    expect(fitRoleScales(rows, ratings(handMap)).get("support")).toBeNull()
  })
})

describe("computeRoleSuggestions", () => {
  it("flags a player rated well above their production, as a whole number", () => {
    const { rows, hands } = chaseCohort()
    rows.push(row("subject", { roleRatings: { returns: 50 }, rolesPlayed: { returns: 20 } }))
    const out = computeRoleSuggestions(board(rows), ratings([...hands, ["subject", { Chase: 8 }]]), [])
    const s = out.find((x) => x.name === "subject")
    expect(s).toBeDefined()
    expect(s!.role).toBe("Chase")
    expect(s!.kind).toBe("divergence")
    expect(Number.isInteger(s!.suggestedRating!)).toBe(true)
    expect(s!.gap!).toBeLessThanOrEqual(-ROLE_SUGGESTION.MIN_GAP)
    expect(s!.suggestedRating!).toBeLessThan(8)
  })

  it("judges a camp returner against camp_rating and labels the row Camp, not Chase", () => {
    // chaseCohort is 7 chasers rated on Chase. Add a camp returner who returns
    // like a mid chaser (cohort 56) but is rated Chase 0, Camp 4.
    const { rows, hands } = chaseCohort()
    rows.push(row("camper", { roleRatings: { returns: 56 }, rolesPlayed: { returns: 25 } }))
    const out = computeRoleSuggestions(board(rows), ratings([...hands, ["camper", { Camp: 4 }]]), [])
    const s = out.find((x) => x.name === "camper")
    expect(s).toBeDefined()
    expect(s!.kind).toBe("divergence") // NOT "unrated" — they hold a Camp rating
    expect(s!.role).toBe("Camp")
    expect(s!.currentRating).toBe(4)
  })

  it("only calls a returner 'unrated' when they hold neither Chase nor Camp", () => {
    const { rows, hands } = chaseCohort()
    rows.push(
      row("greenhorn", {
        roleRatings: { returns: 45 },
        rolesPlayed: { returns: ROLE_SUGGESTION.MIN_UNRATED_GAMES + 1 },
        mainRole: "returns",
      }),
    )
    const out = computeRoleSuggestions(
      board(rows),
      ratings([...hands, ["greenhorn", { Chase: 0, Camp: 0 }]]),
      [],
    )
    const s = out.find((x) => x.name === "greenhorn")
    expect(s).toBeDefined()
    expect(s!.kind).toBe("unrated")
    expect(s!.role).toBe("Chase / Camp")
  })

  it("says nothing when production and the rating roughly agree", () => {
    const { rows, hands } = chaseCohort()
    rows.push(row("ok", { roleRatings: { returns: 56 }, rolesPlayed: { returns: 20 } }))
    const out = computeRoleSuggestions(board(rows), ratings([...hands, ["ok", { Chase: 6 }]]), [])
    expect(out.find((x) => x.name === "ok")).toBeUndefined()
  })

  it("does not argue a top-quartile producer down off the regression line", () => {
    // A tight cohort (hand 3–7) with one player who is BOTH the top producer and
    // rated 10. The fitted line predicts ~8 for them, but production agrees they
    // are the best, so no down-suggestion.
    const pairs: Array<[string, number, number]> = [
      ["p1", 40, 3],
      ["p2", 44, 4],
      ["p3", 48, 4],
      ["p4", 52, 5],
      ["p5", 56, 5],
      ["p6", 60, 6],
      ["p7", 64, 7],
    ]
    const rows = pairs.map(([n, c]) => row(n, { roleRatings: { base: c }, rolesPlayed: { base: 20 } }))
    const hands = pairs.map(([n, , h]) => [n, { Cleaner: h }] as [string, Partial<Record<RoleName, number>>])
    rows.push(row("star", { roleRatings: { base: 66 }, rolesPlayed: { base: 20 } }))
    const out = computeRoleSuggestions(board(rows), ratings([...hands, ["star", { Cleaner: 10 }]]), [])
    expect(out.find((x) => x.name === "star")).toBeUndefined()
  })

  it("surfaces a one-point gap when it agrees with a pending tier move", () => {
    const { rows, hands } = chaseCohort()
    rows.push(row("slipping", { roleRatings: { returns: 50 }, rolesPlayed: { returns: 20 } }))
    const move: TierMove = {
      name: "slipping",
      from: 7,
      to: 6,
      actualWinRate: 0,
      expectedWinRate: 0,
      gap: 0,
      games: 15,
      estimatedTier: 6,
      latent: 6,
      productionGames: 15,
    }
    const out = computeRoleSuggestions(board(rows), ratings([...hands, ["slipping", { Chase: 6 }]]), [move])
    const s = out.find((x) => x.name === "slipping")
    expect(s).toBeDefined()
    expect(s!.tierMove).toBe(-1)
    expect(Math.abs(s!.gap!)).toBeLessThan(ROLE_SUGGESTION.MIN_GAP)
    expect(out[0].tierMove).not.toBe(0) // tier-move rows sort first
  })

  it("emits an 'unrated' row for a main role played a lot with rating 0", () => {
    const { rows, hands } = chaseCohort()
    rows.push(
      row("newbie", {
        roleRatings: { base: 47 },
        rolesPlayed: { base: ROLE_SUGGESTION.MIN_UNRATED_GAMES + 1 },
        mainRole: "base",
      }),
    )
    const out = computeRoleSuggestions(board(rows), ratings([...hands, ["newbie", { Cleaner: 0 }]]), [])
    const s = out.find((x) => x.name === "newbie" && x.role === "Cleaner")
    expect(s).toBeDefined()
    expect(s!.kind).toBe("unrated")
    expect(s!.suggestedRating).toBeNull()
  })

  it("does not emit 'unrated' below the games bar", () => {
    const { rows, hands } = chaseCohort()
    rows.push(
      row("dabbler", {
        roleRatings: { base: 47 },
        rolesPlayed: { base: ROLE_SUGGESTION.MIN_UNRATED_GAMES - 1 },
        mainRole: "base",
      }),
    )
    const out = computeRoleSuggestions(board(rows), ratings([...hands, ["dabbler", { Cleaner: 0 }]]), [])
    expect(out.find((x) => x.name === "dabbler")).toBeUndefined()
  })

  it("does not emit 'unrated' for a role that is not the player's main and only a small share", () => {
    const { rows, hands } = chaseCohort()
    rows.push(
      row("cameo", {
        roleRatings: { base: 55 },
        rolesPlayed: { base: ROLE_SUGGESTION.MIN_UNRATED_GAMES + 1, cap: 200 },
        mainRole: "cap",
      }),
    )
    const out = computeRoleSuggestions(board(rows), ratings([...hands, ["cameo", { Cleaner: 0, Capper: 8 }]]), [])
    expect(out.find((x) => x.name === "cameo" && x.role === "Cleaner")).toBeUndefined()
  })

  it("ignores a role a player has barely played (below the games-in-role floor)", () => {
    const { rows, hands } = chaseCohort()
    rows.push(
      row("brief", {
        roleRatings: { cap: 70 },
        rolesPlayed: { cap: ROLE_SUGGESTION.MIN_GAMES_IN_ROLE - 1 },
      }),
    )
    const out = computeRoleSuggestions(board(rows), ratings([...hands, ["brief", { Capper: 3 }]]), [])
    expect(out.find((x) => x.name === "brief")).toBeUndefined()
  })

  it("still gives no number when a role cannot be fit, but keeps a tier-move row", () => {
    const rows = [
      row("cap1", { roleRatings: { cap: 50 }, rolesPlayed: { cap: 20 } }),
      row("cap2", { roleRatings: { cap: 60 }, rolesPlayed: { cap: 20 } }),
      row("mover", { roleRatings: { cap: 40 }, rolesPlayed: { cap: 20 } }),
    ]
    const move: TierMove = {
      name: "mover",
      from: 6,
      to: 5,
      actualWinRate: 0,
      expectedWinRate: 0,
      gap: 0,
      games: 15,
      estimatedTier: 5,
      latent: 5,
      productionGames: 15,
    }
    const out = computeRoleSuggestions(
      board(rows),
      ratings([
        ["cap1", { Capper: 5 }],
        ["cap2", { Capper: 6 }],
        ["mover", { Capper: 7 }],
      ]),
      [move],
    )
    const s = out.find((x) => x.name === "mover")
    expect(s).toBeDefined()
    expect(s!.suggestedRating).toBeNull()
    expect(s!.gap).toBeNull()
    expect(s!.band).toBe("below average")
  })
})
