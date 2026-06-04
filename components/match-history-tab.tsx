"use client"

import { useEffect, useState } from "react"
import { getMatches, deleteMatch, updateMatchDate, getMatchStats } from "@/app/admin/actions"
import { createClient } from "@/lib/supabase/client"
import { Trophy, Clock, Trash2, Pencil, Check, X, BarChart3, ChevronDown, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

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
  stats_csv_uploaded_at?: string | null
}

// One per-player scoreboard row (from getMatchStats; players(name) is joined).
interface ScoreboardRow {
  player_id: string
  team: "Red" | "Blue"
  played_partial: boolean
  score: number
  captures: number
  returns: number
  base_cleaner: number
  dbs_kills: number
  kills: number
  deaths: number
  dfa_kills: number
  flag_hold_ms: number
  time_played: number | null
  players: { name: string } | { name: string }[] | null
}

// Whole-seconds duration as m:ss.
function formatMmss(totalSeconds: number): string {
  const s = Math.max(0, Math.round(totalSeconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

function scoreboardName(row: ScoreboardRow): string {
  const p = row.players
  if (!p) return "Unknown"
  return Array.isArray(p) ? p[0]?.name ?? "Unknown" : p.name
}

function TeamScoreboard({ rows, team }: { rows: ScoreboardRow[]; team: "Red" | "Blue" }) {
  const color = team === "Red" ? "#ff4757" : "#00d4ff"
  // Sorted by Score desc — mirrors the in-game scoreboard ranking.
  const sorted = [...rows].sort((a, b) => b.score - a.score)
  const cols = ["Score", "Caps", "Ret", "BC", "DBS", "K", "D", "DFA", "Hold"]

  if (sorted.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-[var(--color-border)] text-[var(--color-text-dim)]">
            <th className="px-3 py-2 text-left font-bold" style={{ color }}>
              {team.toUpperCase()} TEAM
            </th>
            {cols.map((c) => (
              <th key={c} className="px-2 py-2 text-right font-medium tabular-nums">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.player_id} className="border-t border-[var(--color-border)]/40">
              <td className="px-3 py-1.5 text-left">
                <span className="text-[var(--color-text)]">{scoreboardName(r)}</span>
                {r.played_partial && (
                  <span className="ml-1.5 rounded bg-amber-500/15 px-1 py-0.5 text-[10px] font-bold text-amber-400">
                    PARTIAL
                  </span>
                )}
              </td>
              <td className="px-2 py-1.5 text-right font-bold tabular-nums" style={{ color }}>
                {r.score}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text)]">{r.captures}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text)]">{r.returns}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text)]">{r.base_cleaner}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text)]">{r.dbs_kills}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text)]">{r.kills}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text)]">{r.deaths}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text)]">{r.dfa_kills}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text)]">
                {formatMmss((r.flag_hold_ms || 0) / 1000)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function MatchScoreboard({ rows }: { rows: ScoreboardRow[] }) {
  const red = rows.filter((r) => r.team === "Red")
  const blue = rows.filter((r) => r.team === "Blue")
  // No match-length field exists — the longest player time ≈ full match duration.
  // time_played (TIME-SUM) is already in minutes.
  const durationMinutes = rows.reduce((max, r) => Math.max(max, r.time_played ?? 0), 0)

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-1.5 text-xs text-[var(--color-text-dim)]">
        <Clock className="h-3 w-3" />
        Match duration: <span className="font-medium text-[var(--color-text)]">{Math.round(durationMinutes)}m</span>
      </div>
      <TeamScoreboard rows={red} team="Red" />
      <TeamScoreboard rows={blue} team="Blue" />
    </div>
  )
}

export function MatchHistoryTab() {
  const [matches, setMatches] = useState<Match[]>([])
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [editDateId, setEditDateId] = useState<string | null>(null)
  const [editDateValue, setEditDateValue] = useState<string>("")
  const [isSavingDate, setIsSavingDate] = useState(false)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [statsCache, setStatsCache] = useState<Record<string, ScoreboardRow[]>>({})
  const [statsLoadingId, setStatsLoadingId] = useState<string | null>(null)
  const [statsErrors, setStatsErrors] = useState<Record<string, string>>({})

  useEffect(() => {
    // Check if user is authenticated (admin)
    const checkAdmin = async () => {
      const supabase = createClient()
      const { data: { user } } = await supabase.auth.getUser()
      setIsAdmin(!!user)
    }
    checkAdmin()

    getMatches().then((result) => {
      if (result.success) {
        setMatches(result.data as Match[])
      }
      setLoading(false)
    })
  }, [])

  const toDatetimeLocal = (isoString: string) => {
    const d = new Date(isoString)
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  }

  const openEditDate = (match: Match) => {
    setEditDateId(match.id)
    setEditDateValue(toDatetimeLocal(match.created_at))
  }

  const handleSaveDate = async (matchId: string) => {
    if (!editDateValue) return
    setIsSavingDate(true)
    const result = await updateMatchDate(matchId, new Date(editDateValue).toISOString())
    if (result.success) {
      setMatches(
        matches
          .map((m) => m.id === matchId ? { ...m, created_at: new Date(editDateValue).toISOString() } : m)
          .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
      )
    }
    setEditDateId(null)
    setIsSavingDate(false)
  }

  // Lazy-load a match's scoreboard the first time it's expanded; cache thereafter.
  const toggleExpand = async (matchId: string) => {
    if (expandedId === matchId) {
      setExpandedId(null)
      return
    }
    setExpandedId(matchId)
    if (statsCache[matchId]) return
    setStatsLoadingId(matchId)
    setStatsErrors((prev) => {
      const { [matchId]: _removed, ...rest } = prev
      return rest
    })
    const result = await getMatchStats(matchId)
    if (result.success) {
      setStatsCache((prev) => ({ ...prev, [matchId]: result.data as ScoreboardRow[] }))
    } else {
      setStatsErrors((prev) => ({ ...prev, [matchId]: result.error || "Failed to load stats" }))
    }
    setStatsLoadingId(null)
  }

  const handleDelete = async (matchId: string) => {
    setIsDeleting(true)
    const result = await deleteMatch(matchId)
    if (result.success) {
      setMatches(matches.filter((m) => m.id !== matchId))
    }
    setDeleteConfirm(null)
    setIsDeleting(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"></div>
      </div>
    )
  }

  if (matches.length === 0) {
    return (
      <div className="text-center py-12 text-[var(--color-text-dim)]">
        <Trophy className="w-12 h-12 mx-auto mb-4 opacity-50" />
        <p>No matches have been logged yet.</p>
        <p className="text-sm mt-2">Balance teams and log your first match result!</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-lg font-bold text-[var(--color-primary)] flex items-center gap-2">
          <Trophy className="w-5 h-5" />
          Match History
        </h3>
        <span className="text-sm text-[var(--color-text-dim)]">{matches.length} match{matches.length !== 1 ? "es" : ""}</span>
      </div>

      <div className="space-y-3">
        {matches.map((match) => {
          const redWon = match.red_score > match.blue_score
          const blueWon = match.blue_score > match.red_score
          const date = new Date(match.created_at)

          return (
            <div
              key={match.id}
              className="bg-[var(--color-surface)]/60 backdrop-blur-md border border-[var(--color-border)] rounded-lg p-4 group relative"
            >
              {/* Delete Confirmation Dialog - only for admins */}
              {isAdmin && deleteConfirm === match.id && (
                <div className="absolute inset-0 bg-[var(--color-surface)]/95 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                  <div className="text-center p-4">
                    <p className="text-[var(--color-text)] mb-4">Delete this match? This cannot be undone.</p>
                    <div className="flex gap-2 justify-center">
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => handleDelete(match.id)}
                        disabled={isDeleting}
                      >
                        {isDeleting ? "Deleting..." : "Confirm"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setDeleteConfirm(null)}
                        disabled={isDeleting}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              {/* Edit Date Dialog - only for admins */}
              {isAdmin && editDateId === match.id && (
                <div className="absolute inset-0 bg-[var(--color-surface)]/95 backdrop-blur-sm rounded-lg flex items-center justify-center z-10">
                  <div className="text-center p-4 w-full max-w-xs">
                    <p className="text-[var(--color-text)] font-medium mb-3">Edit match date &amp; time</p>
                    <Input
                      type="datetime-local"
                      value={editDateValue}
                      onChange={(e) => setEditDateValue(e.target.value)}
                      className="mb-3 w-full"
                    />
                    <div className="flex gap-2 justify-center">
                      <Button
                        size="sm"
                        onClick={() => handleSaveDate(match.id)}
                        disabled={isSavingDate}
                        className="flex items-center gap-1"
                      >
                        <Check className="w-3 h-3" />
                        {isSavingDate ? "Saving..." : "Save"}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setEditDateId(null)}
                        disabled={isSavingDate}
                        className="flex items-center gap-1"
                      >
                        <X className="w-3 h-3" />
                        Cancel
                      </Button>
                    </div>
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`px-2 py-0.5 rounded text-xs font-bold ${
                    match.match_type === "algorithm" 
                      ? "bg-[var(--color-primary)]/20 text-[var(--color-primary)]" 
                      : "bg-[var(--color-text-dim)]/20 text-[var(--color-text-dim)]"
                  }`}>
                    {match.match_type === "algorithm" ? "ALGORITHM" : "MANUAL"}
                  </span>
                  {match.red_tiers && match.blue_tiers && (() => {
                    const redTotal = match.red_tiers.reduce((a, b) => a + b, 0)
                    const blueTotal = match.blue_tiers.reduce((a, b) => a + b, 0)
                    const tierGap = Math.abs(redTotal - blueTotal)
                    const avgStrength = (redTotal + blueTotal) / 2
                    const pct = avgStrength / 60

                    const strengthColor =
                      avgStrength >= 45 ? { bg: "bg-green-500/20", text: "text-green-600" } :
                      avgStrength >= 30 ? { bg: "bg-[#e67e22]/20", text: "text-[#e67e22]" } :
                      { bg: "bg-[var(--color-text-dim)]/15", text: "text-[var(--color-text-dim)]" }

                    const strengthLabel =
                      avgStrength >= 45 ? "High" :
                      avgStrength >= 30 ? "Mid" :
                      "Low"

                    return (
                      <>
                        <span
                          className={`px-2 py-0.5 rounded-full text-xs font-bold ${strengthColor.bg} ${strengthColor.text}`}
                          title={`Avg team strength: ${avgStrength.toFixed(1)} / 60`}
                        >
                          {strengthLabel} {avgStrength.toFixed(0)}/60
                        </span>
                        <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-[var(--color-text-dim)]/20 text-[var(--color-text-dim)]">
                          Tier gap: {tierGap}
                        </span>
                      </>
                    )
                  })()}
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center gap-1 text-xs text-[var(--color-text-dim)]">
                    <Clock className="w-3 h-3" />
                    {date.toLocaleDateString()} {date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </div>
                  {isAdmin && (
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => openEditDate(match)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[var(--color-primary)]/20 text-[var(--color-text-dim)] hover:text-[var(--color-primary)]"
                        title="Edit match date"
                      >
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => setDeleteConfirm(match.id)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-[#ff4757]/20 text-[var(--color-text-dim)] hover:text-[#ff4757]"
                        title="Delete match"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className={`p-3 rounded-lg ${redWon ? "bg-[#ff4757]/20 border border-[#ff4757]/50" : "bg-[#ff4757]/10"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[#ff4757] font-bold text-sm">RED TEAM</span>
                    <span className={`text-xl font-bold ${redWon ? "text-[#ff4757]" : "text-[var(--color-text-dim)]"}`}>
                      {match.red_score}
                      {redWon && <span className="ml-1 text-xs">WIN</span>}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {match.red_team.map((player, index) => (
                      <span key={player} className="text-xs text-[var(--color-text)] bg-[var(--color-surface)] px-2 py-0.5 rounded flex items-center gap-1">
                        {player}
                        {match.red_tiers?.[index] != null && (
                          <span className="text-[10px] font-bold text-[var(--color-primary)] bg-[var(--color-primary)]/20 px-1 rounded">
                            {match.red_tiers[index]}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>

                <div className={`p-3 rounded-lg ${blueWon ? "bg-[#00d4ff]/20 border border-[#00d4ff]/50" : "bg-[#00d4ff]/10"}`}>
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[#00d4ff] font-bold text-sm">BLUE TEAM</span>
                    <span className={`text-xl font-bold ${blueWon ? "text-[#00d4ff]" : "text-[var(--color-text-dim)]"}`}>
                      {match.blue_score}
                      {blueWon && <span className="ml-1 text-xs">WIN</span>}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {match.blue_team.map((player, index) => (
                      <span key={player} className="text-xs text-[var(--color-text)] bg-[var(--color-surface)] px-2 py-0.5 rounded flex items-center gap-1">
                        {player}
                        {match.blue_tiers?.[index] != null && (
                          <span className="text-[10px] font-bold text-[var(--color-primary)] bg-[var(--color-primary)]/20 px-1 rounded">
                            {match.blue_tiers[index]}
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </div>

              {match.notes && (
                <p className="mt-3 text-sm text-[var(--color-text-dim)] italic border-t border-[var(--color-border)] pt-3">
                  {match.notes}
                </p>
              )}

              {/* Scoreboard — only for matches uploaded with a stats CSV */}
              {match.stats_csv_uploaded_at && (
                <div className="mt-3 border-t border-[var(--color-border)] pt-3">
                  <button
                    onClick={() => toggleExpand(match.id)}
                    className="flex items-center gap-1.5 text-sm font-medium text-[var(--color-primary)] hover:opacity-80"
                  >
                    <BarChart3 className="h-4 w-4" />
                    {expandedId === match.id ? "Hide scoreboard" : "View scoreboard"}
                    <ChevronDown
                      className={`h-4 w-4 transition-transform ${expandedId === match.id ? "rotate-180" : ""}`}
                    />
                  </button>

                  {expandedId === match.id && (
                    <div className="mt-3">
                      {statsLoadingId === match.id ? (
                        <div className="flex items-center gap-2 py-4 text-sm text-[var(--color-text-dim)]">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading scoreboard…
                        </div>
                      ) : statsErrors[match.id] ? (
                        <p className="py-2 text-sm text-[#ff4757]">{statsErrors[match.id]}</p>
                      ) : statsCache[match.id] && statsCache[match.id].length > 0 ? (
                        <MatchScoreboard rows={statsCache[match.id]} />
                      ) : (
                        <p className="py-2 text-sm text-[var(--color-text-dim)] italic">
                          No per-player stats recorded for this match.
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
