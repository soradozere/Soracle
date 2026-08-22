import { describe, expect, it } from "vitest"
import { rankBy, rankByName } from "@/lib/rank-order"
import { computeReturnerRate } from "@/lib/returner-rate"

describe("rankBy", () => {
  it("resolves ties by name instead of by input order", () => {
    const rows = [
      { name: "zed", score: 5 },
      { name: "alice", score: 5 },
    ]
    const forward = [...rows].sort(rankByName((a, b) => b.score - a.score))
    const reversed = [...rows].reverse().sort(rankByName((a, b) => b.score - a.score))
    expect(forward.map((r) => r.name)).toEqual(["alice", "zed"])
    expect(reversed.map((r) => r.name)).toEqual(forward.map((r) => r.name))
  })

  it("leaves a decisive comparator alone", () => {
    const rows = [
      { name: "alice", score: 1 },
      { name: "zed", score: 9 },
    ]
    expect([...rows].sort(rankByName((a, b) => b.score - a.score)).map((r) => r.name)).toEqual([
      "zed",
      "alice",
    ])
  })

  it("accepts a custom key for rows that aren't keyed on `name`", () => {
    const rows = [
      { playerName: "zed", v: 1 },
      { playerName: "alice", v: 1 },
    ]
    expect(
      [...rows].sort(rankBy((r) => r.playerName, (a, b) => b.v - a.v)).map((r) => r.playerName),
    ).toEqual(["alice", "zed"])
  })
})

// Minimal stand-in for the PostgREST builder chain computeReturnerRate uses:
// .from().select()[.in()].order().order() then .range() per page.
function stubClient(rows: Record<string, unknown>[]) {
  const builder: any = {
    select: () => builder,
    in: () => builder,
    order: () => builder,
    range: (from: number, to: number) =>
      Promise.resolve({ data: rows.slice(from, to + 1), error: null }),
    then: (resolve: (v: unknown) => unknown) => Promise.resolve({ data: rows, error: null }).then(resolve),
  }
  return { from: () => builder } as never
}

describe("returner selection under involvement ties", () => {
  // One 6-man side. Two cappers hold the flag; the other four have no flag hold
  // and no mine data at all, so they tie at involvement 0 — the shape the 8 Aug
  // 2026 recovery CSV produces for every non-flag-holder. keep = round(6/3) = 2,
  // so the old code took whichever two the database happened to return first.
  const side = [
    { player_id: "cap1", match_id: "m1", team: "Red", returns: 0, time_played: 10, flag_hold_ms: 900, mine_grabs_red: 0, mine_grabs_blue: 0 },
    { player_id: "cap2", match_id: "m1", team: "Red", returns: 0, time_played: 10, flag_hold_ms: 600, mine_grabs_red: 0, mine_grabs_blue: 0 },
    { player_id: "chaseA", match_id: "m1", team: "Red", returns: 15, time_played: 10, flag_hold_ms: 0, mine_grabs_red: 0, mine_grabs_blue: 0 },
    { player_id: "chaseB", match_id: "m1", team: "Red", returns: 1, time_played: 10, flag_hold_ms: 0, mine_grabs_red: 0, mine_grabs_blue: 0 },
    { player_id: "chaseC", match_id: "m1", team: "Red", returns: 5, time_played: 10, flag_hold_ms: 0, mine_grabs_red: 0, mine_grabs_blue: 0 },
    { player_id: "supp", match_id: "m1", team: "Red", returns: 0, time_played: 10, flag_hold_ms: 0, mine_grabs_red: 0, mine_grabs_blue: 0 },
  ]
  const names = new Map([
    ["cap1", "cap1"], ["cap2", "cap2"], ["chaseA", "chaseA"],
    ["chaseB", "chaseB"], ["chaseC", "chaseC"], ["supp", "supp"],
  ])

  it("returns the same board whatever order the rows arrive in", async () => {
    const forward = await computeReturnerRate(stubClient(side), names)
    const reversed = await computeReturnerRate(stubClient([...side].reverse()), names)
    const rotated = await computeReturnerRate(stubClient([...side.slice(3), ...side.slice(0, 3)]), names)

    const shape = (r: Awaited<ReturnType<typeof computeReturnerRate>>) =>
      r.rows.map((x) => `${x.name}:${x.perMinute.toFixed(3)}`)
    expect(reversed.rows.length).toBeGreaterThan(0)
    expect(shape(reversed)).toEqual(shape(forward))
    expect(shape(rotated)).toEqual(shape(forward))
  })

  it("counts every player tied at the cut rather than an arbitrary subset", async () => {
    const result = await computeReturnerRate(stubClient(side), names)
    // All four zero-involvement players are equally uninvolved in the other
    // roles, so all four are returners; neither flag holder is.
    expect(result.rows.map((r) => r.name).sort()).toEqual(["chaseA", "chaseB", "chaseC", "supp"])
  })

  it("still excludes the role-involved players when involvement separates them", async () => {
    const separated = side.map((r) =>
      r.player_id === "chaseC" ? { ...r, mine_grabs_red: 9 } : r,
    )
    const result = await computeReturnerRate(stubClient(separated), names)
    // chaseC now leads own-base mines, so they rank above the three at zero.
    expect(result.rows.map((r) => r.name)).not.toContain("chaseC")
  })
})
