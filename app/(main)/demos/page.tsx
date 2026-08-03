import type { Metadata } from "next"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import Link from "next/link"
import { ListVideo } from "lucide-react"
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
  const {
    data: { user },
  } = await supabase.auth.getUser()
  const isAdmin = user ? (await supabase.rpc("is_admin")).data === true : false

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
      <header className="mb-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">Demos</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Watch a recorded match in the browser. Switch between any player&apos;s point of view, or
              detach the camera and fly around.
            </p>
          </div>
          <Link
            href="/demos/playlists"
            className="flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-sm hover:bg-muted"
          >
            <ListVideo className="h-4 w-4" />
            Playlists
            {playlists.length > 0 && <span className="text-muted-foreground">({playlists.length})</span>}
          </Link>
        </div>
      </header>

      <DemoLibrary demos={demos} players={players} canUpload={canUpload} isAdmin={isAdmin} />
    </main>
  )
}
