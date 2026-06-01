"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { ArrowUp, ArrowDown, TrendingUp, TrendingDown, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"

// Minimum matches AT THE PLAYER'S CURRENT TIER required for a suggestion.
// Only games played since the player's last tier change count (see match loop below),
// so this sample resets whenever an admin re-ranks a player.
const MIN_MATCHES_THRESHOLD = 5

// Minimum performance gap to trigger a suggestion (15%)
const MIN_GAP_THRESHOLD = 0.15

interface RankSuggestion {
  playerName: string
  currentTier: number
  suggestedTier: number
  actualWinRate: number
  expectedWinRate: number
  performanceGap: number
  matchesAnalysed: number
  isOverperforming: boolean
}

interface Match {
  id: string
  red_team: string[]
  blue_team: string[]
  red_tiers: number[] | null
  blue_tiers: number[] | null
  red_score: number
  blue_score: number
}

interface Player {
  name: string
  tier_value: number
}

export function RankSuggestions() {
  const [suggestions, setSuggestions] = useState<RankSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSuggestions = async () => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // Calculate start of current month in UTC
      const now = new Date()
      const startOfMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const startOfMonthISO = startOfMonth.toISOString()

      // Fetch matches from current month with tier snapshot data
      const { data: matches, error: matchesError } = await supabase
        .from("matches")
        .select("id, red_team, blue_team, red_tiers, blue_tiers, red_score, blue_score")
        .not("red_tiers", "is", null)
        .not("blue_tiers", "is", null)
        .gte("created_at", startOfMonthISO)

      if (matchesError) {
        setError(matchesError.message)
        setLoading(false)
        return
      }

      // Fetch current player tiers
      const { data: players, error: playersError } = await supabase
        .from("players")
        .select("name, tier_value")

      if (playersError) {
        setError(playersError.message)
        setLoading(false)
        return
      }

      const playerTierMap = new Map<string, number>()
      for (const player of players || []) {
        playerTierMap.set(player.name, player.tier_value)
      }

      // Calculate stats for each player using the TIER SNAPSHOTS recorded at match time
      // (red_tiers/blue_tiers), not current tiers. This does two things:
      //   1. Expected win prob reflects how teams were actually balanced when the match was
      //      played, so re-ranking one player can't distort everyone else's baseline.
      //   2. We only count a match toward a player if their snapshot tier equals their CURRENT
      //      tier — i.e. games played since their last tier change. Once an admin moves a
      //      player, the games that motivated the move stop counting, so the suggestion no
      //      longer re-fires against the new tier.
      const playerStats = new Map<string, {
        totalExpectedWinProb: number
        wins: number
        matches: number
      }>()

      const accumulate = (
        playerName: string,
        snapshotTier: number | null | undefined,
        expectedWinProb: number,
        won: boolean,
      ) => {
        const currentTier = playerTierMap.get(playerName)
        if (currentTier === undefined) return
        // Only count games played at the player's current tier.
        if (snapshotTier == null || snapshotTier !== currentTier) return

        if (!playerStats.has(playerName)) {
          playerStats.set(playerName, { totalExpectedWinProb: 0, wins: 0, matches: 0 })
        }
        const stats = playerStats.get(playerName)!
        stats.totalExpectedWinProb += expectedWinProb
        stats.matches++
        if (won) stats.wins++
      }

      for (const match of (matches || []) as Match[]) {
        if (!match.red_tiers || !match.blue_tiers) continue

        const redWon = match.red_score > match.blue_score
        const blueWon = match.blue_score > match.red_score

        // Use the snapshot tiers (tiers at match time) for the expected-win calculation.
        const redTierSum = match.red_tiers.reduce((a, b) => a + b, 0)
        const blueTierSum = match.blue_tiers.reduce((a, b) => a + b, 0)
        const totalTiers = redTierSum + blueTierSum

        if (totalTiers === 0) continue

        const redExpected = redTierSum / totalTiers
        const blueExpected = blueTierSum / totalTiers

        match.red_team.forEach((playerName, i) => {
          accumulate(playerName, match.red_tiers![i], redExpected, redWon)
        })
        match.blue_team.forEach((playerName, i) => {
          accumulate(playerName, match.blue_tiers![i], blueExpected, blueWon)
        })
      }

      // Generate suggestions
      const newSuggestions: RankSuggestion[] = []

      for (const [playerName, stats] of playerStats.entries()) {
        if (stats.matches < MIN_MATCHES_THRESHOLD) continue

        const currentTier = playerTierMap.get(playerName)
        if (currentTier === undefined) continue

        const expectedWinRate = stats.totalExpectedWinProb / stats.matches
        const actualWinRate = stats.wins / stats.matches
        const performanceGap = actualWinRate - expectedWinRate

        // Only suggest if gap exceeds threshold
        if (Math.abs(performanceGap) < MIN_GAP_THRESHOLD) continue

        // Move at most one tier per suggestion. A genuinely mis-ranked player will be
        // moved again next sample window once they've played enough games at the new tier;
        // this avoids noise-driven 2-tier jumps from small samples.
        let tierChange = 0
        if (performanceGap >= MIN_GAP_THRESHOLD) {
          tierChange = 1
        } else if (performanceGap <= -MIN_GAP_THRESHOLD) {
          tierChange = -1
        }

        const suggestedTier = Math.max(1, Math.min(10, currentTier + tierChange))

        // Only add if the suggestion is different from current tier
        if (suggestedTier !== currentTier) {
          newSuggestions.push({
            playerName,
            currentTier,
            suggestedTier,
            actualWinRate,
            expectedWinRate,
            performanceGap,
            matchesAnalysed: stats.matches,
            isOverperforming: performanceGap > 0,
          })
        }
      }

      // Sort by absolute performance gap (largest first)
      newSuggestions.sort((a, b) => Math.abs(b.performanceGap) - Math.abs(a.performanceGap))

      setSuggestions(newSuggestions)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to calculate suggestions")
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchSuggestions()
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-[#66fcf1]" />
        <span className="ml-2 text-[#8892a0]">Calculating rank suggestions...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-400 mb-4">Error: {error}</p>
        <Button onClick={fetchSuggestions} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  if (suggestions.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-[#8892a0] mb-2">No rank suggestions available.</p>
        <p className="text-[#8892a0] text-sm">
          Players need at least {MIN_MATCHES_THRESHOLD} matches at their current tier this month before suggestions appear. Re-ranking a player resets their count.
        </p>
        <Button onClick={fetchSuggestions} variant="outline" size="sm" className="mt-4">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-[#8892a0]">
          {suggestions.length} suggestion{suggestions.length !== 1 ? "s" : ""} based on this month's games played at each player's current tier
        </p>
        <Button onClick={fetchSuggestions} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4">
        {suggestions.map((suggestion) => (
          <div
            key={suggestion.playerName}
            className="bg-[#1a1a2e]/60 border border-[#3d4855] rounded-lg p-4"
          >
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
              {/* Player info */}
              <div className="flex items-center gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#c5c6c7]">{suggestion.playerName}</span>
                    <span className="text-sm text-[#8892a0]">— Tier {suggestion.currentTier}</span>
                  </div>
                  <div className="flex items-center gap-2 mt-1">
                    {suggestion.isOverperforming ? (
                      <>
                        <ArrowUp className="w-4 h-4 text-[#27ae60]" />
                        <span className="text-[#27ae60] font-medium">
                          Tier {suggestion.suggestedTier}
                        </span>
                      </>
                    ) : (
                      <>
                        <ArrowDown className="w-4 h-4 text-[#f39c12]" />
                        <span className="text-[#f39c12] font-medium">
                          Tier {suggestion.suggestedTier}
                        </span>
                      </>
                    )}
                  </div>
                </div>
              </div>

              {/* Stats */}
              <div className="flex flex-wrap items-center gap-4 text-sm">
                <div className="flex flex-col items-center">
                  <span className="text-[#8892a0] text-xs uppercase">Actual</span>
                  <span className="text-[#c5c6c7] font-mono">
                    {Math.round(suggestion.actualWinRate * 100)}%
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[#8892a0] text-xs uppercase">Expected</span>
                  <span className="text-[#c5c6c7] font-mono">
                    {Math.round(suggestion.expectedWinRate * 100)}%
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[#8892a0] text-xs uppercase">Gap</span>
                  <span
                    className={`font-mono font-bold ${
                      suggestion.isOverperforming ? "text-[#27ae60]" : "text-[#f39c12]"
                    }`}
                  >
                    {suggestion.performanceGap > 0 ? "+" : ""}
                    {Math.round(suggestion.performanceGap * 100)}%
                  </span>
                </div>
                <div className="flex flex-col items-center">
                  <span className="text-[#8892a0] text-xs uppercase">Matches</span>
                  <span className="text-[#c5c6c7] font-mono">{suggestion.matchesAnalysed}</span>
                </div>
              </div>

              {/* Performance label */}
              <div
                className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                  suggestion.isOverperforming
                    ? "bg-[#27ae60]/20 text-[#27ae60]"
                    : "bg-[#f39c12]/20 text-[#f39c12]"
                }`}
              >
                {suggestion.isOverperforming ? (
                  <>
                    <TrendingUp className="w-3 h-3" />
                    Overperforming
                  </>
                ) : (
                  <>
                    <TrendingDown className="w-3 h-3" />
                    Underperforming
                  </>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
