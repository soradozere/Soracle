"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LogIn, UserCircle2 } from "lucide-react"
import { playerSlug } from "@/lib/player-profile"

// Top-bar login button, mirroring AdminNavButton's style. Unlike that one,
// this is always visible — logged out it's an entry point to /player-login;
// logged in it becomes a shortcut to the player's own profile (where the
// actual "Log out" control lives).
export function PlayerNavButton() {
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
      className="px-3 py-1.5 rounded-md text-sm transition-all font-medium flex items-center gap-1.5 bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855]"
      title={player ? "Your profile" : "Player login"}
    >
      {player ? <UserCircle2 className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
      {player ? player.name : "Login"}
    </Link>
  )
}
