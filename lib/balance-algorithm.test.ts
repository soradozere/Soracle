import { describe, expect, it } from "vitest"
import { balanceTeamsWithOptions } from "@/lib/balance-algorithm"
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

/** Which team (red or blue) a player landed on, for "are these two together?" checks. */
function sameTeam(option: { result: { teamRed: string[] } }, a: string, b: string): boolean {
  const red = new Set(option.result.teamRed)
  return red.has(a) === red.has(b)
}

describe("best-capper / best-chaser separation", () => {
  // The real lobby from the August 2026 report. bizzle is the sole best capper (10) AND
  // the sole best chaser (10), which used to switch rule 3c off entirely — so nothing
  // stopped cheese, the next-best chaser (9), stacking onto his team. All three posted
  // suggestions had them together, leaving the other side no answer to bizzle capping.
  const reportedLobby = [
    mk("bizzle", 10, 10, 10, 0, 0, 0),
    mk("cheese", 8, 6, 9, 9, 0, 0),
    mk("glempa", 7, 6, 0, 7, 6, 0),
    mk("xan", 6, 6, 0, 7, 7, 7),
    mk("Canon", 6, 0, 0, 4, 8, 6),
    mk("sora", 5, 4, 0, 3, 5, 5),
    mk("Interlude", 9, 8, 0, 0, 10, 10),
    mk("original", 9, 9, 0, 0, 8, 9),
    mk("jin", 7, 7, 7, 8, 8, 7),
    mk("eze", 6, 0, 0, 8, 7, 0),
    mk("retpecs", 6, 7, 0, 0, 0, 0),
    mk("viktor", 5, 6, 0, 0, 7, 0),
  ]

  it("splits a dual threat from the next-best chaser in the recommended option", () => {
    const options = balanceTeamsWithOptions(
      reportedLobby.map((p) => p.name),
      reportedLobby,
    )

    expect(sameTeam(options[0], "bizzle", "cheese")).toBe(false)
  })

  // The first attempt at the fix bought chaser separation by stacking three tier-8+ players
  // against one, which is a worse problem than the one being solved. This lobby is one that
  // regressed that way (19 April 2026): Interlude 9 + original 9 + cheese 8 all landed
  // opposite bizzle. The separation rule must not pay for itself with an elite stack.
  const eliteTrapLobby = [
    mk("bizzle", 10, 10, 10, 0, 0, 0),
    mk("cheese", 8, 6, 9, 9, 0, 0),
    mk("Interlude", 9, 8, 0, 0, 10, 10),
    mk("original", 9, 9, 0, 0, 8, 9),
    mk("shax", 7, 8, 0, 0, 6, 5),
    mk("xan", 6, 6, 0, 7, 7, 7),
    mk("giraffe", 6, 0, 0, 5, 6, 5),
    mk("sora", 5, 4, 0, 3, 5, 5),
    mk("riji", 5, 3, 0, 4, 5, 4),
    mk("ewok", 5, 0, 0, 5, 5, 4),
    mk("savior", 4, 3, 0, 4, 4, 4),
    mk("vee", 4, 2, 0, 3, 4, 4),
  ]

  it("does not buy chaser separation with a 3-v-1 elite stack", () => {
    const options = balanceTeamsWithOptions(
      eliteTrapLobby.map((p) => p.name),
      eliteTrapLobby,
    )
    const elites = (team: string[]) =>
      team.filter((n) => eliteTrapLobby.find((p) => p.name === n)!.tierValue >= 8).length

    options.forEach((o) => {
      const red = elites(o.result.teamRed)
      const blue = elites(o.result.teamBlue)
      // the balancer's own elite-stack condition: 3+ on one side, short by 2+ on the other
      const stacked = (red >= 3 && blue < red - 1) || (blue >= 3 && red < blue - 1)
      expect(stacked).toBe(false)
    })
  })

  it("splits the dual threat from the runner-up without stacking elites", () => {
    const options = balanceTeamsWithOptions(
      eliteTrapLobby.map((p) => p.name),
      eliteTrapLobby,
    )

    expect(sameTeam(options[0], "bizzle", "cheese")).toBe(false)
  })

  it("leaves both teams a viable chaser in the recommended option", () => {
    const options = balanceTeamsWithOptions(
      reportedLobby.map((p) => p.name),
      reportedLobby,
    )
    const chaseOf = (name: string) => reportedLobby.find((p) => p.name === name)!.roles.Chase
    const viable = (team: string[]) => team.filter((n) => chaseOf(n) >= 4).length

    expect(viable(options[0].result.teamRed)).toBeGreaterThan(0)
    expect(viable(options[0].result.teamBlue)).toBeGreaterThan(0)
  })

  // The ordinary case the rule was written for: two different players hold the crowns.
  // Everyone is the same tier so tier balance can't dictate the answer, leaving the
  // separation rule as the deciding term.
  it("splits the best capper from the best chaser when they are different players", () => {
    const lobby = [
      mk("topCapper", 6, 10, 0, 5, 5, 5),
      mk("topChaser", 6, 0, 10, 5, 5, 5),
      ...Array.from({ length: 10 }, (_, i) => mk(`filler${i}`, 6, 5, 5, 5, 5, 5)),
    ]

    const options = balanceTeamsWithOptions(
      lobby.map((p) => p.name),
      lobby,
    )

    expect(sameTeam(options[0], "topCapper", "topChaser")).toBe(false)
  })

  // A dual threat with nobody else able to chase at all. There is no counter to
  // distribute, so the runner-up rule must not fire (and must not crash on the
  // all-zero runner-up rating) — it should still return three usable splits.
  it("handles a dual threat when nobody else can chase", () => {
    const lobby = [
      mk("dual", 8, 10, 10, 5, 5, 5),
      ...Array.from({ length: 11 }, (_, i) => mk(`filler${i}`, 6, 5, 0, 5, 5, 5)),
    ]

    const options = balanceTeamsWithOptions(
      lobby.map((p) => p.name),
      lobby,
    )

    expect(options).toHaveLength(3)
    options.forEach((o) => {
      expect(o.result.teamRed).toHaveLength(6)
      expect(o.result.teamBlue).toHaveLength(6)
    })
  })
})

describe("bottom-cluster draft anchor and constraint repricing", () => {
  // Real lobby from the August 2026 watertight audit. ewok (tier 4) is the unique
  // weakest player and the bottom cluster is devy(5), sora(5), ewok(4). The old build's
  // Perfect Balance handed ewok's team sora as well — two of the three bottom-cluster
  // players on one side, the "last picks ride together" complaint. The draft anchor rule
  // caps the weakest player's team at a minority of the cluster, which for a cluster of
  // three means ewok stands alone.
  const lastPickLobby = [
    mk("Interlude", 9, 8, 0, 0, 10, 10),
    mk("fetchd", 9, 0, 10, 0, 0, 0),
    mk("jin", 7, 6, 7, 8, 6, 7),
    mk("xan", 6, 6, 0, 6, 7, 6),
    mk("eze", 6, 0, 0, 8, 7, 0),
    mk("devy", 5, 0, 0, 5, 0, 5),
    mk("ultra", 9, 8, 10, 0, 0, 0),
    mk("arhont", 8, 0, 8, 8, 8, 0),
    mk("cheese", 8, 6, 9, 9, 0, 0),
    mk("twinblade", 7, 0, 0, 8, 8, 8),
    mk("sora", 5, 4, 0, 3, 5, 5),
    mk("ewok", 4, 0, 0, 4, 5, 6),
  ]

  it("keeps the unique weakest player away from the bottom-cluster majority", () => {
    const options = balanceTeamsWithOptions(
      lastPickLobby.map((p) => p.name),
      lastPickLobby,
    )

    expect(sameTeam(options[0], "ewok", "sora")).toBe(false)
    expect(sameTeam(options[0], "ewok", "devy")).toBe(false)
  })

  // Real lobby where the lobby's only two viable returners (ultra chase 10, arhont
  // chase 8) both landed on one team in the old Perfect Balance — the 500-point coverage
  // penalty was outbid by role-sum smoothing. At constraint pricing they must split.
  const noReturnerLobby = [
    mk("ultra", 9, 8, 10, 0, 0, 0),
    mk("arhont", 8, 0, 8, 8, 8, 0),
    mk("phoenix", 7, 7, 0, 0, 0, 8),
    mk("xan", 6, 6, 0, 6, 7, 6),
    mk("sora", 5, 4, 0, 3, 5, 5),
    mk("Apple", 4, 0, 0, 4, 4, 0),
    mk("Interlude", 9, 8, 0, 0, 10, 10),
    mk("glempa", 7, 6, 0, 7, 6, 0),
    mk("shax", 7, 7, 0, 0, 0, 6),
    mk("yuki", 6, 0, 0, 7, 8, 0),
    mk("devy", 5, 0, 0, 5, 0, 5),
    mk("link", 4, 2, 0, 0, 3, 2),
  ]

  it("leaves both teams a viable returner when the lobby has exactly two", () => {
    const options = balanceTeamsWithOptions(
      noReturnerLobby.map((p) => p.name),
      noReturnerLobby,
    )

    expect(sameTeam(options[0], "ultra", "arhont")).toBe(false)
  })

  // Real lobby whose old option 2 shipped tier totals 43 v 40 even though a gap-1 split
  // of the same twelve exists. With the over-max wall at 2000 a three-point gap can no
  // longer be bought with role-sum gains.
  const gapLobby = [
    mk("Interlude", 9, 8, 0, 0, 10, 10),
    mk("fetchd", 9, 0, 10, 0, 0, 0),
    mk("jin", 7, 6, 7, 8, 6, 7),
    mk("glempa", 7, 6, 0, 7, 6, 0),
    mk("yuki", 6, 0, 0, 7, 8, 0),
    mk("devy", 5, 0, 0, 5, 0, 5),
    mk("arhont", 8, 0, 8, 8, 8, 0),
    mk("cheese", 8, 6, 9, 9, 0, 0),
    mk("cooky", 8, 8, 9, 0, 0, 0),
    mk("xan", 6, 6, 0, 6, 7, 6),
    mk("giraffe", 6, 0, 0, 6, 8, 6),
    mk("ewok", 4, 0, 0, 4, 5, 6),
  ]

  it("keeps every suggested option within the two-point tier gap", () => {
    const options = balanceTeamsWithOptions(
      gapLobby.map((p) => p.name),
      gapLobby,
    )

    for (const option of options) {
      expect(Math.abs(option.result.redTierTotal - option.result.blueTierTotal)).toBeLessThanOrEqual(2)
    }
  })
})
