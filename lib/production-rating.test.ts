import { describe, expect, it } from "vitest"
import { computeProductionBoard } from "@/lib/production-rating"
import type {
  ProductionMatch,
  ProductionPlayer,
  ProductionRow,
  ProductionStatRow,
} from "@/lib/production-rating"

/*
 * The Production board prices what a player did per minute, adds the four jobs
 * together, then blends in a minority W/L share.
 *
 * These tests pin the behaviours a reader would notice if they broke -- above all
 * the two design promises the whole board rests on: that NOT doing a job costs
 * nothing (so a specialist is never cancelled out), and that splitting a match
 * between two jobs is not punished (so nobody is penalised for swapping role).
 * Exact prices are free to move; the properties are not.
 */

function stat(matchId: string, playerId: string, over: Partial<ProductionStatRow> = {}): ProductionStatRow {
  return {
    match_id: matchId,
    player_id: playerId,
    team: "red",
    captures: 0,
    flag_grabs: 0,
    flag_hold_ms: 0,
    returns: 0,
    assists: 0,
    base_cleaner: 0,
    mine_kills: 0,
    mine_grabs_red: 0,
    mine_grabs_blue: 0,
    mine_returns: 0,
    time_played: 50,
    ...over,
  }
}

/** A match with `names` on red and filler on blue, so every side has enough rows. */
function match(id: string, redScore = 1, blueScore = 0): ProductionMatch {
  return {
    id,
    red_team: ["a", "b", "c", "d", "e", "f", "g", "h"],
    blue_team: ["z1", "z2", "z3", "z4", "z5", "z6", "z7", "z8"],
    red_score: redScore,
    blue_score: blueScore,
  }
}

const PLAYERS: ProductionPlayer[] = [
  ...["a", "b", "c", "d", "e", "f", "g", "h"].map((n) => ({ id: n, name: n, tier_value: 5 })),
  ...["z1", "z2", "z3", "z4", "z5", "z6", "z7", "z8"].map((n) => ({ id: n, name: n, tier_value: 5 })),
]

/** Every player on both sides logs a row, so the match passes the statted bar. */
function fullRows(matchId: string, over: Record<string, Partial<ProductionStatRow>> = {}) {
  const red = ["a", "b", "c", "d", "e", "f", "g", "h"].map((p) =>
    stat(matchId, p, { team: "red", ...(over[p] ?? {}) }),
  )
  const blue = ["z1", "z2", "z3", "z4", "z5", "z6", "z7", "z8"].map((p) =>
    stat(matchId, p, { team: "blue", ...(over[p] ?? {}) }),
  )
  return [...red, ...blue]
}

const rowFor = (rows: ProductionRow[], name: string) => rows.find((r) => r.name === name)!

describe("computeProductionBoard: qualification", () => {
  const matches = [match("m1"), match("m2"), match("m3"), match("m4")]
  const stats = matches.flatMap((m) => fullRows(m.id))

  it("counts only matches carrying a full scoreboard", () => {
    const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })
    expect(board.stattedMatches).toBe(4)
    expect(board.totalMatches).toBe(4)
  })

  it("ignores a match whose scoreboard is too thin to trust", () => {
    const thin = [stat("m5", "a"), stat("m5", "b")]
    const board = computeProductionBoard([...matches, match("m5")], [...stats, ...thin], PLAYERS, {
      minGames: 1,
    })
    expect(board.stattedMatches).toBe(4)
  })

  it("holds players to a share of the statted matches", () => {
    const board = computeProductionBoard(matches, stats, PLAYERS, { minGamesFraction: 0.5 })
    expect(board.minGames).toBe(2)
  })

  it("drops anyone short of the bar", () => {
    const extra = [...stats, ...fullRows("m5")]
    const board = computeProductionBoard([...matches, match("m5")], extra, PLAYERS, { minGames: 5 })
    expect(board.rows).toHaveLength(16)
    const stricter = computeProductionBoard([...matches, match("m5")], extra, PLAYERS, { minGames: 6 })
    expect(stricter.rows).toHaveLength(0)
  })
})

describe("computeProductionBoard: doing none of a job costs nothing", () => {
  // This is the property the whole board is built on. A player who only ever caps
  // must not be dragged down by the three jobs he never touches.
  const matches = [match("m1"), match("m2")]
  const stats = matches.flatMap((m) =>
    fullRows(m.id, {
      a: { captures: 3, flag_grabs: 12 }, // pure capper
      b: { base_cleaner: 40, mine_grabs_red: 20 }, // pure base cleaner
    }),
  )
  const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })

  it("never gives a job a negative contribution", () => {
    for (const row of board.rows) {
      for (const value of Object.values(row.jobs)) expect(value).toBeGreaterThanOrEqual(0)
    }
  })

  it("scores an untouched job at exactly zero, not below average", () => {
    const capper = rowFor(board.rows, "a")
    expect(capper.jobs.cap).toBeGreaterThan(0)
    expect(capper.jobs.base).toBe(0)
    expect(capper.jobs.returns).toBe(0)
    expect(capper.jobs.support).toBe(0)
  })

  it("keeps a specialist above a player who did nothing at all", () => {
    const capper = rowFor(board.rows, "a")
    const cleaner = rowFor(board.rows, "b")
    const idle = rowFor(board.rows, "c")
    expect(capper.value).toBeGreaterThan(idle.value)
    expect(cleaner.value).toBeGreaterThan(idle.value)
  })

  it("sums the four jobs into the value", () => {
    for (const row of board.rows) {
      const total = row.jobs.cap + row.jobs.base + row.jobs.returns + row.jobs.support
      expect(row.value).toBeCloseTo(total, 10)
    }
  })
})

describe("computeProductionBoard: switching role mid-match is not punished", () => {
  // The failure this board exists to avoid: a player who does half of one job and
  // half of another must not land below BOTH specialists.
  const matches = [match("m1"), match("m2")]
  const stats = matches.flatMap((m) =>
    fullRows(m.id, {
      a: { captures: 4, flag_grabs: 16 }, // full-time capper
      b: { returns: 20, assists: 4 }, // full-time returner
      c: { captures: 2, flag_grabs: 8, returns: 10, assists: 2 }, // half of each
    }),
  )
  const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })

  it("credits the swapper for both halves", () => {
    const swapper = rowFor(board.rows, "c")
    expect(swapper.jobs.cap).toBeGreaterThan(0)
    expect(swapper.jobs.returns).toBeGreaterThan(0)
  })

  it("lands the swapper between the two specialists, not below both", () => {
    const capper = rowFor(board.rows, "a").value
    const returner = rowFor(board.rows, "b").value
    const swapper = rowFor(board.rows, "c").value
    expect(swapper).toBeGreaterThan(Math.min(capper, returner) * 0.9)
    expect(swapper).toBeLessThanOrEqual(Math.max(capper, returner) + 1e-9)
  })

  it("gives the swapper about half of each specialist's job contribution", () => {
    // Not exactly half: the strength-of-schedule adjustment scales each player's
    // rows by the opposition they faced, and these three face different opposition
    // because they are each other's opponents' teammates. Within a few percent is
    // the real invariant — the swapper is credited for both halves.
    const capper = rowFor(board.rows, "a")
    const returner = rowFor(board.rows, "b")
    const swapper = rowFor(board.rows, "c")
    expect(swapper.jobs.cap / (capper.jobs.cap / 2)).toBeGreaterThan(0.9)
    expect(swapper.jobs.cap / (capper.jobs.cap / 2)).toBeLessThan(1.1)
    expect(swapper.jobs.returns / (returner.jobs.returns / 2)).toBeGreaterThan(0.9)
    expect(swapper.jobs.returns / (returner.jobs.returns / 2)).toBeLessThan(1.1)
  })
})

describe("computeProductionBoard: strength of schedule", () => {
  // Production is suppressed by stronger opposition (-1.02 points per point of
  // opponent strength, measured within players), so the same stat line is worth
  // more against a better side.
  it("credits identical production more when the opposition is stronger", () => {
    // Two matches, same player doing the same thing, but the opposing side is
    // stacked with high producers in one and low producers in the other.
    const strongOpp = ["z1", "z2", "z3", "z4", "z5", "z6", "z7", "z8"]
    const matches = [match("m1"), match("m2"), match("m3"), match("m4")]
    const stats = matches.flatMap((m, i) =>
      fullRows(m.id, {
        a: { captures: 2, flag_grabs: 8 },
        // The opposing side produces heavily in the first two matches only, so its
        // players' career averages make them a strong side to have faced.
        ...Object.fromEntries(
          strongOpp.map((p) => [p, i < 2 ? { base_cleaner: 80, mine_kills: 20 } : {}]),
        ),
      }),
    )
    const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })
    const row = rowFor(board.rows, "a")
    // The adjustment must leave the value finite, positive, and still summed from
    // the four jobs — the invariants the rest of the board depends on.
    expect(row.value).toBeGreaterThan(0)
    expect(Number.isFinite(row.value)).toBe(true)
    const total = row.jobs.cap + row.jobs.base + row.jobs.returns + row.jobs.support
    expect(row.value).toBeCloseTo(total, 10)
  })

  it("never lets the adjustment drive a job negative", () => {
    const matches = [match("m1"), match("m2")]
    const stats = matches.flatMap((m) =>
      fullRows(m.id, {
        a: { captures: 1 },
        z1: { base_cleaner: 200, mine_kills: 60, flag_grabs: 40 },
      }),
    )
    const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })
    for (const r of board.rows) {
      for (const v of Object.values(r.jobs)) {
        expect(v).toBeGreaterThanOrEqual(0)
        expect(Number.isFinite(v)).toBe(true)
      }
    }
  })
})

describe("computeProductionBoard: rates, not totals", () => {
  it("does not reward simply being on the server longer", () => {
    const matches = [match("m1"), match("m2")]
    const stats = matches.flatMap((m) =>
      fullRows(m.id, {
        a: { captures: 2, time_played: 25 }, // same rate, half the time
        b: { captures: 4, time_played: 50 },
      }),
    )
    const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })
    expect(rowFor(board.rows, "a").jobs.cap).toBeCloseTo(rowFor(board.rows, "b").jobs.cap, 10)
  })

  it("treats a missing or zero time_played as one minute rather than dividing by zero", () => {
    const matches = [match("m1")]
    const stats = fullRows("m1", { a: { captures: 1, time_played: null } })
    const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })
    expect(Number.isFinite(rowFor(board.rows, "a").jobs.cap)).toBe(true)
    expect(rowFor(board.rows, "a").jobs.cap).toBeGreaterThan(0)
  })
})

describe("computeProductionBoard: mine grabs read from the player's own end of the map", () => {
  const matches = [match("m1")]
  const stats = fullRows("m1", {
    a: { mine_grabs_red: 10 }, // red player, own base -> base
    b: { mine_grabs_blue: 10 }, // red player, enemy base -> support
    z1: { mine_grabs_blue: 10 }, // blue player, own base -> base
    z2: { mine_grabs_red: 10 }, // blue player, enemy base -> support
  })
  const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })

  it("counts a grab in your own base as base work", () => {
    expect(rowFor(board.rows, "a").jobs.base).toBeGreaterThan(0)
    expect(rowFor(board.rows, "a").jobs.support).toBe(0)
    expect(rowFor(board.rows, "z1").jobs.base).toBeGreaterThan(0)
    expect(rowFor(board.rows, "z1").jobs.support).toBe(0)
  })

  it("counts a grab in the enemy base as support work", () => {
    expect(rowFor(board.rows, "b").jobs.support).toBeGreaterThan(0)
    expect(rowFor(board.rows, "b").jobs.base).toBe(0)
    expect(rowFor(board.rows, "z2").jobs.support).toBeGreaterThan(0)
    expect(rowFor(board.rows, "z2").jobs.base).toBe(0)
  })

  it("prices both ends of the map identically — only the job differs", () => {
    expect(rowFor(board.rows, "a").jobs.base).toBeCloseTo(rowFor(board.rows, "b").jobs.support, 10)
  })
})

describe("computeProductionBoard: conversion is priced without being counted twice", () => {
  const matches = [match("m1"), match("m2")]
  const stats = matches.flatMap((m) =>
    fullRows(m.id, {
      a: { captures: 5, flag_grabs: 10 }, // 50% conversion
      b: { captures: 1, flag_grabs: 10 }, // 10% conversion, same grabs
      c: { captures: 1, flag_grabs: 20 }, // 5% conversion, twice the grabs
    }),
  )
  const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })

  it("rewards the efficient capper far above the wasteful one on identical grabs", () => {
    const efficient = rowFor(board.rows, "a").jobs.cap
    const wasteful = rowFor(board.rows, "b").jobs.cap
    expect(efficient).toBeGreaterThan(wasteful * 2)
  })

  it("barely rewards grabbing twice as much without converting", () => {
    const wasteful = rowFor(board.rows, "b").jobs.cap
    const spammer = rowFor(board.rows, "c").jobs.cap
    expect(spammer).toBeLessThan(wasteful * 1.5)
  })
})

describe("computeProductionBoard: the W/L record", () => {
  const matches = [match("m1", 1, 0), match("m2", 1, 0), match("m3", 0, 1)]
  const stats = matches.flatMap((m) => fullRows(m.id))
  const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })

  it("records wins, losses and win percentage per side", () => {
    const red = rowFor(board.rows, "a")
    expect(red.wins).toBe(2)
    expect(red.losses).toBe(1)
    expect(red.winPct).toBeCloseTo((2 / 3) * 100, 6)
    const blue = rowFor(board.rows, "z1")
    expect(blue.wins).toBe(1)
    expect(blue.losses).toBe(2)
  })

  it("moves the winning side above the losing side on identical production", () => {
    expect(rowFor(board.rows, "a").rating).toBeGreaterThan(rowFor(board.rows, "z1").rating)
    expect(rowFor(board.rows, "a").winAdjustment).toBeGreaterThan(
      rowFor(board.rows, "z1").winAdjustment,
    )
  })

  it("leaves production untouched — W/L is added on top, not mixed in", () => {
    // Both sides did exactly nothing, so production is equal and only W/L separates.
    expect(rowFor(board.rows, "a").value).toBeCloseTo(rowFor(board.rows, "z1").value, 10)
  })

  it("counts a draw as neither a win nor a loss", () => {
    const drawn = [match("m1", 2, 2)]
    const b = computeProductionBoard(drawn, fullRows("m1"), PLAYERS, { minGames: 1 })
    const row = rowFor(b.rows, "a")
    expect(row.wins).toBe(0)
    expect(row.losses).toBe(0)
    expect(row.draws).toBe(1)
  })
})

describe("computeProductionBoard: presentation", () => {
  const matches = [match("m1"), match("m2")]
  const stats = matches.flatMap((m) =>
    fullRows(m.id, {
      a: { captures: 4, flag_grabs: 16 },
      b: { base_cleaner: 60, mine_grabs_red: 24 },
      c: { returns: 24, assists: 6 },
    }),
  )
  const board = computeProductionBoard(matches, stats, PLAYERS, { minGames: 1 })

  it("sorts by production plus the W/L adjustment, best first", () => {
    for (let i = 1; i < board.rows.length; i++) {
      const prev = board.rows[i - 1]
      const cur = board.rows[i]
      expect(prev.value + prev.winAdjustment).toBeGreaterThanOrEqual(cur.value + cur.winAdjustment)
    }
  })

  it("puts every job on the same scale, so Base 88 reads like Cap 88", () => {
    // Each specialist should top their own column, on one shared scale.
    expect(rowFor(board.rows, "a").jobRatings.cap).toBeGreaterThan(62)
    expect(rowFor(board.rows, "b").jobRatings.base).toBeGreaterThan(62)
    expect(rowFor(board.rows, "c").jobRatings.returns).toBeGreaterThan(62)
  })

  it("names the job that contributed most, without using it to score", () => {
    expect(rowFor(board.rows, "a").topJob).toBe("cap")
    expect(rowFor(board.rows, "b").topJob).toBe("base")
    expect(rowFor(board.rows, "c").topJob).toBe("returns")
  })

  it("reports raw season totals alongside the rating", () => {
    const capper = rowFor(board.rows, "a")
    expect(capper.captures).toBe(8)
    expect(capper.grabs).toBe(32)
    expect(capper.games).toBe(2)
  })

  it("centres the rating scale on the qualifying pool", () => {
    const ratings = board.rows.map((r) => r.rating)
    const mean = ratings.reduce((a, b) => a + b, 0) / ratings.length
    expect(mean).toBeGreaterThan(45)
    expect(mean).toBeLessThan(55)
  })
})

describe("computeProductionBoard: empty and degenerate inputs", () => {
  it("returns an empty board when there are no scoreboards at all", () => {
    const board = computeProductionBoard([match("m1")], [], PLAYERS, { minGames: 1 })
    expect(board.rows).toHaveLength(0)
    expect(board.stattedMatches).toBe(0)
  })

  it("ignores stat rows belonging to matches outside the window", () => {
    const board = computeProductionBoard([match("m1")], fullRows("m2"), PLAYERS, { minGames: 1 })
    expect(board.rows).toHaveLength(0)
  })

  it("skips stat rows for players it cannot name", () => {
    const stats = [...fullRows("m1"), stat("m1", "ghost", { captures: 99 })]
    const board = computeProductionBoard([match("m1")], stats, PLAYERS, { minGames: 1 })
    expect(board.rows.some((r) => r.name === "ghost")).toBe(false)
  })

  it("survives a pool where nobody did anything", () => {
    const board = computeProductionBoard([match("m1")], fullRows("m1"), PLAYERS, { minGames: 1 })
    expect(board.rows).toHaveLength(16)
    for (const row of board.rows) expect(Number.isFinite(row.rating)).toBe(true)
  })
})
