import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import {
  getDemo,
  getAdjacentDemos,
  getOwnRating,
  listComments,
  listOtherDemos,
  listPlaylists,
  playlistIdsForDemo,
} from "@/lib/demos-server"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { createClient } from "@/lib/supabase/server"
import { DemoDetail } from "@/components/demo-detail"

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const demo = await getDemo(id)
  if (!demo) return {}
  return {
    title: `${demo.title} — JK2 Capture the Flag`,
    description: `${demo.map} · ${demo.gametype} recorded match, watchable in the browser.`,
  }
}

export default async function DemoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const demo = await getDemo(id)
  if (!demo) notFound()

  const [others, adjacent, comments, playlists, inPlaylistIds, cookieStore, supabase] = await Promise.all([
    listOtherDemos(id),
    getAdjacentDemos(id, demo.createdAt),
    listComments(id),
    listPlaylists(),
    playlistIdsForDemo(id),
    cookies(),
    createClient(),
  ])
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  const [ownRating, auth, { data: players }] = await Promise.all([
    playerId ? getOwnRating(id, playerId) : Promise.resolve(null),
    supabase.auth.getUser(),
    supabase.from("players").select("id, name").order("name"),
  ])
  const isAdmin = auth.data.user ? (await supabase.rpc("is_admin")).data === true : false

  return (
    // Wider than the library grid on purpose -- a single video benefits from
    // the room in a way a grid of cards doesn't; theater mode (in DemoDetail)
    // goes further still by dropping the sidebar entirely.
    <main className="mx-auto max-w-[100rem] px-4 py-8">
      <DemoDetail
        demo={demo}
        others={others}
        previousDemo={adjacent.previous}
        nextDemo={adjacent.next}
        canRate={!!playerId}
        ownRating={ownRating}
        isAdmin={isAdmin}
        players={players ?? []}
        comments={comments}
        currentPlayerId={playerId}
        playlists={playlists}
        inPlaylistIds={inPlaylistIds}
      />
    </main>
  )
}
