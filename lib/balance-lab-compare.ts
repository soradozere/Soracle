import { balanceTeamsWithOptions, evaluateTeams } from "./balance-algorithm"
import { balanceConfidencePct } from "./balance-confidence"
import type { DraftResult } from "./balance-draft"
import type { Player } from "./types"

/*
 * Lab glue: run the same twelve players through the SHIPPED balancer and line its answer
 * up against the composition draft's, so the workbench can show whether the draft is
 * producing sensible teams by the incumbent's own lights.
 *
 * Two numbers matter here:
 *   - how much the two rosters overlap (are these basically the same teams?)
 *   - what the live evaluator SCORES the draft's split at, next to its own best split
 *     (is the draft's answer near-optimal, or does the live algorithm think it's poor?)
 */

export interface LineupComparison {
  /** The live balancer's first option — the split the bot actually serves. */
  baseline: {
    teamRed: string[]
    teamBlue: string[]
    redTierTotal: number
    blueTierTotal: number
    gap: number
    score: number
    confidence: number
  }
  /** The DRAFT's split, fed back through the live balancer's own evaluator. */
  draftScoredLive: { score: number; confidence: number } | null
  draftGap: number
  /**
   * Players on the same side under both methods, after aligning colours (the draft and
   * the balancer assign RED/BLUE independently). 12 = identical teams, 6 = no better
   * than chance.
   */
  sameSide: number
  /** The players the two methods put on opposite sides, under the best alignment. */
  movers: string[]
}

export function compareToBaseline(draft: DraftResult, allPlayers: Player[]): LineupComparison | null {
  const draftRed = draft.teams.RED.map((p) => p.name)
  const draftBlue = draft.teams.BLUE.map((p) => p.name)
  const lobby = [...draftRed, ...draftBlue]

  let options
  try {
    options = balanceTeamsWithOptions(lobby, allPlayers)
  } catch {
    // balanceTeamsWithOptions throws on anything but 12 resolvable players; the lab
    // guarantees that, but if a name ever fails to resolve, skip the comparison rather
    // than blow up the whole result.
    return null
  }
  const best = options[0]

  const live = evaluateTeams(draftRed, draftBlue, allPlayers)

  const baseRed = new Set(best.result.teamRed)
  const inBase = (names: string[]) => names.filter((n) => baseRed.has(n)).length

  // Agreement with draftRed treated as the RED side, vs. with the draft flipped.
  const agree = inBase(draftRed) + (draftBlue.length - inBase(draftBlue))
  const agreeFlipped = inBase(draftBlue) + (draftRed.length - inBase(draftRed))
  const flipped = agreeFlipped > agree
  const sameSide = Math.max(agree, agreeFlipped)

  const alignedRed = new Set(flipped ? draftBlue : draftRed)
  const movers = lobby
    .filter((n) => alignedRed.has(n) !== baseRed.has(n))
    .sort((a, b) => a.localeCompare(b))

  return {
    baseline: {
      teamRed: best.result.teamRed,
      teamBlue: best.result.teamBlue,
      redTierTotal: best.result.redTierTotal,
      blueTierTotal: best.result.blueTierTotal,
      gap: Math.abs(best.result.redTierTotal - best.result.blueTierTotal),
      score: best.score,
      confidence: balanceConfidencePct(best.score),
    },
    draftScoredLive: live
      ? { score: live.score, confidence: balanceConfidencePct(live.score) }
      : null,
    draftGap: Math.abs(draft.tierTotals.RED - draft.tierTotals.BLUE),
    sameSide,
    movers,
  }
}
