"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { PlayerProfile } from "@/components/player-profile"
import { BackgroundParticles } from "@/components/background-particles"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import { resolvePlayerSlug } from "@/lib/player-profile"
import { checkIsAdmin } from "@/lib/is-admin"
import type { Player } from "@/lib/types"
import { ArrowLeft } from "lucide-react"

// Client body of /player/[slug]: fetches the roster (anon-readable), resolves
// the slug to a player, and renders the shared profile component. Standalone
// page, so it paints its own background rather than relying on the balancer's
// theme provider.

export function PlayerProfileRoute({ slug }: { slug: string }) {
  const [players, setPlayers] = useState<Player[] | null>(null)
  const [error, setError] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  // The logged-in player's own id, if any — lets a player edit their own
  // profile (minus the tooltip, which stays an admin-only touch) without
  // being an admin.
  const [ownPlayerId, setOwnPlayerId] = useState<string | null>(null)

  useEffect(() => {
    fetchPlayersFromDB()
      .then(setPlayers)
      .catch(() => setError(true))
    // Admins (you) get the full inline profile editor; anyone else just views
    // unless they're logged in as this player.
    checkIsAdmin().then(setIsAdmin).catch(() => setIsAdmin(false))
    fetch("/api/player-auth/me")
      .then((r) => r.json())
      .then((data) => setOwnPlayerId(data.playerId ?? null))
      .catch(() => setOwnPlayerId(null))
  }, [])

  const player = players ? resolvePlayerSlug(slug, players) : null
  const isOwner = !!player && !!ownPlayerId && player.id === ownPlayerId

  return (
    <div className="min-h-screen bg-[#0b0c10] px-4 py-6">
      <BackgroundParticles />
      <div className="max-w-5xl mx-auto relative z-10">
        <div className="flex items-center justify-between mb-4">
          <Link
            href="/"
            className="inline-flex items-center gap-2 text-sm text-[#8892a0] hover:text-[#66fcf1] transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Soracle
          </Link>
          {ownPlayerId ? (
            <button
              onClick={async () => {
                await fetch("/api/player-auth/logout", { method: "POST" })
                setOwnPlayerId(null)
              }}
              className="text-sm text-[#8892a0] hover:text-[#66fcf1] transition-colors"
            >
              Log out
            </button>
          ) : (
            <Link href="/player-login" className="text-sm text-[#8892a0] hover:text-[#66fcf1] transition-colors">
              Player login
            </Link>
          )}
        </div>

        {error ? (
          <div className="p-10 text-center text-[#ff4757]">Failed to load players. Try again in a moment.</div>
        ) : !players ? (
          <div className="p-10 text-center text-[#8892a0] animate-pulse font-mono text-sm">
            LOCATING PLAYER…
          </div>
        ) : !player ? (
          <div className="p-10 text-center">
            <p className="text-lg text-[#c5c6c7] mb-2">
              No player found for <span className="font-mono text-[#66fcf1]">{slug}</span>
            </p>
            <p className="text-sm text-[#8892a0]">Check the spelling, or head back and right-click a player card.</p>
          </div>
        ) : (
          <PlayerProfile player={player} allPlayers={players} isAdmin={isAdmin} isOwner={isOwner} />
        )}
      </div>
    </div>
  )
}
