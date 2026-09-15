import { describe, expect, it } from "vitest"
import {
  DRAFT_ORDERS,
  TEAM_SLOTS,
  blueIndexFor,
  computeDraftStats,
  formatDraftLog,
  runDraft,
} from "@/lib/balance-draft"
import type { Player } from "@/lib/types"

function mk(
  name: string,
  tierValue: number,
  Capper: number,
  Chase: number,
  Camp: number,
  Cleaner: number,
  Support: number,
): Player {
  return {
    id: name,
    name,
    tierValue,
    mic: true,
    roles: { Capper, Chase, Camp, Cleaner, Support },
  }
}

/*
 * A real lobby off the live roster, 3 September 2026. Ordinary shape for this roster:
 * only three players carry a Chase rating, and half the lobby are base players rated
 * Cap 0 / Ret 0 whose value is in Cleaner and Support. Interlude is the extreme — tier 9,
 * the lobby's best base cleaner and best support, invisible to a draft that only reads
 * Cap and Chase.
 */
const liveLobby = [
  mk("bizzle", 10, 10, 10, 0, 0, 0),
  mk("Interlude", 9, 0, 0, 0, 10, 10),
  mk("cheese", 8, 4, 9, 9, 0, 0),
  mk("original", 8, 0, 0, 0, 8, 9),
  mk("shax", 7, 8, 7, 0, 7, 0),
  mk("jin", 7, 7, 7, 7, 8, 7),
  mk("retpecs", 7, 8, 0, 0, 0, 0),
  mk("phoenix", 7, 7, 0, 0, 0, 8),
  mk("giraffe", 6, 0, 0, 6, 7, 6),
  mk("Canon", 6, 0, 0, 4, 8, 6),
  mk("devy", 4, 3, 0, 4, 0, 3),
  mk("ewok", 4, 0, 0, 4, 5, 6),
]

const pickOf = (result: ReturnType<typeof runDraft>, name: string) =>
  result.picks.find((p) => p.player === name)!.pickNumber

const slotOf = (result: ReturnType<typeof runDraft>, name: string) =>
  result.picks.find((p) => p.player === name)!.slot

const reasonOf = (result: ReturnType<typeof runDraft>, name: string) =>
  result.picks.find((p) => p.player === name)!.reason

/** Picks by a given side (0 = first-pick / weaker-captain side), in pick order. */
const sidePicks = (result: ReturnType<typeof runDraft>, teamIndex: 0 | 1) =>
  result.picks.filter((p) => p.teamIndex === teamIndex)

describe("team composition", () => {
  it("is six distinct jobs; Cap and Ret are the ones picked for", () => {
    expect(TEAM_SLOTS).toHaveLength(6)
    expect(TEAM_SLOTS.map((s) => s.id)).toEqual(["cap1", "chase", "bc", "supp", "camp", "cap2"])

    const byRole = TEAM_SLOTS.reduce<Record<string, number>>((acc, s) => {
      acc[s.role] = (acc[s.role] ?? 0) + 1
      return acc
    }, {})
    expect(byRole).toEqual({ Capper: 2, Chase: 1, Cleaner: 1, Support: 1, Camp: 1 })

    expect(TEAM_SLOTS.filter((s) => s.priority === "premium").map((s) => s.id)).toEqual([
      "cap1",
      "chase",
    ])
  })

  it("fills every slot exactly once per side", () => {
    const result = runDraft(liveLobby)
    for (const team of ["RED", "BLUE"] as const) {
      const slots = result.teams[team].map((p) => p.slot)
      expect([...slots].sort()).toEqual([...TEAM_SLOTS.map((s) => s.id)].sort())
    }
  })
})

describe("draft order", () => {
  it("deals both orders fairly, differing only in where each side's picks fall", () => {
    for (const [id, spec] of Object.entries(DRAFT_ORDERS)) {
      const order = spec.order
      expect(order, id).toHaveLength(12)
      expect(order.filter((t) => t === 0), id).toHaveLength(6)
      expect(order.slice(0, 2), id).toEqual([0, 1])

      let a = 0
      let b = 0
      for (const t of order) {
        if (t === 0) a++
        else b++
        expect(Math.abs(a - b), id).toBeLessThanOrEqual(1)
      }
    }

    // The true snake levels the pick POSITIONS, which the alternating order gives away.
    const positions = (id: keyof typeof DRAFT_ORDERS, team: 0 | 1) =>
      [...DRAFT_ORDERS[id].order].reduce<number>((sum, t, i) => (t === team ? sum + i + 1 : sum), 0)

    expect(positions("alternating", 0)).toBe(37)
    expect(positions("alternating", 1)).toBe(41)
    expect(positions("snake", 0)).toBe(positions("snake", 1))
  })

  it("runs either order over the same lobby, and reports which it used", () => {
    const alternating = runDraft(liveLobby, "alternating")
    const snake = runDraft(liveLobby, "snake")

    expect(alternating.orderId).toBe("alternating")
    expect(snake.orderId).toBe("snake")
    expect(snake.captains).toEqual(alternating.captains)
    for (const result of [alternating, snake]) {
      expect(result.teams.RED).toHaveLength(6)
      expect(new Set(result.picks.map((p) => p.player)).size).toBe(12)
    }
  })
})

describe("role statistics", () => {
  it("scores every role", () => {
    const { stats, players } = computeDraftStats(liveLobby)

    expect(Object.keys(stats).sort()).toEqual(["Camp", "Capper", "Chase", "Cleaner", "Support"])

    const interlude = players.find((p) => p.name === "Interlude")!
    expect(interlude.viable.Capper).toBe(false)
    expect(interlude.viable.Chase).toBe(false)
    expect(interlude.viable.Cleaner).toBe(true)
    expect(interlude.viable.Support).toBe(true)
    expect(interlude.bestRating).toBe(10)
  })

  it("leaves everyone non-viable when a role's ratings carry no spread", () => {
    const flat = liveLobby.map((p) => ({ ...p, roles: { ...p.roles, Chase: 5 } }))
    const { stats, players } = computeDraftStats(flat)

    expect(stats.Chase.sd).toBe(0)
    expect(players.every((p) => p.z.Chase === 0)).toBe(true)
    expect(players.some((p) => p.viable.Chase)).toBe(false)
  })
})

describe("captains", () => {
  it("takes the two highest tiers, with role ratings only breaking the tie", () => {
    const result = runDraft(liveLobby)
    expect(new Set([result.captains.RED, result.captains.BLUE])).toEqual(
      new Set(["bizzle", "Interlude"]),
    )
  })

  it("seeds the stronger captain to pick 2, the weaker to pick 1", () => {
    const result = runDraft(liveLobby)

    // The first-pick side is teamIndex 0; RED/BLUE is decided later by tier total.
    expect(result.picks[0]).toMatchObject({ pickNumber: 1, teamIndex: 0, player: "Interlude" })
    expect(result.picks[1]).toMatchObject({ pickNumber: 2, teamIndex: 1, player: "bizzle" })
    expect(result.picks[0].detail).toContain("counterweight")
  })

  it("seats a captain at the job he stands out most at, not a fixed role", () => {
    const result = runDraft(liveLobby)

    // Interlude is a 10 at both Cleaner and Support — the point is he lands at a base job
    // at all, having been undraftable under the old two-role model.
    expect(["bc", "supp"]).toContain(slotOf(result, "Interlude"))
    // bizzle is Cap 10 / Ret 10; Chase is the rarer rating, so that's where he stands out.
    expect(slotOf(result, "bizzle")).toBe("chase")
  })
})

describe("premium — Cap and Ret come first", () => {
  it("fills both premium slots before any other job, on both sides", () => {
    const result = runDraft(liveLobby)

    for (const teamIndex of [0, 1] as const) {
      const picks = sidePicks(result, teamIndex)
      const premiumFilledAt = picks
        .filter((p) => p.slot === "cap1" || p.slot === "chase")
        .map((p) => p.pickNumber)
      expect(premiumFilledAt).toHaveLength(2)

      const lastPremium = Math.max(...premiumFilledAt)
      const otherBefore = picks.filter(
        (p) =>
          p.pickNumber < lastPremium &&
          p.slot !== "cap1" &&
          p.slot !== "chase" &&
          p.reason !== "captain",
      )
      expect(otherBefore).toEqual([]) // only the captain may sit outside the premium pair
    }
  })

  it("leans Ret when a player is equally good at Cap and Ret", () => {
    // Two base captains, so both teams owe a Cap and a Ret. `flex` (Cap 9 / Ret 9) and
    // `pureCap` (Cap 9) are tied at the top — the tie goes to the returner slot.
    const lobby = [
      mk("capA", 10, 0, 0, 5, 8, 6),
      mk("capB", 10, 0, 0, 5, 8, 6),
      mk("flex", 8, 9, 9, 0, 0, 0),
      mk("pureCap", 8, 9, 0, 0, 0, 0),
      mk("r1", 6, 0, 7, 0, 0, 0),
      mk("r2", 6, 0, 6, 0, 0, 0),
      mk("c1", 6, 7, 0, 0, 0, 0),
      mk("c2", 6, 6, 0, 0, 0, 0),
      mk("b1", 5, 0, 0, 6, 6, 6),
      mk("b2", 5, 0, 0, 6, 6, 6),
      mk("b3", 4, 0, 0, 5, 5, 5),
      mk("b4", 4, 0, 0, 5, 5, 5),
    ]
    const result = runDraft(lobby)

    expect(slotOf(result, "flex")).toBe("chase")
    expect(reasonOf(result, "flex")).toBe("premium")
    expect(slotOf(result, "pureCap")).toBe("cap1")
  })

  it("still sends a genuine Cap monster to Cap over a dead-even flex player", () => {
    const lobby = [
      mk("capA", 10, 0, 0, 5, 8, 6),
      mk("capB", 10, 0, 0, 5, 8, 6),
      mk("monster", 8, 10, 4, 0, 0, 0), // Cap 10 clears everyone; Ret 4 also viable here
      mk("flex", 8, 7, 7, 0, 0, 0),
      mk("r1", 6, 0, 8, 0, 0, 0),
      mk("r2", 6, 0, 6, 0, 0, 0),
      mk("c1", 6, 6, 0, 0, 0, 0),
      mk("c2", 6, 5, 0, 0, 0, 0),
      mk("b1", 5, 0, 0, 6, 6, 6),
      mk("b2", 5, 0, 0, 6, 6, 6),
      mk("b3", 4, 0, 0, 5, 5, 5),
      mk("b4", 4, 0, 0, 5, 5, 5),
    ]
    const result = runDraft(lobby)
    expect(slotOf(result, "monster")).toBe("cap1")
  })
})

describe("best available — once Cap and Ret are held", () => {
  it("does not strand a strong base player behind weaker rated ones", () => {
    const result = runDraft(liveLobby)

    // Interlude (captain) and original are the lobby's strongest base players; both must
    // land ahead of the tier-4s.
    expect(pickOf(result, "Interlude")).toBeLessThan(pickOf(result, "devy"))
    expect(pickOf(result, "original")).toBeLessThan(pickOf(result, "devy"))
    expect(pickOf(result, "original")).toBeLessThan(pickOf(result, "ewok"))
  })

  it("never takes a tier 4 over a tier 6 on the strength of a Cap 3", () => {
    const result = runDraft(liveLobby)

    // devy's Cap 3 is below the lobby mean — not viable — so it earns him nothing.
    expect(pickOf(result, "devy")).toBeGreaterThan(pickOf(result, "Canon"))
    expect(pickOf(result, "devy")).toBeGreaterThan(pickOf(result, "giraffe"))
  })

  it("orders every best-available pick by tier", () => {
    const result = runDraft(liveLobby)
    const byName = new Map(result.players.map((p) => [p.name, p]))

    for (const teamIndex of [0, 1] as const) {
      const open = sidePicks(result, teamIndex).filter((p) => p.reason === "best-available")
      for (let i = 1; i < open.length; i++) {
        expect(byName.get(open[i - 1].player)!.tierValue).toBeGreaterThanOrEqual(
          byName.get(open[i].player)!.tierValue,
        )
      }
    }
  })

  it("uses no scarcity reasoning — only captain / premium / best-available / fallback", () => {
    const result = runDraft(liveLobby)
    const reasons = new Set(result.picks.map((p) => p.reason))
    for (const r of reasons) {
      expect(["captain", "premium", "best-available", "fallback"]).toContain(r)
    }
  })
})

describe("fallback", () => {
  it("hands a role with nobody viable to the best remaining player by tier", () => {
    // Nobody is rated for Cap or Ret at all, so both premium slots go to the fallback,
    // which picks by tier — not by whoever happens to carry a stray point.
    const lobby = [
      mk("t9", 9, 0, 0, 4, 6, 6),
      mk("t8", 8, 0, 0, 4, 6, 6),
      mk("t7a", 7, 0, 0, 4, 6, 6),
      mk("t7b", 7, 0, 0, 4, 6, 6),
      mk("t6a", 6, 0, 0, 4, 6, 6),
      mk("t6b", 6, 0, 0, 4, 6, 6),
      mk("t5a", 5, 0, 0, 4, 6, 6),
      mk("t5b", 5, 0, 0, 4, 6, 6),
      mk("t4a", 4, 0, 0, 4, 6, 6),
      mk("t4b", 4, 0, 0, 4, 6, 6),
      mk("t3a", 3, 0, 0, 4, 6, 6),
      mk("t3b", 3, 0, 0, 4, 6, 6),
    ]
    const result = runDraft(lobby)

    const premiumPicks = result.picks.filter(
      (p) => (p.slot === "cap1" || p.slot === "chase") && p.reason !== "captain",
    )
    expect(premiumPicks).toHaveLength(2)
    expect(premiumPicks.every((p) => p.reason === "fallback")).toBe(true)

    // Those forced picks are the highest tiers still on the board when they happen.
    const byName = new Map(result.players.map((p) => [p.name, p]))
    for (const pick of premiumPicks) {
      const earlierNames = new Set(
        result.picks.filter((p) => p.pickNumber < pick.pickNumber).map((p) => p.player),
      )
      const bestRemaining = Math.max(
        ...result.players.filter((p) => !earlierNames.has(p.name)).map((p) => p.tierValue),
      )
      expect(byName.get(pick.player)!.tierValue).toBe(bestRemaining)
    }
  })

  it("treats a lone rated player as the capper — that is not a fallback", () => {
    // One player has Cap 3 and everyone else Cap 0: a positive z-score, so he IS viable
    // and gets drafted as the team's capper. Fallback is only for nobody-rated.
    const lobby = [
      mk("capA", 10, 0, 0, 5, 8, 6),
      mk("capB", 10, 0, 0, 5, 8, 6),
      mk("lone", 6, 3, 0, 0, 0, 0),
      ...Array.from({ length: 9 }, (_, i) => mk(`b${i}`, 5 - (i % 3), 0, 0, 4, 5, 5)),
    ]
    const result = runDraft(lobby)
    expect(slotOf(result, "lone")).toBe("cap1")
    expect(reasonOf(result, "lone")).toBe("premium")
  })
})

describe("draft integrity", () => {
  it("drafts all twelve players exactly once, six a side", () => {
    const result = runDraft(liveLobby)
    const drafted = [...result.teams.RED, ...result.teams.BLUE].map((p) => p.name)

    expect(new Set(drafted).size).toBe(12)
    expect([...drafted].sort()).toEqual(liveLobby.map((p) => p.name).sort())
  })

  it("is deterministic, and independent of the order players are passed in", () => {
    const first = runDraft(liveLobby)
    const second = runDraft([...liveLobby].reverse())

    expect(formatDraftLog(second)).toBe(formatDraftLog(first))
    expect(second.teams.RED.map((p) => p.name)).toEqual(first.teams.RED.map((p) => p.name))
  })

  it("rejects a lobby that isn't twelve players", () => {
    expect(() => runDraft(liveLobby.slice(0, 11))).toThrow(/exactly 12/)
  })

  it("survives a lobby with no rated players at all", () => {
    const unrated = liveLobby.map((p, i) => mk(`p${i}`, ((i * 3) % 9) + 1, 0, 0, 0, 0, 0))
    const result = runDraft(unrated)

    expect(result.picks).toHaveLength(12)
    expect(result.picks.filter((p) => p.reason === "fallback").length).toBeGreaterThan(0)
  })
})

describe("colour assignment", () => {
  it("gives Blue to the lighter team", () => {
    const result = runDraft(liveLobby)
    expect(result.tierTotals.BLUE).toBeLessThanOrEqual(result.tierTotals.RED)
  })

  it("gives Blue to the first-pick side on an exact tie", () => {
    expect(blueIndexFor(36, 40)).toBe(0)
    expect(blueIndexFor(40, 36)).toBe(1)
    expect(blueIndexFor(38, 38)).toBe(0)
  })
})

describe("pick log", () => {
  it("numbers the captains first and groups a team's consecutive picks onto one line", () => {
    const result = runDraft(liveLobby)
    const lines = formatDraftLog(result).split("\n")

    expect(lines[0]).toMatch(/^PICK 1\. CAPTAIN BLUE = Interlude$/)
    expect(lines[1]).toMatch(/^PICK 2\. CAPTAIN RED = bizzle$/)

    const doubled = lines.filter((line) => line.includes(", "))
    expect(doubled).toHaveLength(1)
    expect(doubled[0]).toMatch(/^PICK \d+\. (RED|BLUE) = \w+, \w+$/)

    const named = lines.flatMap((line) => line.split(" = ")[1].split(", "))
    expect(named).toHaveLength(12)
  })
})
