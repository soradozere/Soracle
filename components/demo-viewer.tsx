"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Pause, Play, Eye, Video, Compass, Maximize, Minimize } from "lucide-react"
import { JkdEngine, type CameraMode, type DemoPlayerInfo } from "@/lib/demo-viewer/jkd-client"
import { cn } from "@/lib/utils"

const SPEEDS = [0.25, 0.5, 1, 2, 4]

const CAMERAS: Array<{ id: CameraMode; label: string; icon: typeof Eye }> = [
  { id: "follow", label: "Follow", icon: Eye },
  { id: "chase", label: "Chase", icon: Video },
  { id: "free", label: "Free fly", icon: Compass },
]

interface DemoViewerProps {
  /** URL of the .dm_15 to play. */
  demoUrl: string
  /**
   * Known length in milliseconds. The format states no duration, so without
   * this the scrubber can only span what has been watched so far -- which on a
   * long demo looks like a bar that refuses to move.
   */
  durationMs?: number
  /** Where the engine's own js/wasm/data are served from, no trailing slash. */
  engineBaseUrl?: string
}

export function DemoViewer({ demoUrl, durationMs = 0, engineBaseUrl }: DemoViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<JkdEngine | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  const [status, setStatus] = useState<string | null>("Starting the engine…")
  // -1 when there is nothing measurable to show, otherwise 0..1.
  const [progress, setProgress] = useState(-1)
  const [failed, setFailed] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [camera, setCamera] = useState<CameraMode>("follow")
  const [follow, setFollow] = useState(-1)
  const [players, setPlayers] = useState<DemoPlayerInfo[]>([])

  const [elapsed, setElapsed] = useState(0)
  const [span, setSpan] = useState(Math.max(durationMs, 1000))
  const [seeking, setSeeking] = useState(false)
  const [killMessage, setKillMessage] = useState<{ lead: string; who: string } | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)

  // Scrub state lives in refs: the drag handlers run far more often than React
  // should re-render, and the gesture has to survive a re-render mid-drag.
  const draggingRef = useRef(false)
  const resumeAfterSeekRef = useRef(false)
  const pendingTargetRef = useRef<number | null>(null)
  const killShownAtRef = useRef(-1)
  const announceShownAtRef = useRef(-1)

  const base =
    engineBaseUrl ?? process.env.NEXT_PUBLIC_DEMO_ENGINE_URL ?? "http://127.0.0.1:8090"

  // ---- boot ---------------------------------------------------------------

  useEffect(() => {
    if (!canvasRef.current) return
    let cancelled = false

    const engine = new JkdEngine({
      baseUrl: base,
      canvas: canvasRef.current,
      onStatus: (s) => {
        if (cancelled) return
        // The engine reports its asset download as "... (received/total)".
        // That bundle is hundreds of megabytes, so a bare line of text reads as
        // a page that has hung -- turn it into a real progress bar.
        const m = /\((\d+)\s*\/\s*(\d+)\)/.exec(s || "")
        if (m && Number(m[2]) > 0) {
          setProgress(Number(m[1]) / Number(m[2]))
          setStatus("Loading game data…")
        } else {
          setProgress(-1)
          setStatus(s || null)
        }
      },
      onKill: ({ target, attacker, viewed }) => {
        if (cancelled || viewed < 0) return
        // World deaths and suicides arrive with the attacker outside the client
        // range or equal to the target; neither of those names anyone.
        const byPlayer = attacker >= 0 && attacker < 32 && attacker !== target
        if (!byPlayer) return
        if (attacker === viewed) {
          setKillMessage({ lead: "You killed ", who: engine.getPlayerName(target) })
        } else if (target === viewed) {
          setKillMessage({ lead: "Killed by ", who: engine.getPlayerName(attacker) })
        } else {
          return
        }
        killShownAtRef.current = engine.getElapsed()
      },
      onAnnouncement: (text) => {
        if (cancelled) return
        setAnnouncement(text)
        announceShownAtRef.current = engine.getElapsed()
      },
      onPlaybackEnded: (real) => {
        if (cancelled) return
        if (real > 0) setSpan(real)
        setStatus("Playback ended.")
      },
    })

    engineRef.current = engine

    engine
      .start()
      .then(() => {
        if (cancelled) return
        setReady(true)
        setStatus("Loading demo…")
        return engine.loadDemo(demoUrl, (f) => {
          setStatus("Loading demo…")
          setProgress(f)
        })
      })
      .then(() => {
        if (cancelled) return
        setStatus(null)
        setProgress(-1)
        engine.setCameraMode("follow")
        engine.setSpeed(1)
        engine.setPaused(false)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setFailed(err.message)
        setStatus(null)
      })

    return () => {
      cancelled = true
    }
    // The engine is a singleton for the lifetime of the page; re-running this
    // on a prop change would try to boot a second one over the first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---- poll engine state ---------------------------------------------------

  useEffect(() => {
    if (!ready) return
    const engine = engineRef.current!

    const id = window.setInterval(() => {
      setSeeking(engine.isSeeking)
      setSpan(engine.getDuration(durationMs))

      const now = engine.getElapsed()
      if (now >= 0 && !draggingRef.current && !engine.isSeeking) setElapsed(now)

      setPlayers(engine.getPlayers())

      // Kill messages expire on demo time, not wall time: one that faded while
      // the demo was paused would be gone before you looked at it, and one left
      // over from before a seek would describe a kill that hasn't happened yet.
      if (killShownAtRef.current >= 0 && now >= 0) {
        const age = now - killShownAtRef.current
        if (age < 0 || age > 3000) {
          killShownAtRef.current = -1
          setKillMessage(null)
        }
      }
      if (announceShownAtRef.current >= 0 && now >= 0) {
        const age = now - announceShownAtRef.current
        if (age < 0 || age > 4000) {
          announceShownAtRef.current = -1
          setAnnouncement(null)
        }
      }
    }, 200)

    return () => window.clearInterval(id)
  }, [ready, durationMs])

  // ---- controls ------------------------------------------------------------

  const togglePaused = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    setPaused((p) => {
      engine.setPaused(!p)
      return !p
    })
  }, [])

  const chooseSpeed = useCallback((s: number) => {
    engineRef.current?.setSpeed(s)
    setSpeed(s)
  }, [])

  const chooseCamera = useCallback((mode: CameraMode) => {
    engineRef.current?.setCameraMode(mode)
    setCamera(mode)
  }, [])

  const chooseFollow = useCallback((clientNum: number) => {
    engineRef.current?.setFollow(clientNum)
    setFollow(clientNum)
  }, [])

  const toggleFullscreen = useCallback(() => {
    if (document.fullscreenElement) void document.exitFullscreen()
    else void containerRef.current?.requestFullscreen()
  }, [])

  // Track it from the event rather than from the click: Escape and the browser's
  // own controls leave fullscreen too, and the button would otherwise lie.
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  /**
   * Scrubbing.
   *
   * Three rules keep a drag steady. Playback freezes while the thumb is held, so
   * time doesn't creep forward underneath it. Only one seek is ever in flight,
   * with later positions replacing the pending target rather than stacking up.
   * And backward seeks wait for release: going back has no shortcut in a demo --
   * the engine restarts and replays -- so doing it mid-drag rebuilds the whole
   * client several times a second.
   */
  const requestSeek = useCallback((targetMs: number, allowBackward: boolean) => {
    const engine = engineRef.current
    if (!engine) return
    if (!allowBackward && targetMs < engine.getElapsed()) {
      pendingTargetRef.current = null
      return
    }
    if (engine.isSeeking) {
      pendingTargetRef.current = targetMs
      return
    }
    void engine.seekTo(targetMs).then(() => {
      const queued = pendingTargetRef.current
      pendingTargetRef.current = null
      if (queued !== null) {
        requestSeek(queued, true)
      } else if (resumeAfterSeekRef.current) {
        resumeAfterSeekRef.current = false
        engine.setPaused(false)
        setPaused(false)
      }
    })
  }, [])

  const onScrubStart = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    draggingRef.current = true
    resumeAfterSeekRef.current = !paused
    engine.setPaused(true)
    setPaused(true)
  }, [paused])

  const onScrubMove = useCallback(
    (value: number) => {
      setElapsed(value)
      if (draggingRef.current) requestSeek(value, false)
    },
    [requestSeek],
  )

  const onScrubEnd = useCallback(
    (value: number) => {
      draggingRef.current = false
      pendingTargetRef.current = null
      requestSeek(value, true)
    },
    [requestSeek],
  )

  // The wheel drives the camera rather than switching weapons, which is
  // meaningless when you are watching rather than playing.
  const onWheel = useCallback(
    (e: React.WheelEvent) => {
      const engine = engineRef.current
      if (!engine) return
      e.preventDefault()
      const step = e.deltaY > 0 ? 1 : -1
      // Distance only means something in chase. Following a player now puts you
      // in their eyes, where there is no distance to change -- so the wheel goes
      // back to field of view there, as it does for the free camera.
      if (camera === "chase") {
        const next = clamp(engine.getCvarNumber("cg_thirdPersonRange") + step * 15, 20, 400)
        engine.setChaseRange(next)
      } else {
        const next = clamp(engine.getCvarNumber("cg_fov") + step * 3, 60, 130)
        engine.setFov(next)
      }
    },
    [camera],
  )

  // Nothing is being watched until a snapshot has arrived; asking before that
  // gets -1 back and renders as the literal "client -1".
  const viewClient = follow >= 0 ? follow : ready ? (engineRef.current?.getViewClientNum() ?? -1) : -1
  const watching = viewClient >= 0 ? engineRef.current?.getPlayerName(viewClient) : null

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative h-full w-full overflow-hidden bg-black",
        fullscreen ? "rounded-none" : "rounded-xl",
      )}
    >
      <canvas
        ref={canvasRef}
        // The engine looks its render target up by this exact id.
        id="canvas"
        onWheel={onWheel}
        onContextMenu={(e) => e.preventDefault()}
        // The engine owns the drawing buffer -- it picks its own resolution from
        // r_customwidth and sizes the canvas to match. Setting width/height here
        // would leave its viewport rendering into one corner of a larger buffer,
        // so this only ever scales the result: object-contain keeps the aspect
        // ratio the engine chose rather than stretching the picture.
        className="absolute inset-0 h-full w-full object-contain"
        tabIndex={-1}
      />

      {/* Who is being watched. */}
      {ready && !failed && camera !== "free" && watching && (
        <div className="pointer-events-none absolute inset-x-0 top-5 text-center">
          <div className="text-[11px] uppercase tracking-[0.16em] text-white/60">Watching</div>
          <div className="text-xl font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
            {watching}
          </div>
        </div>
      )}
      {ready && !failed && camera === "free" && (
        <div className="pointer-events-none absolute inset-x-0 top-5 text-center text-xl font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
          Free camera
        </div>
      )}

      {/* Flag and scoring announcements, forwarded from the engine's centre
          prints. Sits above the kill message, since the two often land together
          -- someone scoring and someone dying tend to be the same moment. */}
      {announcement && (
        <div className="pointer-events-none absolute inset-x-0 top-[18%] text-center text-lg font-semibold uppercase tracking-wide text-cyan-300 drop-shadow-[0_2px_14px_rgba(0,0,0,0.9)]">
          {announcement}
        </div>
      )}

      {/* Kill message. The engine draws its own, but its 2D text rasterises as
          blank glyphs in the wasm build, so it is suppressed there and drawn
          here where it can match the rest of the site. */}
      {killMessage && (
        <div className="pointer-events-none absolute inset-x-0 top-[26%] text-center text-[27px] font-medium text-white/95 drop-shadow-[0_2px_14px_rgba(0,0,0,0.9)]">
          {killMessage.lead}
          <b className="font-bold">{killMessage.who}</b>
        </div>
      )}

      {(status || failed) && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className={cn("text-sm", failed ? "text-red-300" : "text-white/70")}>
            {failed ?? status}
          </div>
          {!failed && progress >= 0 && (
            <div className="h-1 w-56 overflow-hidden rounded-full bg-white/15">
              <div
                className="h-full rounded-full bg-cyan-400 transition-[width] duration-150"
                style={{ width: `${Math.round(progress * 100)}%` }}
              />
            </div>
          )}
        </div>
      )}

      {/* Controls. */}
      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-10">
        <div className="mb-2 flex items-center gap-3 text-xs text-white/70">
          <span className="tabular-nums">{seeking ? "seeking…" : formatTime(elapsed)}</span>
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((1000 * elapsed) / Math.max(span, 1))}
            disabled={!ready || span <= 1000}
            onPointerDown={onScrubStart}
            onChange={(e) => onScrubMove((Number(e.target.value) / 1000) * span)}
            onPointerUp={(e) =>
              onScrubEnd((Number((e.target as HTMLInputElement).value) / 1000) * span)
            }
            className="h-1 flex-1 cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className="tabular-nums">{formatTime(span)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={togglePaused}
            disabled={!ready}
            className="flex items-center gap-1.5 rounded-md bg-white/10 px-3 py-1.5 text-sm text-white hover:bg-white/20 disabled:opacity-40"
          >
            {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
            {paused ? "Play" : "Pause"}
          </button>

          <div className="flex items-center gap-1">
            <span className="mr-1 text-[11px] uppercase tracking-wider text-white/50">Speed</span>
            {SPEEDS.map((s) => (
              <button
                key={s}
                onClick={() => chooseSpeed(s)}
                disabled={!ready}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  speed === s ? "bg-cyan-500 text-black" : "bg-white/10 text-white hover:bg-white/20",
                )}
              >
                {s}×
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1">
            <span className="mr-1 text-[11px] uppercase tracking-wider text-white/50">Camera</span>
            {CAMERAS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => chooseCamera(id)}
                disabled={!ready}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-xs",
                  camera === id ? "bg-cyan-500 text-black" : "bg-white/10 text-white hover:bg-white/20",
                )}
              >
                <Icon className="h-3 w-3" />
                {label}
              </button>
            ))}
          </div>

          <button
            onClick={toggleFullscreen}
            title={fullscreen ? "Exit full screen" : "Full screen"}
            className="ml-auto rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"
          >
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>

        {players.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-white/50">Watching</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => chooseFollow(-1)}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  follow === -1 ? "bg-cyan-500 text-black" : "bg-white/10 text-white hover:bg-white/20",
                )}
              >
                Recorded view
              </button>
              {players.map((p) => (
                <button
                  key={p.clientNum}
                  onClick={() => chooseFollow(p.clientNum)}
                  title={p.visible ? undefined : "Not in view at this moment"}
                  className={cn(
                    "rounded border px-2 py-1 text-xs",
                    follow === p.clientNum
                      ? "border-transparent bg-cyan-500 text-black"
                      : "bg-white/10 text-white hover:bg-white/20",
                    p.team === 1 ? "border-red-400/60" : "border-blue-400/60",
                    !p.visible && follow !== p.clientNum && "opacity-50",
                  )}
                >
                  {p.name}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function clamp(v: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, v))
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, "0")
  if (m < 60) return `${m}:${s}`
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}`
}
