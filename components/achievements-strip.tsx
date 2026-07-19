"use client"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Crest, CrestStyles, fmtDate, roman } from "@/components/achievement-crest"
import type { AchievementView } from "@/lib/achievements"

// Horizontal, scrollable strip of achievement crests for the Career section, one
// player's worth. The tile itself and all of its CSS live in
// components/achievement-crest.tsx, shared with the /achievements pages; this file
// owns only the strip layout and the per-player tooltip copy.

function StripCrest({ a }: { a: AchievementView }) {
  const pending = a.pending && !a.earned

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Crest a={a} />
      </TooltipTrigger>
      <TooltipContent className="bg-[#1f2833] border border-[#66fcf1]/30 text-[#c5c6c7] text-xs max-w-64">
        <div className="font-bold text-[#e6edf3]">
          {a.title}
          {a.tiered ? ` ${roman(Math.max(1, a.rank))}` : ""}
        </div>
        <div className="mt-0.5">{a.condition}</div>
        <div className="mt-1 text-[#8892a0]">
          {a.rarity === "oneofone"
            ? `The only player who will ever hold this · Claimed ${fmtDate(a.earnedDate)}`
            : a.earned
              ? `${a.earnedRequirement ? `Reached ${a.earnedRequirement} · ` : ""}${a.earnedWith ? `${a.earnedWith} · ` : ""}Earned ${fmtDate(a.earnedDate)}${a.tiered ? ` · rank ${a.rank}/${a.totalRanks}` : ""}`
              : pending
                ? "Starts tracking once scoreboards carry this stat"
                : a.progressLabel
                  ? `Progress: ${a.progressLabel}`
                  : "Locked"}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function AchievementsStrip({ achievements }: { achievements: AchievementView[] }) {
  if (!achievements.length) return null
  const earned = achievements.filter((a) => a.earned).length

  return (
    <div className="mt-4">
      <CrestStyles />
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-[#8892a0] font-bold">Achievements</span>
        <span className="text-[10px] font-mono text-[#66fcf1]">
          {earned} / {achievements.length} earned
        </span>
      </div>
      <div className="ach-strip">
        {achievements.map((a) => (
          <StripCrest key={a.id} a={a} />
        ))}
      </div>
    </div>
  )
}
