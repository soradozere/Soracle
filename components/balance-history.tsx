"use client"

import type { BalanceResult, Player } from "@/lib/types"
import { Clock, Copy, Trash2 } from 'lucide-react'

interface BalanceHistoryEntry {
  id: string
  result: BalanceResult
  timestamp: Date
  selectedPlayers: string[]
}

interface BalanceHistoryProps {
  history: BalanceHistoryEntry[]
  players: Player[]
  onRestore: (entry: BalanceHistoryEntry) => void
  onClear: () => void
}

export function BalanceHistory({ history, players, onRestore, onClear }: BalanceHistoryProps) {
  if (history.length === 0) return null

  const handleCopy = (result: BalanceResult) => {
    const text = `🔥 Red Team: ${result.teamRed.join(", ")}\n💧 Blue Team: ${result.teamBlue.join(", ")}`
    navigator.clipboard.writeText(text)
  }

  return (
    <div className="mt-12 border-t border-[#3d4855] pt-8">
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xl font-bold text-[#66fcf1] flex items-center gap-2">
          <Clock className="w-5 h-5" />
          Balance History
        </h3>
        <button
          onClick={onClear}
          className="px-3 py-1.5 bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] rounded-md hover:bg-[#ff4757] hover:text-white transition-all text-sm font-medium border border-[#3d4855] flex items-center gap-2"
        >
          <Trash2 className="w-4 h-4" />
          Clear History
        </button>
      </div>

      <div className="space-y-4">
        {history.map((entry, index) => {
          const tierDiff = Math.abs(entry.result.redTierTotal - entry.result.blueTierTotal)
          const timeAgo = getTimeAgo(entry.timestamp)

          return (
            <div
              key={entry.id}
              className="bg-[#1f2833]/50 backdrop-blur-md border border-[#3d4855] rounded-lg p-4 hover:border-[#66fcf1]/50 transition-all"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <div className="text-[#c5c6c7] font-medium mb-1">Balance #{history.length - index}</div>
                  <div className="text-[#8892a0] text-sm">{timeAgo}</div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => handleCopy(entry.result)}
                    className="px-2 py-1 bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] rounded hover:bg-[#3d4855] transition-all text-xs border border-[#3d4855]"
                  >
                    <Copy className="w-3 h-3" />
                  </button>
                  <button
                    onClick={() => onRestore(entry)}
                    style={{
                      backgroundColor: "var(--color-primary)",
                      color: "var(--color-background)",
                    }}
                    className="px-3 py-1 rounded transition-all text-xs font-bold hover-glow"
                  >
                    Restore
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-[#0b0c10]/60 backdrop-blur-sm rounded-lg p-3 border border-[#ff4757]/30">
                  <div className="text-[#ff4757] font-bold text-sm mb-2 flex items-center justify-between">
                    <span>🔥 RED TEAM</span>
                    <span className="text-xs">Tier: {entry.result.redTierTotal}</span>
                  </div>
                  <div className="text-[#c5c6c7] text-xs space-y-1">
                    {entry.result.teamRed.map((name) => (
                      <div key={name}>{name}</div>
                    ))}
                  </div>
                </div>

                <div className="bg-[#0b0c10]/60 backdrop-blur-sm rounded-lg p-3 border border-[#62d6e8]/30">
                  <div className="text-[#62d6e8] font-bold text-sm mb-2 flex items-center justify-between">
                    <span>💧 BLUE TEAM</span>
                    <span className="text-xs">Tier: {entry.result.blueTierTotal}</span>
                  </div>
                  <div className="text-[#c5c6c7] text-xs space-y-1">
                    {entry.result.teamBlue.map((name) => (
                      <div key={name}>{name}</div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-between text-xs">
                <span className="text-[#8892a0]">
                  Tier Diff:{" "}
                  <span className={tierDiff <= 2 ? "text-[#27ae60]" : "text-[#ff4757]"}>{tierDiff.toFixed(1)}</span>
                </span>
                <span className="text-[#8892a0]">
                  Mic: {entry.result.redMic} vs {entry.result.blueMic}
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function getTimeAgo(date: Date): string {
  const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000)

  if (seconds < 60) return "Just now"
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`
  return `${Math.floor(seconds / 86400)} days ago`
}
