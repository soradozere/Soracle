import type { Player } from "./types"

/*
 * EXPERIMENTAL composition draft — the /lab/balance workbench only.
 *
 * Nothing here is wired into the live balancer, the bot, or /balancer. The shipped
 * algorithm (lib/balance-algorithm.ts) scores all 924 possible 6v6 splits against ~15
 * tuned heuristic terms. This does something completely different: it approximates two
 * captains picking teams.
 *
 * One rule per pick. Still owe a Cap or a Ret? Take the best one on the board (Ret leans
 * first — it's the scarcer role). Got both? Take the best player left and drop them in
 * whichever job still fits. No scarcity arithmetic, no per-role counting — a captain
 * doesn't do that, and dropping it made the teams tighter, not looser.
 *
 * The role a player lands in is a suggestion, not an assignment: the teams are built to
 * be even overall, and people swap roles freely in game.
 *
 * Determinism is a design goal: no Math.random, every comparison ends in a name tiebreak,
 * so the same twelve players always produce the same teams.
 */

export const ALL_ROLES = ["Capper", "Chase", "Camp", "Cleaner", "Support"] as const
export type Role = (typeof ALL_ROLES)[number]

/*
 * A team is six DIFFERENT jobs, not two roles duplicated.
 *
 * Only 12 of 59 active players carry any Chase rating, so a second returner usually does
 * not exist; and over half the roster reads Cap 0 / Ret 0 not because they are weak but
 * because they play base — Interlude is tier 9 with Cleaner 10 and Support 10.
 *
 * Only ONE job gets picked for on purpose: the strong Cap and the strong Ret (priority
 * "premium"). The `priority` field otherwise just orders the tiebreak for which open job
 * a flexible player lands in — core (a real base pairing) ahead of filler.
 */
export const TEAM_SLOTS = [
  { id: "cap1", label: "Cap", role: "Capper", priority: "premium" },
  { id: "chase", label: "Chase", role: "Chase", priority: "premium" },
  { id: "bc", label: "BC", role: "Cleaner", priority: "core" },
  { id: "supp", label: "Support", role: "Support", priority: "core" },
  { id: "camp", label: "Camp", role: "Camp", priority: "filler" },
  { id: "cap2", label: "Cap 2", role: "Capper", priority: "filler" },
] as const satisfies readonly {
  id: string
  label: string
  role: Role
  priority: "premium" | "core" | "filler"
}[]

export type TeamSlot = (typeof TEAM_SLOTS)[number]
export type SlotId = TeamSlot["id"]

const PRIORITY_RANK = { premium: 0, core: 1, filler: 2 } as const

/** Declaration order, used as the final deterministic tiebreak between slots. */
const SLOT_RANK = new Map<SlotId, number>(TEAM_SLOTS.map((s, i) => [s.id, i]))

/**
 * Which side owns each of the twelve picks. 0 = the side that picks FIRST and holds the
 * WEAKER captain; 1 = the other. (RED / BLUE is a separate, later decision — see
 * blueIndexFor — so index 0 is NOT "Red".) Picks 1 and 2 are the captains; the remaining
 * ten are the draft proper.
 *
 * Both orders deal six picks each and never let the cumulative gap exceed one, so they
 * differ only in WHERE each side's picks fall — which, combined with the weaker captain
 * picking first, decides how even the draft comes out. Measured over 4,000 random twelves
 * off the active roster (mean tier total of the first-pick side minus the second, 0 = the
 * counterweight exactly cancels the captain gap):
 *
 *                  first-pick slots    mean diff    first-pick stronger    within 2 pts
 *   alternating    1,3,5,7,9,12          +0.06            42.4%              73.8%
 *   snake          1,4,5,8,9,12          -2.26            10.6%              53.0%
 *
 * Alternating pairs cleanly with weaker-captain-first: the first side takes the earlier
 * pick of every round, which almost exactly offsets conceding the better captain — dead
 * even on average, three lobbies in four inside two tier points. The true snake over-
 * corrects: it also hands the SECOND side picks 2 and 3 back to back, so that side gets
 * the stronger captain AND the tempo, and the draft tilts their way by ~2 tier points.
 */
export const DRAFT_ORDERS = {
  alternating: {
    label: "Alternating",
    pattern: "AB · abababab·ba",
    note: "First side takes the earlier pick each round — the counterweight to conceding the top captain.",
    order: [0, 1, 0, 1, 0, 1, 0, 1, 0, 1, 1, 0] as const,
  },
  snake: {
    label: "True snake",
    pattern: "AB · ba·ab·ba·ab·ba",
    note: "Each round reverses. Over-corrects: the second side gets the top captain and picks 2-3 back to back.",
    order: [0, 1, 1, 0, 0, 1, 1, 0, 0, 1, 1, 0] as const,
  },
} satisfies Record<string, { label: string; pattern: string; note: string; order: readonly (0 | 1)[] }>

export type DraftOrderId = keyof typeof DRAFT_ORDERS

export const DEFAULT_ORDER_ID: DraftOrderId = "alternating"

export const TEAM_LABELS = ["RED", "BLUE"] as const
export type TeamLabel = (typeof TEAM_LABELS)[number]

/*
 * RED / BLUE is assigned AFTER the draft, from the tier totals: the lighter team takes
 * Blue. The Blue base is the easier one to hold in JK2 CTF, so handing it to the weaker
 * side nudges a lopsided draft back toward an even game — the same rule the live balancer
 * uses. An exact tie goes to the side that picked first (index 0, the weaker-captain
 * side), keeping the whole thing deterministic rather than coin-flipped.
 *
 * So the pick log can read "PICK 1. CAPTAIN BLUE" — the first pick belongs to the side
 * that conceded the stronger captain, which is usually the one that ends up lighter.
 */
export function blueIndexFor(tier0: number, tier1: number): 0 | 1 {
  return tier1 < tier0 ? 1 : 0
}

/** Why the draft chose a given player. Surfaced in the lab's diagnostics panel. */
export type PickReason =
  /** Seeded to a side before the draft — one of the two highest-tier players. */
  | "captain"
  /** Drafted to fill the team's Cap or Ret — the two roles picked for on purpose. */
  | "premium"
  /** Cap and Ret already held, so just the best player left, slotted by fit. */
  | "best-available"
  /** Forced into a Cap or Ret slot with no viable player left for it. */
  | "fallback"

export interface RoleStats {
  mean: number
  sd: number
}

/** Per-player figures from step 1, kept for the diagnostics table. */
export interface PlayerDraftStats {
  name: string
  tierValue: number
  roles: Record<Role, number>
  /** Standard score per role, across the twelve selected. */
  z: Record<Role, number>
  /** z > 0 — above this lobby's mean for the role. */
  viable: Record<Role, boolean>
  /** Highest raw rating across all five roles; breaks a captain tie. */
  bestRating: number
  /** Mean of all five role ratings — the last real tiebreak before name order. */
  roleAverage: number
}

export interface DraftPick {
  /** 1-12, in draft order. */
  pickNumber: number
  teamIndex: 0 | 1
  team: TeamLabel
  player: string
  /** The job this pick fills. Every pick fills exactly one; six picks, six slots. */
  slot: SlotId
  slotLabel: string
  reason: PickReason
  /** Human-readable justification, e.g. "Best Ret on the board (Chase 8, z +1.20)". */
  detail: string
}

/** Consecutive picks by the same team, collapsed for the "PICK n. BLUE = B, C" log. */
export interface DraftTurn {
  turnNumber: number
  team: TeamLabel
  isCaptain: boolean
  players: string[]
}

export interface DraftedPlayer {
  name: string
  tierValue: number
  pickNumber: number
  slot: SlotId
  slotLabel: string
  reason: PickReason
}

export interface DraftResult {
  captains: Record<TeamLabel, string>
  teams: Record<TeamLabel, DraftedPlayer[]>
  tierTotals: Record<TeamLabel, number>
  picks: DraftPick[]
  turns: DraftTurn[]
  stats: Record<Role, RoleStats>
  players: PlayerDraftStats[]
  /** Which pick order produced this draft. */
  orderId: DraftOrderId
}

/**
 * Population mean and standard deviation. Population rather than sample because the
 * twelve selected players ARE the whole pool being described — there is no wider
 * population being estimated from them.
 */
function meanAndSd(values: number[]): RoleStats {
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length
  return { mean, sd: Math.sqrt(variance) }
}

/**
 * Step 1 — role statistics across the twelve selected players, for all five roles.
 *
 * Standard scores rather than raw ratings, because the five roles have very different
 * distributions across the roster: 40 of 59 active players carry a Cleaner rating but
 * only 12 carry a Chase one. A Chase 7 is therefore a far rarer asset than a Cleaner 7,
 * and z is what makes "is this player better as a chaser or a cleaner?" a fair question.
 * Within a single slot the raw rating still decides, since there the distribution is
 * shared by every candidate.
 */
export function computeDraftStats(players: Player[]): {
  stats: Record<Role, RoleStats>
  players: PlayerDraftStats[]
} {
  const stats = Object.fromEntries(
    ALL_ROLES.map((role) => [role, meanAndSd(players.map((p) => p.roles[role]))]),
  ) as Record<Role, RoleStats>

  return {
    stats,
    players: players.map((p) => {
      // A zero SD means every player shares the rating, so nobody is above the mean and
      // no z-score is defined. Reporting 0 leaves the whole pool non-viable for that
      // role, routing its picks through the fallback — the right outcome, since the
      // ratings carry no signal to separate anyone on.
      const z = Object.fromEntries(
        ALL_ROLES.map((role) => {
          const { mean, sd } = stats[role]
          return [role, sd === 0 ? 0 : (p.roles[role] - mean) / sd]
        }),
      ) as Record<Role, number>

      return {
        name: p.name,
        tierValue: p.tierValue,
        roles: { ...p.roles },
        z,
        viable: Object.fromEntries(ALL_ROLES.map((role) => [role, z[role] > 0])) as Record<
          Role,
          boolean
        >,
        bestRating: Math.max(...ALL_ROLES.map((role) => p.roles[role])),
        roleAverage: ALL_ROLES.reduce((s, role) => s + p.roles[role], 0) / ALL_ROLES.length,
      }
    }),
  }
}

/**
 * Ranks two candidates once their headline score is equal: better all-round role average,
 * then higher tier, then name. The last is arbitrary but total, which keeps the draft
 * reproducible.
 */
function breakTie(a: PlayerDraftStats, b: PlayerDraftStats): number {
  if (a.roleAverage !== b.roleAverage) return b.roleAverage - a.roleAverage
  if (a.tierValue !== b.tierValue) return b.tierValue - a.tierValue
  return a.name.localeCompare(b.name)
}

/**
 * Best remaining player on overall strength: tier, then all-round role average, then
 * name. Used once Cap and Ret are secured, and for a forced pick — a role that has to be
 * filled but has no viable player left is better handed to the strongest body available
 * than to whoever happens to carry the highest (worthless) rating in it.
 */
function bestByTier(pool: PlayerDraftStats[]): PlayerDraftStats {
  return [...pool].sort((a, b) => {
    if (b.tierValue !== a.tierValue) return b.tierValue - a.tierValue
    if (b.roleAverage !== a.roleAverage) return b.roleAverage - a.roleAverage
    return a.name.localeCompare(b.name)
  })[0]
}

function compareSlots(a: TeamSlot, b: TeamSlot): number {
  return (
    PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
    SLOT_RANK.get(a.id)! - SLOT_RANK.get(b.id)!
  )
}

/**
 * Which of the given slots a player is best suited to. Compared on z so the answer is
 * "where does this player stand out most", not "which raw number is biggest". Prefers a
 * slot they're viable for; if they're viable for none, falls back to their best raw
 * rating so a pick always lands somewhere sensible.
 */
function bestSlotFor(p: PlayerDraftStats, slots: readonly TeamSlot[]): TeamSlot {
  const viable = slots.filter((s) => p.viable[s.role])
  const scope = viable.length > 0 ? viable : slots
  return [...scope].sort(
    (a, b) => p.z[b.role] - p.z[a.role] || compareSlots(a, b),
  )[0]
}

const fmtZ = (z: number) => (z >= 0 ? "+" : "") + z.toFixed(2)

/**
 * Runs the draft end to end. `selected` must be exactly twelve players; the caller is
 * expected to have resolved names against the roster already.
 */
export function runDraft(
  selected: Player[],
  orderId: DraftOrderId = DEFAULT_ORDER_ID,
): DraftResult {
  if (selected.length !== 12) {
    throw new Error(`Draft needs exactly 12 players, got ${selected.length}`)
  }
  const order = DRAFT_ORDERS[orderId].order

  const { stats, players } = computeDraftStats(selected)

  // --- Captains ---------------------------------------------------------------------
  // The two strongest players by TIER, with the role ratings only breaking ties.
  //
  // Seating captains on their best Cap/Ret rating meant a player rated 0 in both could
  // never captain however good he was: a tier 9 lost the armband to a tier 7 with a Cap
  // 8, in a lobby where the tier 9 was plainly the better player. The captain is his
  // side's best player; the ten picks that follow are what sorts the composition out.
  const captainOrder = [...players].sort((a, b) => {
    if (b.tierValue !== a.tierValue) return b.tierValue - a.tierValue
    if (b.bestRating !== a.bestRating) return b.bestRating - a.bestRating
    return breakTie(a, b)
  })

  const rosters: DraftedPlayer[][] = [[], []]
  const filled: Set<SlotId>[] = [new Set(), new Set()]
  const picks: DraftPick[] = []
  const pool = new Map(players.map((p) => [p.name, p]))

  // `team` is filled in provisionally and overwritten once the draft is done and the
  // tier totals — and so the colours — are known.
  const commit = (
    teamIndex: 0 | 1,
    player: PlayerDraftStats,
    slot: TeamSlot,
    reason: PickReason,
    detail: string,
  ) => {
    pool.delete(player.name)
    filled[teamIndex].add(slot.id)
    const pickNumber = picks.length + 1
    rosters[teamIndex].push({
      name: player.name,
      tierValue: player.tierValue,
      pickNumber,
      slot: slot.id,
      slotLabel: slot.label,
      reason,
    })
    picks.push({
      pickNumber,
      teamIndex,
      team: "RED",
      player: player.name,
      slot: slot.id,
      slotLabel: slot.label,
      reason,
      detail,
    })
  }

  // The STRONGER captain is seeded to the second-picking side, the weaker one to the
  // first. Whoever lands the lobby's best player concedes first pick of the field as the
  // counterweight — otherwise seeding captains on tier just hands one team both the best
  // player and the better draft slot, and nothing downstream pays it back. Every order
  // opens 0,1, so the weaker captain is pick 1 and the stronger is pick 2. Each takes
  // the job he stands out most at, which may well be a core slot: a captain who is the
  // lobby's best base cleaner fills BC, and his side still owes a capper and a chaser.
  const seated: [PlayerDraftStats, PlayerDraftStats] = [captainOrder[1], captainOrder[0]]
  ;([0, 1] as const).forEach((index) => {
    const captain = seated[index]
    const slot = bestSlotFor(captain, TEAM_SLOTS)
    const rank = index === 1 ? "top" : "second"
    commit(
      index,
      captain,
      slot,
      "captain",
      `Captain — ${rank} tier in the lobby (${captain.tierValue}), seeded to ` +
        `pick ${index + 1}${index === 0 ? " as the counterweight" : ""}; best suited to ` +
        `${slot.label} (${slot.role} ${captain.roles[slot.role]}, z ${fmtZ(captain.z[slot.role])})`,
    )
  })

  // --- The draft --------------------------------------------------------------------
  // One rule per pick, meant to read like a captain thinking out loud:
  //
  //   Still owe a Cap or a Ret?  Take the best one on the board. Ret leans first — it is
  //   the scarcer role — but a genuine Cap monster still goes Cap.
  //
  //   Got both?  Take the best player left and drop them in whichever job still fits.
  //
  // No scarcity arithmetic, no per-role counting. If a role has to be filled and nobody
  // left can really play it, the best body available takes it (fallback).
  const CAP_SLOT = TEAM_SLOTS.find((s) => s.id === "cap1")!
  const RET_SLOT = TEAM_SLOTS.find((s) => s.id === "chase")!

  for (let pickIndex = 2; pickIndex < order.length; pickIndex++) {
    const teamIndex = order[pickIndex]
    const remaining = [...pool.values()]
    const unfilled = TEAM_SLOTS.filter((s) => !filled[teamIndex].has(s.id))

    const needsCap = unfilled.some((s) => s.id === "cap1")
    const needsRet = unfilled.some((s) => s.id === "chase")

    if (needsCap || needsRet) {
      // Best Cap-or-Ret player still available, each rated on their stronger of the two
      // roles this team still needs. A dead-even player (or a straight rating tie between
      // two players) leans Ret.
      let best: { player: PlayerDraftStats; role: Role; rating: number } | null = null
      for (const p of remaining) {
        let role: Role | null = null
        let rating = -1
        if (needsCap && p.viable.Capper && p.roles.Capper > rating) {
          role = "Capper"
          rating = p.roles.Capper
        }
        if (needsRet && p.viable.Chase && p.roles.Chase >= rating) {
          role = "Chase"
          rating = p.roles.Chase
        }
        if (!role) continue
        const better =
          !best ||
          rating > best.rating ||
          (rating === best.rating && role === "Chase" && best.role !== "Chase") ||
          (rating === best.rating && role === best.role && breakTie(p, best.player) < 0)
        if (better) best = { player: p, role, rating }
      }

      if (!best) {
        // Nobody left can really play the role we owe — take the best body and put them
        // there. Ret gets the fallback first when both are still owed.
        const slot = needsRet ? RET_SLOT : CAP_SLOT
        const choice = bestByTier(remaining)
        commit(
          teamIndex,
          choice,
          slot,
          "fallback",
          `No viable ${slot.label} left — best remaining player takes it ` +
            `(tier ${choice.tierValue}, ${slot.role} ${choice.roles[slot.role]})`,
        )
        continue
      }

      const slot = best.role === "Chase" ? RET_SLOT : CAP_SLOT
      commit(
        teamIndex,
        best.player,
        slot,
        "premium",
        `Best ${slot.label} on the board (${best.role} ${best.rating}, z ${fmtZ(best.player.z[best.role])})`,
      )
      continue
    }

    // Cap and Ret held — the composition stops steering. Best player left, slotted into
    // whichever of this team's open jobs suits them most.
    const choice = bestByTier(remaining)
    const slot = bestSlotFor(choice, unfilled)
    commit(
      teamIndex,
      choice,
      slot,
      "best-available",
      `Best player left (tier ${choice.tierValue}) — ${slot.label}` +
        (choice.viable[slot.role]
          ? ` (${slot.role} ${choice.roles[slot.role]}, z ${fmtZ(choice.z[slot.role])})`
          : " (no strong role fit)"),
    )
  }

  const tierTotal = (roster: DraftedPlayer[]) => roster.reduce((s, p) => s + p.tierValue, 0)
  const tierByIndex: [number, number] = [tierTotal(rosters[0]), tierTotal(rosters[1])]
  const blueIndex = blueIndexFor(tierByIndex[0], tierByIndex[1])
  const labelOf = (i: 0 | 1): TeamLabel => (i === blueIndex ? "BLUE" : "RED")

  // Now that colours are settled, stamp every pick with its real team.
  for (const pick of picks) pick.team = labelOf(pick.teamIndex)

  // Collapse runs of same-team picks so the log reads "PICK 4. BLUE = B, C".
  const turns: DraftTurn[] = []
  for (const pick of picks) {
    const previous = turns[turns.length - 1]
    const isCaptain = pick.reason === "captain"
    if (previous && previous.team === pick.team && !previous.isCaptain && !isCaptain) {
      previous.players.push(pick.player)
      continue
    }
    turns.push({
      turnNumber: turns.length + 1,
      team: pick.team,
      isCaptain,
      players: [pick.player],
    })
  }

  const redIndex = (1 - blueIndex) as 0 | 1
  return {
    captains: { RED: rosters[redIndex][0].name, BLUE: rosters[blueIndex][0].name },
    teams: { RED: rosters[redIndex], BLUE: rosters[blueIndex] },
    tierTotals: { RED: tierByIndex[redIndex], BLUE: tierByIndex[blueIndex] },
    picks,
    turns,
    stats,
    players,
    orderId,
  }
}

/** The pick log as plain text — also what the lab's copy button emits. */
export function formatDraftLog(result: DraftResult): string {
  return result.turns
    .map((turn) => {
      const who = turn.isCaptain ? `CAPTAIN ${turn.team}` : turn.team
      return `PICK ${turn.turnNumber}. ${who} = ${turn.players.join(", ")}`
    })
    .join("\n")
}
