import { afterEach, describe, expect, it } from "vitest"
import { balanceTeamsWithOptions, CONFIG, evaluateTeams } from "@/lib/balance-algorithm"
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

describe("tied top tier and elite-chaser spread", () => {
  // The real 22 Aug 2026 lobby (exact DB ratings at match time) whose shipped
  // Perfect Balance put cooky and cheese — the lobby's only two chase-9s — on one
  // team against levi's chase 6, with a 32v30 tier edge on top. Red won 7-3.
  // Two tie-driven gaps caused it: the anchored top-cluster rule only guarded
  // Interlude's side (cooky and Interlude tie at 9), and the crown-pair rule was
  // excused by Interlude tying cooky's capper 8.
  const disasterLobby = [
    mk("cooky", 9, 8, 9, 0, 0, 0),
    mk("cheese", 8, 6, 9, 9, 0, 0),
    mk("Interlude", 9, 8, 0, 0, 10, 10),
    mk("levi", 6, 0, 6, 6, 6, 0),
    mk("sora", 5, 4, 0, 3, 5, 5),
    mk("riji", 5, 0, 0, 5, 5, 4),
    mk("vee", 4, 0, 0, 4, 4, 4),
    mk("Voodoo", 4, 0, 0, 0, 4, 0),
    mk("savior", 3, 3, 0, 0, 3, 2),
    mk("ben", 3, 0, 0, 3, 4, 3),
    mk("matt", 3, 4, 0, 0, 0, 3),
    mk("quasar", 3, 0, 0, 3, 3, 3),
  ]

  it("splits the tied-top players in every suggested option", () => {
    const options = balanceTeamsWithOptions(
      disasterLobby.map((p) => p.name),
      disasterLobby,
    )
    for (const option of options) {
      expect(sameTeam(option, "cooky", "Interlude")).toBe(false)
    }
  })

  it("does not stack the only two elite chasers in the recommendation", () => {
    const options = balanceTeamsWithOptions(
      disasterLobby.map((p) => p.name),
      disasterLobby,
    )
    expect(sameTeam(options[0], "cooky", "cheese")).toBe(false)
  })

  it("scores a lineup identically regardless of team argument order", () => {
    const red = ["cooky", "sora", "savior", "ben", "vee", "cheese"]
    const blue = ["riji", "matt", "Interlude", "Voodoo", "levi", "quasar"]
    const forward = evaluateTeams(red, blue, disasterLobby)
    const reversed = evaluateTeams(blue, red, disasterLobby)
    expect(forward?.score).toBe(reversed?.score)
  })
})

describe("elite-capper monopoly", () => {
  // A real 12-player roster (April 2026 match), stress-tested against CURRENT
  // ratings during the 25 Aug 2026 audit of the elite-capper-stacking bug that
  // surfaced live 24 Aug (cheese + original). Before the fix, every one of the
  // three suggested options put the lobby's two elite (8+) cappers, cooky and
  // suvix, on the same team -- CONCENTRATION_WEIGHT's quadratic term (300,
  // ≈1200 for a 2-v-0 split) was cheap enough for the search to buy the
  // monopoly with role-balance gains elsewhere. MONOPOLY_PENALTY (flat, 8000)
  // fixes it: Perfect Balance and Fair Fight both split them; only the
  // deliberately role-blind Off-Role option still allows it, which is correct
  // -- Off-Role exists specifically for nights when role ratings carry no
  // signal, and MONOPOLY_PENALTY (like CONCENTRATION_WEIGHT) is a role term.
  const eliteCapperLobby = [
    mk("cooky", 9, 8, 9, 0, 0, 0),
    mk("suvix", 8, 8, 0, 0, 0, 0),
    mk("luke", 6, 6, 0, 0, 7, 5),
    mk("giraffe", 6, 0, 0, 6, 8, 6),
    mk("viktor", 5, 5, 0, 0, 5, 0),
    mk("yuki", 6, 0, 0, 7, 8, 0),
    mk("shax", 7, 7, 0, 0, 0, 6),
    mk("Interlude", 9, 0, 0, 0, 10, 10),
    mk("cheese", 8, 4, 9, 9, 0, 0),
    mk("phoenix", 7, 7, 0, 0, 0, 8),
    mk("jin", 7, 6, 7, 8, 6, 7),
    mk("vee", 4, 0, 0, 4, 4, 4),
  ]

  it("splits the lobby's two elite cappers in every role-aware option", () => {
    const options = balanceTeamsWithOptions(
      eliteCapperLobby.map((p) => p.name),
      eliteCapperLobby,
    )
    for (const option of options) {
      if (option.label === "Off-Role") continue
      expect(sameTeam(option, "cooky", "suvix")).toBe(false)
    }
  })
})

describe("crown-value ties must not disarm runner-up protection", () => {
  // X is the sole best chaser (10) and shares the capper crown. Z is the
  // second-best chaser and is stacked onto X's team, leaving the opposition no
  // answer in either direction. Only Y's CAPPER rating differs between the two
  // lobbies — nothing about the split changes — so the penalty must not move.
  const lobby = (yCapper: number) => [
    mk("X", 10, 10, 10, 0, 0, 0),
    mk("Z", 8, 0, 9, 0, 0, 0),
    mk("Y", 9, yCapper, 4, 0, 0, 0),
    ...Array.from({ length: 9 }, (_, i) => mk(`h${i}`, i < 2 ? 7 : i < 5 ? 6 : 5, 4, 0, 4, 4, 4)),
  ]
  const stacked = ["X", "Z", "h0", "h1", "h2", "h3"]
  const scoreStacked = (yCapper: number) => {
    const players = lobby(yCapper)
    const blue = players.filter((p) => !stacked.includes(p.name)).map((p) => p.name)
    return evaluateTeams(stacked, blue, players)!.score
  }

  it("prices the stack the same whether or not the opposing capper ties the crown", () => {
    // Before the fix a tie deleted a 4000-point constraint, so making the
    // OPPOSING capper stronger made an already-stacked lineup look better.
    expect(Math.abs(scoreStacked(10) - scoreStacked(9))).toBeLessThan(50)
  })

  it("still charges the stack when the crown is tied", () => {
    const players = lobby(10)
    const blue = players.filter((p) => !stacked.includes(p.name)).map((p) => p.name)
    const separated = ["X", "h0", "h1", "h2", "h3", "h4"]
    const sepBlue = players.filter((p) => !separated.includes(p.name)).map((p) => p.name)
    expect(evaluateTeams(stacked, blue, players)!.score).toBeGreaterThan(
      evaluateTeams(separated, sepBlue, players)!.score,
    )
  })
})

describe("Off-Role card reports a comparable score", () => {
  const lobby = [
    mk("a", 9, 9, 0, 0, 8, 8),
    mk("b", 8, 0, 9, 8, 0, 0),
    mk("c", 8, 8, 0, 0, 6, 6),
    mk("d", 7, 0, 8, 7, 0, 0),
    mk("e", 7, 7, 0, 6, 6, 6),
    mk("f", 6, 0, 0, 6, 7, 6),
    mk("g", 6, 6, 0, 0, 5, 5),
    mk("h", 6, 0, 0, 6, 6, 5),
    mk("i", 5, 4, 0, 4, 5, 5),
    mk("j", 5, 0, 0, 5, 4, 5),
    mk("k", 4, 3, 0, 4, 4, 4),
    mk("l", 4, 0, 0, 3, 4, 4),
  ]

  it("scores the off-role split with the same evaluator as the other cards", () => {
    const options = balanceTeamsWithOptions(
      lobby.map((p) => p.name),
      lobby,
    )
    const offRole = options[2]
    // The reduced role-blind score is a strict subset of the full evaluator's
    // terms, so reporting it made this card structurally out-score the others.
    const honest = evaluateTeams(offRole.result.teamRed, offRole.result.teamBlue, lobby)!.score
    expect(offRole.score).toBeCloseTo(honest, 5)
  })
})

describe("odd clusters must not force the anchor's companions together", () => {
  // A real 12-man lobby with today's ratings. Interlude is the unique tier-9, so
  // the top cluster is the odd trio {Interlude, arhont, cheese} — and arhont and
  // cheese are also the lobby's two best returners. Counting Interlude inside his
  // own tally made every split that separated them look like a 2-v-1 stack and
  // charged it 4000, outbidding the 1200 elite-chaser rule meant to keep exactly
  // this pair apart. Measured over the match history, 67 of 67 odd-cluster
  // lobbies charged the fair split and 38 of 53 recommendations stacked the pair.
  const realLobby = [
    mk("Interlude", 9, 8, 0, 0, 10, 10),
    mk("arhont", 8, 0, 8, 8, 8, 0),
    mk("cheese", 8, 6, 9, 9, 0, 0),
    mk("suvix", 7, 8, 0, 0, 0, 0),
    mk("andrew", 7, 0, 8, 9, 0, 0),
    mk("phoenix", 7, 7, 0, 0, 0, 8),
    mk("shax", 7, 7, 0, 0, 0, 6),
    mk("jin", 7, 6, 7, 8, 6, 7),
    mk("flawless", 6, 0, 0, 6, 6, 5),
    mk("giraffe", 6, 0, 0, 6, 8, 6),
    mk("Canon", 6, 0, 0, 4, 8, 6),
    mk("xan", 6, 6, 0, 6, 7, 6),
  ]

  it("splits the two cluster-mates when they are the lobby's best returners", () => {
    const options = balanceTeamsWithOptions(
      realLobby.map((p) => p.name),
      realLobby,
    )
    expect(sameTeam(options[0], "arhont", "cheese")).toBe(false)
  })

  // Mirror of the same off-by-one at the bottom: W is the unique weakest and the
  // cluster widens to {W, x, y}. Counting W in his own tally charged one of the
  // two equally-even orientations, so separating x and y cost a flat constraint
  // and the only free arrangement pooled them opposite him.
  const oddBottomLobby = [
    ...Array.from({ length: 9 }, (_, i) => mk(`g${i}`, i < 3 ? 9 : i < 6 ? 8 : 7, 6, 5, 5, 5, 5)),
    mk("W", 3, 2, 0, 3, 3, 3),
    mk("x", 5, 3, 0, 4, 4, 4),
    mk("y", 5, 3, 0, 4, 4, 4),
  ]

  it("does not price separating the weakest player's two companions as a constraint", () => {
    const names = oddBottomLobby.map((p) => p.name)
    let bestSeparating = Infinity
    let bestTogether = Infinity
    const walk = (start: number, red: string[]) => {
      if (red.length === 6) {
        const blue = names.filter((n) => !red.includes(n))
        const score = evaluateTeams(red, blue, oddBottomLobby)!.score
        const split = red.includes("x") !== red.includes("y")
        if (split) bestSeparating = Math.min(bestSeparating, score)
        else bestTogether = Math.min(bestTogether, score)
        return
      }
      for (let i = start; i < names.length; i++) {
        red.push(names[i])
        walk(i + 1, red)
        red.pop()
      }
    }
    walk(0, [])
    // Was 4083 — a constraint-level charge that made pooling the two weak
    // players the only affordable shape. Anything under the 4000 band means the
    // search is choosing rather than being forced.
    expect(bestSeparating - bestTogether).toBeLessThan(4000)
  })
})

describe("floor balance — the weak-floor team loses too often", () => {
  // Real 23 Aug 2026 lobby (2-7 loss). fetchd is a cap/chase dual threat; the lobby's
  // floor is ben (tier 3) and two tier-4s (vee, devy). The widened bottom cluster is
  // {ben, vee, devy}, so the draft-anchor rule permits a 2-1 split of it — and the old
  // build's Perfect Balance pooled ben with a tier-4 (floor-drag gap 4 between teams)
  // while the tier SUMS stayed level. Replayed over the 155-lobby history the team the
  // balancer rated a shade lighter, or handed the worse floor, lost ~2/3 of its games;
  // FLOOR_WEIGHT is what makes that shortfall cost something.
  const lobby = [
    mk("fetchd", 10, 10, 10, 0, 0, 0),
    mk("Interlude", 9, 0, 0, 0, 10, 10),
    mk("twinblade", 8, 8, 7, 8, 0, 0),
    mk("original", 8, 0, 0, 0, 8, 9),
    mk("glempa", 7, 6, 0, 7, 6, 0),
    mk("jin", 7, 7, 7, 7, 8, 7),
    mk("flawless", 6, 0, 0, 6, 6, 5),
    mk("levi", 6, 0, 6, 6, 6, 0),
    mk("sora", 5, 4, 0, 3, 5, 5),
    mk("vee", 4, 0, 0, 4, 4, 4),
    mk("devy", 4, 3, 0, 4, 0, 3),
    mk("ben", 3, 0, 0, 3, 4, 3),
  ]
  const floorDragGap = (o: { result: { teamRed: string[]; teamBlue: string[] } }) => {
    const drag = (names: string[]) =>
      names.reduce((s, n) => s + Math.pow(Math.max(0, 5 - lobby.find((p) => p.name === n)!.tierValue), 2), 0)
    return Math.abs(drag(o.result.teamRed) - drag(o.result.teamBlue))
  }

  afterEach(() => {
    CONFIG.tier.FLOOR_WEIGHT = 15
  })

  it("spreads the tier-3 away from the tier-4s in the recommendation", () => {
    const options = balanceTeamsWithOptions(
      lobby.map((p) => p.name),
      lobby,
    )
    expect(sameTeam(options[0], "ben", "devy")).toBe(false)
    expect(sameTeam(options[0], "ben", "vee")).toBe(false)
  })

  it("is the term doing it — zeroing FLOOR_WEIGHT brings the pooled floor back", () => {
    const withTerm = floorDragGap(
      balanceTeamsWithOptions(lobby.map((p) => p.name), lobby)[0],
    )

    CONFIG.tier.FLOOR_WEIGHT = 0
    const withoutTerm = floorDragGap(
      balanceTeamsWithOptions(lobby.map((p) => p.name), lobby)[0],
    )

    // Old build recommended a 4-point floor-drag gap here; the term pulls it to 2.
    expect(withTerm).toBeLessThan(withoutTerm)
    expect(withTerm).toBeLessThanOrEqual(2)
  })
})

describe("mid-core balance — a carry plus a passenger hides a lopsided core", () => {
  // Real 2 Sep 2026 lobby, lost 0-7 as the balancer's own Perfect Balance. bizzle
  // (tier 10, sole star) and besty (tier 1, non-player) cancel out in the tier sum,
  // so a 36-35 split was reached by handing Red the five weakest bodies and Blue the
  // five strongest. Drop each team's best and worst and the working cores were 22 v 27.
  const lobby = [
    mk("bizzle", 10, 10, 10, 0, 0, 0),
    mk("jin", 7, 7, 7, 7, 8, 7),
    mk("shax", 7, 8, 7, 0, 7, 0),
    mk("phoenix", 7, 7, 0, 0, 0, 8),
    mk("retpecs", 7, 8, 0, 0, 0, 0),
    mk("flawless", 6, 0, 0, 6, 6, 5),
    mk("luke", 6, 6, 0, 0, 7, 5),
    mk("eze", 6, 0, 0, 8, 7, 0),
    mk("viktor", 5, 4, 0, 0, 5, 0),
    mk("sora", 5, 4, 0, 3, 5, 5),
    mk("Voodoo", 4, 0, 0, 0, 4, 0),
    mk("besty", 1, 0, 0, 0, 1, 1),
  ]
  const midCoreGap = (o: { result: { teamRed: string[]; teamBlue: string[] } }) => {
    const core = (names: string[]) => {
      const t = names.map((n) => lobby.find((p) => p.name === n)!.tierValue).sort((a, b) => a - b)
      return t.slice(1, -1).reduce((s, x) => s + x, 0)
    }
    return Math.abs(core(o.result.teamRed) - core(o.result.teamBlue))
  }

  afterEach(() => {
    CONFIG.tier.MID_CORE_WEIGHT = 4
  })

  it("does not recommend the split that pools the weak bodies with the carry", () => {
    const options = balanceTeamsWithOptions(
      lobby.map((p) => p.name),
      lobby,
    )
    // the split that was played and lost 0-7
    expect(sameTeam(options[0], "bizzle", "Voodoo") && sameTeam(options[0], "bizzle", "viktor")).toBe(false)
    expect(midCoreGap(options[0])).toBeLessThanOrEqual(2)
  })

  it("is the term doing it — zeroing MID_CORE_WEIGHT brings the lopsided core back", () => {
    const withTerm = midCoreGap(balanceTeamsWithOptions(lobby.map((p) => p.name), lobby)[0])

    CONFIG.tier.MID_CORE_WEIGHT = 0
    const withoutTerm = midCoreGap(balanceTeamsWithOptions(lobby.map((p) => p.name), lobby)[0])

    // Old build recommended a middle-four gap of 5 here; the term pulls it to 1.
    expect(withTerm).toBeLessThan(withoutTerm)
    expect(withoutTerm).toBeGreaterThanOrEqual(4)
  })
})
