"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { ArrowUp, ArrowDown, RefreshCw, Trophy, TrendingUp, TrendingDown, HelpCircle } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { TS, type Rating, rateMatch, conservativeRating } from "@/lib/trueskill"

// Hidden, admin-only TrueSkill board. Like the ELO board, it's a running rating replayed
// in chronological order on every load — nothing is persisted, it's derived fresh.
//
// Each player is a Gaussian N(μ, σ): μ is estimated skill, σ the uncertainty. The board
// ranks on the conservative estimate μ − 3σ, so a long, consistent record outranks a
// small-sample player with the same μ. Two scopes, matching the toggle:
//   • All-time — replays every match ever; μ is SEEDED from tier so day-one order mirrors
//     tier order, then results pull it away.
//   • Monthly  — replays only the selected month's matches, μ seeded FLAT (everyone at the
//     default 25) so the board is pure this-month form. Resets on the 1st, like the W/L
//     stats and the monthly ELO board.

// All-time tier seed for μ: centre the tiers on the default 25 so a Tier-10 player starts
// above a Tier-1 player but everyone sits on the standard TrueSkill scale. σ always starts
// at the full default so early results can still move the rating freely.
const MU_TIER_STEP = 1.5
const seedMuFromTier = (tier: number | null | undefined) => TS.MU + ((tier ?? 5) - 5.5) * MU_TIER_STEP

// Minimum all-time matches before a player is rated.
const MIN_MATCHES_THRESHOLD = 5
// Monthly qualifier — same 30% rule used across the rest of the Reports tab.
const MONTHLY_MIN_FRACTION = 0.3

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

interface TrueSkillLeaderboardProps {
  year: number
  month: number
}

interface Match {
  id: string
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
  created_at: string
}

interface BoardRow {
  name: string
  tier: number
  rating: number // conservative μ − 3σ, what we sort on
  mu: number
  sigma: number
  matches: number
  wins: number
  losses: number
  draws: number
  kills: number
  deaths: number
}

interface TsSuggestion {
  playerName: string
  currentTier: number
  suggestedTier: number
  impliedTier: number
  rating: number
  matches: number
  isPromotion: boolean
}

function kdRatio(kills: number, deaths: number): string {
  if (kills === 0 && deaths === 0) return "—"
  if (deaths === 0) return "∞"
  return (kills / deaths).toFixed(2)
}

export function TrueSkillLeaderboard({ year, month }: TrueSkillLeaderboardProps) {
  const [scope, setScope] = useState<"alltime" | "month">("alltime")
  const [allTimeBoard, setAllTimeBoard] = useState<BoardRow[]>([])
  const [monthBoard, setMonthBoard] = useState<BoardRow[]>([])
  const [monthMinMatches, setMonthMinMatches] = useState(0)
  const [monthMatchCount, setMonthMatchCount] = useState(0)
  const [allSuggestions, setAllSuggestions] = useState<TsSuggestion[]>([])
  const [monthSuggestions, setMonthSuggestions] = useState<TsSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const computeTrueSkill = async () => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      const { data: matches, error: matchesError } = await supabase
        .from("matches")
        .select("id, red_team, blue_team, red_score, blue_score, created_at")
        .order("created_at", { ascending: true })
      if (matchesError) {
        setError(matchesError.message)
        setLoading(false)
        return
      }

      const { data: players, error: playersError } = await supabase
        .from("players")
        .select("id, name, tier_value")
      if (playersError) {
        setError(playersError.message)
        setLoading(false)
        return
      }

      const { data: stats, error: statsError } = await supabase
        .from("match_stats")
        .select("player_id, match_id, kills, deaths")
      if (statsError) {
        setError(statsError.message)
        setLoading(false)
        return
      }

      const playerTierMap = new Map<string, number>()
      const playerIdToName = new Map<string, string>()
      for (const player of players || []) {
        playerTierMap.set(player.name, player.tier_value)
        playerIdToName.set(player.id, player.name)
      }

      // Two independent ratings: all-time μ is seeded from current tier; monthly μ starts
      // flat at the default. σ always starts at the default. Non-roster players (who left)
      // are seeded lazily at the neutral default so their old teams still update.
      const NEUTRAL: Rating = { mu: TS.MU, sigma: TS.SIGMA }
      const seeded = (seedMu: (name: string) => number) => {
        const m = new Map<string, Rating>()
        for (const name of playerTierMap.keys()) m.set(name, { mu: seedMu(name), sigma: TS.SIGMA })
        return m
      }
      const tsAll = seeded((name) => seedMuFromTier(playerTierMap.get(name)))
      const tsMonth = seeded(() => TS.MU)

      const applyMatch = (map: Map<string, Rating>, match: Match) => {
        const get = (name: string): Rating => {
          if (!map.has(name)) map.set(name, { ...NEUTRAL })
          return map.get(name)!
        }
        const t1 = match.red_team.map(get)
        const t2 = match.blue_team.map(get)
        const score1 = match.red_score > match.blue_score ? 1 : match.red_score < match.blue_score ? 0 : 0.5
        const { team1, team2 } = rateMatch(t1, t2, score1)
        match.red_team.forEach((name, i) => map.set(name, team1[i]))
        match.blue_team.forEach((name, i) => map.set(name, team2[i]))
      }

      // W/L/D records, all-time and month-only.
      type Rec = { matches: number; wins: number; losses: number; draws: number }
      const allRecord = new Map<string, Rec>()
      const monthRecord = new Map<string, Rec>()
      const bump = (map: Map<string, Rec>, name: string, result: "W" | "L" | "D") => {
        if (!map.has(name)) map.set(name, { matches: 0, wins: 0, losses: 0, draws: 0 })
        const r = map.get(name)!
        r.matches++
        if (result === "W") r.wins++
        else if (result === "L") r.losses++
        else r.draws++
      }

      const isInSelectedMonth = (iso: string) => {
        const d = new Date(iso)
        return d.getFullYear() === year && d.getMonth() === month - 1
      }

      const monthMatchIds = new Set<string>()
      const monthMatches: Match[] = []

      for (const match of (matches || []) as Match[]) {
        if (!match.red_team?.length || !match.blue_team?.length) continue
        const inMonth = isInSelectedMonth(match.created_at)

        const redScore = match.red_score > match.blue_score ? 1 : match.red_score < match.blue_score ? 0 : 0.5
        const redResult: "W" | "L" | "D" = redScore === 1 ? "W" : redScore === 0 ? "L" : "D"
        const blueResult: "W" | "L" | "D" = redScore === 1 ? "L" : redScore === 0 ? "W" : "D"

        for (const name of match.red_team) {
          bump(allRecord, name, redResult)
          if (inMonth) bump(monthRecord, name, redResult)
        }
        for (const name of match.blue_team) {
          bump(allRecord, name, blueResult)
          if (inMonth) bump(monthRecord, name, blueResult)
        }

        applyMatch(tsAll, match)
        if (inMonth) {
          monthMatchIds.add(match.id)
          monthMatches.push(match)
        }
      }

      // Second pass: the monthly rating only sees the selected month's matches.
      for (const match of monthMatches) applyMatch(tsMonth, match)

      const monthCount = monthMatches.length

      // Aggregate kills/deaths per name, all-time and month-only.
      const allKd = new Map<string, { kills: number; deaths: number }>()
      const monthKd = new Map<string, { kills: number; deaths: number }>()
      for (const row of stats || []) {
        const name = playerIdToName.get(row.player_id)
        if (!name) continue
        if (!allKd.has(name)) allKd.set(name, { kills: 0, deaths: 0 })
        const a = allKd.get(name)!
        a.kills += row.kills || 0
        a.deaths += row.deaths || 0
        if (monthMatchIds.has(row.match_id)) {
          if (!monthKd.has(name)) monthKd.set(name, { kills: 0, deaths: 0 })
          const m = monthKd.get(name)!
          m.kills += row.kills || 0
          m.deaths += row.deaths || 0
        }
      }

      const buildBoard = (
        recMap: Map<string, Rec>,
        kdMap: Map<string, { kills: number; deaths: number }>,
        tsMap: Map<string, Rating>,
        seedMu: (name: string) => number,
        minMatches: number,
      ): BoardRow[] => {
        const rows: BoardRow[] = []
        for (const [name, tier] of playerTierMap.entries()) {
          const r = recMap.get(name)
          if (!r || r.matches < minMatches || r.matches === 0) continue
          const kd = kdMap.get(name) || { kills: 0, deaths: 0 }
          const rating = tsMap.get(name) ?? { mu: seedMu(name), sigma: TS.SIGMA }
          rows.push({
            name,
            tier,
            rating: Math.round(conservativeRating(rating) * 10) / 10,
            mu: Math.round(rating.mu * 10) / 10,
            sigma: Math.round(rating.sigma * 10) / 10,
            matches: r.matches,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws,
            kills: kd.kills,
            deaths: kd.deaths,
          })
        }
        rows.sort((a, b) => b.rating - a.rating)
        return rows
      }

      const allBoard = buildBoard(
        allRecord,
        allKd,
        tsAll,
        (name) => seedMuFromTier(playerTierMap.get(name)),
        MIN_MATCHES_THRESHOLD,
      )
      const minMonth = Math.ceil(monthCount * MONTHLY_MIN_FRACTION)
      const mBoard = buildBoard(monthRecord, monthKd, tsMonth, () => TS.MU, minMonth)

      setAllTimeBoard(allBoard)
      setMonthBoard(mBoard)
      setMonthMinMatches(minMonth)
      setMonthMatchCount(monthCount)

      // Histogram-preserving rank suggestions — identical concept to the ELO board. Re-deal
      // the qualifying players into the SAME tier slots they occupy today, ordered by
      // TrueSkill rating: the top ratings fill the Tier-10 slots, etc. A player whose rating
      // would land them in a different tier is over/under-ranked. It's a reshuffle, never a
      // ratchet, so it can't inflate the league.
      const buildSuggestions = (board: BoardRow[]): TsSuggestion[] => {
        const histogram = new Map<number, number>()
        for (const p of board) histogram.set(p.tier, (histogram.get(p.tier) || 0) + 1)

        const sortedByRating = [...board].sort((a, b) => b.rating - a.rating)
        const impliedTier = new Map<string, number>()
        let idx = 0
        for (let tier = 10; tier >= 1; tier--) {
          const count = histogram.get(tier) || 0
          for (let i = 0; i < count; i++) {
            const p = sortedByRating[idx++]
            if (!p) break
            impliedTier.set(p.name, tier)
          }
        }

        const result: TsSuggestion[] = []
        for (const p of board) {
          const implied = impliedTier.get(p.name)
          if (implied === undefined || implied === p.tier) continue
          const direction = implied > p.tier ? 1 : -1
          const suggestedTier = Math.max(1, Math.min(10, p.tier + direction))
          if (suggestedTier === p.tier) continue
          result.push({
            playerName: p.name,
            currentTier: p.tier,
            suggestedTier,
            impliedTier: implied,
            rating: p.rating,
            matches: p.matches,
            isPromotion: direction > 0,
          })
        }

        result.sort((a, b) => {
          const gapA = Math.abs(a.impliedTier - a.currentTier)
          const gapB = Math.abs(b.impliedTier - b.currentTier)
          if (gapB !== gapA) return gapB - gapA
          return b.rating - a.rating
        })
        return result
      }

      setAllSuggestions(buildSuggestions(allBoard))
      setMonthSuggestions(buildSuggestions(mBoard))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to calculate TrueSkill")
    }

    setLoading(false)
  }

  useEffect(() => {
    computeTrueSkill()
    // Recompute when the selected month changes so the monthly board stays in sync.
  }, [year, month])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
        <span className="ml-2 text-[var(--color-text-dim)]">Calculating TrueSkill ratings...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-400 mb-4">Error: {error}</p>
        <Button onClick={computeTrueSkill} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  const board = scope === "alltime" ? allTimeBoard : monthBoard
  const suggestions = scope === "alltime" ? allSuggestions : monthSuggestions
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-text-dim)]">
          <span className="inline-block mr-2 px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide bg-[var(--color-primary)]/15 text-[var(--color-primary)] border border-[var(--color-primary)]/30 align-middle">
            Experimental
          </span>
          Hidden TrueSkill — Gaussian skill rating (μ ± σ), replayed across all matches. Admin only; not
          currently wired into team balancing.
        </p>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <HelpCircle className="w-4 h-4 mr-2" />
                How TrueSkill works
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-[var(--color-primary)]">How the hidden TrueSkill works</DialogTitle>
                <DialogDescription className="sr-only">
                  Explanation of the TrueSkill rating and suggestion logic.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm text-[var(--color-text)]">
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Skill as a bell curve (μ ± σ)</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Every player is a Gaussian: <span className="font-mono">μ</span> is the best estimate of their
                    skill and <span className="font-mono">σ</span> is how unsure we are. New players start wide
                    (<span className="font-mono">σ = {TS.SIGMA.toFixed(1)}</span>); the more they play, the more σ
                    shrinks and the rating settles.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">The board number (μ − 3σ)</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Players are ranked on the <em>conservative</em> estimate{" "}
                    <span className="font-mono">μ − 3σ</span> — the skill we&apos;re ~99.7% sure they&apos;re at least
                    at. That&apos;s why two players with the same μ aren&apos;t tied: the one with more games (smaller
                    σ) ranks higher. It&apos;s the same number Xbox Live showed as &quot;your TrueSkill&quot;.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">How a match moves it</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Each team&apos;s skill is the sum of its players&apos; μ, plus per-player performance noise
                    (<span className="font-mono">β = {TS.BETA.toFixed(1)}</span>). That gives an expected result; beat
                    a team you were expected to lose to and μ jumps a lot (and σ drops), beat one you should have and
                    it barely moves. A small dynamics factor (<span className="font-mono">τ</span>) re-widens σ a hair
                    each game so ratings can still drift as form changes. Draws pull the two teams&apos; ratings
                    toward each other. Nothing is stored — the whole history replays fresh on every load.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Seeded from tier (all-time)</h4>
                  <p className="text-[var(--color-text-dim)]">
                    In the all-time view each player&apos;s μ is seeded from their current tier, so before anyone
                    plays the order already mirrors tier order. Results then pull μ away from the seed. Re-ranking a
                    player shifts their seed and the whole history replays from there, so established players barely
                    move while new ones shift more.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">All-time vs monthly</h4>
                  <p className="text-[var(--color-text-dim)]">
                    All-time replays every match, seeded from tier. Monthly replays only that month&apos;s matches and
                    starts <em>everyone level</em> at μ = {TS.MU} — pure this-month form, not tier order. It resets on
                    the 1st, like the W/L stats, and requires 30%+ of the month&apos;s matches.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Rank suggestions</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Qualifying players are re-sorted by TrueSkill and dealt back into the <em>same</em> tier slots that
                    exist today — highest ratings take the Tier-10 spots, and so on. If your rating would land you in a
                    different tier than you hold, you get a promote/demote suggestion (capped to one tier at a time).
                    It reshuffles existing tiers, so it can never inflate the league.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">K/D</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Display only — it does <em>not</em> affect TrueSkill. Players without uploaded match stats show{" "}
                    <span className="font-mono">—</span>.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button onClick={computeTrueSkill} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>
      </div>

      {/* Scope toggle */}
      <div className="flex items-center justify-center gap-2">
        <button
          onClick={() => setScope("alltime")}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            scope === "alltime"
              ? "bg-[var(--color-primary)] text-[var(--color-background)]"
              : "bg-[var(--color-surface)] text-[var(--color-text-dim)] hover:bg-[var(--color-border)]/50"
          }`}
        >
          All-time
        </button>
        <button
          onClick={() => setScope("month")}
          className={`px-4 py-2 rounded-lg text-sm font-bold transition-all ${
            scope === "month"
              ? "bg-[var(--color-primary)] text-[var(--color-background)]"
              : "bg-[var(--color-surface)] text-[var(--color-text-dim)] hover:bg-[var(--color-border)]/50"
          }`}
        >
          {monthLabel}
        </button>
      </div>

      {/* TrueSkill Leaderboard */}
      <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]">
          <h3 className="text-lg font-bold text-[var(--color-primary)] flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            TrueSkill Leaderboard
          </h3>
          <p className="text-xs text-[var(--color-text-dim)] mt-1">
            {scope === "alltime"
              ? `Current-roster players with ${MIN_MATCHES_THRESHOLD}+ all-time matches. Ranked on the conservative rating (μ − 3σ) across all matches ever played.`
              : `Players with ${monthMinMatches}+ matches in ${monthLabel} (30% of ${monthMatchCount}). Everyone starts level each month — pure this-month form, not tier order — and resets on the 1st.`}
          </p>
        </div>
        {board.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-[var(--color-text-dim)] text-xs uppercase">
                  <th className="px-4 py-3 text-left">#</th>
                  <th className="px-4 py-3 text-left">Player</th>
                  <th className="px-4 py-3 text-center">Tier</th>
                  <th className="px-4 py-3 text-right">Rating</th>
                  <th className="px-4 py-3 text-right">Skill (μ)</th>
                  <th className="px-4 py-3 text-right">± (σ)</th>
                  <th className="px-4 py-3 text-center">Matches</th>
                  <th className="px-4 py-3 text-center">W–L</th>
                  <th className="px-4 py-3 text-center">K/D</th>
                </tr>
              </thead>
              <tbody>
                {board.map((player, index) => {
                  const isTop3 = index < 3
                  return (
                    <tr
                      key={player.name}
                      className={`border-b border-[var(--color-border)]/50 ${isTop3 ? "bg-[#ffd700]/5" : ""}`}
                    >
                      <td className="px-4 py-3">
                        {isTop3 ? (
                          <span className="text-lg">{index === 0 ? "🥇" : index === 1 ? "🥈" : "🥉"}</span>
                        ) : (
                          <span className="text-[var(--color-text-dim)]">{index + 1}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`font-medium ${isTop3 ? "text-[#ffd700]" : "text-[var(--color-text)]"}`}>
                          {player.name}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-center">
                        <span className="font-bold text-[var(--color-primary)]">{player.tier}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono font-bold text-[var(--color-primary)]">
                        {player.rating.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--color-text)]">
                        {player.mu.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-[var(--color-text-dim)]">
                        {player.sigma.toFixed(1)}
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--color-text)]">{player.matches}</td>
                      <td className="px-4 py-3 text-center">
                        <span className="text-[#27ae60] font-bold">{player.wins}</span>
                        <span className="text-[var(--color-text-dim)]">–</span>
                        <span className="text-[#ff4757] font-bold">{player.losses}</span>
                        {player.draws > 0 && (
                          <span className="text-[var(--color-text-dim)] text-xs"> ({player.draws}D)</span>
                        )}
                      </td>
                      <td className="px-4 py-3 text-center text-[var(--color-text)]">
                        {kdRatio(player.kills, player.deaths)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="p-8 text-center text-[var(--color-text-dim)]">
            <p>
              {scope === "alltime"
                ? "No rated players yet — log some matches first."
                : `No players with ${monthMinMatches}+ matches in ${monthLabel}.`}
            </p>
          </div>
        )}
      </div>

      {/* TrueSkill Rank Suggestions */}
      <div>
        <h3 className="text-lg font-bold text-[var(--color-primary)] mb-1 flex items-center gap-2">
          <TrendingUp className="w-5 h-5" />
          {scope === "alltime" ? "TrueSkill Rank Suggestions" : `Rank Suggestions — ${monthLabel}`}
        </h3>
        <p className="text-sm text-[var(--color-text-dim)] mb-4">
          {scope === "alltime"
            ? "Players whose all-time TrueSkill places them in a different tier than they currently hold (capped to one tier per cycle)."
            : `Players whose ${monthLabel} form places them in a different tier than they currently hold — i.e. over- or under-ranked for the month (capped to one tier per cycle).`}
        </p>

        {suggestions.length === 0 ? (
          <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-8 text-center">
            <p className="text-[var(--color-text-dim)] mb-1">No TrueSkill-based suggestions.</p>
            <p className="text-[var(--color-text-dim)] text-sm">
              {scope === "alltime"
                ? `Everyone with ${MIN_MATCHES_THRESHOLD}+ matches sits in the tier their rating implies.`
                : `Everyone qualifying for ${monthLabel} sits in the tier their form implies.`}
            </p>
          </div>
        ) : (
          <div className="grid gap-4">
            {suggestions.map((s) => (
              <div key={s.playerName} className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[var(--color-text)]">{s.playerName}</span>
                      <span className="text-sm text-[var(--color-text-dim)]">— Tier {s.currentTier}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {s.isPromotion ? (
                        <>
                          <ArrowUp className="w-4 h-4 text-[#27ae60]" />
                          <span className="text-[#27ae60] font-medium">Tier {s.suggestedTier}</span>
                        </>
                      ) : (
                        <>
                          <ArrowDown className="w-4 h-4 text-[#f39c12]" />
                          <span className="text-[#f39c12] font-medium">Tier {s.suggestedTier}</span>
                        </>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-4 text-sm">
                    <div className="flex flex-col items-center">
                      <span className="text-[var(--color-text-dim)] text-xs uppercase">Rating</span>
                      <span className="text-[var(--color-text)] font-mono font-bold">{s.rating.toFixed(1)}</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[var(--color-text-dim)] text-xs uppercase">Implies</span>
                      <span className="text-[var(--color-text)] font-mono">Tier {s.impliedTier}</span>
                    </div>
                    <div className="flex flex-col items-center">
                      <span className="text-[var(--color-text-dim)] text-xs uppercase">Matches</span>
                      <span className="text-[var(--color-text)] font-mono">{s.matches}</span>
                    </div>
                  </div>

                  <div
                    className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                      s.isPromotion ? "bg-[#27ae60]/20 text-[#27ae60]" : "bg-[#f39c12]/20 text-[#f39c12]"
                    }`}
                  >
                    {s.isPromotion ? (
                      <>
                        <TrendingUp className="w-3 h-3" />
                        Promote
                      </>
                    ) : (
                      <>
                        <TrendingDown className="w-3 h-3" />
                        Demote
                      </>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
