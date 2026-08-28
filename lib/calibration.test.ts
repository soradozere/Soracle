import { describe, expect, it } from "vitest"
import { CALIBRATION, computeTierMoves, type CalibrationMatch, type ProductionByMatch } from "@/lib/calibration"

/*
 * The calibrator decides on PRODUCTION, not on who won, and it accumulates a
 * fractional latent tier rather than jumping on a threshold. These tests pin
 * that behaviour and the evidence-window rules that survived the rewrite.
 *
 * Win/loss is still carried on every move for display, so the matches below
 * still have scores — but no assertion should depend on them except the ones
 * that say so.
 */

const ROSTER = ["subject", "r1", "r2", "r3", "r4", "r5", "b1", "b2", "b3", "b4", "b5", "b6"]

// An even 6v6 (both tier sums 30 → expected 0.5 each side, lobby mean tier 5)
// with the subject on red at the given snapshot tier, adjusting a red teammate
// so the sums stay equal. Timestamps count up with index, so index 0 is oldest.
function evenMatch(subjectTier: number, redWins: boolean, index: number): CalibrationMatch {
  const filler = 30 - subjectTier - 20 // four red fillers at 5 + one balancer slot
  return {
    id: `m${index}`,
    red_team: ["subject", "r1", "r2", "r3", "r4", "r5"],
    blue_team: ["b1", "b2", "b3", "b4", "b5", "b6"],
    red_tiers: [subjectTier, filler, 5, 5, 5, 5],
    blue_tiers: [5, 5, 5, 5, 5, 5],
    red_score: redWins ? 5 : 2,
    blue_score: redWins ? 2 : 5,
    created_at: new Date(Date.UTC(2026, 7, 1, 12, 0, 0) + index * 3_600_000).toISOString(),
  }
}

const series = (results: boolean[], tier = 5) => results.map((w, i) => evenMatch(tier, w, i))

/** The timestamp evenMatch(_, _, index) carries. */
const at = (index: number) =>
  new Date(Date.UTC(2026, 7, 1, 12, 0, 0) + index * 3_600_000).toISOString()

/** The other eleven players' raw production — a fixed, realistic spread. */
const OTHERS = [300, 340, 380, 420, 460, 500, 540, 580, 620, 660, 700]

/**
 * Raw production for the subject that standardises to `targetZ` on this board.
 *
 * Solved rather than hard-coded because standardising includes the subject, so
 * their own value shifts the mean and sd it is measured against. Bisection keeps
 * the tests readable in tiers ("plays like a 8") instead of in raw points.
 */
function subjectPointsFor(targetZ: number): number {
  const z = (x: number) => {
    const all = [...OTHERS, x]
    const mean = all.reduce((a, b) => a + b, 0) / all.length
    const sd = Math.sqrt(all.reduce((a, v) => a + (v - mean) ** 2, 0) / all.length)
    return sd > 0 ? (x - mean) / sd : 0
  }
  let lo = -100_000
  let hi = 100_000
  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2
    if (z(mid) < targetZ) lo = mid
    else hi = mid
  }
  return (lo + hi) / 2
}

/**
 * Production for every match, with the subject playing like `impliedTier`.
 *
 * The estimator reads a z as "this many tiers above the lobby's mean", so on a
 * lobby averaging tier 5 an implied tier of 8 is a z of 3 × PRODUCTION_Z_PER_TIER.
 */
function productionAll(matches: CalibrationMatch[], impliedTier: number, lobbyMean = 5): ProductionByMatch {
  const z = (impliedTier - lobbyMean) * CALIBRATION.PRODUCTION_Z_PER_TIER
  const subject = subjectPointsFor(z)
  const map: ProductionByMatch = new Map()
  for (const m of matches) {
    const board = new Map<string, number>()
    board.set("subject", subject)
    const others = [...m.red_team, ...m.blue_team].filter((n) => n !== "subject")
    others.forEach((name, i) => board.set(name, OTHERS[i % OTHERS.length]))
    map.set(m.id, board)
  }
  return map
}

const run = (
  matches: CalibrationMatch[],
  tier = 5,
  candidates = ["subject"],
  lastTierChangeAt = new Map<string, string>(),
  production: ProductionByMatch = new Map(),
) => computeTierMoves(matches, new Map([["subject", tier]]), candidates, lastTierChangeAt, production)

/** The common case: N even matches where the subject plays like `impliedTier`. */
const runPlaying = (n: number, impliedTier: number, tier = 5, wins = true) => {
  const matches = series(Array(n).fill(wins), tier)
  return run(matches, tier, ["subject"], new Map(), productionAll(matches, impliedTier))
}

describe("computeTierMoves: production decides the move", () => {
  it("promotes a player whose production is consistently above their tier", () => {
    const moves = runPlaying(15, 8)
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ name: "subject", from: 5, to: 6 })
    expect(moves[0].estimatedTier).toBeCloseTo(8, 1)
  })

  it("demotes a player whose production is consistently below their tier", () => {
    const moves = runPlaying(15, 2)
    expect(moves).toHaveLength(1)
    expect(moves[0].to).toBe(4)
  })

  it("leaves a player producing exactly at their tier alone", () => {
    expect(runPlaying(15, 5)).toHaveLength(0)
  })

  it("ignores who won — the same production moves a loser the same way", () => {
    const won = runPlaying(15, 8, 5, true)
    const lost = runPlaying(15, 8, 5, false)
    expect(lost).toHaveLength(1)
    expect(lost[0].to).toBe(won[0].to)
    expect(lost[0].latent).toBeCloseTo(won[0].latent, 10)
  })

  it("does not move on a run of wins when production says the tier is right", () => {
    // The old rule promoted on ten straight wins. That is exactly the coin-flip
    // this replaced, and it must no longer be enough on its own.
    const matches = series(Array(10).fill(true))
    expect(run(matches, 5, ["subject"], new Map(), productionAll(matches, 5))).toHaveLength(0)
  })
})

describe("computeTierMoves: the nudge accumulates rather than jumping", () => {
  it("moves the latent a fraction of the way at each evaluation", () => {
    // Three evaluations at 5/10/15 games, each closing NUDGE_RATE of the gap
    // from 5 toward 8: 5 → 5.3 → 5.57 → 5.813.
    const moves = runPlaying(15, 8)
    expect(moves[0].latent).toBeCloseTo(5.813, 3)
  })

  it("needs sustained evidence to cross a boundary, not one good spell", () => {
    // One evaluation (5 games) nudges 5 -> 5.30, which still rounds to 5. A
    // second (10 games) reaches 5.57 and crosses. So three tiers of apparent
    // overperformance must hold up across two windows before anything moves,
    // where the old rule moved on a single five-game coin flip.
    expect(runPlaying(5, 8)).toHaveLength(0)
    expect(runPlaying(10, 8)).toHaveLength(1)
  })

  it("takes longer to move the closer the evidence is to the current tier", () => {
    // A player only marginally above their tier should not cross quickly.
    expect(runPlaying(10, 6)).toHaveLength(0)
    expect(runPlaying(15, 6)).toHaveLength(0)
  })

  it("moves a badly misplaced player further than a marginal one", () => {
    const far = runPlaying(15, 10)
    const near = runPlaying(15, 6)
    expect(far[0].latent - 5).toBeGreaterThan(near.length ? near[0].latent - 5 : 0)
  })

  it("never drifts further than MAX_DRIFT from the tier an admin set", () => {
    const moves = runPlaying(15, 30) // absurd production, deliberately
    expect(moves[0].latent).toBeLessThanOrEqual(5 + CALIBRATION.MAX_DRIFT + 1e-9)
  })

  it("clamps at tier 10 — an overperforming 10 has nowhere to go", () => {
    const matches = series(Array(15).fill(true), 10)
    const moves = computeTierMoves(
      matches,
      new Map([["subject", 10]]),
      ["subject"],
      new Map(),
      productionAll(matches, 20, 5),
    )
    for (const m of moves) expect(m.to).toBeLessThanOrEqual(10)
  })
})

describe("computeTierMoves: no scoreboard, no move", () => {
  it("does not move a player with no production data at all", () => {
    const matches = series(Array(15).fill(true))
    expect(run(matches, 5, ["subject"], new Map())).toHaveLength(0)
  })

  it("does not move a player below the production evidence floor", () => {
    // Fifteen matches played, but only four carry a scoreboard.
    const matches = series(Array(15).fill(true))
    const full = productionAll(matches, 8)
    const thin: ProductionByMatch = new Map([...full].slice(0, 4))
    expect(run(matches, 5, ["subject"], new Map(), thin)).toHaveLength(0)
  })

  it("ignores a board too thin to standardise", () => {
    const matches = series(Array(15).fill(true))
    const thin: ProductionByMatch = new Map(
      [...productionAll(matches, 8)].map(([id, board]) => [
        id,
        new Map([...board].slice(0, 3)), // fewer rows than MIN_BOARD_ROWS
      ]),
    )
    expect(run(matches, 5, ["subject"], new Map(), thin)).toHaveLength(0)
  })
})

describe("computeTierMoves: the evidence window", () => {
  it("does not move below the MIN_GAMES evidence floor", () => {
    expect(runPlaying(4, 10)).toHaveLength(0)
  })

  it("ignores games played at a different snapshot tier", () => {
    const matches = series(Array(15).fill(true), 7) // snapshots say 7
    // …but the player is currently a 5, so none of it counts.
    expect(run(matches, 5, ["subject"], new Map(), productionAll(matches, 10))).toHaveLength(0)
  })

  it("ignores games played before the player's last tier change", () => {
    const matches = series(Array(15).fill(true))
    const production = productionAll(matches, 9)
    // Reset after every match in the series: nothing is left to judge.
    const reset = new Map([["subject", at(99)]])
    expect(run(matches, 5, ["subject"], reset, production)).toHaveLength(0)
  })

  it("counts games played at or after the tier change", () => {
    const matches = series(Array(20).fill(true))
    const production = productionAll(matches, 9)
    const reset = new Map([["subject", at(4.5)]]) // keeps matches 5..19
    expect(run(matches, 5, ["subject"], reset, production)).toHaveLength(1)
  })

  it("counts only the most recent WINDOW_CAP evaluations", () => {
    // Evaluations stop at WINDOW_CAP, so a very long run cannot keep nudging.
    const long = runPlaying(60, 8)
    const capped = runPlaying(15, 8)
    expect(long[0].latent).toBeCloseTo(capped[0].latent, 10)
  })

  it("skips draws entirely", () => {
    const matches = series(Array(15).fill(true)).map((m) => ({ ...m, red_score: 3, blue_score: 3 }))
    expect(run(matches, 5, ["subject"], new Map(), productionAll(matches, 10))).toHaveLength(0)
  })

  it("evaluates only the named candidates", () => {
    const matches = series(Array(15).fill(true))
    expect(run(matches, 5, [], new Map(), productionAll(matches, 10))).toHaveLength(0)
  })

  it("applies each player's own reset, not a shared one", () => {
    const matches = series(Array(15).fill(true))
    const production = productionAll(matches, 9)
    const tiers = new Map([
      ["subject", 5],
      ["r1", 5],
    ])
    // Only the subject is reset past the end of the series.
    const moves = computeTierMoves(
      matches,
      tiers,
      ["subject", "r1"],
      new Map([["subject", at(99)]]),
      production,
    )
    expect(moves.some((m) => m.name === "subject")).toBe(false)
  })
})

describe("computeTierMoves: what a move reports", () => {
  it("carries the production evidence the decision rests on", () => {
    const move = runPlaying(15, 8)[0]
    expect(move.productionGames).toBe(15)
    expect(move.estimatedTier).toBeCloseTo(8, 1)
    expect(move.latent).toBeGreaterThan(move.from)
  })

  it("still carries win/loss for display, without deciding on it", () => {
    const move = runPlaying(15, 8, 5, true)[0]
    expect(move.games).toBe(15)
    expect(move.actualWinRate).toBe(1)
    expect(move.expectedWinRate).toBeCloseTo(0.5, 5)
    expect(move.gap).toBeCloseTo(0.5, 5)
  })
})

describe("computeTierMoves: never more than one tier per write", () => {
  it("caps a huge apparent misplacement at a single tier", () => {
    // The latent may drift two tiers, but the write is +/-1. A player who looks
    // three tiers too low is promoted once, then has to earn the next step.
    const moves = runPlaying(15, 30)
    expect(moves[0].to).toBe(6)
    expect(moves[0].latent).toBeGreaterThan(6.5)
  })

  it("caps a huge apparent overrating at a single tier too", () => {
    const moves = runPlaying(15, -20)
    expect(moves[0].to).toBe(4)
  })
})
