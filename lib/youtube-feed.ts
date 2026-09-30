import { unstable_cache } from "next/cache"
import { createAnonClient } from "@/lib/supabase/anon"

/*
 * The channel's latest video, for the homepage's featured panel.
 *
 * Read from YouTube's per-channel Atom feed rather than the Data API: no API key
 * to store or rotate, no quota to blow through, and no OAuth. The Data API's
 * search.list costs 100 quota units per call for the same answer; this costs
 * nothing and needs no credential that can silently lapse (the render pipeline
 * has taught us what that failure looks like).
 *
 * The feed is keyed by channel ID, not the @handle — handles aren't accepted.
 * Resolved once from the channel page's externalId:
 *   curl -sL https://www.youtube.com/@jk2ctf | grep -o 'externalId":"UC[^"]*'
 */
const CHANNEL_ID = "UCeyBUO4DiHBxuW6xPgDiHGQ" // youtube.com/@jk2ctf
const FEED_URL = `https://www.youtube.com/feeds/videos.xml?channel_id=${CHANNEL_ID}`

export interface FeaturedVideo {
  videoId: string
  title: string
  /** ISO timestamp, so a caller can say how fresh it is. */
  published: string
}

// The handful of entities YouTube actually emits in a title.
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
}
const decode = (s: string) => s.replace(/&(?:amp|lt|gt|quot|#39|apos);/g, (m) => ENTITIES[m] ?? m)

/*
 * Both of the channel's Atom feeds, in the order tried.
 *
 * The per-channel feed is the documented one, but YouTube has been known to
 * answer it with a 404 or an empty body for requests from cloud hosts while
 * still serving the same uploads as a playlist feed. The uploads playlist's id
 * is the channel id with "UC" swapped for "UU" -- a long-standing YouTube
 * convention rather than a documented contract, which is why it's the second
 * try and not the only one.
 */
export const CHANNEL_FEED_URLS = [
  FEED_URL,
  `https://www.youtube.com/feeds/videos.xml?playlist_id=UU${CHANNEL_ID.slice(2)}`,
]

export interface ChannelVideo {
  videoId: string
  title: string
  published: string | null
}

/** Every entry in one feed document, newest first. Exported for tests. */
export function parseChannelFeed(xml: string, max: number): ChannelVideo[] {
  // Regex rather than an XML parser on purpose: this is one fixed,
  // machine-generated document and a parser dependency would be the heaviest
  // thing in the path.
  return xml
    .split("<entry>")
    .slice(1, max + 1)
    .map((entry): ChannelVideo | null => {
      const videoId = /<yt:videoId>([^<]+)<\/yt:videoId>/.exec(entry)?.[1]
      if (!videoId) return null
      const title = /<title>([^<]*)<\/title>/.exec(entry)?.[1]
      const published = /<published>([^<]+)<\/published>/.exec(entry)?.[1]
      return { videoId, title: decode(title ?? "").trim(), published: published ?? null }
    })
    .filter((v): v is ChannelVideo => v !== null)
}

/**
 * The channel's latest uploads, trying each feed URL in turn.
 *
 * Throws, with what each URL answered, when none of them produce a video --
 * so a caching caller keeps its last good result instead of caching the
 * failure, and a caller that wants to can say why the list is empty.
 */
export async function fetchChannelVideos(max: number): Promise<ChannelVideo[]> {
  const outcomes: string[] = []
  for (const url of CHANNEL_FEED_URLS) {
    try {
      // 10s ceiling per attempt: nothing that renders this may hang on a third party.
      const res = await fetch(url, {
        signal: AbortSignal.timeout(10_000),
        headers: { accept: "application/atom+xml" },
      })
      if (!res.ok) {
        outcomes.push(`HTTP ${res.status}`)
        continue
      }
      const videos = parseChannelFeed(await res.text(), max)
      if (videos.length > 0) return videos
      outcomes.push("no entries")
    } catch (e) {
      // "timed out" or fetch's own message ("fetch failed"), plus the
      // network-level cause (ECONNREFUSED, ENOTFOUND, ...) when there is one.
      const cause = (e as { cause?: { code?: string } })?.cause?.code
      const what = e instanceof Error && e.name === "TimeoutError" ? "timed out" : e instanceof Error ? e.message : "fetch failed"
      outcomes.push(cause ? `${what} (${cause})` : what)
    }
  }
  throw new Error(`YouTube feeds: ${outcomes.join(", ")}`)
}

async function fetchLatestVideoUncached(): Promise<FeaturedVideo | null> {
  try {
    const [latest] = await fetchChannelVideos(1)
    return { ...latest, published: latest.published ?? new Date().toISOString() }
  } catch {
    // Timeout, DNS, a shape change at YouTube's end -- all the same here: the
    // homepage falls back to its pinned video id, so a dead feed is invisible.
    return null
  }
}

/*
 * Cached for half an hour. The homepage's own revalidate is an hour, so in
 * practice this is read about as often as the page is rebuilt; the window exists
 * so that a page rebuilt for some other reason (a match landing, which
 * invalidates HISTORY_TAG) doesn't also re-hit YouTube.
 */
export const getLatestChannelVideo = unstable_cache(fetchLatestVideoUncached, ["youtube-latest-video"], {
  revalidate: 1800,
})

/*
 * The featured video, resolving the admin override before the channel feed.
 *
 * An admin can pin a specific video (a player's frag movie on their own channel,
 * which the JK2 CTF feed can never surface) and later clear it to hand control
 * back to the feed. `source` is returned so the admin screen can say which of the
 * two is currently in charge without duplicating this precedence anywhere.
 */
export const FEATURED_VIDEO_KEY = "featured_video"
/** Invalidated by the admin action that sets or clears the override. */
export const FEATURED_VIDEO_TAG = "featured-video"

export interface FeaturedVideoResult {
  videoId: string | null
  title: string | null
  source: "override" | "channel" | "none"
}

const fetchOverride = unstable_cache(
  async (): Promise<string | null> => {
    // Anon and cookie-free: this is public, identical for every visitor, and a
    // cookie read here would opt the homepage out of static rendering (see the
    // long note in app/(main)/page.tsx about exactly that).
    const { data } = await createAnonClient()
      .from("site_settings")
      .select("value")
      .eq("key", FEATURED_VIDEO_KEY)
      .maybeSingle()
    const value = data?.value?.trim()
    return value ? value : null
  },
  ["featured-video-override"],
  { tags: [FEATURED_VIDEO_TAG], revalidate: 3600 },
)

export async function getFeaturedVideo(): Promise<FeaturedVideoResult> {
  const override = await fetchOverride()
  if (override) {
    // No title: a pinned id may be on someone else's channel, and the per-channel
    // feed can't name it. The embed shows YouTube's own title anyway.
    return { videoId: override, title: null, source: "override" }
  }
  const latest = await getLatestChannelVideo()
  if (latest) return { videoId: latest.videoId, title: latest.title, source: "channel" }
  return { videoId: null, title: null, source: "none" }
}

/**
 * Accepts what an admin is likely to paste — a watch URL, a youtu.be link, a
 * /shorts/ or /embed/ path, or a bare id — and returns the 11-character id.
 * Null when it can't find one, so the caller can reject rather than store junk
 * that renders as a broken player.
 */
export function parseVideoId(input: string): string | null {
  const raw = input.trim()
  if (!raw) return null
  if (/^[A-Za-z0-9_-]{11}$/.test(raw)) return raw
  const patterns = [
    /[?&]v=([A-Za-z0-9_-]{11})/,
    /youtu\.be\/([A-Za-z0-9_-]{11})/,
    /\/shorts\/([A-Za-z0-9_-]{11})/,
    /\/embed\/([A-Za-z0-9_-]{11})/,
    /\/live\/([A-Za-z0-9_-]{11})/,
  ]
  for (const re of patterns) {
    const m = re.exec(raw)
    if (m) return m[1]
  }
  return null
}
