import type { Player, BalanceResult, BalanceOption } from "./types"

const ROLES = ["Capper", "Chase", "Camp", "Cleaner", "Support"] as const

const CONFIG = {
  tier: {
    WEIGHT: 3.0,
    MAX_DIFF: 2,
    OVER_MAX_PENALTY: 2000,
    TOP_3_WEIGHT: 3.0,
    BOTTOM_3_WEIGHT: 2.5,
  },
  elite: {
    THRESHOLD: 8,
    // Flat penalty when one team has 3+ elites and the other is short by 2+. Raised from
    // 1500 to constraint level (same band as the cluster rules) in August 2026: at 1500 it
    // sat in the same numeric range as the role heuristics, so the search could BUY a 3-v-1
    // elite stack by paying for it with role-balance gains. Nothing in the 260-lobby history
    // picked a stacking split at the old weight, so raising it changes no existing
    // recommendation — it only stops a stack being traded for.
    STACK_PENALTY: 8000,
  },
  roles: {
    COVERAGE_PENALTY: 4000,
    BALANCE_WEIGHT: 0.8,
    VIABLE_THRESHOLD: 4,
  },
  // Capper is the most crucial and scarcest role. Balancing role *sums* alone lets the
  // algorithm stack the elite cappers on one team (e.g. two 9s) and offset them with
  // several mid cappers on the other. These terms balance the TOP of each team's capper
  // pool so the best cappers get split across teams.
  capper: {
    ELITE_THRESHOLD: 8, // a capper rated 8+ is elite and scarce
    TOP_2_WEIGHT: 2.5, // balance each team's top-2 capper pool
    CONCENTRATION_WEIGHT: 300, // squared diff in elite-capper COUNT per team (2-v-0 ≈ 1200)
    // Flat, constraint-level top-up on CONCENTRATION_WEIGHT for the worst case
    // specifically: one team holding EVERY elite capper in the lobby (2+ total).
    // Surfaced live 24 Aug 2026 (cheese + original stacked) — at 1200,
    // CONCENTRATION_WEIGHT alone is cheap enough for the search to buy a full
    // monopoly by paying for it with role-balance gains elsewhere, the same
    // trade-away shape the tie/anchor family (#164/#170/#172/#173) already
    // fixed for other rules. This does not replace CONCENTRATION_WEIGHT — the
    // quadratic still grades partial imbalances (3-v-1, 4-v-2); this only fires
    // on the all-or-nothing case, at constraint level so it can't be traded.
    MONOPOLY_PENALTY: 8000,
  },
  // Mirror of the capper concentration rule for returners, added after a live game
  // (22 Aug 2026) where the recommendation put the lobby's only two chase-9s on one
  // team against a chase-6. Role SUMS alone priced that 18-v-6 monopoly at ~115
  // points; counting the elite bodies per side is what actually spreads them.
  chase: {
    ELITE_THRESHOLD: 8,
    CONCENTRATION_WEIGHT: 300, // squared diff in elite-chaser COUNT per team (2-v-0 ≈ 1200)
    // Same sibling risk as capper.MONOPOLY_PENALTY, same fix -- this rule is
    // structurally identical and only two days older, so it hasn't been
    // battle-tested any longer than the capper one that just failed live.
    MONOPOLY_PENALTY: 8000,
  },
  // Capper and Chase are the two critical roles. The capper terms above split the elite
  // cappers across teams, but nothing stops the single best capper and the single best
  // chase returner from landing together — a frequent complaint, since that one team then
  // owns both pivotal duels. This flat penalty fires when one side holds BOTH and the other
  // holds NEITHER, nudging the search to break the pair apart. When one player holds both
  // crowns, RUNNER_UP_PENALTY applies per monopolised runner-up role instead — see
  // capperChaseSplitPenalty.
  //
  // RUNNER_UP_PENALTY is set at constraint level rather than as a nudge, and that took two
  // goes to get right. At 1200 it was strong enough to move the recommendation but weak
  // enough to be traded against, and what it bought the separation with was 3-v-1 elite
  // stacks — five of them across the history, which is a worse problem than the one being
  // fixed. Weight-tuning could not separate the two: every increment that unstacked a chaser
  // pair created another elite stack. Checking all 37 dual-threat lobbies exhaustively showed
  // a split satisfying BOTH rules always exists, so this is not a real trade-off — it was the
  // soft terms outbidding both. Pricing both as constraints finds those splits: chaser
  // stacking 13 -> 0 with elite stacking still at 0. If this is ever loosened back into the
  // 1000-2000 band, re-check the elite-stack count, not just tier balance.
  split: {
    CAPPER_CHASE_PENALTY: 4000,
    RUNNER_UP_PENALTY: 4000,
  },
  cluster: {
    TOP_TWO_PENALTY: 8000,
    BOTTOM_CLUSTER_PENALTY: 8000,
  },
}

function getCombinations<T>(arr: T[], k: number): T[][] {
  const result: T[][] = []

  function recurse(start: number, combo: T[]) {
    if (combo.length === k) {
      result.push([...combo])
      return
    }
    for (let i = start; i < arr.length; i++) {
      combo.push(arr[i])
      recurse(i + 1, combo)
      combo.pop()
    }
  }

  recurse(0, [])
  return result
}

/*
 * Top-cluster separation (section 6 of both evaluators). Two regimes:
 *
 * UNIQUE top player: the original rule — the #1 must not hold more top-cluster
 * allies than the other team. One-sided on purpose: the lone star ceding extra
 * cluster members to the other side is a handicap, not a stack.
 *
 * TIED top tier: there is no unique star to protect, and anchoring on one of the
 * tied players made the rule one-eyed — joining the anchor cost 8000 while
 * joining the other tied player was free, so the rule FORCED the remaining
 * cluster members onto the non-anchor's team (22 Aug 2026: cooky and Interlude
 * tied at 9; cheese was pushed onto cooky's side, stacking the lobby's only two
 * chase-9s in the shipped recommendation). With a tie both checks go symmetric:
 * the tied-strongest spread as evenly as possible and so does the full cluster,
 * with imbalance beyond unavoidable parity penalized whichever side holds it.
 * The tied path uses no anchor at all, which also cures evaluateTeams scoring a
 * lineup differently depending on argument order (its old tier-only sort could
 * crown a different tied player than the search's tier-then-role-sum sort).
 */
function topClusterPenalty(
  team1: Player[],
  team2: Player[],
  topPlayer: Player,
  topCluster: Player[],
): number {
  const totalPlayers = team1.length + team2.length
  // Only a genuine minority clusters; at half the lobby or more this is noise.
  if (topCluster.length >= totalPlayers / 2) return 0

  const maxTier = topPlayer.tierValue
  const maxTierPlayers = topCluster.filter((p) => p.tierValue === maxTier)

  if (maxTierPlayers.length >= 2) {
    const spread = (group: Player[]) => {
      const in1 = team1.filter((p) => group.includes(p)).length
      const excess = Math.abs(in1 * 2 - group.length) - (group.length % 2)
      return excess > 0 ? excess * CONFIG.cluster.TOP_TWO_PENALTY * 0.5 : 0
    }
    return spread(maxTierPlayers) + spread(topCluster)
  }

  const topPlayerTeam = team1.includes(topPlayer) ? team1 : team2
  const otherTeam = team1.includes(topPlayer) ? team2 : team1
  // ALLIES beside the top player, not raw cluster membership: the top player is
  // himself in topCluster, so counting membership charged his side for his own
  // presence. For an odd cluster that made the unavoidable even ally split
  // (one cluster-mate each) look like a 2-v-1 stack and priced it at 4000 —
  // measured over the match history, 67 of 67 odd-cluster lobbies charged the
  // fair split, and 38 of 53 recommendations herded BOTH cluster-mates onto the
  // non-top team. Where those two were the lobby's best returners that re-created
  // the very stack the elite-chaser rule was added to prevent, outbidding it
  // 4000 to 1200. Sibling rules (the tied path above, bottomClusterPenalty) both
  // allow unavoidable parity; this one now does too, while keeping the
  // deliberate one-sidedness: 2-v-0 still costs 8000, and the top player ceding
  // cluster members to the other side stays free.
  const alliesWithTop = topPlayerTeam.filter((p) => p !== topPlayer && topCluster.includes(p)).length
  const clusterWithOther = otherTeam.filter((p) => topCluster.includes(p)).length
  if (alliesWithTop > clusterWithOther) {
    return (alliesWithTop - clusterWithOther) * CONFIG.cluster.TOP_TWO_PENALTY * 0.5
  }
  return 0
}

// Bottom-cluster separation — the mirror of the top-player rule in section 6. Manual
// drafts split the final picks across teams by construction; a scoring search has no
// such structure, so nothing stopped it pooling the weakest players on one side to pay
// for stacking the other (July 2026: both tier-5s landed together against the lobby's
// only tier-10, and the community noticed). The cluster is everyone at the lowest tier,
// widened to include the second-lowest tier when a single player sits alone at the
// bottom. Skipped when the cluster is half the lobby or more — splitting it evenly is
// then unavoidable and the check is noise, matching the top-cluster guard. The penalty
// scales with how much more clustered the group is than the most even possible split,
// so odd-sized clusters aren't punished for their unavoidable 2-v-1.
function bottomClusterPenalty(team1: Player[], team2: Player[]): number {
  const everyone = [...team1, ...team2]
  const lowestTier = Math.min(...everyone.map((p) => p.tierValue))
  let cluster = everyone.filter((p) => p.tierValue === lowestTier)
  if (cluster.length === 1) {
    const nextTier = Math.min(...everyone.filter((p) => p.tierValue > lowestTier).map((p) => p.tierValue))
    cluster = everyone.filter((p) => p.tierValue <= nextTier)
  }
  if (cluster.length < 2 || cluster.length >= everyone.length / 2) return 0

  const inTeam1 = team1.filter((p) => cluster.includes(p)).length
  const imbalance = Math.abs(inTeam1 * 2 - cluster.length) // == |count in team1 - count in team2|
  const excess = imbalance - (cluster.length % 2)
  let penalty = excess > 0 ? excess * CONFIG.cluster.BOTTOM_CLUSTER_PENALTY * 0.5 : 0

  // Anchored draft rule: when one player is strictly the weakest in the lobby, their
  // team must not hold the majority of the bottom cluster (the draft would hand the
  // last pick to the side with fewer of the other low picks).
  const atLowest = everyone.filter((p) => p.tierValue === lowestTier)
  if (atLowest.length === 1) {
    const weakest = atLowest[0]
    // Companions beside the weakest, not membership including him — the same
    // correction as the top-cluster rule above. Counting him charged one of the
    // two equally-even 2-v-1 orientations of an odd cluster, leaving exactly one
    // legal arrangement: every other weak player pooled opposite him.
    const mine = (team1.includes(weakest) ? team1 : team2).filter(
      (p) => p !== weakest && cluster.includes(p),
    ).length
    const theirs = cluster.length - 1 - mine
    if (mine > theirs) penalty += (mine - theirs) * CONFIG.cluster.BOTTOM_CLUSTER_PENALTY * 0.5
  }
  return penalty
}

// Flat top-up for the worst case of an elite-role concentration count: one team holding
// EVERY elite player in that role (2+ total elite in the lobby). See CONFIG.capper /
// CONFIG.chase MONOPOLY_PENALTY for why the graduated CONCENTRATION_WEIGHT term alone
// isn't enough to stop this case specifically.
function monopolyPenalty(count1: number, count2: number, penalty: number): number {
  const total = count1 + count2
  if (total < 2) return 0
  return count1 === total || count2 === total ? penalty : 0
}

// Best-capper / best-chaser separation — keep one team from owning BOTH pivotal duel
// roles. Shared by the tier and ELO evaluators, which differ only in penalty scale.
//
// Ratings are compared by VALUE, not identity, so role ties are order-independent: if a
// role's top rating appears on both teams, each side already holds one and nothing fires.
//
// The dual-threat case (one player is the sole best capper AND the sole best chaser) used
// to switch the whole rule off, on the logic that a player can't be split from himself.
// That was too blunt — it also stopped the search caring where the RUNNER-UP in each role
// landed, so the second-best chaser routinely stacked onto the dual threat's team and the
// opposition was left with no answer in either direction (August 2026: bizzle, cap 10 /
// chase 10, pulled the next-best chaser onto his side in every suggested option). He still
// can't be split from himself, so instead we ask where the counters go: the opposition's
// only answer to him capping is the best remaining chaser, and its only threat while he
// chases is the best remaining capper. Each runner-up his team monopolises costs
// runnerUpPenalty — see CONFIG.split for why that is priced as a constraint rather than a
// nudge, and what goes wrong when it isn't.
function capperChaseSplitPenalty(
  team1: Player[],
  team2: Player[],
  pairPenalty: number,
  runnerUpPenalty: number,
): number {
  const everyone = [...team1, ...team2]
  const capOf = (p: Player) => Math.max(p.roles.Capper, 0)
  const chaseOf = (p: Player) => Math.max(p.roles.Chase, 0)

  const bestCapperVal = Math.max(...everyone.map(capOf))
  const bestChaseVal = Math.max(...everyone.map(chaseOf))
  const topCappers = everyone.filter((p) => capOf(p) === bestCapperVal)
  const topChasers = everyone.filter((p) => chaseOf(p) === bestChaseVal)
  // A player is a dual threat when they are the SOLE holder of one critical crown
  // and hold the other outright or jointly. Requiring BOTH crowns to be unique let
  // a value tie on either one disarm the rule entirely: the same tie also disarms
  // the both-vs-neither pair check below (the tied player on the other team makes
  // that side count as holding the crown), so a de-facto dual threat got no
  // runner-up protection and the best remaining counter in his role could be
  // stacked onto his team for free. The trigger even ran backwards — raising the
  // OPPOSING capper from 9 to 10 deleted a 4000-point constraint from an already
  // stacked lineup.
  const soleTopCapper = topCappers.length === 1 ? topCappers[0] : null
  const soleTopChaser = topChasers.length === 1 ? topChasers[0] : null
  const dualThreat =
    soleTopCapper && topChasers.includes(soleTopCapper)
      ? soleTopCapper
      : soleTopChaser && topCappers.includes(soleTopChaser)
        ? soleTopChaser
        : null

  if (!dualThreat) {
    const hasTopCapper = (team: Player[]) => team.some((p) => capOf(p) === bestCapperVal)
    const hasTopChase = (team: Player[]) => team.some((p) => chaseOf(p) === bestChaseVal)
    const team1Both = hasTopCapper(team1) && hasTopChase(team1)
    const team2Both = hasTopCapper(team2) && hasTopChase(team2)
    const team1Neither = !hasTopCapper(team1) && !hasTopChase(team1)
    const team2Neither = !hasTopCapper(team2) && !hasTopChase(team2)
    return (team1Both && team2Neither) || (team2Both && team1Neither) ? pairPenalty : 0
  }

  const dualTeam = team1.includes(dualThreat) ? team1 : team2
  const otherTeam = team1.includes(dualThreat) ? team2 : team1
  const others = everyone.filter((p) => p !== dualThreat)

  // A runner-up counts as monopolised only when the dual threat's team holds that rating
  // and the opposition holds nobody matching it — the same tie handling as above. When the
  // runner-up rating is 0 (nobody else plays the role at all) both teams trivially match,
  // so this can't fire: there is no counter to distribute.
  const monopolised = (of: (p: Player) => number) => {
    const runnerUpVal = Math.max(...others.map(of))
    return dualTeam.some((p) => p !== dualThreat && of(p) === runnerUpVal) && !otherTeam.some((p) => of(p) === runnerUpVal)
  }

  let penalty = 0
  if (monopolised(chaseOf)) penalty += runnerUpPenalty
  if (monopolised(capOf)) penalty += runnerUpPenalty
  return penalty
}

export function evaluateSplit(team1: Player[], team2: Player[], topPlayer: Player, topCluster: Player[]) {
  // 1. Tier balance (primary)
  const tier1 = team1.reduce((s, p) => s + p.tierValue, 0)
  const tier2 = team2.reduce((s, p) => s + p.tierValue, 0)
  const tierDiff = Math.abs(tier1 - tier2)

  let score = Math.pow(tierDiff, 2) * CONFIG.tier.WEIGHT

  if (tierDiff > CONFIG.tier.MAX_DIFF) {
    score += Math.pow(tierDiff - CONFIG.tier.MAX_DIFF, 2) * CONFIG.tier.OVER_MAX_PENALTY
  }

  // 2. Critical role coverage
  const criticalRoles = ["Capper", "Chase"] as const

  criticalRoles.forEach((role) => {
    const viable1 = team1.filter((p) => p.roles[role] >= CONFIG.roles.VIABLE_THRESHOLD).length
    const viable2 = team2.filter((p) => p.roles[role] >= CONFIG.roles.VIABLE_THRESHOLD).length

    if (viable1 === 0 || viable2 === 0) {
      score += CONFIG.roles.COVERAGE_PENALTY
    }
  })

  // 3. Role strength balance
  // NOTE: applyDisabledRoles zeros a player's role rating but does NOT touch their tierValue.
  // This means a player with a critical role disabled still contributes to tier balance but
  // no longer counts toward the role-coverage check above. Known edge case — worth watching.
  ROLES.forEach((role) => {
    const r1 = team1.reduce((s, p) => s + Math.max(p.roles[role], 0), 0)
    const r2 = team2.reduce((s, p) => s + Math.max(p.roles[role], 0), 0)
    score += Math.pow(r1 - r2, 2) * CONFIG.roles.BALANCE_WEIGHT
  })

  // 3b. Capper top-end balance — split the elite cappers across teams.
  // Sum-balancing (section 3) treats two 9-cappers + filler the same as several mid
  // cappers, so the strongest cappers can pile onto one team. These terms compare the
  // top of each team's capper pool, not just the total.
  const cappers1 = team1.map((p) => Math.max(p.roles.Capper, 0)).sort((a, b) => b - a)
  const cappers2 = team2.map((p) => Math.max(p.roles.Capper, 0)).sort((a, b) => b - a)

  const top2Capper1 = cappers1.slice(0, 2).reduce((a, b) => a + b, 0)
  const top2Capper2 = cappers2.slice(0, 2).reduce((a, b) => a + b, 0)
  score += Math.pow(top2Capper1 - top2Capper2, 2) * CONFIG.capper.TOP_2_WEIGHT

  // Elite-capper concentration. Cappers are the scarcest role, so the elite ones (8+)
  // must be split across teams. We count them per side rather than checking whether the
  // top two individuals share a team: counting is order-independent and graduated, so it
  // catches 2-v-0, 3-v-1 and 4-v-2 monopolies alike. The old top-two check silently
  // failed whenever the second-best capper rating tied across teams — the search would
  // keep the argument order in which the flat penalty didn't fire.
  const eliteCappers1 = team1.filter((p) => p.roles.Capper >= CONFIG.capper.ELITE_THRESHOLD).length
  const eliteCappers2 = team2.filter((p) => p.roles.Capper >= CONFIG.capper.ELITE_THRESHOLD).length
  score += Math.pow(eliteCappers1 - eliteCappers2, 2) * CONFIG.capper.CONCENTRATION_WEIGHT
  score += monopolyPenalty(eliteCappers1, eliteCappers2, CONFIG.capper.MONOPOLY_PENALTY)

  // Elite-chaser concentration — see CONFIG.chase. The crown-pair rule below can be
  // excused by a capper-value tie on the other team, so without this count the two
  // best returners can legally end up together.
  const eliteChasers1 = team1.filter((p) => p.roles.Chase >= CONFIG.chase.ELITE_THRESHOLD).length
  const eliteChasers2 = team2.filter((p) => p.roles.Chase >= CONFIG.chase.ELITE_THRESHOLD).length
  score += Math.pow(eliteChasers1 - eliteChasers2, 2) * CONFIG.chase.CONCENTRATION_WEIGHT
  score += monopolyPenalty(eliteChasers1, eliteChasers2, CONFIG.chase.MONOPOLY_PENALTY)

  // 3c. Best-capper / best-chaser separation. See capperChaseSplitPenalty.
  score += capperChaseSplitPenalty(
    team1,
    team2,
    CONFIG.split.CAPPER_CHASE_PENALTY,
    CONFIG.split.RUNNER_UP_PENALTY,
  )

  // 4a. Top-3 strength balance
  const sortedTier1 = team1.map((p) => p.tierValue).sort((a, b) => b - a)
  const sortedTier2 = team2.map((p) => p.tierValue).sort((a, b) => b - a)
  const top3sum1 = sortedTier1.slice(0, 3).reduce((a, b) => a + b, 0)
  const top3sum2 = sortedTier2.slice(0, 3).reduce((a, b) => a + b, 0)
  score += Math.pow(top3sum1 - top3sum2, 2) * CONFIG.tier.TOP_3_WEIGHT

  // 4b. Bottom-3 strength balance — prevent one team having a much higher floor
  const bottom3sum1 = sortedTier1.slice(-3).reduce((a, b) => a + b, 0)
  const bottom3sum2 = sortedTier2.slice(-3).reduce((a, b) => a + b, 0)
  score += Math.pow(bottom3sum1 - bottom3sum2, 2) * CONFIG.tier.BOTTOM_3_WEIGHT

  // 4c. Elite stack penalty — one team must not hoard the tier-8+ players. Flat and
  // constraint-like on purpose: a graduated count-difference term is worth only single
  // digits at 3-v-1 and gets routinely outbid by role-sum smoothing; the flat penalty
  // is what actually enforces the rule.
  const elites1 = team1.filter((p) => p.tierValue >= CONFIG.elite.THRESHOLD).length
  const elites2 = team2.filter((p) => p.tierValue >= CONFIG.elite.THRESHOLD).length
  if ((elites1 >= 3 && elites2 < elites1 - 1) || (elites2 >= 3 && elites1 < elites2 - 1)) {
    score += CONFIG.elite.STACK_PENALTY
  }

  // Mic counts are reported for display only — they no longer affect the score.
  const mic1 = team1.filter((p) => p.mic).length
  const mic2 = team2.filter((p) => p.mic).length

  // 6. Top-cluster separation — see topClusterPenalty for the unique-vs-tied regimes.
  score += topClusterPenalty(team1, team2, topPlayer, topCluster)

  // 7. Bottom-cluster separation — the weakest players must be spread across teams,
  // like a draft's final picks. See bottomClusterPenalty.
  score += bottomClusterPenalty(team1, team2)

  return { score, tier1, tier2, tierDiff, mic1, mic2 }
}

// Role-blind evaluation for the "Off-Role" option: all the tier-derived terms from
// evaluateSplit (tier diff, top/bottom-3 strength, elite stack, top- and bottom-cluster
// separation) with the role and capper terms switched off. For nights when players are
// off-role or swapping roles, the role ratings carry no signal.
function evaluateOffRoleSplit(team1: Player[], team2: Player[], topPlayer: Player, topCluster: Player[]) {
  const tier1 = team1.reduce((s, p) => s + p.tierValue, 0)
  const tier2 = team2.reduce((s, p) => s + p.tierValue, 0)
  const tierDiff = Math.abs(tier1 - tier2)

  let score = Math.pow(tierDiff, 2) * CONFIG.tier.WEIGHT
  if (tierDiff > CONFIG.tier.MAX_DIFF) {
    score += Math.pow(tierDiff - CONFIG.tier.MAX_DIFF, 2) * CONFIG.tier.OVER_MAX_PENALTY
  }

  const sortedTier1 = team1.map((p) => p.tierValue).sort((a, b) => b - a)
  const sortedTier2 = team2.map((p) => p.tierValue).sort((a, b) => b - a)
  const top3Diff = sortedTier1.slice(0, 3).reduce((a, b) => a + b, 0) - sortedTier2.slice(0, 3).reduce((a, b) => a + b, 0)
  score += Math.pow(top3Diff, 2) * CONFIG.tier.TOP_3_WEIGHT
  const bottom3Diff =
    sortedTier1.slice(-3).reduce((a, b) => a + b, 0) - sortedTier2.slice(-3).reduce((a, b) => a + b, 0)
  score += Math.pow(bottom3Diff, 2) * CONFIG.tier.BOTTOM_3_WEIGHT

  const elites1 = team1.filter((p) => p.tierValue >= CONFIG.elite.THRESHOLD).length
  const elites2 = team2.filter((p) => p.tierValue >= CONFIG.elite.THRESHOLD).length
  if ((elites1 >= 3 && elites2 < elites1 - 1) || (elites2 >= 3 && elites1 < elites2 - 1)) {
    score += CONFIG.elite.STACK_PENALTY
  }

  const mic1 = team1.filter((p) => p.mic).length
  const mic2 = team2.filter((p) => p.mic).length

  score += topClusterPenalty(team1, team2, topPlayer, topCluster)

  score += bottomClusterPenalty(team1, team2)

  return { score, tier1, tier2, tierDiff, mic1, mic2 }
}

// Same split regardless of orientation (identical or red/blue-swapped).
function isSameSplit(a1: Player[], a2: Player[], b1: Player[], b2: Player[]): boolean {
  const key = (t: Player[]) => JSON.stringify(t.map((p) => p.name).sort())
  return (
    (key(a1) === key(b1) && key(a2) === key(b2)) ||
    (key(a1) === key(b2) && key(a2) === key(b1))
  )
}

function areTeamsSwapped(team1: Player[], team2: Player[], otherTeam1: Player[], otherTeam2: Player[]): boolean {
  const names1 = team1.map((p) => p.name).sort()
  const names2 = team2.map((p) => p.name).sort()
  const otherNames1 = otherTeam1.map((p) => p.name).sort()
  const otherNames2 = otherTeam2.map((p) => p.name).sort()

  // Check if team1 matches otherTeam2 AND team2 matches otherTeam1 (swapped)
  return (
    JSON.stringify(names1) === JSON.stringify(otherNames2) && JSON.stringify(names2) === JSON.stringify(otherNames1)
  )
}

function applyDisabledRoles(player: Player): Player {
  if (!player.disabledRoles?.length) return player

  const roles = { ...player.roles }
  player.disabledRoles.forEach((role) => {
    if (role in roles) {
      roles[role as keyof typeof roles] = 0
    }
  })

  return { ...player, roles }
}

export function balanceTeamsWithOptions(selectedNames: string[], allPlayers: Player[]): BalanceOption[] {
  const players = selectedNames
    .map((name) => allPlayers.find((p) => p.name === name))
    .filter((p): p is Player => p !== undefined)
    .map(applyDisabledRoles)

  if (players.length !== 12) {
    throw new Error("Must select exactly 12 players")
  }

  // Sort by tier, then role sum
  players.sort((a, b) => {
    const aRoleSum = ROLES.reduce((sum, role) => sum + a.roles[role], 0)
    const bRoleSum = ROLES.reduce((sum, role) => sum + b.roles[role], 0)

    if (b.tierValue !== a.tierValue) return b.tierValue - a.tierValue
    if (bRoleSum !== aRoleSum) return bRoleSum - aRoleSum
    return a.name.localeCompare(b.name)
  })

  // Identify the top player and all players tied at the second-highest tier
  const topTier = players[0].tierValue
  const secondTier = players.find((p) => p.tierValue < topTier)?.tierValue ?? topTier
  const topCluster = players.filter((p) => p.tierValue >= secondTier)

  // Evaluate all combinations and store top results
  const allSplits = getCombinations(players, 6)
  const results: Array<{
    score: number
    team1: Player[]
    team2: Player[]
    tier1: number
    tier2: number
    tierDiff: number
    mic1: number
    mic2: number
  }> = []

  allSplits.forEach((team1) => {
    const team2 = players.filter((p) => !team1.includes(p))
    const topPlayer = players[0]
    const evaluation = evaluateSplit(team1, team2, topPlayer, topCluster)

    results.push({
      score: evaluation.score,
      team1: [...team1],
      team2,
      tier1: evaluation.tier1,
      tier2: evaluation.tier2,
      tierDiff: evaluation.tierDiff,
      mic1: evaluation.mic1,
      mic2: evaluation.mic2,
    })
  })

  // Sort by score
  results.sort((a, b) => a.score - b.score)

  const uniqueResults: typeof results = []
  uniqueResults.push(results[0]) // Always include the best result

  for (let i = 1; i < results.length && uniqueResults.length < 3; i++) {
    const candidate = results[i]
    let isDuplicate = false

    // Check if this candidate is a swap of any already selected result
    for (const existing of uniqueResults) {
      if (areTeamsSwapped(candidate.team1, candidate.team2, existing.team1, existing.team2)) {
        isDuplicate = true
        break
      }
    }

    if (!isDuplicate) {
      uniqueResults.push(candidate)
    }
  }

  // If we still don't have 3 unique options, fill with next best (even if swapped)
  while (uniqueResults.length < 3 && uniqueResults.length < results.length) {
    uniqueResults.push(results[uniqueResults.length])
  }

  // Option line-up: the best split, then the THIRD-best unique split (the old
  // runner-up was always a near-clone of option 1 and never got picked), then the
  // best off-role split — tier balance only, role ratings ignored.
  const chosen: Array<{
    result: (typeof results)[number]
    kind: "best" | "alt" | "offrole"
    /** Score to REPORT, when it differs from the one used to select the split. */
    displayScore?: number
  }> = [
    { result: uniqueResults[0], kind: "best" },
    { result: uniqueResults[2] ?? uniqueResults[1] ?? uniqueResults[0], kind: "alt" },
  ]

  const offRoleResults: typeof results = []
  allSplits.forEach((team1) => {
    const team2 = players.filter((p) => !team1.includes(p))
    const evaluation = evaluateOffRoleSplit(team1, team2, players[0], topCluster)
    offRoleResults.push({
      score: evaluation.score,
      team1: [...team1],
      team2,
      tier1: evaluation.tier1,
      tier2: evaluation.tier2,
      tierDiff: evaluation.tierDiff,
      mic1: evaluation.mic1,
      mic2: evaluation.mic2,
    })
  })
  offRoleResults.sort((a, b) => a.score - b.score)
  const offRolePick =
    offRoleResults.find((candidate) =>
      chosen.every(({ result }) => !isSameSplit(candidate.team1, candidate.team2, result.team1, result.team2)),
    ) ?? offRoleResults[0]
  // Selection stays role-blind — that is the whole point of the card — but the
  // score REPORTED for it is the full one. evaluateOffRoleSplit keeps every tier
  // term and drops all role/capper/crown terms, so it is a strict subset of
  // evaluateSplit's non-negative terms and can never score a split worse than the
  // honest evaluator does. The card therefore printed the highest confidence of
  // the three in every lobby measured, while its split was usually the worst of
  // the three and often left one team unable to field a capper or a chaser.
  // Scored honestly, the three cards are finally comparable.
  const offRoleDisplayScore = evaluateSplit(offRolePick.team1, offRolePick.team2, players[0], topCluster).score
  chosen.push({ result: offRolePick, kind: "offrole", displayScore: offRoleDisplayScore })

  // Convert to BalanceOption format
  return chosen.map(({ result, kind, displayScore }) => {
    // Sort teams by tier
    let [redTeam, blueTeam] = [result.team1, result.team2].map((team) =>
      team.sort((a, b) => b.tierValue - a.tierValue),
    )
    let redMicCount = result.mic1
    let blueMicCount = result.mic2
    let redTierTotal = result.tier1
    let blueTierTotal = result.tier2

    // Colour assignment: the weaker team (lower tier total) takes Blue, since the
    // Blue base is easier to hold and that handicap nudges a skewed match back toward
    // even. Only when the tier totals are exactly equal is red/blue randomised.
    // Decided per option, so each option reflects its own skew direction.
    let wasRandomized = false
    let flip = false
    if (redTierTotal === blueTierTotal) {
      wasRandomized = true
      flip = Math.random() < 0.5
    } else {
      // redTeam currently holds team1 (tier total = redTierTotal). If it's the weaker
      // side, flip so the weaker team ends up on Blue.
      flip = redTierTotal < blueTierTotal
    }

    if (flip) {
      ;[redTeam, blueTeam] = [blueTeam, redTeam]
        ;[redMicCount, blueMicCount] = [blueMicCount, redMicCount]
        ;[redTierTotal, blueTierTotal] = [blueTierTotal, redTierTotal]
    }

    const balanceResult: BalanceResult = {
      teamRed: redTeam.map((p) => p.name),
      teamBlue: blueTeam.map((p) => p.name),
      redMic: redMicCount,
      blueMic: blueMicCount,
      redTierTotal,
      blueTierTotal,
      wasRandomized,
    }

    let label = "Slight Wildcard"
    let description = "Shuffled for variety"

    if (kind === "best") {
      label = "Perfect Balance"
      description = "Closest possible match"
    } else if (kind === "offrole") {
      label = "Off-Role"
      description = "Tier balance only — roles ignored"
    } else if (result.tierDiff < 1.5) {
      label = "Fair Fight"
      description = `Teams within ${result.tierDiff.toFixed(1)} tier points`
    } else {
      label = "Slight Edge"
      description = "Playable, but one side's a bit stronger"
    }

    return {
      result: balanceResult,
      score: displayScore ?? result.score,
      label,
      description,
    }
  })
}

/**
 * Evaluate balance score for any two pre-selected teams.
 * Used for manual team selections in match logging.
 */
export function evaluateTeams(
  redTeamNames: string[],
  blueTeamNames: string[],
  allPlayers: Player[],
): { score: number; tierDiff: number } | null {
  const redTeam = redTeamNames
    .map((name) => allPlayers.find((p) => p.name === name))
    .filter((p): p is Player => p !== undefined)

  const blueTeam = blueTeamNames
    .map((name) => allPlayers.find((p) => p.name === name))
    .filter((p): p is Player => p !== undefined)

  if (redTeam.length !== 6 || blueTeam.length !== 6) {
    return null
  }

  // Determine top player and cluster from the combined teams. The sort MUST match
  // balanceTeamsWithOptions (tier, then role sum, then name): with a tied top tier a
  // tier-only stable sort crowned whichever tied player the caller happened to list
  // first, and the same lineup scored 4000 apart depending on argument order.
  const roleSumOf = (p: Player) => ROLES.reduce((sum, role) => sum + p.roles[role], 0)
  const allPlayed = [...redTeam, ...blueTeam].sort((a, b) => {
    if (b.tierValue !== a.tierValue) return b.tierValue - a.tierValue
    if (roleSumOf(b) !== roleSumOf(a)) return roleSumOf(b) - roleSumOf(a)
    return a.name.localeCompare(b.name)
  })
  const topPlayer = allPlayed[0]
  const topTier = topPlayer.tierValue
  const secondTier = allPlayed.find((p) => p.tierValue < topTier)?.tierValue ?? topTier
  const topCluster = allPlayed.filter((p) => p.tierValue >= secondTier)

  const result = evaluateSplit(redTeam, blueTeam, topPlayer, topCluster)
  return { score: result.score, tierDiff: result.tierDiff }
}

// Fallback for any selected player missing from the ELO map (computeMonthlyEloMap seeds
// every roster player, so this only hits truly unknown names). Neutral mid-tier (tier 5
// → 1000 + 5×100), matching NEUTRAL_SEED / DEFAULT_ELO in lib/elo.ts.
const DEFAULT_ELO = 1500

// Weights for the admin-only "Balance by ELO" mode. ELO (in raw points) is the primary
// strength signal; the role terms below are layered on so the split still respects the
// same coverage / role-balance rules as the tier balancer. These are deliberately on the
// same order of magnitude as the ELO gap (team-average ELO differences are typically
// 0–100) so roles meaningfully break ties between ELO-close splits without overriding a
// genuinely large ELO gap — except coverage, which is treated as a near-constraint.
// Calibrated by eye; tune once there's real match data on how it performs.
const ELO_CONFIG = {
  TOP3_WEIGHT: 0.5, // light penalty for stacking the strongest players by ELO
  COVERAGE_PENALTY: 100, // per critical role (Capper, Chase) a team can't field at all
  ROLE_BALANCE_WEIGHT: 0.6, // per-role sum difference, keeps every role even across teams
  CAPPER_BEST_WEIGHT: 2.0, // split each team's single best capper (scarcest role)
  CAPPER_STACK_PENALTY: 50, // per elite-capper (8+) count difference between teams
  CAPPER_CHASE_PENALTY: 80, // flat: one side holds both the best capper and best chaser
  // Per runner-up role monopolised in the dual-threat case. Deliberately left at parity with
  // CAPPER_CHASE_PENALTY rather than raised to constraint level as the tier balancer's
  // equivalent was: that decision rested on a 260-lobby replay, and there is no comparable
  // validation for ELO mode (it needs a historical ELO map, not just rosters). Revisit
  // together with the "calibrated by eye" note above once ELO mode has real usage data.
  RUNNER_UP_PENALTY: 80,
}

/**
 * Score one 6v6 split for ELO mode. Primary term is the team-average ELO gap; the rest
 * mirror the tier balancer's role logic (critical-role coverage, per-role strength
 * balance, capper top-end split + elite-capper stack penalty). Returns the full
 * score (used for ranking and the confidence %) plus avgDiff (the raw ELO gap, shown on
 * the card) and the team ELO sums.
 */
function evaluateEloSplit(team1: Player[], team2: Player[], eloOf: (p: Player) => number) {
  const sum1 = team1.reduce((s, p) => s + eloOf(p), 0)
  const sum2 = team2.reduce((s, p) => s + eloOf(p), 0)
  const avgDiff = Math.abs(sum1 - sum2) / 6

  let score = avgDiff

  // Top-3 ELO balance — don't pile the strongest players on one side.
  const top3 = (team: Player[]) =>
    team
      .map(eloOf)
      .sort((a, b) => b - a)
      .slice(0, 3)
      .reduce((a, b) => a + b, 0)
  score += (Math.abs(top3(team1) - top3(team2)) / 3) * ELO_CONFIG.TOP3_WEIGHT

  // Critical role coverage — every team needs a viable Capper and Chaser, or it's
  // unplayable no matter how even the ELO is. Heavy flat penalty per missing role.
  const criticalRoles = ["Capper", "Chase"] as const
  criticalRoles.forEach((role) => {
    const viable1 = team1.filter((p) => p.roles[role] >= CONFIG.roles.VIABLE_THRESHOLD).length
    const viable2 = team2.filter((p) => p.roles[role] >= CONFIG.roles.VIABLE_THRESHOLD).length
    if (viable1 === 0 || viable2 === 0) score += ELO_CONFIG.COVERAGE_PENALTY
  })

  // Role strength balance — keep each role's total close across teams.
  ROLES.forEach((role) => {
    const r1 = team1.reduce((s, p) => s + Math.max(p.roles[role], 0), 0)
    const r2 = team2.reduce((s, p) => s + Math.max(p.roles[role], 0), 0)
    score += Math.abs(r1 - r2) * ELO_CONFIG.ROLE_BALANCE_WEIGHT
  })

  // Capper top-end split — balance each team's best capper, and penalise stacking the
  // elite cappers on one side (mirrors the tier balancer's capper handling).
  const cappers1 = team1.map((p) => Math.max(p.roles.Capper, 0)).sort((a, b) => b - a)
  const cappers2 = team2.map((p) => Math.max(p.roles.Capper, 0)).sort((a, b) => b - a)
  score += Math.abs(cappers1[0] - cappers2[0]) * ELO_CONFIG.CAPPER_BEST_WEIGHT

  // Count elite cappers per team rather than checking whether the top two share a side.
  // Counting is order-independent and graduated, so it catches 2-v-0 and 3-v-1 monopolies
  // alike and doesn't silently fail when capper ratings tie across teams (see the tier
  // balancer's matching fix in evaluateSplit).
  const eliteCappers1 = team1.filter((p) => p.roles.Capper >= CONFIG.capper.ELITE_THRESHOLD).length
  const eliteCappers2 = team2.filter((p) => p.roles.Capper >= CONFIG.capper.ELITE_THRESHOLD).length
  score += Math.abs(eliteCappers1 - eliteCappers2) * ELO_CONFIG.CAPPER_STACK_PENALTY

  // Elite-chaser concentration — the mirror the tier evaluator gained after a live
  // game stacked the lobby's only two chase-9s (Aug 2026). ELO mode shares the crown
  // rule via capperChaseSplitPenalty but had no equivalent count of its own, so it
  // could still hoard the returners.
  const eliteChasers1 = team1.filter((p) => p.roles.Chase >= CONFIG.chase.ELITE_THRESHOLD).length
  const eliteChasers2 = team2.filter((p) => p.roles.Chase >= CONFIG.chase.ELITE_THRESHOLD).length
  score += Math.abs(eliteChasers1 - eliteChasers2) * ELO_CONFIG.CAPPER_STACK_PENALTY

  // Best-capper / best-chaser separation (mirrors the tier balancer's 3c, at ELO scale).
  score += capperChaseSplitPenalty(
    team1,
    team2,
    ELO_CONFIG.CAPPER_CHASE_PENALTY,
    ELO_CONFIG.RUNNER_UP_PENALTY,
  )

  return { score, avgDiff, sum1, sum2 }
}

/**
 * Admin-only "Balance by ELO" mode. Splits exactly 12 players into two teams of six,
 * balancing primarily on this month's ELO while still honouring role coverage and role
 * balance (see evaluateEloSplit). Tiers are not used for strength — ELO replaces them —
 * but role ranks fully count, and disabled roles / Off-Role are respected via
 * applyDisabledRoles. Returns 3 options in the same shape as balanceTeamsWithOptions.
 */
export function balanceTeamsByElo(
  selectedNames: string[],
  allPlayers: Player[],
  eloMap: Map<string, number>,
): BalanceOption[] {
  const players = selectedNames
    .map((name) => allPlayers.find((p) => p.name === name))
    .filter((p): p is Player => p !== undefined)
    .map(applyDisabledRoles)

  if (players.length !== 12) {
    throw new Error("Must select exactly 12 players")
  }

  const eloOf = (p: Player) => eloMap.get(p.name) ?? DEFAULT_ELO
  const evaluate = (team1: Player[], team2: Player[]) => evaluateEloSplit(team1, team2, eloOf)

  const allSplits = getCombinations(players, 6)
  const results = allSplits.map((team1) => {
    const team2 = players.filter((p) => !team1.includes(p))
    return { ...evaluate(team1, team2), team1: [...team1], team2 }
  })

  results.sort((a, b) => a.score - b.score)

  // Always take the best, then fill up to 3 with non-mirror alternatives.
  const unique: typeof results = [results[0]]
  for (let i = 1; i < results.length && unique.length < 3; i++) {
    const candidate = results[i]
    if (!unique.some((u) => areTeamsSwapped(candidate.team1, candidate.team2, u.team1, u.team2))) {
      unique.push(candidate)
    }
  }
  while (unique.length < 3 && unique.length < results.length) unique.push(results[unique.length])

  return unique.map((result, index) => {
    let [redTeam, blueTeam] = [result.team1, result.team2].map((team) =>
      [...team].sort((a, b) => eloOf(b) - eloOf(a)),
    )

    const tierTotal = (team: Player[]) => team.reduce((s, p) => s + p.tierValue, 0)
    const eloAvg = (team: Player[]) => Math.round(team.reduce((s, p) => s + eloOf(p), 0) / team.length)
    const micCount = (team: Player[]) => team.filter((p) => p.mic).length

    let redEloTotal = eloAvg(redTeam)
    let blueEloTotal = eloAvg(blueTeam)
    let redTierTotal = tierTotal(redTeam)
    let blueTierTotal = tierTotal(blueTeam)
    let redMic = micCount(redTeam)
    let blueMic = micCount(blueTeam)

    // Weaker (lower ELO) team takes Blue — same handicap rule as the tier balancer.
    let wasRandomized = false
    let flip = false
    if (redEloTotal === blueEloTotal) {
      wasRandomized = true
      flip = Math.random() < 0.5
    } else {
      flip = redEloTotal < blueEloTotal
    }
    if (flip) {
      ;[redTeam, blueTeam] = [blueTeam, redTeam]
      ;[redEloTotal, blueEloTotal] = [blueEloTotal, redEloTotal]
      ;[redTierTotal, blueTierTotal] = [blueTierTotal, redTierTotal]
      ;[redMic, blueMic] = [blueMic, redMic]
    }

    const balanceResult: BalanceResult = {
      teamRed: redTeam.map((p) => p.name),
      teamBlue: blueTeam.map((p) => p.name),
      redMic,
      blueMic,
      redTierTotal,
      blueTierTotal,
      redEloTotal,
      blueEloTotal,
      wasRandomized,
    }

    let label = "Slight Wildcard"
    let description = "Shuffled for variety"
    if (index === 0) {
      label = "Perfect Balance"
      description = "Closest ELO match"
    } else if (result.avgDiff < 40) {
      label = "Fair Fight"
      description = `Teams within ${result.avgDiff.toFixed(0)} avg ELO`
    } else {
      label = "Slight Edge"
      description = "Playable, but one side's a bit stronger"
    }

    // Full score (ELO gap + role penalties) drives the confidence % — same curve and
    // scale as the tier balancer — while the label/description above reflect the raw ELO
    // gap so the card still reads as an ELO balance.
    return { result: balanceResult, score: result.score, label, description }
  })
}

// Keep original function for backward compatibility
export function balanceTeams(selectedNames: string[], allPlayers: Player[]): BalanceResult {
  const options = balanceTeamsWithOptions(selectedNames, allPlayers)
  return options[0].result
}

export function balanceTeamsCompetitive(
  selectedNames: string[],
  allPlayers: Player[],
): {
  options: BalanceOption[]
  selectedPlayers: string[]
  cutPlayers: string[]
} {
  const players = selectedNames
    .map((name) => allPlayers.find((p) => p.name === name))
    .filter((p): p is Player => p !== undefined)

  if (players.length < 12 || players.length > 18) {
    throw new Error("Competitive mode requires 12-18 players")
  }

  // Sort all players by tier value and role strength to determine top 12
  const sortedPlayers = [...players].sort((a, b) => {
    const aRoleSum = ROLES.reduce((sum, role) => sum + a.roles[role], 0)
    const bRoleSum = ROLES.reduce((sum, role) => sum + b.roles[role], 0)

    if (b.tierValue !== a.tierValue) return b.tierValue - a.tierValue
    if (bRoleSum !== aRoleSum) return bRoleSum - aRoleSum
    return a.name.localeCompare(b.name)
  })

  // Select top 12 players
  const top12 = sortedPlayers.slice(0, 12)
  const cutPlayers = sortedPlayers.slice(12)

  // Balance the top 12
  const options = balanceTeamsWithOptions(
    top12.map((p) => p.name),
    allPlayers,
  )

  return {
    options,
    selectedPlayers: top12.map((p) => p.name),
    cutPlayers: cutPlayers.map((p) => p.name),
  }
}