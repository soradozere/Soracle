import { describe, expect, it } from "vitest"
import { capperMonths, type CapperKillRow, type CapperMatchRow, type CapperStatRow } from "./cap-conversion"
import { resolveMonthlySecretHolders } from "./achievements"

/*
 * Wesley's Prodigy — the only MONTH-resolved one-of-one crest. Two halves,
 * tested together because the interesting behaviour is in how they meet:
 *
 *   capperMonths()                 — who was a capper, and what they converted,
 *                                    per completed month (lib/cap-conversion.ts)
 *   resolveMonthlySecretHolders()  — which month settles the crest, forever
 *                                    (lib/achievements.ts)
 *
 * The crest ships with { minConversion: 35, gameFloorFraction: 0.5 }. Tests
 * that depend on those exact numbers say so, so a deliberate retune fails
 * loudly here rather than silently changing who owns the crest.
 */

const NOW = new Date("2026-10-15T12:00:00.000Z")

/** A match on a given day, with the id doubling as a readable label. */
const match = (id: string, iso: string): CapperMatchRow => ({ id, created_at: iso })

/** One scoreboard line. `hold` in ms is what decides who the capper was. */
const stat = (
  match_id: string,
  player_id: string,
  team: string,
  hold: number,
  captures: number,
): CapperStatRow => ({ match_id, player_id, team, flag_hold_ms: hold, captures })

/** `rets` here means "times this player was caught carrying" — the denominator. */
const caught = (match_id: string, victim_player_id: string, rets: number): CapperKillRow => ({
  match_id,
  victim_player_id,
  rets,
})

/**
 * Marks a match as covered by the kill matrix without crediting anyone. Only
 * covered matches are scoreable (see the coverage test below), so every fixture
 * that expects a result has to say the matrix was recorded for that match.
 */
const covers = (match_id: string): CapperKillRow => caught(match_id, "someone-else", 0)

describe("capperMonths", () => {
  it("picks the highest flag hold on each side as that side's capper", () => {
    const rows = capperMonths(
      [match("m1", "2026-09-01T20:00:00Z")],
      [
        stat("m1", "capper", "Red", 600_000, 3),
        stat("m1", "chaser", "Red", 10_000, 1),
        stat("m1", "other", "Blue", 500_000, 2),
      ],
      [covers("m1")],
      NOW,
    )
    expect(rows.map((r) => r.playerId).sort()).toEqual(["capper", "other"])
    // The Red chaser held the flag briefly but was never the capper.
    expect(rows.find((r) => r.playerId === "chaser")).toBeUndefined()
  })

  it("counts everyone tied on flag hold, because a side can run two cappers", () => {
    const rows = capperMonths(
      [match("m1", "2026-09-01T20:00:00Z")],
      [stat("m1", "a", "Red", 300_000, 2), stat("m1", "b", "Red", 300_000, 1)],
      [covers("m1")],
      NOW,
    )
    expect(rows.map((r) => r.playerId).sort()).toEqual(["a", "b"])
  })

  it("gives a side where nobody held the flag no capper at all", () => {
    const rows = capperMonths(
      [match("m1", "2026-09-01T20:00:00Z")],
      [stat("m1", "a", "Red", 0, 0), stat("m1", "b", "Red", 0, 0)],
      [covers("m1")],
      NOW,
    )
    expect(rows).toEqual([])
  })

  it("converts captures over resolved runs, not over grabs", () => {
    const rows = capperMonths(
      [match("m1", "2026-09-01T20:00:00Z")],
      [stat("m1", "a", "Red", 600_000, 3)],
      [caught("m1", "a", 1)],
      NOW,
    )
    // 3 caps, caught once => 3 of 4 resolved runs.
    expect(rows[0].carries).toBe(4)
    expect(rows[0].conversion).toBeCloseTo(75)
  })

  it("excludes the in-progress month — you cannot win a month that isn't over", () => {
    const rows = capperMonths(
      [match("m1", "2026-10-02T20:00:00Z")],
      [stat("m1", "a", "Red", 600_000, 9)],
      [covers("m1")],
      NOW, // October
    )
    expect(rows).toEqual([])
  })

  it("buckets by month in UTC, so an NA-evening match lands in one month for everyone", () => {
    // 23:30 on 30 Sep US-Eastern is 03:30 on 1 Oct UTC -> October, which NOW excludes.
    const rows = capperMonths(
      [match("m1", "2026-10-01T03:30:00Z"), match("m2", "2026-09-30T23:30:00Z")],
      [stat("m1", "a", "Red", 600_000, 5), stat("m2", "a", "Red", 600_000, 5)],
      [covers("m1"), covers("m2")],
      NOW,
    )
    expect(rows).toHaveLength(1)
    expect(rows[0].month).toBe("2026-09")
  })

  it("points at the player's LAST capper game of the month, on parsed timestamps", () => {
    const rows = capperMonths(
      // Mixed offset spellings: a string compare would order these wrongly.
      [match("early", "2026-09-02T20:00:00+00:00"), match("late", "2026-09-20T18:00:00Z")],
      [stat("early", "a", "Red", 600_000, 2), stat("late", "a", "Red", 600_000, 2)],
      [covers("early"), covers("late")],
      NOW,
    )
    expect(rows[0].lastMatchId).toBe("late")
  })

  it("scores ONLY matches the kill matrix covers, or every capper reads 100%", () => {
    // The bug this guards: with no matrix row for a match, nobody is ever
    // recorded as caught, so every carry resolves as a capture. Live June and
    // July 2026 both produced a field of flawless 100% cappers this way.
    const matches = [match("uncovered", "2026-09-05T20:00:00Z"), match("covered", "2026-09-06T20:00:00Z")]
    const stats = [
      stat("uncovered", "a", "Red", 600_000, 4),
      stat("covered", "a", "Red", 600_000, 1),
    ]
    const rows = capperMonths(matches, stats, [caught("covered", "a", 3)], NOW)

    // Only the covered match counts: 1 cap, caught 3 times => 25%, not 5/5.
    expect(rows).toHaveLength(1)
    expect(rows[0].capperGames).toBe(1)
    expect(rows[0].captures).toBe(1)
    expect(rows[0].carries).toBe(4)
    expect(rows[0].conversion).toBeCloseTo(25)
  })

  it("returns nothing at all when the kill matrix is empty (the pre-Aug-2026 era)", () => {
    const rows = capperMonths(
      [match("m1", "2026-06-10T20:00:00Z")],
      [stat("m1", "a", "Red", 600_000, 5)],
      [], // CSV era: no matrix, so no month is scoreable
      NOW,
    )
    expect(rows).toEqual([])
  })

  it("keeps a capper who never resolved a run, at conversion 0, so the floor sees them", () => {
    const rows = capperMonths(
      [match("m1", "2026-09-01T20:00:00Z")],
      [stat("m1", "a", "Red", 600_000, 0)],
      [covers("m1")],
      NOW,
    )
    expect(rows[0].capperGames).toBe(1)
    expect(rows[0].carries).toBe(0)
    expect(rows[0].conversion).toBe(0)
  })
})

describe("resolveMonthlySecretHolders", () => {
  /** Build a month's worth of rows directly, bypassing capperMonths. */
  const row = (
    month: string,
    playerId: string,
    capperGames: number,
    conversion: number,
  ) => ({
    month,
    playerId,
    capperGames,
    captures: 0,
    carries: 10,
    conversion,
    lastMatchId: `${month}-${playerId}`,
    lastDate: `${month}-28T20:00:00Z`,
  })

  it("awards nobody when no month clears the 35% bar", () => {
    // August 2026's real shape: xan led on 28.4%, under the bar.
    const holders = resolveMonthlySecretHolders([
      row("2026-08", "xan", 8, 28.4),
      row("2026-08", "retpecs", 10, 21.7),
      row("2026-08", "interlude", 12, 16.5),
    ])
    expect(holders.size).toBe(0)
  })

  it("awards the EARLIEST qualifying month, not the best one", () => {
    const holders = resolveMonthlySecretHolders([
      row("2026-09", "first", 10, 36),
      row("2026-10", "better", 10, 90), // later, and far better — still loses
    ])
    expect(holders.get("wesleys-prodigy")?.playerId).toBe("first")
  })

  it("settles permanently: a later month cannot take it off the holder", () => {
    const holders = resolveMonthlySecretHolders([
      row("2026-09", "first", 10, 36),
      row("2026-10", "second", 10, 40),
      row("2026-11", "third", 10, 50),
    ])
    expect(holders.size).toBe(1)
    expect(holders.get("wesleys-prodigy")?.playerId).toBe("first")
  })

  it("breaks a same-month tie by conversion, then playerId, so both readers agree", () => {
    const holders = resolveMonthlySecretHolders([
      row("2026-09", "lower", 10, 36),
      row("2026-09", "higher", 10, 42),
    ])
    expect(holders.get("wesleys-prodigy")?.playerId).toBe("higher")

    // Identical conversion -> playerId decides, deterministically.
    const tied = resolveMonthlySecretHolders([
      row("2026-09", "zeta", 10, 40),
      row("2026-09", "alpha", 10, 40),
    ])
    expect(tied.get("wesleys-prodigy")?.playerId).toBe("alpha")
  })

  it("rejects a high conversion below the 50%-of-leader game floor", () => {
    // Leader played 12; floor is 6. A perfect 100% off 2 games doesn't count.
    const holders = resolveMonthlySecretHolders([
      row("2026-09", "flash", 2, 100),
      row("2026-09", "grinder", 12, 20),
    ])
    expect(holders.size).toBe(0)
  })

  it("measures the floor against everyone who played capper, zero-carry rows included", () => {
    const rows = [
      { ...row("2026-09", "busiest", 20, 0), carries: 0 },
      row("2026-09", "contender", 9, 40),
    ]
    // Floor is ceil(20 * 0.5) = 10, so the 9-game contender misses out.
    expect(resolveMonthlySecretHolders(rows).size).toBe(0)

    // One more game and they clear it.
    rows[1] = row("2026-09", "contender", 10, 40)
    expect(resolveMonthlySecretHolders(rows).get("wesleys-prodigy")?.playerId).toBe("contender")
  })

  it("ignores a row that clears the bar on zero resolved runs", () => {
    const holders = resolveMonthlySecretHolders([
      { ...row("2026-09", "ghost", 10, 100), carries: 0 },
    ])
    expect(holders.size).toBe(0)
  })

  it("carries the qualifying month's last match through as the claim", () => {
    const holders = resolveMonthlySecretHolders([row("2026-09", "winner", 10, 36)])
    expect(holders.get("wesleys-prodigy")).toEqual({
      playerId: "winner",
      matchId: "2026-09-winner",
      date: "2026-09-28T20:00:00Z",
    })
  })

  it("returns nothing for an empty history", () => {
    expect(resolveMonthlySecretHolders([]).size).toBe(0)
  })
})
