"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { LogIn, UserCircle2 } from "lucide-react"
import { playerSlug } from "@/lib/player-profile"

// Mirrors the masthead account menu's logged-in/out check (see components/account-menu.tsx)
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
      // Matches the Browse Servers button beside it — see the note in
      // app/(main)/page.tsx: secondary, but legible.
      className="px-4 py-2 rounded-md text-[13px] font-semibold transition-all inline-flex items-center gap-2 hover-glow"
      style={{
        color: "var(--color-text-bright)",
        border: "1px solid color-mix(in srgb, var(--color-primary) 40%, transparent)",
        background:
          "linear-gradient(180deg, color-mix(in srgb, var(--color-surface-elevated) 75%, transparent), color-mix(in srgb, var(--color-surface) 55%, transparent))",
        boxShadow: "inset 0 1px 0 var(--glass-spec)",
      }}
    >
      {player ? (
        <UserCircle2 className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
      ) : (
        <LogIn className="w-4 h-4" style={{ color: "var(--color-primary)" }} />
      )}
      {player ? "Visit Your Profile" : "Player Login"}
    </Link>
  )
}
