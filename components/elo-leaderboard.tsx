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

// Hidden, admin-only ELO. ELO is a running rating, replayed in chronological order
// every load — nothing is persisted, it's derived fresh.
//
// There are TWO ratings, matching the scope toggle:
//   • All-time — replays every match ever played.
//   • Monthly  — replays only the selected month's matches, re-seeded from tier. This
//                resets on the 1st of each month, exactly like the wins/losses stats.
// Both are seeded from tier and use the same maths; they differ only in which matches
// are replayed. Suggestions are an all-time judgment, so they use the all-time rating.

// Seed each player from their CURRENT tier so day-one ELO order mirrors tier order
// (Tier 10 = strongest = highest seed). Real W/L results then pull ratings away from
// the seed. TIER_STEP controls how "sticky" a tier boundary is: with STEP 100 and
// K 24 it takes ~4-6 decisive over/under-performances to cross into a neighbouring tier.
const BASE_ELO = 1000
const TIER_STEP = 100
const K_FACTOR = 24
const ELO_SCALE = 400

// Score-margin weighting: a win is worth more the more decisive it is. A 1-point game
// (or draw) counts as the baseline (×1); bigger margins scale the swing up to ~2x.
// This is what makes ELO diverge from a plain win-rate board — it rewards dominance,
// not just winning. MARGIN_WEIGHT controls how steep that amplification is.
const MARGIN_WEIGHT = 0.6

// Players not on the current roster (left the community) still need a rating so the
// teams they were on update correctly — seed them at the neutral mid-tier equivalent.
const NEUTRAL_SEED = BASE_ELO + 5 * TIER_STEP

// Monthly view: everyone starts the month level, so the board reflects this month's
// form rather than inheriting tier order through the seed (the way all-time does).
const FLAT_SEED = BASE_ELO + 5 * TIER_STEP

// Minimum all-time matches before a player is rated / eligible for a suggestion.
const MIN_MATCHES_THRESHOLD = 5

// Monthly leaderboard qualifier — same 30% rule used across the rest of the Reports tab.
const MONTHLY_MIN_FRACTION = 0.3

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

interface EloLeaderboardProps {
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
  elo: number
  matches: number
  wins: number
  losses: number
  draws: number
  kills: number
  deaths: number
}

interface EloSuggestion {
  playerName: string
  currentTier: number
  suggestedTier: number
  impliedTier: number
  elo: number
  matches: number
  isPromotion: boolean
}

function kdRatio(kills: number, deaths: number): string {
  if (kills === 0 && deaths === 0) return "—"
  if (deaths === 0) return "∞"
  return (kills / deaths).toFixed(2)
}

export function EloLeaderboard({ year, month }: EloLeaderboardProps) {
  const [scope, setScope] = useState<"alltime" | "month">("alltime")
  const [allTimeBoard, setAllTimeBoard] = useState<BoardRow[]>([])
  const [monthBoard, setMonthBoard] = useState<BoardRow[]>([])
  const [monthMinMatches, setMonthMinMatches] = useState(0)
  const [monthMatchCount, setMonthMatchCount] = useState(0)
  const [suggestions, setSuggestions] = useState<EloSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const computeElo = async () => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // Full match history, oldest first — order matters for a running rating.
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

      // Per-player kills/deaths (only matches with an uploaded stats CSV contribute,
      // so this is partial — stats tracking started recently).
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

      // Two independent ratings: all-time is seeded from current tier (so the long-run
      // board respects tier); monthly starts everyone flat (so it's pure this-month form
      // and high-tier players don't auto-sit at the top each month).
      const seedTierFor = (name: string) => BASE_ELO + (playerTierMap.get(name) ?? 5) * TIER_STEP
      const seeded = (seed: (name: string) => number) => {
        const m = new Map<string, number>()
        for (const name of playerTierMap.keys()) m.set(name, seed(name))
        return m
      }
      const eloAll = seeded(seedTierFor)
      const eloMonth = seeded(() => FLAT_SEED)

      // Apply one match's ELO update to a given rating map. Non-roster names (players
      // who left) are seeded lazily from NEUTRAL_SEED so their old teams still update.
      const applyMatchElo = (map: Map<string, number>, match: Match) => {
        const get = (name: string) => {
          if (!map.has(name)) map.set(name, NEUTRAL_SEED)
          return map.get(name)!
        }
        // Snapshot both team averages BEFORE applying any update this match.
        const redAvg = match.red_team.reduce((s, n) => s + get(n), 0) / match.red_team.length
        const blueAvg = match.blue_team.reduce((s, n) => s + get(n), 0) / match.blue_team.length
        const expectedRed = 1 / (1 + Math.pow(10, (blueAvg - redAvg) / ELO_SCALE))
        const expectedBlue = 1 - expectedRed
        const redScore = match.red_score > match.blue_score ? 1 : match.red_score < match.blue_score ? 0 : 0.5
        const blueScore = 1 - redScore

        // Margin multiplier. Close games (margin ≤ 1) and draws use the baseline ×1.
        // Bigger margins amplify the swing; the autocorrelation term gently discounts a
        // blowout BY the favourite (often a balance miss) and boosts an upset blowout, so
        // lopsided teams don't inflate just by running up the score.
        const margin = Math.abs(match.red_score - match.blue_score)
        let marginMult = 1
        if (margin > 1) {
          const winnerAvg = redScore === 1 ? redAvg : blueAvg
          const loserAvg = redScore === 1 ? blueAvg : redAvg
          const autocorr = 2.2 / ((winnerAvg - loserAvg) * 0.001 + 2.2)
          marginMult = (1 + Math.log(margin) * MARGIN_WEIGHT) * autocorr
        }
        const swing = K_FACTOR * marginMult

        for (const name of match.red_team) map.set(name, get(name) + swing * (redScore - expectedRed))
        for (const name of match.blue_team) map.set(name, get(name) + swing * (blueScore - expectedBlue))
      }

      // Records keyed by name, tracked all-time and for the selected month separately.
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

        // Win = 1, draw = 0.5, loss = 0.
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

        applyMatchElo(eloAll, match)
        if (inMonth) {
          monthMatchIds.add(match.id)
          monthMatches.push(match)
        }
      }

      // Second pass: the monthly rating only sees the selected month's matches.
      for (const match of monthMatches) applyMatchElo(eloMonth, match)

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

      // Build a board from a given record + kd + ELO map, gated by a minimum match count.
      const buildBoard = (
        recMap: Map<string, Rec>,
        kdMap: Map<string, { kills: number; deaths: number }>,
        eloMap: Map<string, number>,
        minMatches: number,
      ): BoardRow[] => {
        const rows: BoardRow[] = []
        for (const [name, tier] of playerTierMap.entries()) {
          const r = recMap.get(name)
          if (!r || r.matches < minMatches || r.matches === 0) continue
          const kd = kdMap.get(name) || { kills: 0, deaths: 0 }
          rows.push({
            name,
            tier,
            elo: Math.round(eloMap.get(name) ?? seedTierFor(name)),
            matches: r.matches,
            wins: r.wins,
            losses: r.losses,
            draws: r.draws,
            kills: kd.kills,
            deaths: kd.deaths,
          })
        }
        rows.sort((a, b) => b.elo - a.elo)
        return rows
      }

      const allBoard = buildBoard(allRecord, allKd, eloAll, MIN_MATCHES_THRESHOLD)
      const minMonth = Math.ceil(monthCount * MONTHLY_MIN_FRACTION)
      const mBoard = buildBoard(monthRecord, monthKd, eloMonth, minMonth)

      setAllTimeBoard(allBoard)
      setMonthBoard(mBoard)
      setMonthMinMatches(minMonth)
      setMonthMatchCount(monthCount)

      // Histogram-preserving relative suggestions (all-time): re-deal qualified players
      // into the SAME tier slots they currently occupy, ordered by ELO. The top ELOs
      // fill the Tier 10 slots, the next batch Tier 9, etc. A player whose ELO would
      // land them in a different tier than they sit in today is over/under-ranked.
      // This can never inflate the league — it's a reshuffle, not a ratchet.
      const qualified = allBoard.filter((p) => p.matches >= MIN_MATCHES_THRESHOLD)

      const histogram = new Map<number, number>()
      for (const p of qualified) histogram.set(p.tier, (histogram.get(p.tier) || 0) + 1)

      const sortedByElo = [...qualified].sort((a, b) => b.elo - a.elo)
      const impliedTier = new Map<string, number>()
      let idx = 0
      for (let tier = 10; tier >= 1; tier--) {
        const count = histogram.get(tier) || 0
        for (let i = 0; i < count; i++) {
          const p = sortedByElo[idx++]
          if (!p) break
          impliedTier.set(p.name, tier)
        }
      }

      const newSuggestions: EloSuggestion[] = []
      for (const p of qualified) {
        const implied = impliedTier.get(p.name)
        if (implied === undefined || implied === p.tier) continue
        // Move at most one tier per cycle (mirrors the wins-based tool).
        const direction = implied > p.tier ? 1 : -1
        const suggestedTier = Math.max(1, Math.min(10, p.tier + direction))
        if (suggestedTier === p.tier) continue
        newSuggestions.push({
          playerName: p.name,
          currentTier: p.tier,
          suggestedTier,
          impliedTier: implied,
          elo: p.elo,
          matches: p.matches,
          isPromotion: direction > 0,
        })
      }

      newSuggestions.sort((a, b) => {
        const gapA = Math.abs(a.impliedTier - a.currentTier)
        const gapB = Math.abs(b.impliedTier - b.currentTier)
        if (gapB !== gapA) return gapB - gapA
        return b.elo - a.elo
      })
      setSuggestions(newSuggestions)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to calculate ELO")
    }

    setLoading(false)
  }

  useEffect(() => {
    computeElo()
    // Recompute when the selected month changes so the monthly board stays in sync.
  }, [year, month])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
        <span className="ml-2 text-[var(--color-text-dim)]">Calculating ELO ratings...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-400 mb-4">Error: {error}</p>
        <Button onClick={computeElo} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  const board = scope === "alltime" ? allTimeBoard : monthBoard
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-text-dim)]">
          Hidden ELO — running rating across all matches, seeded from tier. Admin only.
        </p>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <HelpCircle className="w-4 h-4 mr-2" />
                How ELO works
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle className="text-[var(--color-primary)]">How the hidden ELO works</DialogTitle>
                <DialogDescription className="sr-only">
                  Explanation of the ELO rating and suggestion logic.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm text-[var(--color-text)]">
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Seeded from tier (all-time)</h4>
                  <p className="text-[var(--color-text-dim)]">
                    In the all-time view every player starts at <span className="font-mono">{BASE_ELO} + tier × {TIER_STEP}</span> —
                    so a Tier 10 player begins at {BASE_ELO + 10 * TIER_STEP} and a Tier 1 at {BASE_ELO + TIER_STEP}.
                    Before anyone plays, the all-time order already mirrors tier order.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Running rating</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Every match in history is replayed in order. Each team&apos;s strength is the average ELO of its
                    players, and that gives an <em>expected</em> result. Win more than expected and your ELO rises;
                    lose to a team you should have beaten and it falls. The swing per match is scaled by a
                    K-factor of {K_FACTOR}. Nothing is stored — it&apos;s recomputed fresh each time.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Margin of victory</h4>
                  <p className="text-[var(--color-text-dim)]">
                    A win counts for more the more decisive it is — a 7-1 stomp moves ELO roughly twice as much as a
                    7-6 nailbiter (a 1-point game or draw is the baseline). This is what separates ELO from a plain
                    win-rate board: it rewards <em>dominance</em>, not just winning. A blowout by the favoured team
                    counts a little less, and an upset blowout a little more, so lopsided teams can&apos;t inflate
                    just by running up the score.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">The exact maths</h4>
                  <p className="text-[var(--color-text-dim)] mb-2">
                    Each team&apos;s rating is the average ELO of its players. The expected result for Red against
                    Blue is the standard logistic curve:
                  </p>
                  <div className="bg-[var(--color-background)]/60 border border-[var(--color-border)] rounded-md p-3 font-mono text-xs text-[var(--color-text)] space-y-2 overflow-x-auto">
                    <div>E_red = 1 / (1 + 10^((R_blue − R_red) / {ELO_SCALE}))</div>
                    <div className="text-[var(--color-text-dim)]">
                      // a {ELO_SCALE}-point edge ≈ a 10-to-1 expected win
                    </div>
                    <div>R&apos; = R + {K_FACTOR} × m × (S − E)</div>
                    <div className="text-[var(--color-text-dim)]">// S = 1 win / 0.5 draw / 0 loss</div>
                    <div>m = 1, &nbsp;if margin ≤ 1</div>
                    <div>m = (1 + {MARGIN_WEIGHT} × ln(margin)) × 2.2/(Δ×0.001 + 2.2)</div>
                    <div className="text-[var(--color-text-dim)]">// Δ = winner_avg − loser_avg</div>
                  </div>
                  <p className="text-[var(--color-text-dim)] mt-2">
                    <span className="font-bold text-[var(--color-text)]">Worked example.</span> Red (avg 1500) beats
                    Blue (avg 1620) by 7-3. Red was the underdog, so{" "}
                    <span className="font-mono">E_red ≈ 0.33</span>. Margin 4 with an upset gives{" "}
                    <span className="font-mono">m ≈ 1.94</span>, so the swing is{" "}
                    <span className="font-mono">24 × 1.94 ≈ 47</span>. Each Red player gains{" "}
                    <span className="font-mono">47 × (1 − 0.33) ≈ +31</span> and each Blue player loses the same.
                    Had Red been the favourite and won by the same margin, both E and m would shrink the move toward
                    ~half that.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Why a player&apos;s ELO can jump</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Because nothing is stored and the seed comes from the current tier, re-ranking a player changes
                    their all-time starting point by <span className="font-mono">±{TIER_STEP}</span> per tier moved,
                    then the whole history replays from there. ELO self-corrects over many games (a too-high seed
                    means you&apos;re expected to win more than you do, so you bleed back down), so established
                    players barely move while players with few games shift closer to the full {TIER_STEP}.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Rank suggestions</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Among players with {MIN_MATCHES_THRESHOLD}+ matches, everyone is re-sorted by ELO and dealt back
                    into the <em>same</em> tier slots that exist today — the highest ELOs take the Tier 10 spots, and
                    so on. If your ELO would land you in a different tier than you currently hold, you get a
                    promote/demote suggestion (capped to one tier at a time). It re-shuffles the existing tiers, so
                    it can never inflate the league.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">All-time vs monthly</h4>
                  <p className="text-[var(--color-text-dim)]">
                    All-time ELO replays every match ever, seeded from tier. Monthly ELO is a separate rating that
                    replays only that month&apos;s matches and starts <em>everyone level</em> — so it&apos;s pure
                    this-month form, not tier order, and high-tier players don&apos;t auto-sit at the top. It resets
                    on the 1st of each month, like the wins/losses stats, and requires 30%+ of the month&apos;s
                    matches. Suggestions are an all-time judgment, so they only appear in the all-time view.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">K/D</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Display only — it does <em>not</em> affect ELO. Stats tracking started recently, so players
                    without uploaded match stats show <span className="font-mono">—</span>.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button onClick={computeElo} variant="outline" size="sm">
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

      {/* ELO Leaderboard */}
      <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]">
          <h3 className="text-lg font-bold text-[var(--color-primary)] flex items-center gap-2">
            <Trophy className="w-5 h-5" />
            ELO Leaderboard
          </h3>
          <p className="text-xs text-[var(--color-text-dim)] mt-1">
            {scope === "alltime"
              ? `Current-roster players with ${MIN_MATCHES_THRESHOLD}+ all-time matches. ELO is calculated across all matches ever played.`
              : `Players with ${monthMinMatches}+ matches in ${monthLabel} (30% of ${monthMatchCount}). Everyone starts level each month — this board is pure this-month form, not tier order — and resets on the 1st.`}
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
                  <th className="px-4 py-3 text-right">ELO</th>
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
                        {player.elo}
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

      {/* ELO Rank Suggestions — all-time only */}
      {scope === "alltime" && (
        <div>
          <h3 className="text-lg font-bold text-[var(--color-primary)] mb-1 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            ELO Rank Suggestions
          </h3>
          <p className="text-sm text-[var(--color-text-dim)] mb-4">
            Players whose ELO position places them in a different tier than they currently hold (capped to one tier per cycle).
          </p>

          {suggestions.length === 0 ? (
            <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-8 text-center">
              <p className="text-[var(--color-text-dim)] mb-1">No ELO-based suggestions.</p>
              <p className="text-[var(--color-text-dim)] text-sm">
                Everyone with {MIN_MATCHES_THRESHOLD}+ matches sits in the tier their ELO implies.
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
                        <span className="text-[var(--color-text-dim)] text-xs uppercase">ELO</span>
                        <span className="text-[var(--color-text)] font-mono font-bold">{s.elo}</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <span className="text-[var(--color-text-dim)] text-xs uppercase">ELO implies</span>
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
      )}
    </div>
  )
}
