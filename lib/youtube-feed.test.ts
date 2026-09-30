import { describe, expect, it } from "vitest"
import { CHANNEL_FEED_URLS, parseChannelFeed } from "@/lib/youtube-feed"

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
