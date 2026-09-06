import { NextResponse } from "next/server"

// Same channel feed as lib/youtube-feed.ts's single-video fetch (see that
// file for why an Atom feed + regex instead of the Data API), just kept
// across every entry instead of only the first - for the JK2 Launcher's
// Home screen "Recent Highlights" strip.
const CHANNEL_ID = "UCeyBUO4DiHBxuW6xPgDiHGQ" // youtube.com/@jk2ctf
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`
const MAX_VIDEOS = 10

export const revalidate = 1800

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
}
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m)

interface VideoEntry {
  videoId: string
  title: string
  published: string | null
}

export async function GET() {
  try {
    const res = await fetch(FEED_URL, {
      signal: AbortSignal.timeout(10_000),
      headers: { accept: "application/atom+xml" },
    })
    if (!res.ok) return NextResponse.json({ videos: [] })
    const xml = await res.text()

    const videos = xml
      .split("<entry>")
      .slice(1, MAX_VIDEOS + 1)
      .map((entry): VideoEntry | null => {
        const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry)?.[1]
        if (!videoId) return null
        const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1]
        const published = /<published>([^<]+)<\/published>/.exec(entry)?.[1]
        return { videoId, title: decode(title ?? "").trim(), published: published ?? null }
      })
      .filter((v): v is VideoEntry => v !== null)

    return NextResponse.json({ videos })
  } catch {
    return NextResponse.json({ videos: [] })
  }
}
