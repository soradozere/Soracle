"use client"

import { useState } from "react"
import { Play } from "lucide-react"

// One tutorial in the CTF 101 gallery.
//
// Same facade approach as <HomeVideoPanel>: at rest this is our own thumbnail
// and play button, and the YouTube iframe is only mounted once someone presses
// it. On a four-up gallery that matters more than it does on the homepage —
// four resting embeds would be roughly four megabytes of third-party JS, and
// four sets of YouTube's own unstyleable chrome, on a page most people open to
// read rather than to watch.
//
// Separate component rather than a prop on HomeVideoPanel: that one is built to
// fill a column (h-full) beside the activity feed, this one sits in a grid cell
// with its title underneath.
export function CtfVideoCard({
  videoId,
  title,
  tag,
  tagColor,
}: {
  videoId: string
  title: string
  tag: string
  /** Role accent where the tutorial maps to a role; primary otherwise. */
  tagColor?: string
}) {
  const [playing, setPlaying] = useState(false)

  return (
    <article className="glass-panel flex flex-col">
      <div
        className="relative w-full overflow-hidden"
        style={{ aspectRatio: "16 / 9", borderBottom: "1px solid var(--glass-hair)" }}
      >
        {playing ? (
          <iframe
            className="absolute inset-0 w-full h-full"
            // nocookie: a visitor who never presses play is handed nothing.
            src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0&autoplay=1`}
            title={title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <button
            type="button"
            onClick={() => setPlaying(true)}
            className="group absolute inset-0 w-full h-full cursor-pointer"
            aria-label={`Play: ${title}`}
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
                width: 44,
                height: 44,
                backgroundColor: "color-mix(in srgb, var(--color-primary) 88%, transparent)",
                boxShadow: "0 0 26px -4px color-mix(in srgb, var(--color-primary) 80%, transparent)",
              }}
            >
              <Play className="w-5 h-5 ml-0.5" style={{ color: "var(--color-background)" }} fill="currentColor" />
            </span>
          </button>
        )}
      </div>

      <div className="p-3.5 pb-4 flex flex-col gap-1.5">
        <span
          className="text-[9px] font-bold uppercase tracking-[0.16em]"
          style={{ fontFamily: "var(--font-orbitron)", color: tagColor ?? "var(--color-primary)" }}
        >
          {tag}
        </span>
        <a
          href={`https://www.youtube.com/watch?v=${videoId}`}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[13px] font-semibold leading-snug text-text-bright hover:text-primary transition-colors"
        >
          {title}
        </a>
      </div>
    </article>
  )
}
