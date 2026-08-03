import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { getPlaylist } from "@/lib/demos-server"
import { PlaylistDetail } from "@/components/demo-playlists"

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const found = await getPlaylist(slug)
  if (!found) return {}
  return {
    title: `${found.playlist.title} — JK2 Capture the Flag`,
    description:
      found.playlist.description ?? `${found.demos.length} recorded matches, watchable in the browser.`,
  }
}

export default async function PlaylistPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const found = await getPlaylist(slug)
  if (!found) notFound()

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <PlaylistDetail playlist={found.playlist} demos={found.demos} />
    </main>
  )
}
