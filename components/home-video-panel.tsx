"use client"

import { useState } from "react"
import { Play } from "lucide-react"

// The homepage's right-hand column: one featured video, nothing else. It briefly
// carried a "Just unlocked" list underneath, which was the same information the
// activity feed beside it already shows — the feed is shortened to this panel's
// height instead (see app/(main)/page.tsx).
//
// TRIAL — the video half is being judged live. To restore the column exactly as
// it was, drop <HomeVideoPanel> for <HomeCrestGrid> in app/(main)/page.tsx.
//
// The player is a FACADE until clicked: at rest it's our own thumbnail and play
// button, and the YouTube iframe is only mounted once someone presses it. Two
// reasons — the embed's resting chrome (title bar, channel line, share and
// settings buttons, "More videos") is YouTube's and can't be styled or removed
// cross-origin, so the only way to have a clean resting state is not to load it
// yet; and it keeps roughly a megabyte of third-party JS off every homepage
// visit. Once playing, the chrome is whatever YouTube shows — that part really
// is out of our hands.
export function HomeVideoPanel({ videoId, title }: { videoId: string; title?: string }) {
  const [playing, setPlaying] = useState(false)

  return (
    <div className="h-full flex flex-col">
      <div
        className="relative w-full overflow-hidden rounded-lg"
        style={{
          aspectRatio: "16 / 9",
          border: "1px solid var(--glass-hair)",
          backgroundColor: "var(--color-background)",
        }}
      >
        {playing ? (
          <iframe
            className="absolute inset-0 w-full h-full"
            // nocookie: a visitor who never presses play is handed nothing.
            src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=1`}
            title={title ?? "JK2 CTF video"}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 w-full h-full cursor-pointer"
            aria-label="Play video"
          >
            {/* hqdefault is the one thumbnail size that always exists. It's 4:3
                with letterbox bars baked in, so object-cover crops them off. */}
            {/* eslint-disable-next-line @next/next/no-img-element -- third-party thumbnail, no loader wanted */}
            <img
              src={`https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`}
              alt=""
              loading="lazy"
              className="absolute inset-0 w-full h-full object-cover"
            />
            <span
              className="absolute inset-0"
              style={{
                background:
                  "linear-gradient(180deg, color-mix(in srgb, var(--color-background) 30%, transparent), color-mix(in srgb, var(--color-background) 72%, transparent))",
              }}
            />
            <span
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 grid place-items-center rounded-full transition-transform group-hover:scale-110"
              style={{
                width: 54,
                height: 54,
                backgroundColor: "color-mix(in srgb, var(--color-primary) 88%, transparent)",
                boxShadow: "0 0 26px -4px color-mix(in srgb, var(--color-primary) 80%, transparent)",
              }}
            >
              <Play className="w-6 h-6 ml-0.5" style={{ color: "var(--color-background)" }} fill="currentColor" />
            </span>
          </button>
        )}
      </div>

    </div>
  )
}
