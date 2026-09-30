import { NextResponse } from "next/server"
import { unstable_cache } from "next/cache"
import { fetchChannelVideos } from "@/lib/youtube-feed"

// The channel's recent uploads, for the JK2 Launcher's Home screen "Recent
// Highlights" strip. Same feeds as the homepage's featured video (see
// lib/youtube-feed.ts), kept across every entry instead of only the first.
const MAX_VIDEOS = 10

// fetchChannelVideos throws when YouTube gives nothing back, which
// unstable_cache treats as "keep serving the last good list" -- rather than
// caching an empty strip for the whole half hour, as this route used to.
const getRecentVideos = unstable_cache(() => fetchChannelVideos(MAX_VIDEOS), ["youtube-recent-videos"], {
  revalidate: 1800,
})

export async function GET() {
  try {
    return NextResponse.json({ videos: await getRecentVideos() })
  } catch (e) {
    // Still { videos: [] } for the launcher, which hides the strip on an
    // empty list; `error` says what YouTube actually answered, so an empty
    // strip can be diagnosed by opening this URL rather than guessed at.
    return NextResponse.json({ videos: [], error: e instanceof Error ? e.message : String(e) })
  }
}
