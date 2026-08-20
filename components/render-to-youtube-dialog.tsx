"use client"

import { useState } from "react"
import { Youtube, AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { requestRender } from "@/app/(main)/demos/render-actions"
import type { DemoPlayerInfo, CameraMode } from "@/lib/demo-viewer/jkd-client"

/** What the viewer knows at the moment the dialog opens. */
export interface RenderCameraState {
  camera: CameraMode
  /** Engine client number, -1 for the recorder's own view. */
  follow: number
  players: DemoPlayerInfo[]
}

/**
 * Same ladder the server uses, so the dialog can say what will happen before
 * anyone commits to it. 1440p wherever it fits: YouTube allocates bitrate by
 * resolution, so a bigger upload survives their encoder better even when
 * watched at 1080p.
 */
const LADDER = [
  { fps: 60 as const, width: 2560, height: 1440 },
  { fps: 30 as const, width: 2560, height: 1440 },
  { fps: 30 as const, width: 1920, height: 1080 },
]

function estimate(endMs: number): { fps: 30 | 60; height: number; minutes: number } | null {
  const budget = 6 * 60 * 60 * 1000 * 0.8
  for (const s of LADDER) {
    const throughput = 38.2 / ((s.width * s.height) / (1280 * 720))
    const ms = (endMs / 1000) * s.fps * (1000 / throughput)
    if (ms <= budget) return { fps: s.fps, height: s.height, minutes: Math.max(1, Math.round(ms / 60000)) }
  }
  return null
}

export function RenderToYoutubeDialog({
  demoId,
  demoTitle,
  durationMs,
  protagonistId,
  protagonistName,
  getCameraState,
}: {
  demoId: string
  demoTitle: string
  durationMs: number
  protagonistId: string | null
  protagonistName?: string
  /**
   * Read on demand rather than passed as state: the camera moves constantly
   * and only matters at the instant this opens. Null while the engine is
   * still starting.
   */
  getCameraState: (() => RenderCameraState | null) | null
}) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(demoTitle)
  const [description, setDescription] = useState("")
  const [camera, setCamera] = useState<CameraMode>("follow")
  const [follow, setFollow] = useState(-1)
  const [players, setPlayers] = useState<DemoPlayerInfo[]>([])
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  // Adopt whatever the viewer is showing, so the common case is open, confirm,
  // done -- the camera someone has already framed is the one they want.
  function onOpenChange(next: boolean) {
    if (next) {
      const state = getCameraState?.()
      if (state) {
        setCamera(state.camera)
        setFollow(state.follow)
        setPlayers(state.players)
      }
      setError(null)
      setDone(false)
    }
    setOpen(next)
  }

  const est = estimate(durationMs)
  const target = players.find((p) => p.clientNum === follow)

  /*
   * A demo only holds what the recorder could see, so a chosen POV can be
   * out of view for stretches of it. The live viewer warns per moment; a
   * finished mp4 cannot -- it just shows a stale position, permanently, on
   * YouTube. Flagged when the engine currently reports the target as absent,
   * which is a hint rather than coverage analysis: Sora reviews every render
   * before it publishes, and a person watching beats anything cheap here.
   */
  const povWarning = camera === "follow" && follow >= 0 && target && !target.visible

  async function submit() {
    setPending(true)
    setError(null)
    const result = await requestRender(demoId, {
      title,
      description,
      protagonistPlayerId: protagonistId,
      camMode: camera === "free" ? "free" : "follow",
      followClientId: camera === "free" ? null : follow >= 0 ? follow : null,
      startMs: 0,
      endMs: durationMs,
    })
    setPending(false)
    if (result.success) setDone(true)
    else setError(result.error)
  }

  /*
   * Shown disabled rather than hidden while the engine starts.
   *
   * The dialog needs the camera and the roster, which only exist once the
   * engine is up -- but a control that is absent for the first few seconds and
   * then appears reads as a glitch, and someone who looked early concludes the
   * feature is not there at all.
   */
  const waiting = !getCameraState

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        {/* YouTube red rather than the outline default -- this is the one
            control on the page that sends something off Soracle entirely, and
            it should not look like the edit buttons beside it. */}
        <Button
          size="sm"
          disabled={waiting}
          className="bg-[#FF0033] text-white hover:bg-[#d9002b] disabled:bg-[#FF0033]/40"
        >
          <Youtube className="mr-1.5 h-3.5 w-3.5" />
          {waiting ? "Upload to YouTube (starting player…)" : "Upload to YouTube"}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Render for YouTube</DialogTitle>
          <DialogDescription>
            This queues a render. Nothing publishes until an admin has watched it.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 py-2">
            <p className="text-sm">
              Queued. It renders in roughly {est?.minutes ?? "a few"} minutes, then waits for review.
            </p>
            <Button size="sm" onClick={() => setOpen(false)}>
              Close
            </Button>
          </div>
        ) : (
          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <Label htmlFor="yt-title">Video title</Label>
              <Input id="yt-title" value={title} onChange={(e) => setTitle(e.target.value)} maxLength={100} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="yt-desc">Description (optional)</Label>
              <Textarea
                id="yt-desc"
                rows={2}
                value={description}
                onChange={(e) => setDescription(e.target.value)}
              />
            </div>

            <div className="space-y-1.5">
              <Label>Camera</Label>
              <p className="text-sm text-muted-foreground">
                {camera === "free"
                  ? "Free camera, as framed in the player."
                  : follow >= 0 && target
                    ? `Following ${target.name}.`
                    : "The recorder's own view."}
              </p>
              <p className="text-xs text-muted-foreground">
                Set the camera how you want it in the player, then reopen this to pick it up.
              </p>
            </div>

            {povWarning && (
              <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
                <p className="text-xs">
                  <span className="font-medium">{target?.name} isn&apos;t in view right now.</span> A demo
                  only contains what the recorder could see, so stretches where they&apos;re out of sight
                  will render as a frozen position — and the video can&apos;t warn anyone the way the player
                  does. Worth checking before this goes out.
                </p>
              </div>
            )}

            <div className="rounded-md border p-2.5 text-xs text-muted-foreground">
              {est ? (
                <>
                  Renders at {est.height}p{est.fps}, about {est.minutes} minute
                  {est.minutes === 1 ? "" : "s"}.{" "}
                  {est.height < 1440 || est.fps === 30
                    ? "Longer demos step down so the job finishes inside its time limit."
                    : ""}
                </>
              ) : (
                <>This demo is too long to render in one job, even at 30fps.</>
              )}
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}

            <DialogFooter>
              <Button size="sm" disabled={pending || !est || title.trim().length < 3} onClick={submit}>
                {pending ? "Queueing…" : "Queue render"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}
