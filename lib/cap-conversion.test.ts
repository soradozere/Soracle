import { describe, expect, it } from "vitest"
import { aggregateCapConversion, type CaptureStatRow, type KillRow } from "./cap-conversion"

/*
 * aggregateCapConversion is the pure half of computeCapConversion — everything
 * after the two Supabase fetches. The interesting behaviour lives here: what
 * counts as a resolved run, who clears the carry floor, and how ties break.
 */

const names = new Map([
  ["p-leader", "leader"],
  ["p-support", "support"],
  ["p-minor", "minor"],
])

describe("aggregateCapConversion", () => {
  it("returns empty with zero matchCount and carryFloor when there are no kills", () => {
    const result = aggregateCapConversion([], [], names)
    expect(result).toEqual({ rows: [], matchCount: 0, carryFloor: 0 })
  })

  it("counts a resolved run both ways: a capture and a return-while-carrying", () => {
    const kills: KillRow[] = [{ match_id: "m1", victim_player_id: "p-leader", rets: 1 }]
    const stats: CaptureStatRow[] = [{ player_id: "p-leader", captures: 4 }]
    const { rows } = aggregateCapConversion(kills, stats, names)
    expect(rows).toEqual([
      { playerId: "p-leader", name: "leader", captures: 4, caught: 1, carries: 5, conversion: 80 },
    ])
  })

  it("drops a player whose only stat row is zero captures and no returns-against", () => {
    // A support player who never got caught carrying and this window has no
    // caps credited to them either -- zero resolved runs, not "0% conversion".
    const kills: KillRow[] = [{ match_id: "m1", victim_player_id: "p-leader", rets: 0 }]
    const stats: CaptureStatRow[] = [
      { player_id: "p-leader", captures: 5 },
      { player_id: "p-support", captures: 0 },
    ]
    const { rows } = aggregateCapConversion(kills, stats, names)
    expect(rows.map((r) => r.playerId)).toEqual(["p-leader"])
  })

  it("applies the 30% carry floor relative to the leader, not an absolute count", () => {
    const kills: KillRow[] = [
      { match_id: "m1", victim_player_id: "p-leader", rets: 0 },
      { match_id: "m1", victim_player_id: "p-support", rets: 0 },
      { match_id: "m1", victim_player_id: "p-minor", rets: 0 },
    ]
    // Leader: 10 carries (floor = 3). Support: exactly 3 -- clears. Minor: 2 -- doesn't.
    const stats: CaptureStatRow[] = [
      { player_id: "p-leader", captures: 10 },
      { player_id: "p-support", captures: 3 },
      { player_id: "p-minor", captures: 2 },
    ]
    const { rows, carryFloor } = aggregateCapConversion(kills, stats, names)
    expect(carryFloor).toBe(3)
    expect(rows.map((r) => r.playerId).sort()).toEqual(["p-leader", "p-support"])
  })

  it("does not let a floor on captures alone exclude a low-volume support player", () => {
    // The whole point of measuring conversion on CARRIES rather than caps:
    // two caps out of two carries is a perfect rate and must qualify even
    // though the raw cap count is tiny next to a capper main's. The rets:0
    // kill row just puts this match inside kill-matrix coverage; it isn't a
    // real return against p-support.
    const kills: KillRow[] = [{ match_id: "m1", victim_player_id: "p-support", rets: 0 }]
    const stats: CaptureStatRow[] = [{ player_id: "p-support", captures: 2 }]
    const { rows } = aggregateCapConversion(kills, stats, names)
    expect(rows).toEqual([
      { playerId: "p-support", name: "support", captures: 2, caught: 0, carries: 2, conversion: 100 },
    ])
  })

  it("returns nothing for a window with no kill-matrix coverage, even with real captures", () => {
    // No match_kills rows at all -- a CSV-era month, before migration 037 --
    // must come back empty rather than treating every return-against as zero.
    const stats: CaptureStatRow[] = [{ player_id: "p-leader", captures: 20 }]
    const result = aggregateCapConversion([], stats, names)
    expect(result).toEqual({ rows: [], matchCount: 0, carryFloor: 0 })
  })

  it("sorts by conversion, then carries, then name — deterministic under ties", () => {
    const kills: KillRow[] = []
    const stats: CaptureStatRow[] = [
      // Both at 50% conversion; b has more carries so ranks first.
      { player_id: "p-a", captures: 1 },
      { player_id: "p-b", captures: 2 },
    ]
    // a: 1 cap, needs 1 return-against to sit at 50%. b: 2 caps, 2 returns-against.
    kills.push(
      { match_id: "m1", victim_player_id: "p-a", rets: 1 },
      { match_id: "m1", victim_player_id: "p-b", rets: 2 },
    )
    const { rows } = aggregateCapConversion(kills, stats, names)
    expect(rows.map((r) => r.playerId)).toEqual(["p-b", "p-a"])
  })

  it("counts matchCount as distinct match ids from kills, not row count", () => {
    const kills: KillRow[] = [
      { match_id: "m1", victim_player_id: "p-leader", rets: 1 },
      { match_id: "m1", victim_player_id: "p-support", rets: 1 },
      { match_id: "m2", victim_player_id: "p-leader", rets: 1 },
    ]
    const { matchCount } = aggregateCapConversion(kills, [], names)
    expect(matchCount).toBe(2)
  })

  it("falls back to 'unknown' for a player id missing from the name map", () => {
    const kills: KillRow[] = [{ match_id: "m1", victim_player_id: "ghost", rets: 1 }]
    const { rows } = aggregateCapConversion(kills, [], names)
    expect(rows[0].name).toBe("unknown")
  })
})
