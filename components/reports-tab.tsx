"use client"

import { useEffect, useState } from "react"
import { getMatchesByMonth, getMatchStatsByMonth } from "@/app/admin/actions"
import { ChevronLeft, ChevronRight, Trophy, Target, BarChart3, Zap, Swords, Star, Flag, Skull, Crosshair, Shield, Sword, Gauge } from "lucide-react"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import type { Player } from "@/lib/types"
import { Button } from "@/components/ui/button"
import { createClient } from "@/lib/supabase/client"
import { TierChangelog } from "@/components/tier-changelog"
import { EloLeaderboard } from "@/components/elo-leaderboard"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"



interface Match {
  id: string
  red_team: string[]
  blue_team: string[]
  red_tiers?: number[] | null
  blue_tiers?: number[] | null
  red_score: number
  blue_score: number
  match_type: "algorithm" | "manual"
  balance_confidence: number | null
  notes: string | null
  created_at: string
  created_at: string
}

interface PlayerMatchStats {
  name: string
  matches: number
  wins: number
  losses: number
}

// Raw match_stats rows for the month (see getMatchStatsByMonth).
interface MatchStatRow {
  match_id: string
  player_id: string
  flag_hold_ms: number
  dbs_kills: number
  captures: number
  returns: number
  kills: number
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]

// flag_hold_ms is stored in milliseconds — render as m:ss (e.g. 272500 -> "4:32").
function formatFlagHold(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

export function ReportsTab() {
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [matches, setMatches] = useState<Match[]>([])
  const [matchStats, setMatchStats] = useState<MatchStatRow[]>([])
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  const [currentView, setCurrentView] = useState<"stats" | "leaderboard" | "elo">("stats")
  const [isAdmin, setIsAdmin] = useState(false)

  // Check if user is admin
  useEffect(() => {
    const checkAdmin = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      setIsAdmin(!!user)
    }
    checkAdmin()
  }, [])

  useEffect(() => {
    setLoading(true)
    Promise.all([
      getMatchesByMonth(selectedYear, selectedMonth),
      fetchPlayersFromDB(),
      getMatchStatsByMonth(selectedYear, selectedMonth)
    ]).then(([matchResult, playersData, statsResult]) => {
      if (matchResult.success) {
        setMatches(matchResult.data as Match[])
      }
      setPlayers(playersData)
      setMatchStats(statsResult.success ? (statsResult.data as MatchStatRow[]) : [])
      setLoading(false)
    })
  }, [selectedYear, selectedMonth])

  // Visibility logic for leaderboard
  const isCurrentMonth = selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1
  const showLeaderboard = !isCurrentMonth || isAdmin

  // Force view back to stats if the selected view becomes unavailable to this user.
  useEffect(() => {
    if (!showLeaderboard && currentView === "leaderboard") {
      setCurrentView("stats")
    }
    if (!isAdmin && currentView === "elo") {
      setCurrentView("stats")
    }
  }, [showLeaderboard, isAdmin, currentView])

  const canGoNext = !(selectedYear === now.getFullYear() && selectedMonth === now.getMonth() + 1)

  const goToPrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12)
      setSelectedYear(selectedYear - 1)
    } else {
      setSelectedMonth(selectedMonth - 1)
    }
  }

  const goToNextMonth = () => {
    if (!canGoNext) return
    if (selectedMonth === 12) {
      setSelectedMonth(1)
      setSelectedYear(selectedYear + 1)
    } else {
      setSelectedMonth(selectedMonth + 1)
    }
  }

  // Calculate stats
  const totalMatches = matches.length
  const scoreMargins = matches.map(m => Math.abs(m.red_score - m.blue_score))
  const avgMargin = totalMatches > 0 ? scoreMargins.reduce((a, b) => a + b, 0) / totalMatches : 0

  const blowoutCount = matches.filter(m => Math.abs(m.red_score - m.blue_score) > 4).length

  // Nail-biters (matches decided by exactly 1 point)
  const nailBiters = matches.filter(m => Math.abs(m.red_score - m.blue_score) === 1)

  // Average Team Strength - average total tier per individual team (not per full lobby)
  const matchesWithTierSnapshots = matches.filter(m => m.red_tiers && m.blue_tiers)
  const avgLobbyStrength = matchesWithTierSnapshots.length > 0
    ? matchesWithTierSnapshots.reduce((sum, m) => {
        const redTotal = m.red_tiers!.reduce((a, b) => a + b, 0)
        const blueTotal = m.blue_tiers!.reduce((a, b) => a + b, 0)
        return sum + redTotal + blueTotal
      }, 0) / (matchesWithTierSnapshots.length * 2)
    : null

  // Star Player of the Month - weighted wins calculation
  const playerTierMap = new Map<string, number>()
  for (const player of players) {
    playerTierMap.set(player.name, player.tierValue)
  }

  const starPlayerStats = new Map<string, { name: string; wins: number; losses: number; score: number; matches: number }>()
  
  for (const match of matches) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score
    if (!redWon && !blueWon) continue // Skip draws
    
    // Calculate tier totals for each team
    const redTierTotal = match.red_team.reduce((sum, name) => sum + (playerTierMap.get(name) || 5), 0)
    const blueTierTotal = match.blue_team.reduce((sum, name) => sum + (playerTierMap.get(name) || 5), 0)
    
    // Process red team players
    for (const playerName of match.red_team) {
      if (!starPlayerStats.has(playerName)) {
        starPlayerStats.set(playerName, { name: playerName, wins: 0, losses: 0, score: 0, matches: 0 })
      }
      const stats = starPlayerStats.get(playerName)!
      stats.matches++
      
      if (redWon) {
        stats.wins++
        const tierAdvantage = blueTierTotal - redTierTotal // Positive if opponent was stronger
        if (tierAdvantage > 0) {
          // Upset win - bonus points
          stats.score += 1.0 + (tierAdvantage * 0.1)
        } else {
          // Expected win - reduced points (minimum 0.3)
          stats.score += Math.max(0.3, 1.0 + (tierAdvantage * 0.05))
        }
      } else {
        stats.losses++
      }
    }
    
    // Process blue team players
    for (const playerName of match.blue_team) {
      if (!starPlayerStats.has(playerName)) {
        starPlayerStats.set(playerName, { name: playerName, wins: 0, losses: 0, score: 0, matches: 0 })
      }
      const stats = starPlayerStats.get(playerName)!
      stats.matches++
      
      if (blueWon) {
        stats.wins++
        const tierAdvantage = redTierTotal - blueTierTotal // Positive if opponent was stronger
        if (tierAdvantage > 0) {
          // Upset win - bonus points
          stats.score += 1.0 + (tierAdvantage * 0.1)
        } else {
          // Expected win - reduced points (minimum 0.3)
          stats.score += Math.max(0.3, 1.0 + (tierAdvantage * 0.05))
        }
      } else {
        stats.losses++
      }
    }
  }

  const starPlayerMinMatches = Math.ceil(totalMatches * 0.35)
  const starPlayer = Array.from(starPlayerStats.values())
    .filter(p => p.matches >= starPlayerMinMatches)
    .map(p => ({ ...p, avgScore: p.score / p.matches }))
    .sort((a, b) => {
      // Sort by average score first
      if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore
      // Tiebreaker: more matches = more proven
      return b.matches - a.matches
    })[0] || null

  // Winning Streak - longest consecutive wins by any player within the month
  const playerMatchHistory = new Map<string, { won: boolean; date: Date }[]>()
  
  // Sort matches by date for proper chronological order
  const sortedMatches = [...matches].sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  
  for (const match of sortedMatches) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score
    const matchDate = new Date(match.created_at)
    
    for (const playerName of match.red_team) {
      if (!playerMatchHistory.has(playerName)) {
        playerMatchHistory.set(playerName, [])
      }
      playerMatchHistory.get(playerName)!.push({ won: redWon, date: matchDate })
    }
    
    for (const playerName of match.blue_team) {
      if (!playerMatchHistory.has(playerName)) {
        playerMatchHistory.set(playerName, [])
      }
      playerMatchHistory.get(playerName)!.push({ won: blueWon, date: matchDate })
    }
  }

  // Find all player streaks and get top 5
  const allStreaks: { name: string; streak: number }[] = []
  
  for (const [playerName, history] of playerMatchHistory.entries()) {
    let currentStreak = 0
    let maxStreak = 0
    
    for (const match of history) {
      if (match.won) {
        currentStreak++
        maxStreak = Math.max(maxStreak, currentStreak)
      } else {
        currentStreak = 0
      }
    }
    
    if (maxStreak > 1) {
      allStreaks.push({ name: playerName, streak: maxStreak })
    }
  }
  
  // Sort by streak length descending and take top 5
  const streakLeaders = allStreaks
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 5)
  
  const longestStreak = streakLeaders.length > 0 ? streakLeaders[0].streak : 0

  // Rivalries - find pair of players on opposite teams most often
  const opponentPairs = new Map<string, { player1: string; player2: string; count: number; player1Wins: number }>()
  for (const match of matches) {
    const redWon = match.red_score > match.blue_score
    for (const redPlayer of match.red_team) {
      for (const bluePlayer of match.blue_team) {
        const key = [redPlayer, bluePlayer].sort().join(" vs ")
        if (!opponentPairs.has(key)) {
          opponentPairs.set(key, {
            player1: [redPlayer, bluePlayer].sort()[0],
            player2: [redPlayer, bluePlayer].sort()[1],
            count: 0,
            player1Wins: 0
          })
        }
        const pair = opponentPairs.get(key)!
        pair.count++
        // Track who won - if player1 was on the winning team
        const player1OnRed = match.red_team.includes(pair.player1)
        if ((player1OnRed && redWon) || (!player1OnRed && !redWon && match.blue_score > match.red_score)) {
          pair.player1Wins++
        }
      }
    }
  }

  const topRivalry = Array.from(opponentPairs.values())
    .sort((a, b) => b.count - a.count)[0] || null

  // Red vs Blue
  const redWins = matches.filter(m => m.red_score > m.blue_score).length
  const blueWins = matches.filter(m => m.blue_score > m.red_score).length
  const draws = matches.filter(m => m.red_score === m.blue_score).length
  const redPct = totalMatches > 0 ? Math.round((redWins / totalMatches) * 100) : 0
  const bluePct = totalMatches > 0 ? Math.round((blueWins / totalMatches) * 100) : 0

  // CSV stat highlights — cumulative monthly totals per player. Only matches with
  // an uploaded stats CSV contribute, so the qualifier is based on the number of
  // matches that actually have stats this month (not all matches).
  const playerIdToName = new Map<string, string>()
  for (const player of players) {
    if (player.id) playerIdToName.set(player.id, player.name)
  }

  const statAgg = new Map<
    string,
    { flagHoldMs: number; dbsKills: number; captures: number; returns: number; kills: number; matches: number }
  >()
  for (const row of matchStats) {
    if (!statAgg.has(row.player_id)) {
      statAgg.set(row.player_id, { flagHoldMs: 0, dbsKills: 0, captures: 0, returns: 0, kills: 0, matches: 0 })
    }
    const agg = statAgg.get(row.player_id)!
    agg.flagHoldMs += row.flag_hold_ms || 0
    agg.dbsKills += row.dbs_kills || 0
    agg.captures += row.captures || 0
    agg.returns += row.returns || 0
    agg.kills += row.kills || 0
    agg.matches += 1
  }

  const statsMatchCount = new Set(matchStats.map((r) => r.match_id)).size
  const statHighlightMinMatches = Math.max(1, Math.ceil(statsMatchCount * 0.3))

  const qualifiedStatPlayers = Array.from(statAgg.entries())
    .filter(([, agg]) => agg.matches >= statHighlightMinMatches)
    .map(([playerId, agg]) => ({
      name: playerIdToName.get(playerId) ?? "Unknown player",
      ...agg,
    }))

  const topFlagHold =
    [...qualifiedStatPlayers]
      .filter((p) => p.flagHoldMs > 0)
      .sort((a, b) => b.flagHoldMs - a.flagHoldMs)[0] || null

  const topDbsKills =
    [...qualifiedStatPlayers]
      .filter((p) => p.dbsKills > 0)
      .sort((a, b) => b.dbsKills - a.dbsKills)[0] || null

  const topCapper =
    [...qualifiedStatPlayers]
      .filter((p) => p.captures > 0)
      .sort((a, b) => b.captures - a.captures)[0] || null

  const topReturner =
    [...qualifiedStatPlayers]
      .filter((p) => p.returns > 0)
      .sort((a, b) => b.returns - a.returns)[0] || null

  const topKiller =
    [...qualifiedStatPlayers]
      .filter((p) => p.kills > 0)
      .sort((a, b) => b.kills - a.kills)[0] || null

  // Most Caps per Run — efficiency (minutes of flag hold per cap; lower = better).
  // To avoid low-volume flukes, only "regular cappers" qualify: caps >= 40% of the
  // month's highest individual cap total (on top of the min-match threshold).
  const maxMonthlyCaps = qualifiedStatPlayers.reduce((max, p) => Math.max(max, p.captures), 0)
  const regularCapperFloor = maxMonthlyCaps * 0.4
  const mostCapsPerRun =
    qualifiedStatPlayers
      .filter((p) => p.captures >= regularCapperFloor && p.flagHoldMs > 0 && p.captures > 0)
      .map((p) => ({ ...p, minutesPerCap: p.flagHoldMs / 60000 / p.captures }))
      .sort((a, b) => a.minutesPerCap - b.minutesPerCap)[0] || null

  // Algorithm vs Manual
  const algorithmMatches = matches.filter(m => m.match_type === "algorithm")
  const manualMatches = matches.filter(m => m.match_type === "manual")

  const algorithmAvgMargin = algorithmMatches.length > 0
    ? algorithmMatches.map(m => Math.abs(m.red_score - m.blue_score)).reduce((a, b) => a + b, 0) / algorithmMatches.length
    : 0

  const manualAvgMargin = manualMatches.length > 0
    ? manualMatches.map(m => Math.abs(m.red_score - m.blue_score)).reduce((a, b) => a + b, 0) / manualMatches.length
    : 0

  // Avg Tier Gap for Algorithm vs Manual (using tier snapshots)
  const algorithmMatchesWithTiers = algorithmMatches.filter(m => m.red_tiers && m.blue_tiers)
  const manualMatchesWithTiers = manualMatches.filter(m => m.red_tiers && m.blue_tiers)

  const algorithmAvgTierGap = algorithmMatchesWithTiers.length > 0
    ? algorithmMatchesWithTiers.reduce((sum, m) => {
        return sum + Math.abs(m.red_tiers!.reduce((a, b) => a + b, 0) - m.blue_tiers!.reduce((a, b) => a + b, 0))
      }, 0) / algorithmMatchesWithTiers.length
    : null

  const manualAvgTierGap = manualMatchesWithTiers.length > 0
    ? manualMatchesWithTiers.reduce((sum, m) => {
        return sum + Math.abs(m.red_tiers!.reduce((a, b) => a + b, 0) - m.blue_tiers!.reduce((a, b) => a + b, 0))
      }, 0) / manualMatchesWithTiers.length
    : null

  // Nailbiters and Blowouts for Algorithm vs Manual
  const algorithmNailbiters = algorithmMatches.filter(m => Math.abs(m.red_score - m.blue_score) === 1).length
  const algorithmBlowouts = algorithmMatches.filter(m => Math.abs(m.red_score - m.blue_score) > 4).length
  const manualNailbiters = manualMatches.filter(m => Math.abs(m.red_score - m.blue_score) === 1).length
  const manualBlowouts = manualMatches.filter(m => Math.abs(m.red_score - m.blue_score) > 4).length

  // Leaderboard data
  const leaderboardStats = new Map<string, { wins: number; losses: number; draws: number; played: number; form: ("W" | "L")[] }>()

  // Reverse matches to track form (most recent first) - matches come sorted ascending from API
  const reversedMatches = [...matches].reverse()

  for (const match of reversedMatches) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score

    for (const playerName of match.red_team) {
      if (!leaderboardStats.has(playerName)) {
        leaderboardStats.set(playerName, { wins: 0, losses: 0, draws: 0, played: 0, form: [] })
      }
      const stats = leaderboardStats.get(playerName)!
      stats.played++
      if (redWon) {
        stats.wins++
        if (stats.form.length < 5) stats.form.push("W")
      } else if (blueWon) {
        stats.losses++
        if (stats.form.length < 5) stats.form.push("L")
      }
    }

    for (const playerName of match.blue_team) {
      if (!leaderboardStats.has(playerName)) {
        leaderboardStats.set(playerName, { wins: 0, losses: 0, draws: 0, played: 0, form: [] })
      }
      const stats = leaderboardStats.get(playerName)!
      stats.played++
      if (blueWon) {
        stats.wins++
        if (stats.form.length < 5) stats.form.push("W")
      } else if (redWon) {
        stats.losses++
        if (stats.form.length < 5) stats.form.push("L")
      }
    }
  }

  const leaderboardMinMatches = Math.ceil(totalMatches * 0.30)

  const leaderboard = Array.from(leaderboardStats.entries())
    .map(([name, stats]) => ({
      name,
      ...stats,
      winPct: stats.played > 0 ? (stats.wins / stats.played) * 100 : 0
    }))
    .filter(p => p.played >= leaderboardMinMatches)
    .sort((a, b) => {
      // Primary: win rate
      if (b.winPct !== a.winPct) return b.winPct - a.winPct
      // Secondary: total wins
      if (b.wins !== a.wins) return b.wins - a.wins
      // Tertiary: matches played
      return b.played - a.played
    })

  // Leaderboard summary stats
  const totalLeaderboardPlayers = leaderboard.length
  const totalLeaderboardWins = leaderboard.reduce((sum, p) => sum + p.wins, 0)
  const topWinner = leaderboard[0]?.name || null
  const mostWinsPlayer = [...leaderboard].sort((a, b) => b.wins - a.wins)[0]
  const mostWins = mostWinsPlayer?.wins || 0
  const mostWinsName = mostWinsPlayer?.name || null

  // Balance vs Reality data - only includes matches with tier snapshots
  const balanceVsReality = sortedMatches
    .filter(m => m.red_tiers && m.blue_tiers)
    .map((m, i) => {
      const tierGap = Math.abs(
        m.red_tiers!.reduce((a, b) => a + b, 0) - m.blue_tiers!.reduce((a, b) => a + b, 0)
      )
      const scoreMargin = Math.abs(m.red_score - m.blue_score)
      return {
        match: i + 1,
        tierGap,
        scoreMargin,
        matchType: m.match_type,
        date: new Date(m.created_at).toLocaleDateString()
      }
    })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"></div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Month Selector */}
      <div className="flex items-center justify-center gap-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={goToPrevMonth}
          className="text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10"
        >
          <ChevronLeft className="w-5 h-5" />
        </Button>
        <h2 className="text-xl font-bold text-[var(--color-primary)] min-w-[200px] text-center">
          {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
        </h2>
        <Button
          variant="ghost"
          size="icon"
          onClick={goToNextMonth}
          disabled={!canGoNext}
          className="text-[var(--color-primary)] hover:bg-[var(--color-primary)]/10 disabled:opacity-30"
        >
          <ChevronRight className="w-5 h-5" />
        </Button>
      </div>

      {/* View Toggle */}
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setCurrentView("stats")}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            currentView === "stats"
              ? "bg-[var(--color-primary)] text-[var(--color-background)]"
              : "bg-[var(--color-surface)] text-[var(--color-text-dim)] hover:bg-[var(--color-border)]/50"
          }`}
        >
          Monthly Stats
        </button>
        {showLeaderboard && (
          <button
            onClick={() => setCurrentView("leaderboard")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              currentView === "leaderboard"
                ? "bg-[var(--color-primary)] text-[var(--color-background)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-dim)] hover:bg-[var(--color-border)]/50"
            }`}
          >
            Leaderboard
          </button>
        )}
        {isAdmin && (
          <button
            onClick={() => setCurrentView("elo")}
            className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
              currentView === "elo"
                ? "bg-[var(--color-primary)] text-[var(--color-background)]"
                : "bg-[var(--color-surface)] text-[var(--color-text-dim)] hover:bg-[var(--color-border)]/50"
            }`}
          >
            ELO
          </button>
        )}
      </div>

      {/* Admin preview notice */}
      {isAdmin && isCurrentMonth && currentView === "leaderboard" && (
        <div className="text-center text-sm text-[var(--color-text-dim)] italic">
          Admin preview — this leaderboard will be published on {MONTH_NAMES[selectedMonth % 12]} 1st
        </div>
      )}

      {currentView === "elo" ? (
        // ELO is a running, all-time rating — render it regardless of the selected month.
        // The month selector above drives the ELO view's own All-time / Monthly toggle.
        <EloLeaderboard year={selectedYear} month={selectedMonth} />
      ) : totalMatches === 0 ? (
        <div className="text-center py-12 text-[var(--color-text-dim)]">
          <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No matches logged in {MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
        </div>
      ) : currentView === "stats" ? (
        <>
          {/* Monthly Stats View */}
          {/* Overview Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Total Matches</div>
              <div className="text-2xl font-bold text-[var(--color-primary)]">{totalMatches}</div>
            </div>
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Avg Score Margin</div>
              <div className="text-2xl font-bold text-[var(--color-text)]">{avgMargin.toFixed(1)}</div>
            </div>
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Tight games (7-6)</div>
              <div className="text-2xl font-bold text-[#f39c12]">{nailBiters.length}</div>
            </div>
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Blowouts (&gt; 4)</div>
              <div className="text-2xl font-bold text-[var(--color-text)]">{blowoutCount}</div>
            </div>
          </div>

          {/* Star Player of the Month */}
          <div className="bg-[var(--color-surface)]/60 border border-[#ffd700]/30 rounded-lg p-6">
            <h3 className="text-lg font-bold text-[#ffd700] mb-4 flex items-center gap-2">
              <Star className="w-6 h-6 fill-[#ffd700]" />
              Star Player of the Month
            </h3>
            {starPlayer ? (
              <div className="text-center">
                <div className="text-3xl font-bold text-[#ffd700] mb-2">{starPlayer.name}</div>
                <div className="text-lg mb-3">
                  <span className="text-[#27ae60] font-bold">{starPlayer.wins}W</span>
                  <span className="text-[var(--color-text-dim)]"> - </span>
                  <span className="text-[#ff4757] font-bold">{starPlayer.losses}L</span>
                  <span className="text-[var(--color-text-dim)] ml-3">|</span>
                  <span className="text-[var(--color-primary)] font-bold ml-3">{starPlayer.avgScore.toFixed(2)} avg</span>
                </div>
                <p className="text-xs text-[var(--color-text-dim)] italic">
                  Awarded to the player with the most impactful wins — upset victories count more than expected ones.
                </p>
                <p className="text-xs text-[var(--color-text-dim)]/60 mt-1">Based on current player ratings</p>
              </div>
            ) : (
              <p className="text-[var(--color-text-dim)] text-sm text-center italic">
                Not enough data yet — need players with {starPlayerMinMatches}+ matches this month
              </p>
            )}
          </div>

          {/* Winning Streak & Rivalries Row */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Winning Streak */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#f39c12]" />
                Winning Streaks
              </h3>
              {streakLeaders.length > 0 ? (
                <div className="space-y-3">
                  {streakLeaders.map((leader, index) => (
                    <div key={leader.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--color-text-dim)] text-sm w-5">{index + 1}.</span>
                        <span className="text-[var(--color-text)] font-medium">{leader.name}</span>
                      </div>
                      <span className="text-[#f39c12] font-bold">{leader.streak} wins</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">No streaks this month</p>
              )}
            </div>

            {/* Rivalries */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Swords className="w-5 h-5 text-[#ff4757]" />
                Top Rivalry
              </h3>
              {topRivalry && topRivalry.count >= 2 ? (
                <div className="text-center">
                  <div className="text-lg mb-2">
                    <span className="text-[var(--color-text)] font-bold">{topRivalry.player1}</span>
                    <span className="text-[var(--color-text-dim)] mx-2">vs</span>
                    <span className="text-[var(--color-text)] font-bold">{topRivalry.player2}</span>
                  </div>
                  <div className="text-sm text-[var(--color-text-dim)] mb-2">
                    Faced each other <span className="text-[var(--color-primary)] font-bold">{topRivalry.count}</span> times
                  </div>
                  <div className="text-sm">
                    <span className="text-[var(--color-text)]">{topRivalry.player1}&apos;s teams won </span>
                    <span className="text-[#27ae60] font-bold">{topRivalry.player1Wins}</span>
                    <span className="text-[var(--color-text)]">, {topRivalry.player2}&apos;s won </span>
                    <span className="text-[#27ae60] font-bold">{topRivalry.count - topRivalry.player1Wins}</span>
                  </div>
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">No recurring rivalries yet</p>
              )}
            </div>
          </div>

          {/* Average Lobby Strength & Red vs Blue Row */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Average Lobby Strength */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Target className="w-5 h-5" />
                Avg Team Strength
              </h3>
              {avgLobbyStrength !== null ? (
                <div className="text-center">
                  <div className="text-3xl font-bold mb-2 text-[var(--color-primary)]">
                    {avgLobbyStrength.toFixed(1)}
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)]">
                    Total max level: 60
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] mt-2 italic">
                    Based on {matchesWithTierSnapshots.length} matches with tier data
                  </div>
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">No tier snapshot data available</p>
              )}
            </div>

            {/* Red vs Blue */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Target className="w-5 h-5" />
                Red vs Blue Wins
              </h3>
              <div className="space-y-4">
                <div className="flex h-8 rounded-lg overflow-hidden">
                  {redPct > 0 && (
                    <div
                      className="bg-[#ff4757] flex items-center justify-center text-white text-sm font-bold"
                      style={{ width: `${redPct}%` }}
                    >
                      {redPct}%
                    </div>
                  )}
                  {bluePct > 0 && (
                    <div
                      className="bg-[#00d4ff] flex items-center justify-center text-white text-sm font-bold"
                      style={{ width: `${bluePct}%` }}
                    >
                      {bluePct}%
                    </div>
                  )}
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#ff4757]">Red: {redWins} wins</span>
                  <span className="text-[#00d4ff]">Blue: {blueWins} wins</span>
                </div>
                {draws > 0 && (
                  <div className="text-center text-sm text-[var(--color-text-dim)]">
                    Draws: {draws}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Top Flag Hold & Most DBS Kills Row (from match stats CSVs) */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Top Flag Hold */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Flag className="w-5 h-5 text-[#f39c12]" />
                Top Flag Hold
              </h3>
              {topFlagHold ? (
                <div className="text-center">
                  <div className="text-3xl font-bold text-[var(--color-text)] mb-1">{topFlagHold.name}</div>
                  <div className="text-2xl font-bold text-[#f39c12] mb-2">
                    {formatFlagHold(topFlagHold.flagHoldMs)}
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] italic">
                    Most total flag hold time this month
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)]/60 mt-1">
                    Players with {statHighlightMinMatches}+ stat-tracked matches
                  </div>
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">
                  No stats data this month
                </p>
              )}
            </div>

            {/* Most DBS Kills */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Skull className="w-5 h-5 text-[#ff4757]" />
                Most DBS Kills
              </h3>
              {topDbsKills ? (
                <div className="text-center">
                  <div className="text-3xl font-bold text-[var(--color-text)] mb-1">{topDbsKills.name}</div>
                  <div className="text-2xl font-bold text-[#ff4757] mb-2">
                    {topDbsKills.dbsKills} DBS kills
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] italic">
                    Most total DBS kills this month
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)]/60 mt-1">
                    Players with {statHighlightMinMatches}+ stat-tracked matches
                  </div>
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">
                  No stats data this month
                </p>
              )}
            </div>
          </div>

          {/* Top Capper & Top Returner Row (from match stats CSVs) */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Top Capper */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Crosshair className="w-5 h-5 text-[#27ae60]" />
                Top Capper
              </h3>
              {topCapper ? (
                <div className="text-center">
                  <div className="text-3xl font-bold text-[var(--color-text)] mb-1">{topCapper.name}</div>
                  <div className="text-2xl font-bold text-[#27ae60] mb-2">
                    {topCapper.captures} caps
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] italic">
                    Most total captures this month
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)]/60 mt-1">
                    Players with {statHighlightMinMatches}+ stat-tracked matches
                  </div>
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">
                  No stats data this month
                </p>
              )}
            </div>

            {/* Top Returner */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Shield className="w-5 h-5 text-[#00d4ff]" />
                Top Returner
              </h3>
              {topReturner ? (
                <div className="text-center">
                  <div className="text-3xl font-bold text-[var(--color-text)] mb-1">{topReturner.name}</div>
                  <div className="text-2xl font-bold text-[#00d4ff] mb-2">
                    {topReturner.returns} returns
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] italic">
                    Most total returns this month
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)]/60 mt-1">
                    Players with {statHighlightMinMatches}+ stat-tracked matches
                  </div>
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">
                  No stats data this month
                </p>
              )}
            </div>
          </div>

          {/* Top Killer & Most Caps per Run Row (from match stats CSVs) */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Top Killer */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Sword className="w-5 h-5 text-[#ff4757]" />
                Top Killer
              </h3>
              {topKiller ? (
                <div className="text-center">
                  <div className="text-3xl font-bold text-[var(--color-text)] mb-1">{topKiller.name}</div>
                  <div className="text-2xl font-bold text-[#ff4757] mb-2">
                    {topKiller.kills} kills
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] italic">
                    Most total kills this month
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)]/60 mt-1">
                    Players with {statHighlightMinMatches}+ stat-tracked matches
                  </div>
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">
                  No stats data this month
                </p>
              )}
            </div>

            {/* Most Caps per Run */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Gauge className="w-5 h-5 text-[#f39c12]" />
                Most Caps per Run
              </h3>
              {mostCapsPerRun ? (
                <div className="text-center">
                  <div className="text-3xl font-bold text-[var(--color-text)] mb-1">{mostCapsPerRun.name}</div>
                  <div className="text-2xl font-bold text-[#f39c12] mb-1">
                    1 cap / {mostCapsPerRun.minutesPerCap.toFixed(1)} min
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] mb-2">
                    {mostCapsPerRun.captures} caps · {formatFlagHold(mostCapsPerRun.flagHoldMs)} hold
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)] italic">
                    Fewest minutes of flag hold per cap
                  </div>
                  <div className="text-xs text-[var(--color-text-dim)]/60 mt-1">
                    Regular cappers only (≥40% of the top cap total)
                  </div>
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">
                  No stats data this month
                </p>
              )}
            </div>
          </div>

          {/* Algorithm vs Manual */}
          <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
              <BarChart3 className="w-5 h-5" />
              Algorithm vs Manual Comparison
            </h3>
            <div className="grid md:grid-cols-2 gap-4">
              <div className={`p-4 rounded-lg border ${algorithmMatches.length > 0 ? "border-[var(--color-primary)]/50 bg-[var(--color-primary)]/5" : "border-[var(--color-border)]"}`}>
                <div className="text-[var(--color-primary)] font-bold mb-2">Algorithm</div>
                {algorithmMatches.length > 0 ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Matches:</span>
                      <span className="text-[var(--color-text)]">{algorithmMatches.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Avg Margin:</span>
                      <span className="text-[var(--color-text)]">{algorithmAvgMargin.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Avg Tier Gap:</span>
                      <span className="text-[var(--color-text)]">{algorithmAvgTierGap !== null ? algorithmAvgTierGap.toFixed(1) : "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Tight games (7-6):</span>
                      <span className="text-[var(--color-text)]">{algorithmNailbiters}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Blowouts:</span>
                      <span className="text-[var(--color-text)]">{algorithmBlowouts}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[var(--color-text-dim)] text-sm">No algorithm matches this month</p>
                )}
              </div>
              <div className={`p-4 rounded-lg border ${manualMatches.length > 0 ? "border-[var(--color-text-dim)]/50 bg-[var(--color-text-dim)]/5" : "border-[var(--color-border)]"}`}>
                <div className="text-[var(--color-text-dim)] font-bold mb-2">Manual</div>
                {manualMatches.length > 0 ? (
                  <div className="space-y-1 text-sm">
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Matches:</span>
                      <span className="text-[var(--color-text)]">{manualMatches.length}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Avg Margin:</span>
                      <span className="text-[var(--color-text)]">{manualAvgMargin.toFixed(1)}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Avg Tier Gap:</span>
                      <span className="text-[var(--color-text)]">{manualAvgTierGap !== null ? manualAvgTierGap.toFixed(1) : "N/A"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Tight games (7-6):</span>
                      <span className="text-[var(--color-text)]">{manualNailbiters}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-[var(--color-text-dim)]">Blowouts:</span>
                      <span className="text-[var(--color-text)]">{manualBlowouts}</span>
                    </div>
                  </div>
                ) : (
                  <p className="text-[var(--color-text-dim)] text-sm">No manual matches this month</p>
                )}
              </div>
            </div>
            {algorithmMatches.length > 0 && manualMatches.length > 0 && (
              <div className="mt-4 p-3 rounded bg-[#1f2833] text-sm text-center">
                {algorithmAvgMargin < manualAvgMargin ? (
                  <span className="text-[#27ae60]">Algorithm matches have closer games on average ({algorithmAvgMargin.toFixed(1)} vs {manualAvgMargin.toFixed(1)} margin)</span>
                ) : algorithmAvgMargin > manualAvgMargin ? (
                  <span className="text-[#f39c12]">Manual matches have closer games on average ({manualAvgMargin.toFixed(1)} vs {algorithmAvgMargin.toFixed(1)} margin)</span>
                ) : (
                  <span className="text-[var(--color-text-dim)]">Both approaches have similar margins</span>
                )}
              </div>
            )}
          </div>

          {/* Balance vs Reality */}
          {balanceVsReality.length > 0 && (
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-2">Balance vs Reality</h3>
              <p className="text-sm text-[var(--color-text-dim)] mb-4">
                Compares the algorithm&apos;s tier gap prediction against actual score margins. Lower values = closer matches.
              </p>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={balanceVsReality} margin={{ top: 28, right: 8, left: 0, bottom: 16 }}>
                    <XAxis dataKey="match" stroke="var(--color-text-dim)" fontSize={12} label={{ value: "Match #", position: "bottom", fill: "var(--color-text-dim)", fontSize: 11 }} />
                    <YAxis stroke="var(--color-text-dim)" fontSize={12} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: "8px" }}
                      labelStyle={{ color: "var(--color-primary)" }}
                      labelFormatter={(label) => `Match ${label}`}
                      formatter={(value: number, name: string, props: { payload?: { matchType?: string } }) => [
                        value,
                        name === "tierGap" ? "Tier Gap" : "Score Margin"
                      ]}
                      content={({ active, payload, label }) => {
                        if (!active || !payload?.length) return null
                        const matchType = payload[0]?.payload?.matchType
                        return (
                          <div style={{ backgroundColor: "var(--color-surface)", border: "1px solid var(--color-border)", borderRadius: 8, padding: "8px 12px" }}>
                            <p style={{ color: "var(--color-primary)", marginBottom: 4, fontSize: 12 }}>Match {label}</p>
                            {matchType && (
                              <p style={{ marginBottom: 6 }}>
                                <span style={{
                                  fontSize: 10,
                                  fontWeight: 700,
                                  letterSpacing: "0.05em",
                                  padding: "2px 6px",
                                  borderRadius: 4,
                                  backgroundColor: matchType === "algorithm" ? "rgba(102,252,241,0.15)" : "rgba(136,146,160,0.15)",
                                  color: matchType === "algorithm" ? "var(--color-primary)" : "var(--color-text-dim)",
                                  border: `1px solid ${matchType === "algorithm" ? "rgba(102,252,241,0.4)" : "rgba(136,146,160,0.4)"}`,
                                }}>
                                  {matchType === "algorithm" ? "ALGORITHM" : "MANUAL"}
                                </span>
                              </p>
                            )}
                            {payload.map((entry) => (
                              <p key={entry.dataKey as string} style={{ color: entry.color as string, fontSize: 12, margin: "2px 0" }}>
                                {entry.name === "tierGap" ? "Tier Gap" : "Score Margin"}: {entry.value}
                              </p>
                            ))}
                          </div>
                        )
                      }}
                    />
                    <Legend
                      verticalAlign="top"
                      height={36}
                      formatter={(value) => (
                        <span style={{ color: "var(--color-text)", fontSize: 12 }}>
                          {value === "tierGap" ? "Tier Gap (predicted)" : "Score Margin (actual)"}
                        </span>
                      )}
                    />
                    <Line
                      type="monotone"
                      dataKey="tierGap"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      dot={(props) => {
                        const { cx, cy, payload } = props
                        const isAlgorithm = payload.matchType === "algorithm"
                        return isAlgorithm ? (
                          <circle cx={cx} cy={cy} r={4} fill="var(--color-primary)" stroke="none" />
                        ) : (
                          <rect x={cx - 4} y={cy - 4} width={8} height={8} fill="var(--color-primary)" opacity={0.6} />
                        )
                      }}
                      label={(props) => {
                        const { x, y, index } = props
                        const entry = balanceVsReality[index]
                        if (!entry) return <g />
                        const isAlgorithm = entry.matchType === "algorithm"
                        const tag = isAlgorithm ? "ALG" : "MAN"
                        const bg = isAlgorithm ? "rgba(102,252,241,0.15)" : "rgba(136,146,160,0.15)"
                        const color = isAlgorithm ? "var(--color-primary)" : "var(--color-text-dim)"
                        const border = isAlgorithm ? "rgba(102,252,241,0.5)" : "rgba(136,146,160,0.5)"
                        const w = 26, h = 13, rx = 3
                        return (
                          <g>
                            <rect x={x - w / 2} y={y - h - 8} width={w} height={h} rx={rx} fill={bg} stroke={border} strokeWidth={0.8} />
                            <text x={x} y={y - h - 8 + h / 2 + 4} textAnchor="middle" fill={color} fontSize={8} fontWeight={700} letterSpacing="0.05em">
                              {tag}
                            </text>
                          </g>
                        )
                      }}
                    />
                    <Line
                      type="monotone"
                      dataKey="scoreMargin"
                      stroke="#f39c12"
                      strokeWidth={2}
                      dot={(props) => {
                        const { cx, cy, payload } = props
                        const isAlgorithm = payload.matchType === "algorithm"
                        return isAlgorithm ? (
                          <circle cx={cx} cy={cy} r={4} fill="#f39c12" stroke="none" />
                        ) : (
                          <rect x={cx - 4} y={cy - 4} width={8} height={8} fill="#f39c12" opacity={0.6} />
                        )
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-center gap-6 mt-2 text-xs text-[var(--color-text-dim)]">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-[var(--color-primary)]"></div>
                  <span>Algorithm match</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 bg-[var(--color-primary)] opacity-60"></div>
                  <span>Manual match</span>
                </div>
              </div>
            </div>
          )}
        </>
      ) : (
        <>
          {/* Leaderboard View */}
          {/* Wins Leaderboard Table */}
          <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg overflow-hidden">
            <div className="p-4 border-b border-[var(--color-border)]">
              <h3 className="text-lg font-bold text-[var(--color-primary)] flex items-center gap-2">
                <Trophy className="w-5 h-5" />
                Wins Leaderboard
              </h3>
              <p className="text-xs text-[var(--color-text-dim)] mt-1">Players with {leaderboardMinMatches}+ matches this month (30% of {totalMatches})</p>
            </div>
            {leaderboard.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-[var(--color-border)] text-[var(--color-text-dim)] text-xs uppercase">
                      <th className="px-4 py-3 text-left">#</th>
                      <th className="px-4 py-3 text-left">Player</th>
                      <th className="px-4 py-3 text-center">Wins</th>
                      <th className="px-4 py-3 text-center">Losses</th>
                      <th className="px-4 py-3 text-center">Played</th>
                      <th className="px-4 py-3 text-right">Win %</th>
                      <th className="px-4 py-3 text-center">Form</th>
                    </tr>
                  </thead>
                  <tbody>
                    {leaderboard.map((player, index) => {
                      const isTop3 = index < 3
                      const medalColors = ["#ffd700", "#c0c0c0", "#cd7f32"]
                      return (
                        <tr
                          key={player.name}
                          className={`border-b border-[var(--color-border)]/50 ${isTop3 ? "bg-[#ffd700]/5" : ""}`}
                        >
                          <td className="px-4 py-3">
                            {isTop3 ? (
                              <span style={{ color: medalColors[index] }} className="text-lg">
                                {index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}
                              </span>
                            ) : (
                              <span className="text-[var(--color-text-dim)]">{index + 1}</span>
                            )}
                          </td>
                          <td className="px-4 py-3">
                            <span className={`font-medium ${isTop3 ? "text-[#ffd700]" : "text-[var(--color-text)]"}`}>
                              {player.name}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-center text-[#27ae60] font-bold">{player.wins}</td>
                          <td className="px-4 py-3 text-center text-[#ff4757] font-bold">{player.losses}</td>
                          <td className="px-4 py-3 text-center text-[var(--color-text)]">{player.played}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`font-bold ${
                              player.winPct >= 60 ? "text-[#27ae60]" :
                              player.winPct >= 40 ? "text-[var(--color-text)]" :
                              "text-[#ff4757]"
                            }`}>
                              {player.winPct.toFixed(0)}%
                            </span>
                          </td>
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-center gap-1">
                              {player.form.map((result, i) => (
                                <span
                                  key={i}
                                  className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                                    result === "W"
                                      ? "bg-[#27ae60] text-white"
                                      : "bg-[#ff4757] text-white"
                                  }`}
                                >
                                  {result}
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="p-8 text-center text-[var(--color-text-dim)]">
                <p>No players with {leaderboardMinMatches}+ matches yet</p>
              </div>
            )}
          </div>

          {/* Summary Bar */}
          {leaderboard.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Total Players</div>
                <div className="text-2xl font-bold text-[var(--color-primary)]">{totalLeaderboardPlayers}</div>
              </div>
              <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Total Wins</div>
                <div className="text-2xl font-bold text-[#27ae60]">{totalLeaderboardWins}</div>
              </div>
              <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Top Winner</div>
                <div className="text-xl font-bold text-[#ffd700] truncate">{topWinner || "—"}</div>
              </div>
              <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Most Wins</div>
                <div className="text-xl font-bold text-[var(--color-text)]">
                  {mostWins > 0 ? `${mostWins} (${mostWinsName})` : "—"}
                </div>
              </div>
            </div>
          )}

          {/* Star Player of the Month */}
          <div className="bg-[var(--color-surface)]/60 border border-[#ffd700]/30 rounded-lg p-6">
            <h3 className="text-lg font-bold text-[#ffd700] mb-4 flex items-center gap-2">
              <Star className="w-6 h-6 fill-[#ffd700]" />
              Star Player of the Month
            </h3>
            {starPlayer ? (
              <div className="text-center">
                <div className="text-3xl font-bold text-[#ffd700] mb-2">{starPlayer.name}</div>
                <div className="text-lg mb-3">
                  <span className="text-[#27ae60] font-bold">{starPlayer.wins}W</span>
                  <span className="text-[var(--color-text-dim)]"> - </span>
                  <span className="text-[#ff4757] font-bold">{starPlayer.losses}L</span>
                  <span className="text-[var(--color-text-dim)] ml-3">|</span>
                  <span className="text-[var(--color-primary)] font-bold ml-3">{starPlayer.avgScore.toFixed(2)} avg</span>
                </div>
                <p className="text-xs text-[var(--color-text-dim)] italic">
                  Awarded to the player with the most impactful wins — upset victories count more than expected ones.
                </p>
                <p className="text-xs text-[var(--color-text-dim)]/60 mt-1">Based on current player ratings</p>
              </div>
            ) : (
              <p className="text-[var(--color-text-dim)] text-sm text-center italic">
                Not enough data yet — need players with 5+ matches
              </p>
            )}
          </div>

          {/* Winning Streaks & Top Rivalry */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Winning Streaks */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Zap className="w-5 h-5 text-[#f39c12]" />
                Winning Streaks
              </h3>
              {streakLeaders.length > 0 ? (
                <div className="space-y-3">
                  {streakLeaders.map((leader, index) => (
                    <div key={leader.name} className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="text-[var(--color-text-dim)] text-sm w-5">{index + 1}.</span>
                        <span className="text-[var(--color-text)] font-medium">{leader.name}</span>
                      </div>
                      <span className="text-[#f39c12] font-bold">{leader.streak} wins</span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">No streaks this month</p>
              )}
            </div>

            {/* Top Rivalry */}
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
                <Swords className="w-5 h-5 text-[#ff4757]" />
                Top Rivalry
              </h3>
              {topRivalry && topRivalry.count >= 2 ? (
                <div className="text-center">
                  <div className="text-lg mb-2">
                    <span className="text-[var(--color-text)] font-bold">{topRivalry.player1}</span>
                    <span className="text-[var(--color-text-dim)] mx-2">vs</span>
                    <span className="text-[var(--color-text)] font-bold">{topRivalry.player2}</span>
                  </div>
                  <div className="text-sm text-[var(--color-text-dim)] mb-2">
                    Faced each other <span className="text-[var(--color-primary)] font-bold">{topRivalry.count}</span> times
                  </div>
                  <div className="text-sm">
                    <span className="text-[var(--color-text)]">{topRivalry.player1}&apos;s teams won </span>
                    <span className="text-[#27ae60] font-bold">{topRivalry.player1Wins}</span>
                    <span className="text-[var(--color-text)]">, {topRivalry.player2}&apos;s won </span>
                    <span className="text-[#27ae60] font-bold">{topRivalry.count - topRivalry.player1Wins}</span>
                  </div>
                </div>
              ) : (
                <p className="text-[var(--color-text-dim)] text-sm text-center italic">No recurring rivalries yet</p>
              )}
            </div>
          </div>
        </>
      )}

      <div className="mt-12">
        <TierChangelog year={selectedYear} month={selectedMonth} isAdmin={isAdmin} />
      </div>
    </div>
  )
}
