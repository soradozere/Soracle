import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { cookies } from "next/headers"
import {
  getDemo,
  getAdjacentDemos,
  getOwnReaction,
  getPlaylistContext,
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

export default async function DemoDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ playlist?: string }>
}) {
  const { id } = await params
  const { playlist: playlistSlug } = await searchParams
  const demo = await getDemo(id)
  if (!demo) notFound()

  /*
   * A playlist in the query string replaces the library as the source of
   * "what's around this demo", so the two library queries are skipped rather
   * than fetched and thrown away -- this route is dynamic and already runs a
   * fair number of them (see the Vercel usage notes in SORACLE-CONTEXT §4).
   *
   * A slug that resolves to nothing falls through to the library queries on a
   * second trip. That costs a round trip in the one case that shouldn't
   * normally happen -- a hand-edited or stale URL -- and saves two on every
   * click that comes from a real playlist.
   */
  const playlist = playlistSlug ? await getPlaylistContext(playlistSlug, id) : null

  const [others, adjacent, comments, playlists, inPlaylistIds, cookieStore, supabase] = await Promise.all([
    playlist ? Promise.resolve([]) : listOtherDemos(id),
    playlist ? Promise.resolve({ previous: null, next: null }) : getAdjacentDemos(id, demo.createdAt),
    listComments(id),
    listPlaylists(),
    playlistIdsForDemo(id),
    cookies(),
    createClient(),
  ])
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  const [ownReaction, auth, { data: players }] = await Promise.all([
    playerId ? getOwnReaction(id, playerId) : Promise.resolve(null),
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
        previousDemo={playlist ? playlist.previous : adjacent.previous}
        nextDemo={playlist ? playlist.next : adjacent.next}
        playlistContext={playlist}
        canReact={!!playerId}
        ownReaction={ownReaction}
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
