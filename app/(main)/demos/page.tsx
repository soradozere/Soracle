import type { Metadata } from "next"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { requireFullAdmin } from "@/lib/player-role"
import { listDemos, listPlaylists } from "@/lib/demos-server"
import { DemoLibrary } from "@/components/demo-library"

export const metadata: Metadata = {
  title: "Demos — JK2 Capture the Flag",
  description: "Watch recorded matches in the browser. Switch POV, or detach the camera and fly around.",
}

async function uploaderContext() {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)

  const supabase = await createClient()
  const authz = await requireFullAdmin()
  const isAdmin = authz.ok

  const { data: players } = await supabase.from("players").select("id, name").order("name")
  return { canUpload: !!playerId || isAdmin, isAdmin, players: players ?? [] }
}

export default async function DemosPage() {
  const [demos, playlists, { canUpload, isAdmin, players }] = await Promise.all([
    listDemos(),
    listPlaylists(),
    uploaderContext(),
  ])

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      {/*
        The Playlists link lives in DemoLibrary, directly above the card grid --
        it is another way into the same library, so it sits with the cards
        rather than up here by the title.
      */}
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Demos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Watch a recorded match in the browser. Switch between any player&apos;s point of view, or
          detach the camera and fly around.
        </p>
      </header>

      <DemoLibrary
        demos={demos}
        players={players}
        canUpload={canUpload}
        isAdmin={isAdmin}
        playlistCount={playlists.length}
      />
    </main>
  )
}
