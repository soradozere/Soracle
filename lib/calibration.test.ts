import { describe, expect, it } from "vitest"
import { CALIBRATION, computeTierMoves, type CalibrationMatch } from "@/lib/calibration"

// Build an even 6v6 (both tier sums 30 → expected 0.5 each side) with the
// subject on red at the given snapshot tier, adjusting a red teammate so the
// sums stay equal. Timestamps count down so index 0 is the newest match.
function evenMatch(subjectTier: number, redWins: boolean, index: number): CalibrationMatch {
  const filler = 30 - subjectTier - 20 // four red fillers at 5 + one balancer slot
  return {
    red_team: ["subject", "r1", "r2", "r3", "r4", "r5"],
    blue_team: ["b1", "b2", "b3", "b4", "b5", "b6"],
    red_tiers: [subjectTier, filler, 5, 5, 5, 5],
    blue_tiers: [5, 5, 5, 5, 5, 5],
    red_score: redWins ? 5 : 2,
    blue_score: redWins ? 2 : 5,
    created_at: new Date(Date.UTC(2026, 7, 1, 12, 0, 0) - index * 3_600_000).toISOString(),
  }
}

const series = (results: boolean[], tier = 5) => results.map((w, i) => evenMatch(tier, w, i))

const run = (matches: CalibrationMatch[], tier = 5, candidates = ["subject"]) =>
  computeTierMoves(matches, new Map([["subject", tier]]), candidates)

describe("computeTierMoves", () => {
  it("promotes after ten straight wins against even expectations", () => {
    const moves = run(series(Array(10).fill(true)))
    expect(moves).toHaveLength(1)
    expect(moves[0]).toMatchObject({ name: "subject", from: 5, to: 6, games: 10 })
    expect(moves[0].gap).toBeCloseTo(0.5)
  })

  it("demotes after ten straight losses", () => {
    const moves = run(series(Array(10).fill(false)))
    expect(moves).toHaveLength(1)
    expect(moves[0].to).toBe(4)
  })

  it("does not move below the MIN_GAMES evidence floor", () => {
    const moves = run(series(Array(CALIBRATION.MIN_GAMES - 1).fill(true)))
    expect(moves).toHaveLength(0)
  })

  it("holds a 9-3 run under the small-sample bar at 10-14 games", () => {
    // gap 0.25: clears GAP_FULL (0.2) but not GAP_SMALL (0.3) — the stricter
    // bar applies until FULL_SAMPLE_GAMES.
    const moves = run(series([...Array(9).fill(true), ...Array(3).fill(false)]))
    expect(moves).toHaveLength(0)
  })

  it("moves an 11-4 run at fifteen games — the full-sample bar applies", () => {
    // gap 11/15 − 0.5 ≈ 0.233 >= GAP_FULL 0.2
    const moves = run(series([...Array(11).fill(true), ...Array(4).fill(false)]))
    expect(moves).toHaveLength(1)
    expect(moves[0].to).toBe(6)
    expect(moves[0].games).toBe(15)
  })

  it("ignores games played at a different snapshot tier — the evidence reset", () => {
    // Ten wins at snapshot tier 5, but the player is CURRENTLY tier 6 (an
    // admin just moved them): none of it counts.
    const moves = run(series(Array(10).fill(true)), 6)
    expect(moves).toHaveLength(0)
  })

  it("skips draws entirely", () => {
    const matches = series(Array(10).fill(true))
    const draw = evenMatch(5, true, 10)
    draw.red_score = 3
    draw.blue_score = 3
    const moves = run([...matches, draw])
    expect(moves[0].games).toBe(10)
  })

  it("clamps at tier 10 — an overperforming 10 has nowhere to go", () => {
    const matches = Array.from({ length: 10 }, (_, i) => {
      const m = evenMatch(10, true, i)
      m.red_tiers = [10, 4, 4, 4, 4, 4]
      m.blue_tiers = [5, 5, 5, 5, 5, 5]
      return m
    })
    const moves = computeTierMoves(matches, new Map([["subject", 10]]), ["subject"])
    expect(moves).toHaveLength(0)
  })

  it("counts only the most recent WINDOW_CAP games", () => {
    // 15 recent losses then 10 older wins, all at tier 5: the window keeps the
    // slump; a lifetime average would wash it out.
    const losses = series(Array(CALIBRATION.WINDOW_CAP).fill(false))
    const olderWins = Array.from({ length: 10 }, (_, i) => evenMatch(5, true, CALIBRATION.WINDOW_CAP + i))
    const moves = run([...losses, ...olderWins])
    expect(moves).toHaveLength(1)
    expect(moves[0].to).toBe(4)
    expect(moves[0].games).toBe(CALIBRATION.WINDOW_CAP)
  })

  it("evaluates only the named candidates", () => {
    const matches = series(Array(10).fill(true))
    const tiers = new Map([
      ["subject", 5],
      ["b1", 5],
    ])
    const moves = computeTierMoves(matches, tiers, ["b1"])
    // b1 lost all ten (they were on blue) — they demote; subject is not evaluated.
    expect(moves.map((m) => m.name)).toEqual(["b1"])
  })
})
