"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { RefreshCw, TrendingUp, TrendingDown, Lock, Minus } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  CALIBRATION,
  computeCalibrationStates,
  computeTierMoves,
  fetchCalibrationInputs,
  readAutoCalibrationEnabledAt,
  type CalibrationState,
} from "@/lib/calibration"
import { AUTO_CALIBRATION_CHANGED } from "@/lib/calibration-events"
import { cn } from "@/lib/utils"

/*
 * Where every player stands with the calibrator, not just the ones it would act
 * on today.
 *
 * Rank Suggestions answers "who moves now", which is the right question at the
 * moment of a move and useless before it: a latent sitting a thousandth of a
 * tier from the boundary looks exactly like a latent that has never moved. That
 * is not hypothetical — flawless was demoted on 12 Sep 2026 by a latent of
 * 5.49913 against a 5.5 rounding boundary, a margin of 0.00087, with nothing
 * anywhere in the admin panel showing him approaching it.
 *
 * Everything here comes from computeCalibrationStates, the same accumulation
 * computeTierMoves reduces to a yes/no. Nothing on this page re-derives the
 * maths, deliberately — see the note on computeTierMoves for what happened the
 * last time a panel kept its own copy.
 */

/** A player can only ever be moved toward `tier ± 1`, and never past 1 or 10. */
const atTierCap = (s: CalibrationState) =>
  (s.tier >= 10 && s.latent > s.tier) || (s.tier <= 1 && s.latent < s.tier)

/**
 * How much further the latent must drift to change the rounded tier.
 *
 * The boundary is half a tier away in whichever direction the latent is already
 * leaning, so this is 0.5 − |drift| either way.
 */
const distanceToMove = (s: CalibrationState) => 0.5 - Math.abs(s.latent - s.tier)

function sortRows(rows: CalibrationState[]) {
  return [...rows].sort((a, b) => {
    // Anyone with no evaluation yet has no trajectory to rank, so they sit at the
    // bottom in name order rather than pretending to a drift of exactly zero.
    if (a.evaluations === 0 || b.evaluations === 0) {
      if (a.evaluations !== b.evaluations) return a.evaluations === 0 ? 1 : -1
      return a.name.localeCompare(b.name)
    }
    return distanceToMove(a) - distanceToMove(b) || a.name.localeCompare(b.name)
  })
}

export function CalibrationProgress() {
  const [rows, setRows] = useState<CalibrationState[]>([])
  const [movers, setMovers] = useState<Set<string>>(new Set())
  const [live, setLive] = useState(true)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const supabase = createClient()
      // Same bound the engine uses while the switch is on; falls back to recent
      // history while it is off, which is when an admin is ranking by hand and a
      // blank page would be least useful. Mirrors Rank Suggestions.
      const enabledAt = await readAutoCalibrationEnabledAt(supabase)
      const inputs = await fetchCalibrationInputs(supabase, enabledAt)
      const names = [...inputs.currentTiers.keys()]

      const states = computeCalibrationStates(
        inputs.matches,
        inputs.currentTiers,
        names,
        inputs.lastTierChangeAt,
        inputs.production,
      )
      const moves = computeTierMoves(
        inputs.matches,
        inputs.currentTiers,
        names,
        inputs.lastTierChangeAt,
        inputs.production,
      )

      setLive(enabledAt !== null)
      setMovers(new Set(moves.map((m) => m.name)))
      // A player with no games at all in the window is a roster entry, not a
      // participant — they'd be 40 rows of "no evidence" above the ones that matter.
      setRows(sortRows(states.filter((s) => s.games > 0)))
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to read calibration state")
    }
    setLoading(false)
  }

  useEffect(() => {
    load()
    const onSwitchChanged = () => load()
    window.addEventListener(AUTO_CALIBRATION_CHANGED, onSwitchChanged)
    return () => window.removeEventListener(AUTO_CALIBRATION_CHANGED, onSwitchChanged)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-[#66fcf1]" />
        <span className="ml-2 text-[#8892a0]">Replaying the calibrator…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center">
        <p className="text-red-400 mb-4">Error: {error}</p>
        <Button onClick={load} variant="outline" size="sm">
          <RefreshCw className="w-4 h-4 mr-2" />
          Retry
        </Button>
      </div>
    )
  }

  const evaluated = rows.filter((r) => r.evaluations > 0)
  const frozen = rows.filter((r) => r.frozen)

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm text-[#8892a0]">
            {evaluated.length} player{evaluated.length === 1 ? "" : "s"} with a live reading ·{" "}
            {movers.size > 0 ? (
              <span className="text-[#66fcf1]">
                {movers.size} would move now
              </span>
            ) : (
              "none would move now"
            )}
            {frozen.length > 0 && ` · ${frozen.length} frozen`}
          </p>
          {!live && (
            <p className="text-xs text-[#8892a0] italic">
              Auto-calibration is off, so nothing here will happen on its own. These read the same way the engine would,
              over recent history rather than from the moment the switch was last turned on.
            </p>
          )}
        </div>
        <Button onClick={load} variant="outline" size="sm" className="shrink-0">
          <RefreshCw className="w-4 h-4 mr-2" />
          Refresh
        </Button>
      </div>

      {rows.length === 0 ? (
        <p className="p-8 text-center text-[#8892a0]">
          Nobody has played a game at their current tier since their last tier change.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-[#3d4855]">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-[#1a1a2e]/80 text-left text-[11px] uppercase tracking-wide text-[#8892a0]">
                <th className="px-3 py-2 font-medium">Player</th>
                <th className="px-3 py-2 font-medium">Tier</th>
                <th className="px-3 py-2 font-medium">Trajectory</th>
                <th className="px-3 py-2 font-medium text-right">Latent</th>
                <th className="px-3 py-2 font-medium text-right">Drift</th>
                <th className="px-3 py-2 font-medium text-right">Plays like</th>
                <th className="px-3 py-2 font-medium text-right">Scoreboards</th>
                <th className="px-3 py-2 font-medium text-right">Next check</th>
                <th className="px-3 py-2 font-medium text-right">To move</th>
                <th className="px-3 py-2 font-medium">State</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const drift = r.latent - r.tier
                const down = drift < 0
                const capped = atTierCap(r)
                const moving = movers.has(r.name)
                const unevaluated = r.evaluations === 0
                return (
                  <tr
                    key={r.name}
                    className={cn(
                      "border-t border-[#3d4855]/60",
                      moving ? "bg-[#66fcf1]/10" : "bg-[#1a1a2e]/40",
                      unevaluated && "opacity-60",
                    )}
                  >
                    <td className="px-3 py-2 font-bold text-[#c5c6c7]">{r.name}</td>
                    <td className="px-3 py-2 tabular-nums text-[#8892a0]">{r.tier}</td>
                    <td className="px-3 py-2 font-mono text-xs text-[#8892a0]">
                      {r.trajectory.map((v) => v.toFixed(2)).join(" → ")}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#c5c6c7]">{r.latent.toFixed(3)}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono font-bold tabular-nums",
                        unevaluated ? "text-[#8892a0]" : down ? "text-[#f39c12]" : "text-[#27ae60]",
                      )}
                    >
                      {drift >= 0 ? "+" : ""}
                      {drift.toFixed(3)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#8892a0]">
                      {r.estimatedTier === null ? "—" : r.estimatedTier.toFixed(1)}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#8892a0]">
                      {r.productionGames}/{CALIBRATION.WINDOW_CAP}
                      <span className="ml-1 text-[10px] text-[#8892a0]/70">({r.evaluations}/3 checks)</span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#8892a0]">
                      {r.gamesToNextEvaluation === null
                        ? "—"
                        : `${r.gamesToNextEvaluation} game${r.gamesToNextEvaluation === 1 ? "" : "s"}`}
                    </td>
                    <td className="px-3 py-2 text-right font-mono tabular-nums text-[#c5c6c7]">
                      {unevaluated || capped ? "—" : distanceToMove(r).toFixed(3)}
                    </td>
                    <td className="px-3 py-2">
                      {moving ? (
                        <span className="text-[#66fcf1] font-medium">Moves on the next save</span>
                      ) : r.frozen ? (
                        <span className="flex items-center gap-1 text-[#8892a0]">
                          <Lock className="w-3 h-3" /> Frozen — no checks left
                        </span>
                      ) : capped ? (
                        <span className="text-[#8892a0]">At the tier cap</span>
                      ) : unevaluated ? (
                        <span className="flex items-center gap-1 text-[#8892a0]">
                          <Minus className="w-3 h-3" /> No check yet
                        </span>
                      ) : down ? (
                        <span className="flex items-center gap-1 text-[#f39c12]">
                          <TrendingDown className="w-3 h-3" /> Drifting down
                        </span>
                      ) : (
                        <span className="flex items-center gap-1 text-[#27ae60]">
                          <TrendingUp className="w-3 h-3" /> Drifting up
                        </span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <div className="space-y-1 text-xs text-[#8892a0]">
        <p>
          <span className="text-[#c5c6c7]">Latent</span> is the fractional tier the engine accumulates; a move is
          written when it rounds off the player&apos;s actual tier, so <span className="text-[#c5c6c7]">to move</span>{" "}
          is how much further it has to drift. <span className="text-[#c5c6c7]">Trajectory</span> is that latent after
          each check, starting from the tier an admin set.
        </p>
        <p>
          A check fires every {CALIBRATION.MIN_GAMES} scoreboards and stops after {CALIBRATION.WINDOW_CAP}, so each
          placement gets {CALIBRATION.WINDOW_CAP / CALIBRATION.MIN_GAMES} of them. Past that a player is{" "}
          <span className="text-[#c5c6c7]">frozen</span>: later games still feed the average but nothing reads it again
          until their tier changes. Every tier change — an admin edit included — resets the window and the latent.
        </p>
      </div>
    </div>
  )
}
