"use client"

import type { BalanceResult, Player } from "@/lib/types"
import { Copy, RefreshCw, Flame, Droplet } from 'lucide-react'
import { memo, useMemo } from "react"

interface TeamDisplayProps {
  result: BalanceResult
  players: Player[]
  onCopy: () => void
  onCopyAll: () => void
  onSwapSides: () => void
}

const ROLE_LABELS = {
  Capper: "CAP",
  Chase: "CHA",
  Camp: "CAM",
  Cleaner: "BC",
  Support: "SUP",
}

export const TeamDisplay = memo(function TeamDisplay({ result, players, onCopy, onCopyAll, onSwapSides }: TeamDisplayProps) {
  const getPlayerRoleCoverage = useMemo(() => {
    return (teamNames: string[]) => {
      const teamPlayers = teamNames.map((name) => players.find((p) => p.name === name)!).filter(Boolean)

      return Object.keys(ROLE_LABELS).map((role) => {
        const viableCount = teamPlayers.filter((p) => p.roles[role as keyof typeof p.roles] >= 4).length
        return {
          role,
          count: viableCount,
          status: viableCount >= 2 ? "good" : viableCount === 1 ? "warning" : "bad",
        }
      })
    }
  }, [players])

  const redCoverage = useMemo(() => getPlayerRoleCoverage(result.teamRed), [getPlayerRoleCoverage, result.teamRed])
  const blueCoverage = useMemo(() => getPlayerRoleCoverage(result.teamBlue), [getPlayerRoleCoverage, result.teamBlue])

  return (
    <div className="space-y-6 animate-in fade-in duration-500">
      {/* Swap Suggestion - Added glass effect */}
      <div className="bg-[#1f2833]/50 backdrop-blur-md border border-[#3d4855] rounded-lg p-4">
        <div className="flex items-center justify-between">
          <p className="text-[#c5c6c7] text-sm">{result.swapText}</p>
          <div className="flex gap-2">
            <button
              onClick={onCopy}
              className="px-4 py-2 bg-[#27ae60] text-white rounded-md hover:bg-[#229954] transition-all text-sm font-medium border border-[#27ae60] shadow-lg shadow-[#27ae60]/30"
            >
              <Copy className="w-4 h-4 inline mr-1" />
              Copy Teams
            </button>
            <button
              onClick={onCopyAll}
              style={{
                backgroundColor: "var(--color-primary)",
                borderColor: "var(--color-primary)",
                color: "var(--color-background)",
                boxShadow: "0 10px 15px -3px var(--color-primary-glow)",
              }}
              className="px-4 py-2 rounded-md hover:opacity-90 transition-all text-sm font-medium border"
            >
              <Copy className="w-4 h-4 inline mr-1" />
              Copy All Options
            </button>
            <button
              onClick={onSwapSides}
              className="px-4 py-2 bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] rounded-md hover:bg-[#3d4855] transition-all text-sm font-medium border border-[#3d4855]"
            >
              <RefreshCw className="w-4 h-4 inline mr-1" />
              Swap Sides
            </button>
          </div>
        </div>
      </div>

      {/* Teams */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Red Team - Added glass effect */}
        <div className="bg-[#1f2833]/50 backdrop-blur-md border-2 border-[#ff4757] rounded-lg p-6 glow-border-red">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Flame className="w-6 h-6 text-[#ff4757]" />
              <h3 className="text-2xl font-bold text-[#ff4757] font-mono">RED TEAM</h3>
            </div>
            <div className="bg-[#ff4757] text-white px-3 py-1 rounded-md font-bold font-mono">
              Tier: {result.redTierTotal}
            </div>
          </div>

          <ul className="space-y-2 mb-4">
            {result.teamRed.map((name, i) => (
              <li
                key={i}
                className="bg-[#0b0c10]/60 backdrop-blur-sm p-3 rounded-md border border-[#3d4855] text-white font-medium"
              >
                {name}
              </li>
            ))}
          </ul>

          <div className="pt-4 border-t border-[#3d4855]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#8892a0] text-sm">Role Coverage</span>
              <span className="text-[#8892a0] text-sm">Mic Users: {result.redMic}</span>
            </div>
            <div className="flex gap-2">
              {redCoverage.map(({ role, count, status }) => (
                <div
                  key={role}
                  className={`flex-1 px-2 py-1 rounded text-center text-xs font-bold ${
                    status === "good"
                      ? "bg-[#27ae60] text-white"
                      : status === "warning"
                        ? "bg-[#f39c12] text-white"
                        : "bg-[#ff4757] text-white"
                  }`}
                >
                  {ROLE_LABELS[role as keyof typeof ROLE_LABELS]} {count}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Blue Team - Added glass effect */}
        <div className="bg-[#1f2833]/50 backdrop-blur-md border-2 border-[#62d6e8] rounded-lg p-6 glow-border-blue">
          <div className="flex items-center justify-between mb-4">
            <div className="flex items-center gap-2">
              <Droplet className="w-6 h-6 text-[#62d6e8]" />
              <h3 className="text-2xl font-bold text-[#62d6e8] font-mono">BLUE TEAM</h3>
            </div>
            <div className="bg-[#62d6e8] text-[#0b0c10] px-3 py-1 rounded-md font-bold font-mono">
              Tier: {result.blueTierTotal}
            </div>
          </div>

          <ul className="space-y-2 mb-4">
            {result.teamBlue.map((name, i) => (
              <li
                key={i}
                className="bg-[#0b0c10]/60 backdrop-blur-sm p-3 rounded-md border border-[#3d4855] text-white font-medium"
              >
                {name}
              </li>
            ))}
          </ul>

          <div className="pt-4 border-t border-[#3d4855]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-[#8892a0] text-sm">Role Coverage</span>
              <span className="text-[#8892a0] text-sm">Mic Users: {result.blueMic}</span>
            </div>
            <div className="flex gap-2">
              {blueCoverage.map(({ role, count, status }) => (
                <div
                  key={role}
                  className={`flex-1 px-2 py-1 rounded text-center text-xs font-bold ${
                    status === "good"
                      ? "bg-[#27ae60] text-white"
                      : status === "warning"
                        ? "bg-[#f39c12] text-white"
                        : "bg-[#ff4757] text-white"
                  }`}
                >
                  {ROLE_LABELS[role as keyof typeof ROLE_LABELS]} {count}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
})
