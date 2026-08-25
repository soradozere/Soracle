import type { Metadata } from "next"
import { listPlaylists } from "@/lib/demos-server"
import { requireFullAdmin } from "@/lib/player-role"
import { PlaylistIndex } from "@/components/demo-playlists"

export const metadata: Metadata = {
  title: "Demo playlists — JK2 Capture the Flag",
  description: "Curated collections of recorded JK2 matches, including each month's highlights.",
}

export default async function PlaylistsPage() {
  const [playlists, authz] = await Promise.all([listPlaylists(), requireFullAdmin()])
  const isAdmin = authz.ok

  return (
    <main className="mx-auto max-w-5xl px-4 py-8">
      <h1 className="text-2xl font-semibold tracking-tight">Playlists</h1>
      <p className="mt-1 mb-6 text-sm text-muted-foreground">
        Hand-picked collections — a month&rsquo;s best moments, or whatever else is worth watching together.
      </p>
      <PlaylistIndex playlists={playlists} isAdmin={isAdmin} />
    </main>
  )
}
