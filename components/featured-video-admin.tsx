"use client"

import { useEffect, useState, useTransition } from "react"
import { Loader2, Play, RotateCcw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { clearFeaturedVideo, readFeaturedVideo, setFeaturedVideo } from "@/app/admin/featured-video-actions"
import type { FeaturedVideoResult } from "@/lib/youtube-feed"

// Admin control for the homepage's featured video.
//
// Two states, and the point of the panel is that it always says which one you're
// in: AUTO follows the newest upload on youtube.com/@jk2ctf, PINNED shows one
// specific video until someone clears it. Pinning exists for the case the channel
// feed can't cover — a player posting a frag movie on their own channel.
export function FeaturedVideoAdmin() {
  const [state, setState] = useState<FeaturedVideoResult | null>(null)
  const [input, setInput] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pending, startTransition] = useTransition()

  const refresh = () =>
    readFeaturedVideo().then((r) => {
      if (r.success) setState(r.data)
      else setError(r.error)
    })

  useEffect(() => {
    refresh()
  }, [])

  const pin = () => {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const r = await setFeaturedVideo(input)
      if (!r.success) {
        setError(r.error)
        return
      }
      setInput("")
      setSaved(true)
      await refresh()
    })
  }

  const unpin = () => {
    setError(null)
    setSaved(false)
    startTransition(async () => {
      const r = await clearFeaturedVideo()
      if (!r.success) {
        setError(r.error)
        return
      }
      await refresh()
    })
  }

  const pinned = state?.source === "override"

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <span
          className="w-9 h-9 rounded-lg grid place-items-center shrink-0"
          style={{
            color: pinned ? "var(--color-warning)" : "var(--color-primary)",
            backgroundColor: `color-mix(in srgb, ${pinned ? "var(--color-warning)" : "var(--color-primary)"} 12%, transparent)`,
          }}
        >
          <Play className="w-4 h-4" fill="currentColor" />
        </span>
        <div className="min-w-0 text-sm">
          {state === null ? (
            <span className="text-muted-foreground">Checking…</span>
          ) : (
            <>
              <div className="font-semibold">
                {pinned ? "Pinned to one video" : state.source === "channel" ? "Automatic" : "Nothing to show"}
              </div>
              <div className="text-muted-foreground text-xs mt-0.5">
                {pinned
                  ? "The homepage shows this video until you switch back to automatic."
                  : state.source === "channel"
                    ? "The homepage follows the newest upload on youtube.com/@jk2ctf."
                    : "The channel feed is unreachable and nothing is pinned — the homepage is using its built-in fallback."}
              </div>
              {state.videoId && (
                <a
                  href={`https://www.youtube.com/watch?v=${state.videoId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs underline mt-1 inline-block break-all"
                >
                  {state.title ?? state.videoId}
                </a>
              )}
            </>
          )}
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Paste a YouTube link or video id"
          className="flex-1 min-w-[220px]"
          onKeyDown={(e) => {
            if (e.key === "Enter" && input.trim()) pin()
          }}
        />
        <Button onClick={pin} disabled={pending || !input.trim()} className="gap-2">
          {pending && <Loader2 className="w-4 h-4 animate-spin" />}
          Pin this video
        </Button>
        {pinned && (
          <Button variant="outline" onClick={unpin} disabled={pending} className="gap-2">
            <RotateCcw className="w-4 h-4" />
            Back to automatic
          </Button>
        )}
      </div>

      {/* A watch URL, youtu.be, /shorts/, /embed/ or a bare id all work — see
          parseVideoId. Anything else is rejected rather than stored. */}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {saved && !error && <p className="text-xs" style={{ color: "var(--color-success)" }}>Saved. The homepage updates within the hour, or immediately on its next rebuild.</p>}
    </div>
  )
}
