import { describe, expect, it } from "vitest"
import { runDraft } from "@/lib/balance-draft"
import { compareToBaseline } from "@/lib/balance-lab-compare"
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
  return { id: name, name, tierValue, mic: true, roles: { Capper, Chase, Camp, Cleaner, Support } }
}

const lobby = [
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

describe("compareToBaseline", () => {
  it("lines the draft up against the shipped balancer's own pick", () => {
    const draft = runDraft(lobby)
    const cmp = compareToBaseline(draft, lobby)!

    expect(cmp).not.toBeNull()

    // Both split the same twelve into two sixes.
    expect([...cmp.baseline.teamRed, ...cmp.baseline.teamBlue].sort()).toEqual(
      lobby.map((p) => p.name).sort(),
    )

    // sameSide is bounded: 6 (chance) to 12 (identical), and only ever even because
    // moving one player swaps two.
    expect(cmp.sameSide).toBeGreaterThanOrEqual(6)
    expect(cmp.sameSide).toBeLessThanOrEqual(12)
    expect(cmp.sameSide % 2).toBe(0)

    // movers are exactly the players not on their baseline side under the best alignment.
    expect(cmp.movers).toHaveLength(12 - cmp.sameSide)

    // The live evaluator can score the draft's split, and both confidences are percentages.
    expect(cmp.draftScoredLive).not.toBeNull()
    for (const pct of [cmp.baseline.confidence, cmp.draftScoredLive!.confidence]) {
      expect(pct).toBeGreaterThanOrEqual(30)
      expect(pct).toBeLessThanOrEqual(100)
    }

    // The balancer's own pick can't score worse than the draft's split by its own metric.
    expect(cmp.baseline.score).toBeLessThanOrEqual(cmp.draftScoredLive!.score)
  })

  it("reports 12 same-side and no movers when the draft matches the baseline", () => {
    // Feed compareToBaseline a draft whose teams ARE the balancer's first option.
    const draft = runDraft(lobby)
    const cmp = compareToBaseline(draft, lobby)!

    const forced: typeof draft = {
      ...draft,
      teams: {
        RED: cmp.baseline.teamRed.map((name) => ({
          name,
          tierValue: lobby.find((p) => p.name === name)!.tierValue,
          pickNumber: 1,
          slot: "cap1",
          slotLabel: "Cap",
          reason: "captain",
        })),
        BLUE: cmp.baseline.teamBlue.map((name) => ({
          name,
          tierValue: lobby.find((p) => p.name === name)!.tierValue,
          pickNumber: 2,
          slot: "cap1",
          slotLabel: "Cap",
          reason: "captain",
        })),
      },
    }

    const identical = compareToBaseline(forced, lobby)!
    expect(identical.sameSide).toBe(12)
    expect(identical.movers).toEqual([])
  })

  it("is colour-blind — the overlap count doesn't change if the draft swaps RED/BLUE", () => {
    const draft = runDraft(lobby)
    const cmp = compareToBaseline(draft, lobby)!

    const swapped: typeof draft = { ...draft, teams: { RED: draft.teams.BLUE, BLUE: draft.teams.RED } }
    const swappedCmp = compareToBaseline(swapped, lobby)!

    expect(swappedCmp.sameSide).toBe(cmp.sameSide)
    expect(swappedCmp.movers).toHaveLength(cmp.movers.length)
  })
})
