import type { Player, BalanceResult, BalanceOption } from "./types"

const ROLES = ["Capper", "Chase", "Camp", "Cleaner", "Support"] as const

const CONFIG = {
  tier: {
    WEIGHT: 3.0,
    MAX_DIFF: 2,
    OVER_MAX_PENALTY: 200,
    TOP_3_WEIGHT: 3.0,
    BOTTOM_3_WEIGHT: 2.5,
    VARIANCE_WEIGHT: 1.5,
  },
  elite: {
    THRESHOLD: 8,
    CONCENTRATION_WEIGHT: 4.0,
    TOP_TIER_WEIGHT: 1.5,
    STACK_PENALTY: 1500, // flat penalty when one team has 3+ elites and the other is short by 2+
  },
  roles: {
    COVERAGE_PENALTY: 500,
    BALANCE_WEIGHT: 0.8,
    VIABLE_THRESHOLD: 4,
  },
  // Capper is the most crucial and scarcest role. Balancing role *sums* alone lets the
  // algorithm stack the elite cappers on one team (e.g. two 9s) and offset them with
  // several mid cappers on the other. These terms balance the TOP of each team's capper
  // pool so the best cappers get split across teams.
  capper: {
    ELITE_THRESHOLD: 8, // a capper rated 8+ is elite and scarce
    BEST_WEIGHT: 5.0, // balance each team's single best capper
    TOP_2_WEIGHT: 2.5, // balance each team's top-2 capper pool
    CONCENTRATION_WEIGHT: 300, // squared diff in elite-capper COUNT per team (2-v-0 ≈ 1200)
  },
  cluster: {
    TOP_TWO_PENALTY: 8000,
  },
  mic: {
    WEIGHT: 0.3,
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

  const bestCapperDiff = Math.abs(cappers1[0] - cappers2[0])
  score += Math.pow(bestCapperDiff, 2) * CONFIG.capper.BEST_WEIGHT

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

  // 4a. Top-tier distribution (dynamic threshold)
  const allTiers = [...team1, ...team2].map((p) => p.tierValue).sort((a, b) => b - a)
  const eliteThreshold = allTiers[Math.floor(allTiers.length * 0.25) - 1] // Top 25%
  const top1 = team1.filter((p) => p.tierValue >= eliteThreshold).length
  const top2 = team2.filter((p) => p.tierValue >= eliteThreshold).length
  score += Math.pow(top1 - top2, 2) * CONFIG.elite.TOP_TIER_WEIGHT

  // 4b. Top-3 strength balance
  const sortedTier1 = team1.map((p) => p.tierValue).sort((a, b) => b - a)
  const sortedTier2 = team2.map((p) => p.tierValue).sort((a, b) => b - a)
  const top3sum1 = sortedTier1.slice(0, 3).reduce((a, b) => a + b, 0)
  const top3sum2 = sortedTier2.slice(0, 3).reduce((a, b) => a + b, 0)
  score += Math.pow(top3sum1 - top3sum2, 2) * CONFIG.tier.TOP_3_WEIGHT

  // 4c. Tier variance balance
  const variance = (tiers: number[]) => {
    const mean = tiers.reduce((a, b) => a + b, 0) / tiers.length
    return Math.sqrt(tiers.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / tiers.length)
  }
  const var1 = variance(team1.map((p) => p.tierValue))
  const var2 = variance(team2.map((p) => p.tierValue))
  score += Math.pow(var1 - var2, 2) * CONFIG.tier.VARIANCE_WEIGHT

  // 4d. Bottom-3 strength balance — prevent one team having a much higher floor
  const bottom3sum1 = sortedTier1.slice(-3).reduce((a, b) => a + b, 0)
  const bottom3sum2 = sortedTier2.slice(-3).reduce((a, b) => a + b, 0)
  score += Math.pow(bottom3sum1 - bottom3sum2, 2) * CONFIG.tier.BOTTOM_3_WEIGHT

  // 4e. Elite concentration penalty — prevent stacking 3+ elite players on one team
  const elites1 = team1.filter((p) => p.tierValue >= CONFIG.elite.THRESHOLD).length
  const elites2 = team2.filter((p) => p.tierValue >= CONFIG.elite.THRESHOLD).length
  const eliteDiff = Math.abs(elites1 - elites2)
  score += Math.pow(eliteDiff, 2) * CONFIG.elite.CONCENTRATION_WEIGHT

  // Extra flat penalty when one team has 3+ elites and the other has fewer by 2+
  if ((elites1 >= 3 && elites2 < elites1 - 1) || (elites2 >= 3 && elites1 < elites2 - 1)) {
    score += CONFIG.elite.STACK_PENALTY
  }

  // 5. Mic balance
  const mic1 = team1.filter((p) => p.mic).length
  const mic2 = team2.filter((p) => p.mic).length
  score += Math.pow(mic1 - mic2, 2) * CONFIG.mic.WEIGHT

  // 6. Top player separation — the #1 player should not be teamed with too many other top-cluster players.
  // Only applies when the top cluster is a genuine minority; if half or more of the lobby is at the top tier,
  // clustering is meaningless and this check becomes noise.
  const totalPlayers = team1.length + team2.length
  if (topCluster.length < totalPlayers / 2) {
    const topPlayerTeam = team1.includes(topPlayer) ? team1 : team2
    const otherTeam = team1.includes(topPlayer) ? team2 : team1
    const clusterWithTop = topPlayerTeam.filter((p) => topCluster.includes(p)).length
    const clusterWithOther = otherTeam.filter((p) => topCluster.includes(p)).length

    // Graduated penalty: heavier when top player has significantly more cluster allies
    if (clusterWithTop > clusterWithOther) {
      const clusterImbalance = clusterWithTop - clusterWithOther
      score += clusterImbalance * CONFIG.cluster.TOP_TWO_PENALTY * 0.5
    }
  }

  return { score, tier1, tier2, tierDiff, mic1, mic2 }
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

  // Convert to BalanceOption format
  return uniqueResults.map((result, index) => {
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

    if (index === 0) {
      label = "Perfect Balance"
      description = "Closest possible match"
    } else if (result.tierDiff < 1.5) {
      label = "Fair Fight"
      description = `Teams within ${result.tierDiff.toFixed(1)} tier points`
    } else {
      label = "Slight Edge"
      description = "Playable, but one side's a bit stronger"
    }

    return {
      result: balanceResult,
      score: result.score,
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

  // Determine top player and cluster from the combined teams
  const allPlayed = [...redTeam, ...blueTeam].sort((a, b) => b.tierValue - a.tierValue)
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
  MIC_WEIGHT: 0.3,
}

/**
 * Score one 6v6 split for ELO mode. Primary term is the team-average ELO gap; the rest
 * mirror the tier balancer's role logic (critical-role coverage, per-role strength
 * balance, capper top-end split + elite-capper stack penalty, mic). Returns the full
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

  // Mic balance — light tiebreaker.
  const mic1 = team1.filter((p) => p.mic).length
  const mic2 = team2.filter((p) => p.mic).length
  score += Math.abs(mic1 - mic2) * ELO_CONFIG.MIC_WEIGHT

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