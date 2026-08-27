import { describe, expect, it } from "vitest"
import { aggregateReturnerRates, pickReturners, type StatRow } from "./returner-rate"

/*
 * Two things are worth testing directly here, both pure and both where the
 * real bugs would hide: pickReturners (which two players on a side actually
 * played returner that match) and aggregateReturnerRates (turning picked
 * returner-games into a ranked, floor-filtered board). computeReturnerRate
 * itself is thin Supabase-fetching glue around these.
 */

const row = (overrides: Partial<StatRow> & { player_id: string }): StatRow => ({
  match_id: "m1",
  team: "Red",
  returns: 0,
  time_played: 600,
  flag_hold_ms: 0,
  mine_grabs_red: 0,
  mine_grabs_blue: 0,
  ...overrides,
})

describe("pickReturners", () => {
  it("keeps the two least-involved players on a full 6-player side", () => {
    // capper: max flag hold. cleaner: max mines in own base (red). support:
    // max mines in enemy base (blue, from red's perspective). Two players
    // touch neither role at all -- they're the returners.
    const side: StatRow[] = [
      row({ player_id: "capper", flag_hold_ms: 300_000 }),
      row({ player_id: "cleaner", mine_grabs_red: 10 }),
      row({ player_id: "support", mine_grabs_blue: 10 }),
      row({ player_id: "co-capper", flag_hold_ms: 250_000 }),
      row({ player_id: "returner-a" }),
      row({ player_id: "returner-b" }),
    ]
    const picked = pickReturners(side).map((r) => r.player_id).sort()
    expect(picked).toEqual(["returner-a", "returner-b"])
  })

  it("expands through a tie at the cut boundary instead of choosing arbitrarily", () => {
    // keep = round(6/3) = 2, but three players are equally uninvolved -- all
    // three must count, not an arbitrary two of them.
    const side: StatRow[] = [
      row({ player_id: "capper", flag_hold_ms: 300_000 }),
      row({ player_id: "cleaner", mine_grabs_red: 10 }),
      row({ player_id: "support", mine_grabs_blue: 10 }),
      row({ player_id: "tie-a" }),
      row({ player_id: "tie-b" }),
      row({ player_id: "tie-c" }),
    ]
    const picked = pickReturners(side).map((r) => r.player_id).sort()
    expect(picked).toEqual(["tie-a", "tie-b", "tie-c"])
  })

  it("credits a co-capper's teammate rather than crowning a second co-capper", () => {
    // Real case from the doc: a player with heavy flag-grab activity but far
    // behind the actual team leader in hold time must not read as a returner
    // just because they aren't THE top holder.
    const side: StatRow[] = [
      row({ player_id: "leader", flag_hold_ms: 300_000 }),
      row({ player_id: "co-capper", flag_hold_ms: 280_000 }),
      row({ player_id: "cleaner", mine_grabs_red: 10 }),
      row({ player_id: "support", mine_grabs_blue: 10 }),
      row({ player_id: "returner-a" }),
      row({ player_id: "returner-b" }),
    ]
    const picked = pickReturners(side).map((r) => r.player_id)
    expect(picked).not.toContain("co-capper")
  })

  it("returns everyone when nobody touched a mine or the flag (no maximum to divide by)", () => {
    // The hand-rebuilt recovery CSV case: no mine data, and here nobody held
    // the flag either. Every involvement score is 0, so the tie-expansion
    // pulls in the whole side rather than an arbitrary two.
    const side: StatRow[] = [
      row({ player_id: "a" }),
      row({ player_id: "b" }),
      row({ player_id: "c" }),
      row({ player_id: "d" }),
    ]
    const picked = pickReturners(side).map((r) => r.player_id).sort()
    expect(picked).toEqual(["a", "b", "c", "d"])
  })

  it("keeps a lone player on a short-handed side without needing a tie to expand into", () => {
    const side: StatRow[] = [row({ player_id: "solo", flag_hold_ms: 100_000 })]
    expect(pickReturners(side).map((r) => r.player_id)).toEqual(["solo"])
  })
})

describe("aggregateReturnerRates", () => {
  const names = new Map([
    ["returner-a", "alpha"],
    ["returner-b", "beta"],
  ])

  it("returns empty with zero gameFloor when there are no stats", () => {
    expect(aggregateReturnerRates([], names)).toEqual({ rows: [], gameFloor: 0 })
  })

  it("aggregates returns and minutes across a returner's games", () => {
    const stats: StatRow[] = [
      row({ player_id: "returner-a", returns: 3, time_played: 600, match_id: "m1" }),
      row({ player_id: "returner-a", returns: 5, time_played: 900, match_id: "m2" }),
    ]
    const { rows } = aggregateReturnerRates(stats, names)
    const a = rows.find((r) => r.playerId === "returner-a")
    expect(a).toMatchObject({ returns: 8, minutes: 1500, games: 2, gamesPlayed: 2 })
    expect(a?.perMinute).toBeCloseTo(8 / 1500)
  })

  it("counts gamesPlayed (all appearances) separately from games (returner games only)", () => {
    // returner-a plays a match as the clear capper (excluded from returner
    // games there) and a match as a returner. gamesPlayed must still be 2.
    const stats: StatRow[] = [
      row({ player_id: "returner-a", flag_hold_ms: 300_000, match_id: "m1", returns: 0 }),
      row({ player_id: "filler-1", match_id: "m1" }),
      row({ player_id: "returner-a", returns: 4, time_played: 600, match_id: "m2" }),
    ]
    const { rows } = aggregateReturnerRates(stats, names)
    const a = rows.find((r) => r.playerId === "returner-a")
    expect(a?.games).toBe(1)
    expect(a?.gamesPlayed).toBe(2)
  })

  it("excludes a picked returner whose counted games all have zero minutes", () => {
    const stats: StatRow[] = [row({ player_id: "returner-a", returns: 0, time_played: 0 })]
    const { rows } = aggregateReturnerRates(stats, names)
    expect(rows).toEqual([])
  })

  it("applies the relative game floor and sorts by rate, then games, then name", () => {
    const games = (playerId: string, n: number, perMatchReturns: number, minutesEach = 10) =>
      Array.from({ length: n }, (_, i) =>
        row({ player_id: playerId, match_id: `m${i}`, returns: perMatchReturns, time_played: minutesEach }),
      )
    // Leader: 15 returner games (floor = ceil(15*0.2) = 3). Just-clears: 3.
    // Below-floor: 2, filtered out despite a higher per-minute rate.
    const stats: StatRow[] = [
      ...games("leader", 15, 1),
      ...games("just-clears", 3, 1),
      ...games("below-floor", 2, 5),
    ]
    const { rows, gameFloor } = aggregateReturnerRates(stats, names)
    expect(gameFloor).toBe(3)
    expect(rows.map((r) => r.playerId)).toEqual(["leader", "just-clears"])
  })
})
