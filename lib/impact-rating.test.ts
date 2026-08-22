import { describe, expect, it } from "vitest"
import { ALL_TIME_MIN_MATCHES, MONTHLY_MIN_FRACTION, computeImpactBoard } from "@/lib/impact-rating"
import type { ImpactMatch, ImpactPlayer, ImpactStatRow } from "@/lib/impact-rating"

/*
 * Impact is two votes added together: win rate, ELO and TrueSkill collapsed into
 * one "results" vote (they correlate 0.93-0.97 with each other over a month, so
 * summing them raw would let "who won" outvote production 3-to-1), plus average
 * score per game as the other vote. The tests below pin the behaviours a reader
 * would notice if they broke -- who qualifies, what counts as a played match, that
 * the ratings really do reset each month, and that collapsing the results actually
 * happens rather than exact decimals, which are free to move.
 */

function stat(matchId: string, playerId: string, over: Partial<ImpactStatRow> = {}): ImpactStatRow {
  return {
    match_id: matchId,
    player_id: playerId,
    team: "red",
    score: 0,
    captures: 0,
    returns: 0,
    base_cleaner: 0,
    assists: 0,
    flag_grabs: 0,
    kills: 0,
    deaths: 0,
    time_played: 20,
    ...over,
  }
}

/**
 * One match's scoreboard, padded to `totalRows` with ids deliberately NOT on the
 * roster. A match only counts as statted at eight rows, and off-roster fillers are
 * the right padding precisely because the board drops them: they make the match
 * real without joining the pool.
 */
function scoreboard(matchId: string, lines: Record<string, Partial<ImpactStatRow>>, totalRows = 8): ImpactStatRow[] {
  const real = Object.entries(lines).map(([playerId, line]) => stat(matchId, playerId, line))
  const fillers = Array.from({ length: Math.max(0, totalRows - real.length) }, (_, i) =>
    stat(matchId, `ghost-${matchId}-${i}`),
  )
  return [...real, ...fillers]
}

const match = (id: string, red: string[], blue: string[], redScore: number, blueScore: number): ImpactMatch => ({
  id,
  red_team: red,
  blue_team: blue,
  red_score: redScore,
  blue_score: blueScore,
})

const player = (name: string, tier: number | null = 5): ImpactPlayer => ({ id: name, name, tier_value: tier })

const rowFor = (board: ReturnType<typeof computeImpactBoard>, name: string) => {
  const row = board.rows.find((r) => r.name === name)
  if (!row) throw new Error(`expected ${name} on the board, got ${board.rows.map((r) => r.name).join(", ") || "nobody"}`)
  return row
}

// ---------------------------------------------------------------------------

describe("computeImpactBoard: qualification and match counting", () => {
  const players = [player("regular"), player("cameo")]
  const matches = Array.from({ length: 4 }, (_, i) => match(`m${i}`, ["regular", "cameo"], ["ghost"], 5, 3))
  const statRows = matches.flatMap((m, i) =>
    // cameo only appears on the first scoreboard, so they fall under any bar above one.
    scoreboard(m.id, i === 0 ? { regular: {}, cameo: {} } : { regular: {} }),
  )

  it("drops players below the bar", () => {
    const board = computeImpactBoard(matches, statRows, players, { minGames: 3 })
    expect(board.rows.map((r) => r.name)).toEqual(["regular"])
  })

  it("resolves a fraction against the matches that HAVE a scoreboard", () => {
    // Six matches, four of them statted -> a 0.5 fraction must mean 2, not 3.
    const more = [...matches, match("x1", ["regular"], ["ghost"], 1, 2), match("x2", ["regular"], ["ghost"], 2, 1)]
    const board = computeImpactBoard(more, statRows, players, { minGamesFraction: 0.5 })
    expect(board.stattedMatches).toBe(4)
    expect(board.totalMatches).toBe(6)
    expect(board.minGames).toBe(2)
  })

  it("does not count a short scoreboard as a statted match", () => {
    const thin = scoreboard("solo", { regular: {} }, 7)
    const board = computeImpactBoard([match("solo", ["regular"], ["ghost"], 1, 0)], thin, players, { minGames: 1 })
    expect(board.stattedMatches).toBe(0)
    expect(board.rows).toEqual([])
  })

  it("returns an empty board, not a crash, when no match has stats", () => {
    const board = computeImpactBoard(matches, [], players, { minGames: 1 })
    expect(board.rows).toEqual([])
    expect(board.totalMatches).toBe(4)
    expect(board.stattedMatches).toBe(0)
  })

  it("ignores a scoreboard row for someone who is not on the roster", () => {
    const withStranger = [...statRows, stat("m0", "not-a-player", { score: 9999 })]
    const board = computeImpactBoard(matches, withStranger, players, { minGames: 3 })
    expect(board.rows.map((r) => r.name)).toEqual(["regular"])
  })
})

describe("computeImpactBoard: the win record", () => {
  const players = [player("duke")]
  /*
   * Five matches, only three with a scoreboard. Win rate, ELO and TrueSkill are
   * built from results, which the site has for every match; only score per game
   * needs the upload. So the record must span all five.
   */
  const matches = [
    match("a", ["duke"], ["ghost"], 5, 1),
    match("b", ["duke"], ["ghost"], 2, 5),
    match("c", ["duke"], ["ghost"], 3, 3),
    match("d", ["duke"], ["ghost"], 1, 5),
    match("e", ["duke"], ["ghost"], 4, 5),
  ]
  const statRows = ["a", "b", "c"].flatMap((id) => scoreboard(id, { duke: { score: 300 } }))
  const board = computeImpactBoard(matches, statRows, players, { minGames: 3 })

  it("counts wins, losses and draws over every match in range", () => {
    const duke = rowFor(board, "duke")
    expect(duke.wins).toBe(1)
    expect(duke.losses).toBe(3)
    expect(duke.draws).toBe(1)
    expect(duke.winPct).toBeCloseTo(20, 10)
    // ...while the games count is scoreboard games, which is what score/game divides by.
    expect(duke.games).toBe(3)
  })

  it("keeps only the last five results, newest last", () => {
    const seven = [
      match("p", ["duke"], ["ghost"], 5, 0),
      match("q", ["duke"], ["ghost"], 0, 5),
      ...matches,
    ]
    // p W, q L, then a W, b L, c D, d L, e L -> the last five are a..e.
    const row = rowFor(computeImpactBoard(seven, statRows, players, { minGames: 3 }), "duke")
    expect(row.form).toEqual(["W", "L", "D", "L", "L"])
  })
})

describe("computeImpactBoard: results collapsed to one vote, plus score", () => {
  /*
   * Three players whose results and scoreboards are deliberately pulled apart, so
   * each part of the sum can be seen moving on its own. `winner` wins everything
   * while scoring little; `scorer` loses everything while scoring heavily; `middle`
   * sits between them and anchors the pool so the z-scores have a spread.
   */
  const players = [player("winner", 6), player("scorer", 7), player("middle", 5)]
  const matches = Array.from({ length: 6 }, (_, i) =>
    match(`m${i}`, ["winner"], ["scorer", "middle"], 5, 2),
  )
  const statRows = matches.flatMap((m) =>
    scoreboard(m.id, {
      winner: { score: 100 },
      scorer: { score: 900, team: "blue" },
      middle: { score: 400, team: "blue" },
    }),
  )
  const board = computeImpactBoard(matches, statRows, players, { minGames: 6 })

  /*
   * The value is resultsZ + scoreZ, NOT the four raw z-scores summed. Win rate, ELO
   * and TrueSkill are collapsed into one results vote first (averaged, then
   * re-standardised) so that "who won" cannot outvote production 3-to-1 -- see the
   * module header for why, and the reliability numbers that justified it.
   */
  it("adds the collapsed results vote to the score vote, not all four raw parts", () => {
    for (const row of board.rows) {
      expect(row.value).toBeCloseTo(row.resultsZ + row.scoreZ, 10)
      // The raw sum of all four is a DIFFERENT, larger number -- this is the
      // formula this design deliberately moved away from.
      const rawSum = row.winRateZ + row.eloZ + row.trueSkillZ + row.scoreZ
      if (Math.abs(row.resultsZ - row.winRateZ) > 1e-9) {
        expect(row.value).not.toBeCloseTo(rawSum, 6)
      }
    }
  })

  it("standardises each part across the pool, so each sums to zero", () => {
    const sum = (f: (r: (typeof board.rows)[number]) => number) => board.rows.reduce((a, r) => a + f(r), 0)
    expect(sum((r) => r.winRateZ)).toBeCloseTo(0, 8)
    expect(sum((r) => r.eloZ)).toBeCloseTo(0, 8)
    expect(sum((r) => r.trueSkillZ)).toBeCloseTo(0, 8)
    expect(sum((r) => r.scoreZ)).toBeCloseTo(0, 8)
    expect(sum((r) => r.resultsZ)).toBeCloseTo(0, 8)
  })

  it("re-standardises the averaged results, so a unanimous result reads the same as any other extreme", () => {
    // winner sweeps win rate, ELO and TrueSkill alike, so averaging them and
    // re-standardising must not shrink their spread relative to a single raw
    // z-score -- that shrinkage is exactly the bug re-standardising exists to fix.
    const winner = rowFor(board, "winner")
    expect(Math.abs(winner.resultsZ)).toBeGreaterThan(0)
    // With three players and winner sweeping all results, its resultsZ should be
    // as extreme as any individual results z-score it was built from -- collapsing
    // must not quietly turn into an averaging-away of the signal.
    const maxIndividual = Math.max(Math.abs(winner.winRateZ), Math.abs(winner.eloZ), Math.abs(winner.trueSkillZ))
    expect(Math.abs(winner.resultsZ)).toBeGreaterThan(maxIndividual * 0.9)
  })

  it("puts the winner top on results and the scorer top on score", () => {
    const winner = rowFor(board, "winner")
    const scorer = rowFor(board, "scorer")
    expect(winner.winRateZ).toBeGreaterThan(scorer.winRateZ)
    expect(winner.eloZ).toBeGreaterThan(scorer.eloZ)
    expect(winner.trueSkillZ).toBeGreaterThan(scorer.trueSkillZ)
    expect(winner.resultsZ).toBeGreaterThan(scorer.resultsZ)
    expect(scorer.scoreZ).toBeGreaterThan(winner.scoreZ)
  })

  /*
   * The load-bearing property of this design, and the reason it measures as weakly
   * as it does: three of the four parts are built from nothing but who won, so they
   * move together. Whoever won more must lead on all three.
   */
  it("moves win rate, ELO and TrueSkill together", () => {
    const byWin = [...board.rows].sort((a, b) => b.winRateZ - a.winRateZ).map((r) => r.name)
    const byElo = [...board.rows].sort((a, b) => b.eloZ - a.eloZ).map((r) => r.name)
    const byTs = [...board.rows].sort((a, b) => b.trueSkillZ - a.trueSkillZ).map((r) => r.name)
    expect(byElo).toEqual(byWin)
    expect(byTs).toEqual(byWin)
  })

  it("sorts the board by the summed value, highest first", () => {
    const values = board.rows.map((r) => r.value)
    expect([...values].sort((a, b) => b - a)).toEqual(values)
  })

  it("carries the raw totals through untouched", () => {
    const scorer = rowFor(board, "scorer")
    expect(scorer.tier).toBe(7)
    expect(scorer.games).toBe(6)
    expect(scorer.scorePerGame).toBeCloseTo(900, 10)
    expect(scorer.minutes).toBe(120)
    expect(scorer.scorePerMin).toBeCloseTo(45, 10)
  })
})

describe("computeImpactBoard: the ratings reset", () => {
  /*
   * ELO and TrueSkill are replayed from level over whatever match list they are
   * handed, so a monthly board reflects the month rather than the rating a player
   * carried into it. Two identical months must therefore produce identical ratings,
   * and a player who lost heavily in the first must not start the second behind.
   */
  const players = [player("a"), player("b")]
  const monthOne = [match("j1", ["a"], ["b"], 7, 0), match("j2", ["a"], ["b"], 7, 0), match("j3", ["a"], ["b"], 7, 1)]
  const monthTwo = [match("k1", ["a"], ["b"], 7, 0), match("k2", ["a"], ["b"], 7, 0), match("k3", ["a"], ["b"], 7, 1)]
  const statsFor = (ms: ImpactMatch[]) =>
    ms.flatMap((m) => scoreboard(m.id, { a: { score: 500 }, b: { score: 400, team: "blue" } }))

  it("gives the same ratings to two identical months", () => {
    const one = computeImpactBoard(monthOne, statsFor(monthOne), players, { minGames: 3 })
    const two = computeImpactBoard(monthTwo, statsFor(monthTwo), players, { minGames: 3 })
    expect(one.rows.map((r) => r.elo)).toEqual(two.rows.map((r) => r.elo))
    expect(one.rows.map((r) => r.trueSkill)).toEqual(two.rows.map((r) => r.trueSkill))
  })

  it("replays in the order it is handed, so results early in the month still count", () => {
    const forwards = computeImpactBoard(monthOne, statsFor(monthOne), players, { minGames: 3 })
    const backwards = computeImpactBoard([...monthOne].reverse(), statsFor(monthOne), players, { minGames: 3 })
    // Same matches, different order -> ELO lands somewhere different, which is why
    // the caller has to hand them over oldest-first.
    expect(rowFor(forwards, "a").elo).not.toBeCloseTo(rowFor(backwards, "a").elo, 6)
  })
})

describe("the qualifying constants", () => {
  it("keeps the 30% monthly rule and the flat all-time bar", () => {
    expect(MONTHLY_MIN_FRACTION).toBeCloseTo(0.3, 10)
    expect(ALL_TIME_MIN_MATCHES).toBe(20)
  })
})
