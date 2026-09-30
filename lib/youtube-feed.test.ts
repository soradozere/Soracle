import { afterEach, describe, expect, it, vi } from "vitest"
import { CHANNEL_FEED_URLS, fetchChannelVideos, parseChannelFeed, parsePlaylistItems } from "@/lib/youtube-feed"

const entry = (id: string, title: string) =>
  `<entry><yt:videoId>${id}</yt:videoId><title>${title}</title><published>2026-09-01T00:00:00+00:00</published></entry>`

describe("parseChannelFeed", () => {
  it("reads entries newest first, decoding titles, up to the limit", () => {
    const xml = `<feed><title>JK2 CTF</title>${entry("aaaaaaaaaaa", "Caps &amp; Returns")}${entry("bbbbbbbbbbb", "Two")}${entry("ccccccccccc", "Three")}</feed>`
    expect(parseChannelFeed(xml, 2)).toEqual([
      { videoId: "aaaaaaaaaaa", title: "Caps & Returns", published: "2026-09-01T00:00:00+00:00" },
      { videoId: "bbbbbbbbbbb", title: "Two", published: "2026-09-01T00:00:00+00:00" },
    ])
  })

  it("ignores the feed's own <title> and entries without a video id", () => {
    const xml = `<feed><title>Channel</title><entry><title>no id</title></entry>${entry("ddddddddddd", "Real")}</feed>`
    expect(parseChannelFeed(xml, 10).map((v) => v.videoId)).toEqual(["ddddddddddd"])
  })

  it("returns nothing for an empty or error page", () => {
    expect(parseChannelFeed("<html>404</html>", 10)).toEqual([])
  })
})

describe("CHANNEL_FEED_URLS", () => {
  it("falls back to the uploads playlist (UC... -> UU...)", () => {
    expect(CHANNEL_FEED_URLS[1]).toBe(
      "https://www.youtube.com/feeds/videos.xml?playlist_id=UUeyBUO4DiHBxuW6xPgDiHGQ",
    )
  })
})

describe("parsePlaylistItems", () => {
  const item = (id: string, title: string, privacyStatus: string) => ({
    snippet: { title, publishedAt: "2026-09-02T00:00:00Z", resourceId: { videoId: id } },
    status: { privacyStatus },
    contentDetails: { videoId: id, videoPublishedAt: "2026-09-01T00:00:00Z" },
  })

  it("keeps public uploads in order, preferring the video's own publish date", () => {
    const body = { items: [item("aaaaaaaaaaa", " shux ", "public"), item("bbbbbbbbbbb", "Two", "public")] }
    expect(parsePlaylistItems(body, 10)).toEqual([
      { videoId: "aaaaaaaaaaa", title: "shux", published: "2026-09-01T00:00:00Z" },
      { videoId: "bbbbbbbbbbb", title: "Two", published: "2026-09-01T00:00:00Z" },
    ])
  })

  it("drops private and unlisted uploads, then applies the limit", () => {
    const body = {
      items: [
        item("ppppppppppp", "Private video", "private"),
        item("uuuuuuuuuuu", "Unlisted", "unlisted"),
        item("ccccccccccc", "One", "public"),
        item("ddddddddddd", "Two", "public"),
      ],
    }
    expect(parsePlaylistItems(body, 1).map((v) => v.videoId)).toEqual(["ccccccccccc"])
  })

  it("copes with an empty or malformed response", () => {
    expect(parsePlaylistItems({}, 10)).toEqual([])
    expect(parsePlaylistItems({ items: [{ status: { privacyStatus: "public" } }] }, 10)).toEqual([])
  })
})

describe("fetchChannelVideos", () => {
  const KEY = "secret-test-key"
  const reply = (status: number, body: unknown) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  })

  it("uses the Data API first when a key is set", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", KEY)
    const fetchMock = vi.fn(async () =>
      reply(200, {
        items: [
          {
            status: { privacyStatus: "public" },
            snippet: { title: "shux" },
            contentDetails: { videoId: "aaaaaaaaaaa", videoPublishedAt: "2026-09-01T00:00:00Z" },
          },
        ],
      }),
    )
    vi.stubGlobal("fetch", fetchMock)
    expect(await fetchChannelVideos(10)).toEqual([
      { videoId: "aaaaaaaaaaa", title: "shux", published: "2026-09-01T00:00:00Z" },
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0][0])).toContain("playlistId=UUeyBUO4DiHBxuW6xPgDiHGQ")
  })

  it("falls back to the feeds, and reports every failure without the key", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", KEY)
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) =>
        url.includes("googleapis")
          ? reply(403, { error: { errors: [{ reason: "quotaExceeded" }] } })
          : reply(404, "not found"),
      ),
    )
    const error = await fetchChannelVideos(10).catch((e: Error) => e)
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toBe("YouTube: Data API: HTTP 403 quotaExceeded, HTTP 404, HTTP 404")
    expect((error as Error).message).not.toContain(KEY)
  })

  it("says when no key is configured", async () => {
    vi.stubEnv("YOUTUBE_API_KEY", "")
    vi.stubGlobal("fetch", vi.fn(async () => reply(404, "not found")))
    await expect(fetchChannelVideos(10)).rejects.toThrow("Data API: no YOUTUBE_API_KEY, HTTP 404, HTTP 404")
  })
})
