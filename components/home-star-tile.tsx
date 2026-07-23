"use client"

import { useEffect, useState } from "react"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import { loadPlayerBadges } from "@/lib/player-profile"

// Star Player of the Month is only knowable client-side, same as the badge
// chips on the Active Players strip — see the note in home-active-players.tsx.
export function HomeStarTile() {
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

  return (
    <div className="text-3xl font-black truncate" style={{ fontFamily: "var(--font-orbitron)" }}>
      {name === undefined ? (
        <span className="inline-block w-20 h-7 rounded bg-[#3d4855]/60 animate-pulse align-middle" />
      ) : name === null ? (
        <span className="text-lg text-[#8892a0]">TBD</span>
      ) : (
        <span style={{ color: "var(--color-primary)", textShadow: "0 0 16px var(--color-primary-glow)" }}>
          {name}
        </span>
      )}
    </div>
  )
}
