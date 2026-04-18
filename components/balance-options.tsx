"use client"

import type { BalanceResult, Player } from "@/lib/types"
import { Check } from 'lucide-react'
import { memo } from "react"

/**
 * Converts raw balance penalty score to a confidence percentage.
 * Uses exponential decay — small differences near 0 matter more
 * than large differences at the high end.
 *
 * Score 0    → 100%  (perfect split)
 * Score 12   → ~95%  (excellent)
 * Score 50   → ~85%  (solid)
 * Score 150  → ~65%  (noticeable gaps)
 * Score 500+ → floors at 30%
 */
function getBalanceConfidence(score: number): number {
  const k = 0.004   // Decay rate
  const floor = 30   // Minimum — even bad balances don't show 0%
  const raw = floor + (100 - floor) * Math.exp(-k * score)
  return Math.round(raw)
}

function getConfidenceColor(confidence: number): { bg: string; text: string } {
  if (confidence >= 80) {
    return { bg: "bg-[#27ae60]/20", text: "text-[#27ae60]" }
  } else if (confidence >= 60) {
    return { bg: "bg-[#f39c12]/20", text: "text-[#f39c12]" }
  } else {
    return { bg: "bg-[#ff4757]/20", text: "text-[#ff4757]" }
  }
}

interface BalanceOption {
  result: BalanceResult
  score: number
  label: string
  description: string
}

interface BalanceOptionsProps {
  options: BalanceOption[]
  selectedIndex: number
  onSelect: (index: number) => void
  players: Player[]
}

export const BalanceOptions = memo(function BalanceOptions({
  options,
  selectedIndex,
  onSelect,
  players,
}: BalanceOptionsProps) {
  if (options.length === 0) return null

  return (
    <div className="mb-8">
      <h3 className="text-xl font-bold text-[#66fcf1] mb-4">Balance Options</h3>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {options.map((option, index) => {
          const isSelected = index === selectedIndex
          const redTier = option.result.redTierTotal
          const blueTier = option.result.blueTierTotal
          const tierDiff = Math.abs(redTier - blueTier)

          return (
            <button
              key={index}
              onClick={() => onSelect(index)}
              className={`relative p-4 rounded-lg border-2 transition-all text-left backdrop-blur-md ${
                isSelected
                  ? "border-[#66fcf1] bg-[#1f2833]/60 shadow-[0_0_20px_rgba(102,252,241,0.3)]"
                  : "border-[#3d4855] bg-[#1f2833]/40 hover:border-[#66fcf1]/50"
              }`}
            >
              {isSelected && (
                <div className="absolute top-2 right-2">
                  <div
                    style={{ backgroundColor: "var(--color-primary)", color: "var(--color-background)" }}
                    className="w-6 h-6 rounded-full flex items-center justify-center"
                  >
                    <Check className="w-4 h-4" />
                  </div>
                </div>
              )}

              <div className="mb-3">
                <div className="text-[#66fcf1] font-bold text-lg mb-1">{option.label}</div>
                <div className="text-[#8892a0] text-sm">{option.description}</div>
              </div>

              <div className="space-y-2 text-sm">
                <div className="flex justify-between items-center">
                  <span className="text-[#c5c6c7]">Tier Difference:</span>
                  <span
                    className={`font-mono font-bold ${
                      tierDiff <= 1 ? "text-[#27ae60]" : tierDiff <= 2 ? "text-[#f39c12]" : "text-[#ff4757]"
                    }`}
                  >
                    {tierDiff.toFixed(1)}
                  </span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#c5c6c7]">Red Tier:</span>
                  <span className="font-mono text-[#ff4757]">{redTier}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#c5c6c7]">Blue Tier:</span>
                  <span className="font-mono text-[#62d6e8]">{blueTier}</span>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-[#c5c6c7]">Balance:</span>
                  {(() => {
                    const confidence = getBalanceConfidence(option.score)
                    const colors = getConfidenceColor(confidence)
                    return (
                      <span className="flex items-center gap-2">
                        <span
                          className={`font-mono font-bold px-2 py-0.5 rounded-full text-xs ${colors.bg} ${colors.text}`}
                        >
                          {confidence}%
                        </span>
                        <span className="font-mono text-[#8892a0] text-xs">
                          (raw: {option.score.toFixed(1)})
                        </span>
                      </span>
                    )
                  })()}
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
})
