"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Emblem } from "@/components/emblem"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import { loadPlayerBadges, playerSlug } from "@/lib/player-profile"

const STAR_GOLD = "#ffd700"

// Star Player of the Month is only knowable client-side, same as the badge
// chips on the Active Players strip — see the note in home-active-players.tsx.
//
// The tile owns its whole panel rather than being dropped inside one, so it can
// carry the star crest as a watermark bleeding off the corner — the treatment the
// Stats page hero uses for the same award. Its record comes in as a prop: the
// homepage has already computed the month's wins/losses per player for the
// Active Players strip, so this needs no query of its own and no second copy of
// the scoring rules.
export function HomeStarTile({
  monthlyStats,
}: {
  monthlyStats: Record<string, { wins: number; losses: number; draws: number }>
}) {
  const [name, setName] = useState<string | null | undefined>(undefined)

  useEffect(() => {
    let cancelled = false
    fetchPlayersFromDB()
      .then((players) => loadPlayerBadges(players))
      .then((badges) => {
        if (cancelled) return
        const star = Object.entries(badges).find(([, ids]) => ids.includes("star"))
        setName(star ? star[0] : null)
      })
      .catch(() => {
        if (!cancelled) setName(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const record = name ? monthlyStats[name] : undefined
  const played = record ? record.wins + record.losses + record.draws : 0

  const body = (
    <>
      <Emblem
        src="/badges/star.svg"
        color={STAR_GOLD}
        className="absolute -right-6 -top-5 w-[124px] h-[124px] opacity-[0.07] pointer-events-none"
      />
      <div className="relative text-2xl font-extrabold truncate" style={{ fontFamily: "var(--font-orbitron)" }}>
        {name === undefined ? (
          <span className="inline-block w-20 h-7 rounded bg-[#3d4855]/60 animate-pulse align-middle" />
        ) : name === null ? (
          <span className="text-lg text-[#8892a0]">TBD</span>
        ) : (
          <span style={{ color: STAR_GOLD, textShadow: `0 0 18px color-mix(in srgb, ${STAR_GOLD} 35%, transparent)` }}>
            {name}
          </span>
        )}
      </div>
      <div className="relative mt-1 text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8892a0]">
        Player of the Month
      </div>
      {record && played > 0 && (
        <div className="relative mt-1.5 text-[11px] tabular-nums text-[#8892a0]">
          <span style={{ color: "#27ae60" }}>{record.wins}W</span>
          {" – "}
          <span style={{ color: "#ff4757" }}>{record.losses}L</span>
          <span className="opacity-70"> · {played} games</span>
        </div>
      )}
    </>
  )

  // Once the holder is known the tile becomes their profile link; until then
  // it's a plain panel, so there's nothing to click through to a 404.
  return name ? (
    <Link href={`/player/${playerSlug(name)}`} className="glass-panel p-4 block transition-transform hover:-translate-y-0.5">
      {body}
    </Link>
  ) : (
    <div className="glass-panel p-4">{body}</div>
  )
}
