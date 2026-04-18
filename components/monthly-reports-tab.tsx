"use client"

import { useEffect, useState, useMemo } from "react"
import { getMatchesByMonth } from "@/app/admin/actions"
import { Trophy, ChevronLeft, ChevronRight, Users, TrendingUp, Minus } from "lucide-react"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  Cell,
} from "recharts"

interface Match {
  id: string
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
  match_type: "algorithm" | "manual"
  balance_confidence: number | null
  notes: string | null
  created_at: string
}

function getBalanceConfidence(score: number): number {
  const k = 0.004
  const floor = 30
  const raw = floor + (100 - floor) * Math.exp(-k * score)
  return Math.round(raw)
}

function getConfidenceColor(confidence: number): string {
  if (confidence >= 80) return "#27ae60"
  if (confidence >= 60) return "#f39c12"
  return "#ff4757"
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]

export function MonthlyReportsTab() {
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth() + 1)
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    getMatchesByMonth(selectedYear, selectedMonth).then((result) => {
      if (result.success) {
        setMatches(result.data as Match[])
      }
      setLoading(false)
    })
  }, [selectedYear, selectedMonth])

  const canGoNext = useMemo(() => {
    const current = new Date(selectedYear, selectedMonth - 1)
    const today = new Date(now.getFullYear(), now.getMonth())
    return current < today
  }, [selectedYear, selectedMonth, now])

  const goToPreviousMonth = () => {
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

  // Compute all stats
  const stats = useMemo(() => {
    if (matches.length === 0) return null

    // Basic stats
    const totalMatches = matches.length
    const margins = matches.map(m => Math.abs(m.red_score - m.blue_score))
    const avgMargin = margins.reduce((a, b) => a + b, 0) / margins.length

    // Closest and biggest blowout
    let closestMatch = matches[0]
    let biggestBlowout = matches[0]
    let closestMargin = Math.abs(matches[0].red_score - matches[0].blue_score)
    let biggestMargin = closestMargin

    matches.forEach(m => {
      const margin = Math.abs(m.red_score - m.blue_score)
      if (margin < closestMargin) {
        closestMargin = margin
        closestMatch = m
      }
      if (margin > biggestMargin) {
        biggestMargin = margin
        biggestBlowout = m
      }
    })

    // Player stats
    const playerStats = new Map<string, { wins: number; losses: number; draws: number; matches: number }>()
    
    matches.forEach(match => {
      const redWon = match.red_score > match.blue_score
      const blueWon = match.blue_score > match.red_score
      const draw = match.red_score === match.blue_score

      match.red_team.forEach(player => {
        if (!playerStats.has(player)) {
          playerStats.set(player, { wins: 0, losses: 0, draws: 0, matches: 0 })
        }
        const s = playerStats.get(player)!
        s.matches++
        if (redWon) s.wins++
        else if (blueWon) s.losses++
        else s.draws++
      })

      match.blue_team.forEach(player => {
        if (!playerStats.has(player)) {
          playerStats.set(player, { wins: 0, losses: 0, draws: 0, matches: 0 })
        }
        const s = playerStats.get(player)!
        s.matches++
        if (blueWon) s.wins++
        else if (redWon) s.losses++
        else s.draws++
      })
    })

    // Convert to array and sort
    const playerLeaderboard = Array.from(playerStats.entries())
      .map(([name, stats]) => ({
        name,
        ...stats,
        winRate: stats.matches > 0 ? (stats.wins / stats.matches) * 100 : 0
      }))
      .sort((a, b) => {
        // Players with 2+ matches sorted by win rate
        if (a.matches >= 2 && b.matches >= 2) return b.winRate - a.winRate
        // Players with 2+ matches come before those with 1
        if (a.matches >= 2 && b.matches < 2) return -1
        if (a.matches < 2 && b.matches >= 2) return 1
        // Both have 1 match, sort by win rate
        return b.winRate - a.winRate
      })

    // Most played
    const mostPlayed = [...playerLeaderboard]
      .sort((a, b) => b.matches - a.matches)
      .slice(0, 10)

    // Red vs Blue wins
    let redWins = 0
    let blueWins = 0
    let draws = 0
    matches.forEach(m => {
      if (m.red_score > m.blue_score) redWins++
      else if (m.blue_score > m.red_score) blueWins++
      else draws++
    })

    // Algorithm vs Manual
    const algorithmMatches = matches.filter(m => m.match_type === "algorithm")
    const manualMatches = matches.filter(m => m.match_type === "manual")

    const algorithmStats = algorithmMatches.length > 0 ? {
      count: algorithmMatches.length,
      avgMargin: algorithmMatches.reduce((acc, m) => acc + Math.abs(m.red_score - m.blue_score), 0) / algorithmMatches.length,
      avgConfidence: algorithmMatches.filter(m => m.balance_confidence !== null && m.balance_confidence !== 0)
        .reduce((acc, m) => acc + getBalanceConfidence(m.balance_confidence!), 0) / 
        (algorithmMatches.filter(m => m.balance_confidence !== null && m.balance_confidence !== 0).length || 1)
    } : null

    const manualStats = manualMatches.length > 0 ? {
      count: manualMatches.length,
      avgMargin: manualMatches.reduce((acc, m) => acc + Math.abs(m.red_score - m.blue_score), 0) / manualMatches.length,
      avgConfidence: manualMatches.filter(m => m.balance_confidence !== null && m.balance_confidence !== 0)
        .reduce((acc, m) => acc + getBalanceConfidence(m.balance_confidence!), 0) / 
        (manualMatches.filter(m => m.balance_confidence !== null && m.balance_confidence !== 0).length || 1)
    } : null

    // Confidence trend data
    const matchesWithConfidence = matches.filter(m => m.balance_confidence !== null && m.balance_confidence !== 0)
    const confidenceTrend = matchesWithConfidence.map((m, i) => ({
      index: i + 1,
      confidence: getBalanceConfidence(m.balance_confidence!),
      date: new Date(m.created_at).toLocaleDateString()
    }))

    const avgConfidence = confidenceTrend.length > 0
      ? confidenceTrend.reduce((acc, m) => acc + m.confidence, 0) / confidenceTrend.length
      : 0

    return {
      totalMatches,
      avgMargin,
      closestMatch,
      closestMargin,
      biggestBlowout,
      biggestMargin,
      playerLeaderboard,
      mostPlayed,
      redWins,
      blueWins,
      draws,
      algorithmStats,
      manualStats,
      confidenceTrend,
      avgConfidence
    }
  }, [matches])

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
      <div className="flex items-center justify-center gap-4 mb-6">
        <button
          onClick={goToPreviousMonth}
          className="p-2 rounded-lg bg-[var(--color-surface)] hover:bg-[#2a3441] transition-colors text-[var(--color-primary)]"
        >
          <ChevronLeft className="w-5 h-5" />
        </button>
        <h2 className="text-xl font-bold text-[var(--color-primary)] min-w-[200px] text-center">
          {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
        </h2>
        <button
          onClick={goToNextMonth}
          disabled={!canGoNext}
          className={`p-2 rounded-lg transition-colors ${
            canGoNext 
              ? "bg-[var(--color-surface)] hover:bg-[#2a3441] text-[var(--color-primary)]" 
              : "bg-[var(--color-surface)]/50 text-[var(--color-text-dim)]/50 cursor-not-allowed"
          }`}
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {matches.length === 0 ? (
        <div className="text-center py-12 text-[var(--color-text-dim)]">
          <Trophy className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No matches logged in {MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
        </div>
      ) : stats && (
        <>
          {/* Overview Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-[var(--color-primary)]">{stats.totalMatches}</div>
              <div className="text-sm text-[var(--color-text-dim)]">Total Matches</div>
            </div>
            <div className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4 text-center">
              <div className="text-3xl font-bold text-[var(--color-primary)]">{stats.avgMargin.toFixed(1)}</div>
              <div className="text-sm text-[var(--color-text-dim)]">Avg Score Margin</div>
            </div>
            <div className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4">
              <div className="text-sm text-[var(--color-text-dim)] mb-1">Closest Match</div>
              <div className="text-lg font-bold text-[#27ae60]">
                {stats.closestMatch.red_score}-{stats.closestMatch.blue_score}
              </div>
              <div className="text-xs text-[var(--color-text-dim)] truncate">
                {stats.closestMatch.red_team.slice(0, 2).join(", ")}... vs {stats.closestMatch.blue_team.slice(0, 2).join(", ")}...
              </div>
            </div>
            <div className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4">
              <div className="text-sm text-[var(--color-text-dim)] mb-1">Biggest Blowout</div>
              <div className="text-lg font-bold text-[#ff4757]">
                {stats.biggestBlowout.red_score}-{stats.biggestBlowout.blue_score}
              </div>
              <div className="text-xs text-[var(--color-text-dim)] truncate">
                {stats.biggestBlowout.red_team.slice(0, 2).join(", ")}... vs {stats.biggestBlowout.blue_team.slice(0, 2).join(", ")}...
              </div>
            </div>
          </div>

          {/* Player Win Rate Leaderboard */}
          <div className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
              <Trophy className="w-5 h-5" />
              Player Win Rate Leaderboard
            </h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-[var(--color-text-dim)] border-b border-[var(--color-border)]">
                    <th className="text-left py-2 px-2">#</th>
                    <th className="text-left py-2 px-2">Player</th>
                    <th className="text-center py-2 px-2">Played</th>
                    <th className="text-center py-2 px-2">W</th>
                    <th className="text-center py-2 px-2">L</th>
                    <th className="text-right py-2 px-2">Win %</th>
                  </tr>
                </thead>
                <tbody>
                  {stats.playerLeaderboard.map((player, index) => {
                    const isRanked = player.matches >= 2
                    const rankNum = isRanked ? stats.playerLeaderboard.filter((p, i) => i < index && p.matches >= 2).length + 1 : null
                    const isTop3 = rankNum !== null && rankNum <= 3
                    const rankedCount = stats.playerLeaderboard.filter(p => p.matches >= 2).length
                    const isBottom3 = rankNum !== null && rankNum > rankedCount - 3

                    return (
                      <tr 
                        key={player.name} 
                        className={`border-b border-[var(--color-border)]/50 ${
                          isTop3 ? "bg-[#f39c12]/10" : isBottom3 ? "bg-[#ff4757]/10" : ""
                        }`}
                      >
                        <td className="py-2 px-2 text-[var(--color-text-dim)]">
                          {isRanked ? (
                            <span className={
                              rankNum === 1 ? "text-[#ffd700] font-bold" :
                              rankNum === 2 ? "text-[#c0c0c0] font-bold" :
                              rankNum === 3 ? "text-[#cd7f32] font-bold" : ""
                            }>
                              {rankNum}
                            </span>
                          ) : "-"}
                        </td>
                        <td className="py-2 px-2 text-[var(--color-text)]">{player.name}</td>
                        <td className="py-2 px-2 text-center text-[var(--color-text-dim)]">{player.matches}</td>
                        <td className="py-2 px-2 text-center text-[#27ae60]">{player.wins}</td>
                        <td className="py-2 px-2 text-center text-[#ff4757]">{player.losses}</td>
                        <td className="py-2 px-2 text-right font-mono">
                          <span className={isRanked ? "text-white font-bold" : "text-[var(--color-text-dim)]"}>
                            {player.winRate.toFixed(0)}%
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Most Played Players */}
          <div className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4">
            <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4 flex items-center gap-2">
              <Users className="w-5 h-5" />
              Most Active Players
            </h3>
            <div className="space-y-2">
              {stats.mostPlayed.map((player, index) => (
                <div key={player.name} className="flex items-center gap-3">
                  <span className="text-[var(--color-text-dim)] w-6 text-right">{index + 1}.</span>
                  <span className="text-[var(--color-text)] flex-1">{player.name}</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-[#0b0c10] rounded-full overflow-hidden">
                      <div 
                        className="h-full bg-[var(--color-primary)]" 
                        style={{ width: `${(player.matches / stats.mostPlayed[0].matches) * 100}%` }}
                      />
                    </div>
                    <span className="text-[var(--color-primary)] font-mono w-8 text-right">{player.matches}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Red vs Blue + Algorithm vs Manual */}
          <div className="grid md:grid-cols-2 gap-4">
            {/* Red vs Blue */}
            <div className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4">Red vs Blue Wins</h3>
              <div className="space-y-3">
                <div className="h-6 rounded-full overflow-hidden flex bg-[#0b0c10]">
                  <div 
                    className="h-full bg-[#ff4757] flex items-center justify-center text-xs font-bold"
                    style={{ width: `${(stats.redWins / (stats.redWins + stats.blueWins + stats.draws)) * 100}%` }}
                  >
                    {stats.redWins > 0 && stats.redWins}
                  </div>
                  {stats.draws > 0 && (
                    <div 
                      className="h-full bg-[var(--color-text-dim)] flex items-center justify-center text-xs font-bold"
                      style={{ width: `${(stats.draws / (stats.redWins + stats.blueWins + stats.draws)) * 100}%` }}
                    >
                      {stats.draws}
                    </div>
                  )}
                  <div 
                    className="h-full bg-[#00d4ff] flex items-center justify-center text-xs font-bold"
                    style={{ width: `${(stats.blueWins / (stats.redWins + stats.blueWins + stats.draws)) * 100}%` }}
                  >
                    {stats.blueWins > 0 && stats.blueWins}
                  </div>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-[#ff4757]">
                    Red: {stats.redWins} ({((stats.redWins / (stats.redWins + stats.blueWins + stats.draws)) * 100).toFixed(0)}%)
                  </span>
                  {stats.draws > 0 && (
                    <span className="text-[var(--color-text-dim)]">Draws: {stats.draws}</span>
                  )}
                  <span className="text-[#00d4ff]">
                    Blue: {stats.blueWins} ({((stats.blueWins / (stats.redWins + stats.blueWins + stats.draws)) * 100).toFixed(0)}%)
                  </span>
                </div>
              </div>
            </div>

            {/* Algorithm vs Manual */}
            <div className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-4">Algorithm vs Manual</h3>
              <div className="grid grid-cols-2 gap-4">
                <div className={`p-3 rounded-lg ${stats.algorithmStats ? "bg-[var(--color-primary)]/10 border border-[var(--color-primary)]/30" : "bg-[var(--color-surface)]"}`}>
                  <div className="text-sm text-[var(--color-primary)] font-bold mb-2">ALGORITHM</div>
                  {stats.algorithmStats ? (
                    <>
                      <div className="text-2xl font-bold text-white">{stats.algorithmStats.count}</div>
                      <div className="text-xs text-[var(--color-text-dim)]">matches</div>
                      <div className="mt-2 text-sm">
                        <span className="text-[var(--color-text-dim)]">Avg margin: </span>
                        <span className="text-white">{stats.algorithmStats.avgMargin.toFixed(1)}</span>
                      </div>
                      <div className="text-sm">
                        <span className="text-[var(--color-text-dim)]">Avg confidence: </span>
                        <span className="text-white">{stats.algorithmStats.avgConfidence.toFixed(0)}%</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-[var(--color-text-dim)] text-sm">No algorithm matches</div>
                  )}
                </div>
                <div className={`p-3 rounded-lg ${stats.manualStats ? "bg-[var(--color-text-dim)]/10 border border-[var(--color-text-dim)]/30" : "bg-[var(--color-surface)]"}`}>
                  <div className="text-sm text-[var(--color-text-dim)] font-bold mb-2">MANUAL</div>
                  {stats.manualStats ? (
                    <>
                      <div className="text-2xl font-bold text-white">{stats.manualStats.count}</div>
                      <div className="text-xs text-[var(--color-text-dim)]">matches</div>
                      <div className="mt-2 text-sm">
                        <span className="text-[var(--color-text-dim)]">Avg margin: </span>
                        <span className="text-white">{stats.manualStats.avgMargin.toFixed(1)}</span>
                      </div>
                      <div className="text-sm">
                        <span className="text-[var(--color-text-dim)]">Avg confidence: </span>
                        <span className="text-white">{stats.manualStats.avgConfidence.toFixed(0)}%</span>
                      </div>
                    </>
                  ) : (
                    <div className="text-[var(--color-text-dim)] text-sm">No manual matches</div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Balance Confidence Trend */}
          {stats.confidenceTrend.length > 0 && (
            <div className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4">
              <h3 className="text-lg font-bold text-[var(--color-primary)] mb-2 flex items-center gap-2">
                <TrendingUp className="w-5 h-5" />
                Balance Confidence Trend
              </h3>
              <div className="text-sm text-[var(--color-text-dim)] mb-4">
                Average confidence: <span className="text-white font-bold">{stats.avgConfidence.toFixed(0)}%</span>
              </div>
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={stats.confidenceTrend}>
                    <XAxis 
                      dataKey="index" 
                      stroke="var(--color-text-dim)" 
                      fontSize={12}
                      tickLine={false}
                    />
                    <YAxis 
                      domain={[0, 100]} 
                      stroke="var(--color-text-dim)" 
                      fontSize={12}
                      tickLine={false}
                      width={35}
                    />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "var(--color-surface)",
                        border: "1px solid var(--color-border)",
                        borderRadius: "8px",
                      }}
                      labelStyle={{ color: "var(--color-text-dim)" }}
                      formatter={(value: number) => [`${value}%`, "Confidence"]}
                      labelFormatter={(label) => `Match ${label}`}
                    />
                    <Line
                      type="monotone"
                      dataKey="confidence"
                      stroke="var(--color-primary)"
                      strokeWidth={2}
                      dot={(props) => {
                        const { cx, cy, payload } = props
                        return (
                          <circle
                            cx={cx}
                            cy={cy}
                            r={4}
                            fill={getConfidenceColor(payload.confidence)}
                            stroke="none"
                          />
                        )
                      }}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
