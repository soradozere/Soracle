"use client"

import { Emblem } from "@/components/emblem"

// The top three used 🥇🥈🥉, which ignore the theme entirely and sit oddly next
// to the site's own emblems. Same three ranks, drawn with the crests the profile
// pages already use, tinted gold / silver / bronze.
const MEDAL_EMBLEMS = [
  { src: "/badges/champion.svg", color: "#ffd700" },
  { src: "/badges/star.svg", color: "#c9ced6" },
  { src: "/badges/top5.svg", color: "#cd7f32" },
]

export function RankMedal({ index }: { index: number }) {
  const medal = MEDAL_EMBLEMS[index]
  if (!medal) return null
  return (
    <span
      className="w-[26px] h-[26px] rounded-full grid place-items-center"
      style={{
        color: medal.color,
        backgroundColor: `color-mix(in srgb, ${medal.color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in srgb, ${medal.color} 45%, transparent)${
          index === 0 ? `, 0 0 14px -5px ${medal.color}` : ""
        }`,
      }}
    >
      <Emblem src={medal.src} className="w-[15px] h-[15px]" label={`Rank ${index + 1}`} />
    </span>
  )
}
