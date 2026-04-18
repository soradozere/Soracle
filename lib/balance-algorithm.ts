import type { Player, BalanceResult, BalanceOption } from "./types"

const ROLES = ["Capper", "Chase", "Camp", "Cleaner", "Support"] as const

const CONFIG = {
  TIER_WEIGHT: 3.0,
  ROLE_COVERAGE_PENALTY: 500,
  ROLE_BALANCE_WEIGHT: 0.8,
  TOP_TIER_WEIGHT: 1.5,
  MIC_WEIGHT: 0.3,
  TOP_TWO_PENALTY: 8000,
  MAX_TIER_DIFF: 2,
  TOP_3_WEIGHT: 3.0,
  VARIANCE_WEIGHT: 1.5,
  BOTTOM_3_WEIGHT: 2.5,
  ELITE_CONCENTRATION_WEIGHT: 4.0,
  ELITE_THRESHOLD: 8,
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

  let score = Math.pow(tierDiff, 2) * CONFIG.TIER_WEIGHT

  if (tierDiff > CONFIG.MAX_TIER_DIFF) {
    score += Math.pow(tierDiff - CONFIG.MAX_TIER_DIFF, 2) * 200
  }

  // 2. Critical role coverage
  const viableThreshold = 4
  const criticalRoles = ["Capper", "Chase"] as const

  criticalRoles.forEach((role) => {
    const viable1 = team1.filter((p) => p.roles[role] >= viableThreshold).length
    const viable2 = team2.filter((p) => p.roles[role] >= viableThreshold).length

    if (viable1 === 0 || viable2 === 0) {
      score += CONFIG.ROLE_COVERAGE_PENALTY
    }
  })

  // 3. Role strength balance
  ROLES.forEach((role) => {
    const r1 = team1.reduce((s, p) => s + Math.max(p.roles[role], 0), 0)
    const r2 = team2.reduce((s, p) => s + Math.max(p.roles[role], 0), 0)
    score += Math.pow(r1 - r2, 2) * CONFIG.ROLE_BALANCE_WEIGHT
  })

  // 4a. Top-tier distribution (dynamic threshold)
  const allTiers = [...team1, ...team2].map(p => p.tierValue).sort((a, b) => b - a)
  const eliteThreshold = allTiers[Math.floor(allTiers.length * 0.25) - 1] // Top 25%
  const top1 = team1.filter(p => p.tierValue >= eliteThreshold).length
  const top2 = team2.filter(p => p.tierValue >= eliteThreshold).length
  score += Math.pow(top1 - top2, 2) * CONFIG.TOP_TIER_WEIGHT

  // 4b. Top-3 strength balance
  const sortedTier1 = team1.map(p => p.tierValue).sort((a, b) => b - a)
  const sortedTier2 = team2.map(p => p.tierValue).sort((a, b) => b - a)
  const top3sum1 = sortedTier1.slice(0, 3).reduce((a, b) => a + b, 0)
  const top3sum2 = sortedTier2.slice(0, 3).reduce((a, b) => a + b, 0)
  score += Math.pow(top3sum1 - top3sum2, 2) * CONFIG.TOP_3_WEIGHT

  // 4c. Tier variance balance
  const variance = (tiers: number[]) => {
    const mean = tiers.reduce((a, b) => a + b, 0) / tiers.length
    return Math.sqrt(tiers.reduce((sum, t) => sum + Math.pow(t - mean, 2), 0) / tiers.length)
  }
  const var1 = variance(team1.map(p => p.tierValue))
  const var2 = variance(team2.map(p => p.tierValue))
  score += Math.pow(var1 - var2, 2) * CONFIG.VARIANCE_WEIGHT

  // 4d. Bottom-3 strength balance — prevent one team having a much higher floor
  const bottom3sum1 = sortedTier1.slice(-3).reduce((a, b) => a + b, 0)
  const bottom3sum2 = sortedTier2.slice(-3).reduce((a, b) => a + b, 0)
  score += Math.pow(bottom3sum1 - bottom3sum2, 2) * CONFIG.BOTTOM_3_WEIGHT

  // 4e. Elite concentration penalty — prevent stacking 3+ elite players on one team
  const elites1 = team1.filter(p => p.tierValue >= CONFIG.ELITE_THRESHOLD).length
  const elites2 = team2.filter(p => p.tierValue >= CONFIG.ELITE_THRESHOLD).length
  const eliteDiff = Math.abs(elites1 - elites2)
  score += Math.pow(eliteDiff, 2) * CONFIG.ELITE_CONCENTRATION_WEIGHT

  // Extra steep penalty when one team has 3+ elites and the other has fewer by 2+
  if ((elites1 >= 3 && elites2 < elites1 - 1) || (elites2 >= 3 && elites1 < elites2 - 1)) {
    score += 300
  }

  // 5. Mic balance
  const mic1 = team1.filter((p) => p.mic).length
  const mic2 = team2.filter((p) => p.mic).length
  score += Math.pow(mic1 - mic2, 2) * CONFIG.MIC_WEIGHT

  // 6. Top player separation — the #1 player should not be teamed with too many other top-cluster players
  const topPlayerTeam = team1.includes(topPlayer) ? team1 : team2
  const otherTeam = team1.includes(topPlayer) ? team2 : team1
  const clusterWithTop = topPlayerTeam.filter(p => topCluster.includes(p)).length
  const clusterWithOther = otherTeam.filter(p => topCluster.includes(p)).length

  // Graduated penalty: heavier when top player has significantly more cluster allies
  if (clusterWithTop > clusterWithOther) {
    const clusterImbalance = clusterWithTop - clusterWithOther
    score += clusterImbalance * CONFIG.TOP_TWO_PENALTY * 0.5
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
  const secondTier = players.find(p => p.tierValue < topTier)?.tierValue ?? topTier
  const topCluster = players.filter(p => p.tierValue >= secondTier)

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
    let [redTeam, blueTeam] = [result.team1, result.team2].map((team) => team.sort((a, b) => b.tierValue - a.tierValue))
    let redMicCount = result.mic1
    let blueMicCount = result.mic2
    let redTierTotal = result.tier1
    let blueTierTotal = result.tier2

    // Generate swap suggestion using composite score (tier diff + top-3 balance)
    let swapText = "No swap suggested"
    let bestSwap: { red: string; blue: string; improvement: number; newDiff: number } | null = null

    // Helper to calculate top-3 sum for a team
    const getTop3Sum = (team: typeof redTeam) => {
      const sorted = [...team].sort((a, b) => b.tierValue - a.tierValue)
      return sorted.slice(0, 3).reduce((s, p) => s + p.tierValue, 0)
    }

    // Calculate initial composite score
    const initialTop3Diff = Math.abs(getTop3Sum(redTeam) - getTop3Sum(blueTeam))
    let bestComposite = result.tierDiff * CONFIG.TIER_WEIGHT + initialTop3Diff * CONFIG.TOP_3_WEIGHT

    redTeam.forEach((r) => {
      blueTeam.forEach((b) => {
        // Simulate the swap
        const newRedTeam = redTeam.filter(p => p.name !== r.name).concat([b])
        const newBlueTeam = blueTeam.filter(p => p.name !== b.name).concat([r])

        // Tier difference
        const newRedTier = newRedTeam.reduce((s, p) => s + p.tierValue, 0)
        const newBlueTier = newBlueTeam.reduce((s, p) => s + p.tierValue, 0)
        const newTierDiff = Math.abs(newRedTier - newBlueTier)

        // Top-3 strength balance (matches evaluateSplit logic)
        const newTop3Diff = Math.abs(getTop3Sum(newRedTeam) - getTop3Sum(newBlueTeam))

        // Composite score: weighted combination (same philosophy as evaluateSplit)
        const newComposite = newTierDiff * CONFIG.TIER_WEIGHT + newTop3Diff * CONFIG.TOP_3_WEIGHT

        if (newComposite < bestComposite) {
          bestComposite = newComposite
          bestSwap = {
            red: r.name,
            blue: b.name,
            improvement: result.tierDiff - newTierDiff,
            newDiff: newTierDiff,
          }
        }
      })
    })

    const initialComposite = result.tierDiff * CONFIG.TIER_WEIGHT + initialTop3Diff * CONFIG.TOP_3_WEIGHT
    if (bestSwap && bestComposite < initialComposite) {
      swapText = `Suggested Swap: ${bestSwap.red} ↔ ${bestSwap.blue} (tier difference: ${result.tierDiff.toFixed(1)} → ${bestSwap.newDiff.toFixed(1)})`
    }

    // Randomize red/blue assignment for all options
    const shouldRandomize = Math.random() < 0.5
    if (shouldRandomize) {
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
      swapText,
      wasRandomized: shouldRandomize,
    }

    let label = "Alternative Balance"
    let description = "Different team composition"

    if (index === 0) {
      label = "Perfect Balance"
      description = "Optimal balance score"
    } else if (result.tierDiff < 1.5) {
      label = "Tier Balanced"
      description = `Tier diff: ${result.tierDiff.toFixed(1)}`
    } else {
      label = `Option ${index + 1}`
      description = `Score: ${result.score.toFixed(0)}`
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
  allPlayers: Player[]
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
  const secondTier = allPlayed.find(p => p.tierValue < topTier)?.tierValue ?? topTier
  const topCluster = allPlayed.filter(p => p.tierValue >= secondTier)

  const result = evaluateSplit(redTeam, blueTeam, topPlayer, topCluster)
  return { score: result.score, tierDiff: result.tierDiff }
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
