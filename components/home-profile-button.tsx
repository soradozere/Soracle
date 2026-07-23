"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LogIn, UserCircle2 } from "lucide-react"
import { playerSlug } from "@/lib/player-profile"

// Mirrors PlayerNavButton's logged-in/out check (see components/player-nav-button.tsx)
// for the hero's secondary CTA row: logged out it's an entry point to
// /player-login, logged in it jumps straight to the player's own profile.
export function HomeProfileButton() {
  const [player, setPlayer] = useState<{ name: string } | null>(null)
  const [loaded, setLoaded] = useState(false)

  useEffect(() => {
    let active = true
    fetch("/api/player-auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setPlayer(data.playerId ? { name: data.name } : null)
        setLoaded(true)
      })
      .catch(() => active && setLoaded(true))
    return () => {
      active = false
    }
  }, [])

  if (!loaded) return null

  return (
    <Link
      href={player ? `/player/${playerSlug(player.name)}` : "/player-login"}
      className="px-4 py-1.5 rounded-md text-xs font-medium text-[#8892a0] hover:text-[#66fcf1] border border-[#3d4855] hover:border-[#66fcf1]/50 transition-all inline-flex items-center gap-1.5"
    >
      {player ? <UserCircle2 className="w-3.5 h-3.5" /> : <LogIn className="w-3.5 h-3.5" />}
      {player ? "Visit Your Profile" : "Player Login"}
    </Link>
  )
}
