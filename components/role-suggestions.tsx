"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { ArrowDown, ArrowUp, HelpCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  computeProductionBoard,
  type ProductionMatch,
  type ProductionPlayer,
  type ProductionStatRow,
} from "@/lib/production-rating"
import { computeTierMoves, fetchCalibrationInputs, readAutoCalibrationEnabledAt } from "@/lib/calibration"
import { AUTO_CALIBRATION_CHANGED } from "@/lib/calibration-events"
import { computeRoleSuggestions, ROLE_SUGGESTION, type RoleName, type RoleSuggestion } from "@/lib/role-suggestions"

/*
 * A companion to Rank Suggestions, one level down: where a player's production
 * in a role disagrees with their hand-set role rating. See lib/role-suggestions.ts
 * for what it is and — more importantly — what it is not (it applies nothing;
 * Camp is not covered).
 *
 * The tier moves shown as pills come from the same computeTierMoves the tier
 * panel and the live runner use, so a player flagged there and here is one
 * signal read two ways — which is the whole reason this panel exists.
 */

const STAT_COLUMNS =
  "match_id, player_id, team, captures, flag_grabs, flag_hold_ms, returns, assists, base_cleaner, " +
  "mine_kills, mine_grabs_red, mine_grabs_blue, mine_returns, time_played"

const PAGE_SIZE = 1000

/**
 * How far back the production board reads for the per-role cohort ratings.
 *
 * Deliberately NOT the calibrator's "since the switch was flipped" window — that
 * is right for tier moves (a hand edit resets the evidence) but far too short
 * here: fitting a role's rating scale needs several players with 10+ games each
 * in that role, which is a season of play, not a fortnight.
 */
const BOARD_WINDOW_DAYS = 180

type RosterRow = ProductionPlayer & {
  capper_rating: number | null
  chase_rating: number | null
  camp_rating: number | null
  cleaner_rating: number | null
  support_rating: number | null
}

type MatchRow = ProductionMatch & { created_at: string }

async function fetchStatsPaged(
  supabase: ReturnType<typeof createClient>,
  matchIds: string[],
): Promise<ProductionStatRow[]> {
  if (matchIds.length === 0) return []
  const rows: ProductionStatRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("match_stats")
      .select(STAT_COLUMNS)
      .in("match_id", matchIds)
      .order("id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as unknown as ProductionStatRow[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
}

function ratingsByName(roster: RosterRow[]): Map<string, Record<RoleName, number>> {
  const map = new Map<string, Record<RoleName, number>>()
  for (const p of roster) {
    map.set(p.name, {
      Capper: p.capper_rating ?? 0,
      Chase: p.chase_rating ?? 0,
      Camp: p.camp_rating ?? 0,
      Cleaner: p.cleaner_rating ?? 0,
      Support: p.support_rating ?? 0,
    })
  }
  return map
}

export function RoleSuggestions() {
  const [suggestions, setSuggestions] = useState<RoleSuggestion[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSuggestions = async () => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // Tier moves: the calibrator's own window and maths, so a player flagged in
      // both panels is one signal. The board below uses a much longer window.
      const enabledAt = await readAutoCalibrationEnabledAt(supabase)
      const calibration = await fetchCalibrationInputs(supabase, enabledAt)
      const tierMoves = computeTierMoves(
        calibration.matches,
        calibration.currentTiers,
        [...calibration.currentTiers.keys()],
        calibration.lastTierChangeAt,
        calibration.production,
      )

      const since = new Date(Date.now() - BOARD_WINDOW_DAYS * 86_400_000).toISOString()
      const [{ data: matchData, error: matchError }, { data: playerData, error: playerError }] =
        await Promise.all([
          supabase
            .from("matches")
            .select("id, red_team, blue_team, red_score, blue_score, created_at")
            .not("red_team", "is", null)
            .not("blue_team", "is", null)
            .gte("created_at", since)
            .order("created_at", { ascending: false })
            .limit(PAGE_SIZE),
          supabase
            .from("players")
            .select("id, name, tier_value, capper_rating, chase_rating, camp_rating, cleaner_rating, support_rating"),
        ])
      if (matchError) throw new Error(matchError.message)
      if (playerError) throw new Error(playerError.message)

      const matches = ((matchData ?? []) as MatchRow[]).filter(
        (m) => m.red_team?.length && m.blue_team?.length,
      )
      const roster = (playerData ?? []) as RosterRow[]
      const statRows = await fetchStatsPaged(supabase, matches.map((m) => m.id))

      const board = computeProductionBoard(matches, statRows, roster, {
        minGames: ROLE_SUGGESTION.BOARD_MIN_GAMES,
      })

      setSuggestions(computeRoleSuggestions(board, ratingsByName(roster), tierMoves))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to calculate role suggestions")
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchSuggestions()
    // The tier-move pills depend on the auto-calibration switch's "since" bound,
    // so a toggle a few sections up invalidates them.
    const onSwitchChanged = () => fetchSuggestions()
    window.addEventListener(AUTO_CALIBRATION_CHANGED, onSwitchChanged)
    return () => window.removeEventListener(AUTO_CALIBRATION_CHANGED, onSwitchChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-[#66fcf1]" />
        <span className="ml-2 text-[#8892a0]">Calculating role suggestions...</span>
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
        <p className="text-[#8892a0] mb-2">No role suggestions.</p>
        <p className="text-[#8892a0] text-sm">
          A player needs at least {ROLE_SUGGESTION.MIN_GAMES_IN_ROLE} games detected in a role, and a rating that differs
          from their production by more than {ROLE_SUGGESTION.MIN_GAP}, before it shows here. Camp is not covered — there
          is no scoreboard signal for it.
        </p>
        <Button onClick={fetchSuggestions} variant="outline" size="sm" className="mt-4">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>
    )
  }

  const withTierMove = suggestions.filter((s) => s.tierMove !== 0).length

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="space-y-1">
          <p className="text-sm text-[#8892a0]">
            {suggestions.length} role{suggestions.length !== 1 ? "s" : ""} where production over the last{" "}
            {Math.round(BOARD_WINDOW_DAYS / 30)} months and the hand rating disagree
            {withTierMove > 0 && `, ${withTierMove} on a player with a pending tier move`}. Ratings are 0–10; the cohort
            figure is on the Impact scale (50 average, 62 a level above).
          </p>
          <p className="text-xs text-[#8892a0] italic">
            Advisory only — nothing here changes a rating on its own. Apply anything worth acting on in Player Management
            above.
          </p>
        </div>
        <Button onClick={fetchSuggestions} variant="outline" size="sm" className="shrink-0">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3">
        {suggestions.map((s) => {
          const up = s.gap != null ? s.gap > 0 : s.cohortRating >= 50
          const accent = up ? "#27ae60" : "#f39c12"
          return (
            <div key={`${s.name}:${s.role}`} className="bg-[#1a1a2e]/60 border border-[#3d4855] rounded-lg p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-[#c5c6c7]">{s.name}</span>
                    <span className="text-sm text-[#8892a0]">— {s.role}</span>
                    {s.tierMove !== 0 && (
                      <span className="text-[10px] uppercase font-medium px-2 py-0.5 rounded-full bg-[#66fcf1]/15 text-[#66fcf1]">
                        Tier {s.tierMove < 0 ? "down" : "up"} pending
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-sm">
                    {s.kind === "unrated" ? (
                      <span className="text-[#f39c12] font-medium">
                        Plays {s.role} ({s.gamesInRole} games) — no rating set
                      </span>
                    ) : (
                      <>
                        <span className="text-[#8892a0]">Rated {s.currentRating}</span>
                        {s.suggestedRating != null ? (
                          <>
                            {up ? (
                              <ArrowUp className="w-4 h-4" style={{ color: accent }} />
                            ) : (
                              <ArrowDown className="w-4 h-4" style={{ color: accent }} />
                            )}
                            <span className="font-medium" style={{ color: accent }}>
                              {s.suggestedRating}
                            </span>
                          </>
                        ) : (
                          <span className="text-[#8892a0] italic">no fitted number this run</span>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex flex-col items-center">
                    <span className="text-[#8892a0] text-xs uppercase">Production</span>
                    <span className="text-[#c5c6c7] font-mono">
                      {s.cohortRating} · {s.band}
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[#8892a0] text-xs uppercase">Games in role</span>
                    <span className="text-[#c5c6c7] font-mono">{s.gamesInRole}</span>
                  </div>
                  {s.gap != null && (
                    <div className="flex flex-col items-center">
                      <span className="text-[#8892a0] text-xs uppercase">Gap</span>
                      <span className="font-mono font-bold" style={{ color: accent }}>
                        {s.gap > 0 ? "+" : ""}
                        {s.gap}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      <p className="text-xs text-[#8892a0] flex items-start gap-1.5">
        <HelpCircle className="w-3.5 h-3.5 mt-px shrink-0" />
        <span>
          The suggested number is fitted from the current roster&apos;s own ratings against production, so it is
          conservative by design. Role detection is right about 57% of the time — treat a single row as a reason to
          look, not a verdict.
        </span>
      </p>
    </div>
  )
}
