"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { ArrowUp, ArrowDown, TrendingUp, TrendingDown, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CALIBRATION,
  computeTierMoves,
  fetchCalibrationInputs,
  readAutoCalibrationEnabledAt,
  type TierMove,
} from "@/lib/calibration"
import { AUTO_CALIBRATION_CHANGED } from "@/lib/calibration-events"

/*
 * A preview of the auto-calibrator, not a second opinion on it.
 *
 * This panel used to carry its own copy of the maths — its own thresholds, its
 * own match query, its own accumulation loop — written months before the engine
 * existed and never reconciled with it. The two had drifted apart on draws
 * (counted here as a loss for BOTH sides, which quietly biases everyone
 * downward), on the evidence window, and on duplicate names in a roster array,
 * and it still ran the 5-game/flat-15% config the engine's replay study
 * rejected for thrashing. An admin could read a suggestion here that the engine
 * would never act on. It now calls computeTierMoves like the runner does, so
 * there is one implementation of "should this player move" and no way to drift.
 */
export function RankSuggestions() {
  const [moves, setMoves] = useState<TierMove[]>([])
  const [live, setLive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchSuggestions = async () => {
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // While auto-calibration is ON, preview exactly what the engine would do:
      // same evidence bound, same maths, same answer. While it is OFF the engine
      // has no window at all, and a blank panel would be useless precisely when
      // an admin is ranking by hand — so fall back to recent history and label
      // it as advisory.
      const enabledAt = await readAutoCalibrationEnabledAt(supabase)
      const inputs = await fetchCalibrationInputs(supabase, enabledAt)

      const suggested = computeTierMoves(
        inputs.matches,
        inputs.currentTiers,
        [...inputs.currentTiers.keys()],
        inputs.lastTierChangeAt,
      )
      // Biggest gap first, name as the tie-break so the order is stable between
      // refreshes rather than falling to whatever order the roster arrived in.
      suggested.sort((a, b) => Math.abs(b.gap) - Math.abs(a.gap) || a.name.localeCompare(b.name))

      setLive(enabledAt !== null)
      setMoves(suggested)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to calculate suggestions")
    }

    setLoading(false)
  }

  useEffect(() => {
    fetchSuggestions()
    // Both the numbers and the advisory label below are answers to "is the
    // switch on?", so a toggle three sections up invalidates them outright.
    const onSwitchChanged = () => fetchSuggestions()
    window.addEventListener(AUTO_CALIBRATION_CHANGED, onSwitchChanged)
    return () => window.removeEventListener(AUTO_CALIBRATION_CHANGED, onSwitchChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const advisoryNote = !live && (
    <p className="text-xs text-[#8892a0] italic">
      Auto-calibration is off, so nothing here will happen on its own. These read the same way the engine would, over
      recent history rather than from the moment the switch was last turned on.
    </p>
  )

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

  if (moves.length === 0) {
    return (
      <div className="p-8 text-center">
        <p className="text-[#8892a0] mb-2">No rank suggestions available.</p>
        <p className="text-[#8892a0] text-sm">
          A player needs at least {CALIBRATION.MIN_GAMES} games at their current tier, played since their most recent
          tier change, before they can appear here. Re-ranking a player starts their record again.
        </p>
        <div className="mt-3">{advisoryNote}</div>
        <Button onClick={fetchSuggestions} variant="outline" size="sm" className="mt-4">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between mb-4 gap-4">
        <div className="space-y-1">
          <p className="text-sm text-[#8892a0]">
            {moves.length} suggestion{moves.length !== 1 ? "s" : ""} from each player&apos;s last{" "}
            {CALIBRATION.WINDOW_CAP} games at their current tier, counted from their most recent tier change
          </p>
          {advisoryNote}
        </div>
        <Button onClick={fetchSuggestions} variant="outline" size="sm" className="shrink-0">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      <div className="grid gap-4">
        {moves.map((move) => {
          const isOverperforming = move.to > move.from
          return (
            <div key={move.name} className="bg-[#1a1a2e]/60 border border-[#3d4855] rounded-lg p-4">
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                {/* Player info */}
                <div className="flex items-center gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-[#c5c6c7]">{move.name}</span>
                      <span className="text-sm text-[#8892a0]">— Tier {move.from}</span>
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      {isOverperforming ? (
                        <>
                          <ArrowUp className="w-4 h-4 text-[#27ae60]" />
                          <span className="text-[#27ae60] font-medium">Tier {move.to}</span>
                        </>
                      ) : (
                        <>
                          <ArrowDown className="w-4 h-4 text-[#f39c12]" />
                          <span className="text-[#f39c12] font-medium">Tier {move.to}</span>
                        </>
                      )}
                    </div>
                  </div>
                </div>

                {/* Stats */}
                <div className="flex flex-wrap items-center gap-4 text-sm">
                  <div className="flex flex-col items-center">
                    <span className="text-[#8892a0] text-xs uppercase">Actual</span>
                    <span className="text-[#c5c6c7] font-mono">{Math.round(move.actualWinRate * 100)}%</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[#8892a0] text-xs uppercase">Expected</span>
                    <span className="text-[#c5c6c7] font-mono">{Math.round(move.expectedWinRate * 100)}%</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[#8892a0] text-xs uppercase">Gap</span>
                    <span
                      className={`font-mono font-bold ${isOverperforming ? "text-[#27ae60]" : "text-[#f39c12]"}`}
                    >
                      {move.gap > 0 ? "+" : ""}
                      {Math.round(move.gap * 100)}%
                    </span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[#8892a0] text-xs uppercase">Matches</span>
                    <span className="text-[#c5c6c7] font-mono">{move.games}</span>
                  </div>
                </div>

                {/* Performance label */}
                <div
                  className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium ${
                    isOverperforming ? "bg-[#27ae60]/20 text-[#27ae60]" : "bg-[#f39c12]/20 text-[#f39c12]"
                  }`}
                >
                  {isOverperforming ? (
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
          )
        })}
      </div>
    </div>
  )
}
