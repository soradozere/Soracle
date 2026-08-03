"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import {
  Pause,
  Play,
  Eye,
  Compass,
  Link2,
  Maximize,
  Minimize,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
} from "lucide-react"
import {
  JkdEngine,
  getEngineCanvas,
  FIXED_FOV,
  RANGE_DEFAULT,
  RANGE_MAX,
  RANGE_MIN,
  type CameraMode,
  type DemoPlayerInfo,
} from "@/lib/demo-viewer/jkd-client"
import { cn } from "@/lib/utils"

const SPEEDS = [0.25, 0.5, 1, 2, 4]

// "Chase" used to sit between these -- a third-person mode distinct from
// picking a player to follow. It never got camera-distance controls of its
// own and duplicated what watching a specific player already does (that
// forces third person too, see JkdEngine.setFollow), so it's gone rather
// than half-finished.
const CAMERAS: Array<{ id: CameraMode; label: string; icon: typeof Eye }> = [
  { id: "follow", label: "Follow", icon: Eye },
  { id: "free", label: "Free fly", icon: Compass },
]

const DEFAULT_VOLUME = 0.8

/**
 * Free-camera look speed. The engine's own default of 5 is set for playing
 * with a mouse in hand all match; flying a camera around to look at something
 * wants to cover ground, so the whole range sits higher.
 */
const SENSITIVITY_MIN = 20
const SENSITIVITY_MAX = 40
const SENSITIVITY_DEFAULT = 20

// Kept out of the engine because the engine cannot act on it after boot -- the
// choice has to survive a page load to be applied at all.
const DETAIL_KEY = "soracle.demo.detail"
const readHighDetail = () => localStorage.getItem(DETAIL_KEY) !== "low"

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
  /**
   * Player the library says this demo is about. When set, the viewer opens
   * following them rather than on the recorded view -- which on a raw demobot
   * clip is the bot itself, a spectator floating nowhere near the action.
   */
  followName?: string
  /**
   * Fired once, when the demo has genuinely started playing -- not when the
   * page loaded. What a view count should be counting.
   */
  onPlaybackStarted?: () => void
}

export function DemoViewer({ demoUrl, durationMs = 0, engineBaseUrl, followName, onPlaybackStarted }: DemoViewerProps) {
  // Where the engine's canvas gets parked. React owns this div; it does not
  // own the canvas inside it (see getEngineCanvas).
  const holderRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
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
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const [muted, setMuted] = useState(false)

  // Engine settings the viewer can reach, mirrored here only so the controls
  // can render their current position -- the engine remains the owner.
  const [range, setRange] = useState(RANGE_DEFAULT)
  const [sensitivity, setSensitivity] = useState(SENSITIVITY_DEFAULT)
  const [invertLook, setInvertLook] = useState(false)
  const [smoothMouse, setSmoothMouse] = useState(true)
  const [highDetail, setHighDetail] = useState(true)
  const [restarting, setRestarting] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  // Shown over the picture once the demo runs out, in place of the engine's
  // own dead-end "playback ended" message.
  const [ended, setEnded] = useState(false)

  // Chrome visibility: the bottom bar hides itself once the mouse has left
  // the player and playback is running, like any other video player. It also
  // has to get out of the way entirely -- not just fade -- while the pointer
  // is locked for free-fly look, since there's no cursor to hover with at
  // that point; a slim side strip takes over instead.
  const [hovering, setHovering] = useState(false)
  const [pointerLocked, setPointerLocked] = useState(false)
  // A touch device has no hover to react to, so the bar would either never
  // appear or never leave. There, tapping the picture toggles it instead.
  const [touchOnly, setTouchOnly] = useState(false)
  const [tapShowsChrome, setTapShowsChrome] = useState(true)

  const [elapsed, setElapsed] = useState(0)
  // The match clock, which is what anyone discussing the game would quote --
  // -1 until the demo's gamestate says when the level started.
  const [matchTime, setMatchTime] = useState(-1)
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
  const rangeRef = useRef(RANGE_DEFAULT)
  // A renderer restart stops the demo on its way through, which reaches the
  // viewer as an ordinary end of playback. Without this the quality toggle
  // would flash the replay screen at you every time.
  const restartingRef = useRef(false)
  // The engine reports playback stopping when it tears down whatever was
  // running before a demo is opened, too -- which arrives before the first
  // frame and would otherwise put the replay screen up over a demo that has
  // not started. Only an end that follows actual playback is a real one.
  const playedRef = useRef(false)
  const startedNotifiedRef = useRef(false)
  // Which recording the engine currently holds, so a route change to a
  // different demo can be told apart from a re-render of the same one.
  const loadedUrlRef = useRef<string | null>(null)
  // The chosen speed, readable from callbacks that must not be rebuilt every
  // time it changes -- a seek has to put it back (see requestSeek).
  const speedRef = useRef(1)
  // Where the scrubber currently sits, so the release handler knows the target
  // even though it fires on the window rather than on the input.
  const scrubValueRef = useRef(0)
  // Held in a ref so the polling effect never has to restart just because the
  // parent re-rendered and handed us a new closure.
  const onStartedRef = useRef(onPlaybackStarted)
  onStartedRef.current = onPlaybackStarted

  const base =
    engineBaseUrl ?? process.env.NEXT_PUBLIC_DEMO_ENGINE_URL ?? "http://127.0.0.1:8090"

  /**
   * Open where the link says: `?t=204&cam=free&follow=3`.
   *
   * Seeking has to wait for the first frame -- the engine works in absolute
   * server time and cannot convert a position until a snapshot has told it
   * where the demo starts. So this polls for playback rather than seeking
   * straight after load, which silently does nothing.
   */
  const applyLinkState = useCallback(async (engine: JkdEngine) => {
    const params = new URLSearchParams(window.location.search)

    const cam = params.get("cam")
    if (cam === "free" || cam === "follow") {
      engine.setCameraMode(cam)
      setCamera(cam)
    }

    const followParam = Number(params.get("follow"))
    if (Number.isInteger(followParam) && followParam >= 0 && followParam < 32) {
      engine.setFollow(followParam)
      setFollow(followParam)
    }

    const seconds = Number(params.get("t"))
    if (!Number.isFinite(seconds) || seconds <= 0) return
    for (let i = 0; i < 100; i++) {
      if (engine.getElapsed() >= 0) break
      await new Promise((r) => setTimeout(r, 100))
    }
    if (engine.getElapsed() < 0) return
    setSeeking(true)
    await engine.seekTo(seconds * 1000)
    setSeeking(false)
  }, [])

  /**
   * Open behind the demo's protagonist.
   *
   * The recorded view belongs to whoever held the camera, and on a raw
   * demobot clip that is the bot -- a spectator floating nowhere near the
   * play the clip was cut for. When the library knows who a demo is about,
   * start on them. A shared link's own camera state still wins, and a name
   * that can't be matched unambiguously against the demo's players leaves
   * the recorded view alone. Matching is on normalised names because the
   * library says "sora" while the demo says "^8^5^8sora" or "[TSB] sora".
   */
  const applyDefaultFollow = useCallback(
    async (engine: JkdEngine) => {
      if (!followName) return
      const params = new URLSearchParams(window.location.search)
      if (params.get("cam") || params.get("follow")) return
      const wanted = normaliseName(followName)
      if (!wanted) return
      // Players come from the gamestate's configstrings, which arrive a
      // moment after the demo opens.
      for (let i = 0; i < 100; i++) {
        const players = engineRef.current === engine ? engine.getPlayers() : []
        if (players.length > 0) {
          const norm = players.map((p) => ({ p, n: normaliseName(p.name) }))
          const exact = norm.filter((x) => x.n === wanted)
          const partial = norm.filter((x) => x.n.includes(wanted))
          const hit = exact.length === 1 ? exact[0] : exact.length === 0 && partial.length === 1 ? partial[0] : null
          if (hit) {
            engine.setFollow(hit.p.clientNum)
            setFollow(hit.p.clientNum)
          }
          return
        }
        await new Promise((r) => setTimeout(r, 100))
      }
    },
    [followName],
  )

  // ---- boot ---------------------------------------------------------------

  useEffect(() => {
    if (!holderRef.current) return
    let cancelled = false

    // Reclaim the page's one canvas. On a first visit this creates it; on a
    // move from one demo to another it takes the live one -- context and all --
    // out of the unmounted viewer and puts it in this one.
    const canvas = getEngineCanvas()
    holderRef.current.appendChild(canvas)
    canvasRef.current = canvas

    // Read here rather than in a state initialiser: this only exists in the
    // browser, and the engine needs it before its first frame.
    const detail = readHighDetail()
    setHighDetail(detail)

    const engine = new JkdEngine({
      baseUrl: base,
      canvas,
      highDetail: detail,
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
        if (cancelled || restartingRef.current || !playedRef.current) return
        if (real > 0) setSpan(real)
        setEnded(true)
      },
    })

    engineRef.current = engine

    engine
      .start()
      .then(() => {
        if (cancelled) return
        setReady(true)
        setStatus("Loading demo…")
        // Claimed before the load starts, so the demo-swap effect below can
        // tell "already loading this one" from "the route changed".
        loadedUrlRef.current = demoUrl
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
        engine.setVolume(DEFAULT_VOLUME)
        engine.setFov(FIXED_FOV)
        engine.setSensitivity(SENSITIVITY_DEFAULT)
        return applyLinkState(engine).then(() => applyDefaultFollow(engine))
      })
      .catch((err: Error) => {
        if (cancelled) return
        setFailed(err.message)
        setStatus(null)
      })

    return () => {
      cancelled = true
      // The engine outlives this component -- a wasm module cannot be
      // unloaded -- so leaving it alone means a demo that is no longer on
      // screen carries on playing its sound over whatever page you moved to.
      engine.suspend()
    }
    // The engine is a singleton for the lifetime of the page; re-running this
    // on a prop change would try to boot a second one over the first.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Moving between demos, without rebooting the engine.
   *
   * The route keeps this component mounted when you go from one demo to the
   * next -- same component, different props -- so the boot effect above does
   * not run again, and the engine (with its 120MB of loaded assets) is still
   * right there. Swapping the recording into it is all "navigating" needs to
   * mean: a couple of seconds instead of a full reload.
   */
  useEffect(() => {
    if (!ready) return
    const engine = engineRef.current
    if (!engine || loadedUrlRef.current === demoUrl) return
    loadedUrlRef.current = demoUrl
    let cancelled = false

    // Everything on screen belongs to the demo being left behind.
    setEnded(false)
    setElapsed(0)
    setMatchTime(-1)
    setFollow(-1)
    setPlayers([])
    setSpan(Math.max(durationMs, 1000))
    setKillMessage(null)
    setAnnouncement(null)
    killShownAtRef.current = -1
    announceShownAtRef.current = -1
    playedRef.current = false
    startedNotifiedRef.current = false
    setFailed(null)
    setStatus("Loading demo…")

    engine
      .loadDemo(demoUrl, (f) => {
        setStatus("Loading demo…")
        setProgress(f)
      })
      .then(() => {
        if (cancelled) return
        setStatus(null)
        setProgress(-1)
        engine.setCameraMode("follow")
        engine.setSpeed(1)
        engine.setPaused(false)
        engine.setFov(FIXED_FOV)
        setCamera("follow")
        speedRef.current = 1
        setSpeed(1)
        setPaused(false)
        return applyDefaultFollow(engine)
      })
      .catch((err: Error) => {
        if (cancelled) return
        setFailed(err.message)
        setStatus(null)
      })

    return () => {
      cancelled = true
    }
  }, [demoUrl, ready, durationMs, applyDefaultFollow])

  // ---- poll engine state ---------------------------------------------------

  useEffect(() => {
    if (!ready) return
    const engine = engineRef.current!

    const id = window.setInterval(() => {
      setSeeking(engine.isSeeking)
      setSpan(engine.getDuration(durationMs))

      const now = engine.getElapsed()
      if (now >= 0 && !draggingRef.current && !engine.isSeeking) setElapsed(now)
      if (now > 3000) {
        playedRef.current = true
        // Separate from playedRef, which a replay resets -- watching twice in
        // one sitting is one view, not two.
        if (!startedNotifiedRef.current) {
          startedNotifiedRef.current = true
          onStartedRef.current?.()
        }
      }
      setMatchTime(engine.getMatchTime())

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
    speedRef.current = s
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
      // Going backwards reopens the demo, and the engine treats that as a
      // disconnect -- which resets timescale to 1 "in case we dropped from a
      // timescaled demo". Watching in slow motion is not dropping out of it,
      // so the chosen speed goes back on afterwards.
      engine.setSpeed(speedRef.current)
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
    // Scrubbing back into the demo is its own way of un-ending it.
    setEnded(false)
    draggingRef.current = true
    scrubValueRef.current = engine.getElapsed()
    resumeAfterSeekRef.current = !paused
    engine.setPaused(true)
    setPaused(true)
  }, [paused])

  const onScrubMove = useCallback(
    (value: number) => {
      scrubValueRef.current = value
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

  /**
   * End the drag wherever the pointer happens to be let go.
   *
   * Safari does not reliably deliver pointerup to the range input the gesture
   * started on, so a handler bound there can simply never run: the drag stays
   * open, the scrubber keeps following the mouse with no button held, and the
   * next click is what finally commits it. The window always sees the release.
   */
  useEffect(() => {
    const end = () => {
      if (!draggingRef.current) return
      onScrubEnd(scrubValueRef.current)
    }
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    return () => {
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
    }
  }, [onScrubEnd])

  const changeRange = useCallback((next: number) => {
    const v = clamp(next, RANGE_MIN, RANGE_MAX)
    rangeRef.current = v
    setRange(v)
    engineRef.current?.setThirdPersonRange(v)
  }, [])

  /**
   * The wheel pulls the camera in and out, the way it would in any other
   * third-person view. Field of view is fixed (see FIXED_FOV) -- it used to be
   * on the wheel, but zoom is not what a scroll means when you are watching
   * someone play.
   *
   * Bound natively rather than through onWheel because React registers wheel
   * listeners as passive, where preventDefault is ignored -- and without it the
   * page scrolls out from under the player while you adjust the camera.
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const onWheel = (e: WheelEvent) => {
      if (!engineRef.current) return
      e.preventDefault()
      // Free fly is its own camera; there is no player to orbit.
      if (camera === "free") return
      changeRange(rangeRef.current + (e.deltaY > 0 ? 20 : -20))
    }
    canvas.addEventListener("wheel", onWheel, { passive: false })
    return () => canvas.removeEventListener("wheel", onWheel)
  }, [camera, changeRange])

  const replay = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    setEnded(false)
    setElapsed(0)
    // Reopening stops the finished demo first, and that stop must not be read
    // as the new run ending before it has begun.
    playedRef.current = false
    engine.replay()
    engine.setPaused(false)
    setPaused(false)
  }, [])

  /**
   * Quality switch.
   *
   * High detail renders at the display's real pixel density, which is what
   * makes player models look sharp rather than smeared. On a 2x screen that is
   * four times the pixels -- though measuring it did not show a frame rate
   * cost, so the engine is spending its time somewhere other than fill rate.
   * Offered as something to try on a slower machine, not as a promised win.
   *
   * Reloads the page, which is heavy-handed but honest: r_highdpi is read when
   * the renderer starts, and the in-place vid_restart that would avoid this
   * comes back with a black world in this build.
   */
  const chooseDetail = useCallback((on: boolean) => {
    setHighDetail(on)
    setRestarting(true)
    localStorage.setItem(DETAIL_KEY, on ? "high" : "low")
    window.location.reload()
  }, [])

  const changeSensitivity = useCallback((v: number) => {
    setSensitivity(v)
    engineRef.current?.setSensitivity(v)
  }, [])

  const toggleInvert = useCallback((on: boolean) => {
    setInvertLook(on)
    engineRef.current?.setInvertLook(on)
  }, [])

  const toggleSmoothing = useCallback((on: boolean) => {
    setSmoothMouse(on)
    engineRef.current?.setMouseSmoothing(on)
  }, [])

  /**
   * A link back to this exact moment, with the camera you are using.
   *
   * Rounded to the second: nobody sharing a clip means millisecond 204,317,
   * and a tidy number survives being pasted into a Discord message and read
   * back out by a human.
   */
  const copyLink = useCallback(async () => {
    const url = new URL(window.location.href)
    url.searchParams.set("t", String(Math.max(0, Math.round(elapsed / 1000))))
    url.searchParams.set("cam", camera)
    if (follow >= 0) url.searchParams.set("follow", String(follow))
    else url.searchParams.delete("follow")
    try {
      await navigator.clipboard.writeText(url.toString())
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      // Clipboard access can be refused (insecure origin, denied permission).
      // Putting it in the address bar still leaves it somewhere copyable.
      window.history.replaceState(null, "", url.toString())
    }
  }, [elapsed, camera, follow])

  const toggleMuted = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    setMuted((m) => {
      engine.setVolume(m ? volume : 0)
      return !m
    })
  }, [volume])

  const changeVolume = useCallback(
    (v: number) => {
      setVolume(v)
      setMuted(false)
      engineRef.current?.setVolume(v)
    },
    [],
  )

  /**
   * Space pauses, M mutes -- as page keys, not engine binds, because they are
   * the two controls that must keep working while the pointer is locked for
   * free-fly and there is no cursor to click anything with. The engine's own
   * SPACE and M binds are cleared at boot (JkdEngine.applyViewerBinds), so
   * nothing double-fires in the game; jump lives on the right mouse button.
   *
   * Anything typed into a page text field never reaches this listener -- the
   * engine's keyboard guard is registered first on the same window and stops
   * those events entirely. A focused button keeps its own Space behaviour.
   */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!ready || e.repeat || e.metaKey || e.ctrlKey || e.altKey) return
      if (e.target instanceof HTMLElement && e.target.closest("button, a, input, select, textarea")) return
      // Match on key as well as code: virtual keyboards and remote-input
      // software deliver real keydowns with an empty `code`.
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault()
        if (ended) replay()
        else togglePaused()
      } else if (e.code === "KeyM" || e.key.toLowerCase() === "m") {
        toggleMuted()
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [ready, ended, replay, togglePaused, toggleMuted])

  // Asked once on mount rather than from a userAgent guess: `hover: none` is
  // the actual question -- can this input device hover at all.
  useEffect(() => {
    setTouchOnly(window.matchMedia("(hover: none)").matches)
  }, [])

  // Free-fly grabs the pointer for mouse-look (SDL's relative mouse mode maps
  // to the browser's real Pointer Lock API). There's no cursor to hover the
  // bar with at that point, so its visibility has to react to lock state, not
  // just mouse position.
  useEffect(() => {
    const onChange = () => setPointerLocked(!!document.pointerLockElement)
    document.addEventListener("pointerlockchange", onChange)
    return () => document.removeEventListener("pointerlockchange", onChange)
  }, [])

  // Nothing is being watched until a snapshot has arrived; asking before that
  // gets -1 back and renders as the literal "client -1".
  const viewClient = follow >= 0 ? follow : ready ? (engineRef.current?.getViewClientNum() ?? -1) : -1
  const watching = viewClient >= 0 ? engineRef.current?.getPlayerName(viewClient) : null

  // Hidden once playing and the mouse has left, or the whole time the
  // pointer is locked (no cursor to hover with). Visible while paused, still
  // loading, mid-scrub or finished, so the controls that matter are never
  // hiding. On touch, where there is no hover, the tap state stands in.
  const showChrome =
    !pointerLocked && ((touchOnly ? tapShowsChrome : hovering) || paused || !ready || seeking || ended)

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      // Only on touch: with a mouse this would fight the hover behaviour, and
      // clicking the picture is how you enter free-fly.
      onClick={touchOnly ? () => setTapShowsChrome((s) => !s) : undefined}
      className={cn(
        "relative h-full w-full overflow-hidden bg-black",
        fullscreen ? "rounded-none" : "rounded-xl",
      )}
    >
      {/* The canvas lives inside here but is not rendered by React -- it is a
          per-page singleton that survives moving between demos, because the
          WebGL context on it cannot be moved to a replacement element. The
          engine owns the drawing buffer too: it picks its own resolution and
          sizes the canvas to match, so nothing here sets width/height, and
          object-contain (on the canvas itself) only scales the result. */}
      <div ref={holderRef} className="absolute inset-0" />

      {/* Match clock. Always up, not tied to the auto-hiding chrome: on a full
          match this is what tells you whether you're watching the first minute
          or the last, and the engine's own scoreboard clock isn't drawn here. */}
      {ready && !failed && matchTime >= 0 && (
        <div className="pointer-events-none absolute left-4 top-4 rounded-md bg-black/55 px-2 py-1 backdrop-blur-sm">
          <span className="text-[10px] uppercase tracking-[0.14em] text-white/45">Match</span>{" "}
          <span className="tabular-nums text-sm font-medium text-white/90">{formatTime(matchTime)}</span>
        </div>
      )}

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
          {/* Only during the big game-data fetch, which is the one download
              worth warning about -- on a slow connection this is the difference
              between "loading" and "is it broken?". */}
          {!failed && progress >= 0 && status === "Loading game data…" && (
            <div className="text-xs text-white/40">
              First visit downloads the game once (~120MB) — instant after that.
            </div>
          )}
        </div>
      )}

      {/* End of the demo. Covers the last frame rather than sitting beside it,
          because that frame is usually a scoreboard or a corpse -- nothing you
          were meant to be left staring at. */}
      {ended && !failed && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 bg-black/60">
          <p className="text-sm uppercase tracking-[0.16em] text-white/60">End of demo</p>
          <button
            onClick={replay}
            className="flex items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
          >
            <RotateCcw className="h-4 w-4" />
            Watch again
          </button>
        </div>
      )}

      {/* Slim side strip while the pointer is locked for free-fly. Not buttons:
          a locked pointer has no cursor, so nothing here can be clicked -- these
          show the keys that work instead, and reflect the current state. */}
      {pointerLocked && (
        <div className="pointer-events-none absolute inset-y-0 right-0 flex flex-col items-end justify-center gap-2 p-3">
          <div className="flex items-center gap-2 rounded-md bg-black/70 px-2.5 py-1.5 text-[11px] text-white/80">
            {paused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
            <span className="font-medium">Space</span>
          </div>
          <div className="flex items-center gap-2 rounded-md bg-black/70 px-2.5 py-1.5 text-[11px] text-white/80">
            {muted ? <VolumeX className="h-3.5 w-3.5" /> : <Volume2 className="h-3.5 w-3.5" />}
            <span className="font-medium">M</span>
          </div>
          <div className="rounded-md bg-black/70 px-2 py-1 text-[11px] text-white/70">
            Right-click to fly up · Esc to release
          </div>
        </div>
      )}

      {/* Controls. */}
      <div
        className={cn(
          "absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-4 pt-10 transition-opacity duration-300",
          showChrome ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      >
        {/* Deliberately not a Radix popover: those portal to <body>, which is
            outside the fullscreen element, so the panel would vanish exactly
            when the player is at its most useful. Living inside the control
            bar also means it hides with the rest of the chrome. */}
        {settingsOpen && (
          <div className="absolute bottom-full right-4 mb-2 w-64 rounded-xl border border-white/10 bg-black/90 p-1.5 shadow-xl backdrop-blur">
            <SettingToggle
              label="High detail"
              hint={restarting ? "Reloading…" : "Sharper models. Turn off if playback stutters. Reloads the player."}
              on={highDetail}
              onChange={chooseDetail}
            />
            <div className="my-1 border-t border-white/10" />
            <SettingSlider
              label="Camera distance"
              value={range}
              display={range < 16 ? "First person" : String(range)}
              min={RANGE_MIN}
              max={RANGE_MAX}
              step={4}
              onChange={changeRange}
            />
            <SettingSlider
              label="Mouse sensitivity"
              value={sensitivity}
              display={sensitivity.toFixed(0)}
              min={SENSITIVITY_MIN}
              max={SENSITIVITY_MAX}
              step={1}
              onChange={changeSensitivity}
            />
            <SettingToggle label="Invert look" on={invertLook} onChange={toggleInvert} />
            <SettingToggle
              label="Smooth mouse"
              hint="Averages movement, for browser frame timing."
              on={smoothMouse}
              onChange={toggleSmoothing}
            />
          </div>
        )}

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
            // The release is handled on the window, not here -- see the effect
            // by onScrubEnd for why.
            onKeyUp={(e) => {
              if (draggingRef.current) return
              onScrubEnd((Number((e.target as HTMLInputElement).value) / 1000) * span)
            }}
            className="h-1 flex-1 cursor-pointer accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40"
          />
          <span className="tabular-nums">{formatTime(span)}</span>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <button
            onClick={togglePaused}
            disabled={!ready}
            title={paused ? "Play (Space)" : "Pause (Space)"}
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

          <div className="ml-auto flex items-center gap-1.5">
            <button
              onClick={toggleMuted}
              title={muted ? "Unmute (M)" : "Mute (M)"}
              className="rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <input
              type="range"
              min={0}
              max={100}
              value={muted ? 0 : Math.round(volume * 100)}
              onChange={(e) => changeVolume(Number(e.target.value) / 100)}
              className="h-1 w-16 cursor-pointer accent-cyan-400"
              aria-label="Volume"
            />
            <button
              onClick={copyLink}
              title="Copy a link to this moment"
              className="flex items-center gap-1.5 rounded-md bg-white/10 px-2 py-1.5 text-xs text-white hover:bg-white/20"
            >
              <Link2 className="h-4 w-4" />
              {copied ? "Copied" : "Share"}
            </button>
            <button
              onClick={() => setSettingsOpen((s) => !s)}
              title="Settings"
              aria-expanded={settingsOpen}
              className={cn(
                "rounded-md p-1.5 text-white hover:bg-white/20",
                settingsOpen ? "bg-white/25" : "bg-white/10",
              )}
            >
              <Settings className="h-4 w-4" />
            </button>
          </div>

          <button
            onClick={toggleFullscreen}
            title={fullscreen ? "Exit full screen" : "Full screen"}
            className="rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"
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

/** Case, clan tags and punctuation all vary; letters and digits are the name. */
function normaliseName(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "")
}

function SettingToggle({ label, hint, on, onChange }: { label: string; hint?: string; on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className="flex w-full items-start justify-between gap-3 rounded-md px-2 py-1.5 text-left hover:bg-white/10"
    >
      <span className="min-w-0">
        <span className="block text-xs text-white">{label}</span>
        {hint && <span className="block text-[11px] leading-tight text-white/45">{hint}</span>}
      </span>
      <span
        className={cn(
          "mt-0.5 flex h-4 w-7 shrink-0 items-center rounded-full p-0.5 transition-colors",
          on ? "bg-cyan-500" : "bg-white/20",
        )}
      >
        <span className={cn("h-3 w-3 rounded-full bg-white transition-transform", on && "translate-x-3")} />
      </span>
    </button>
  )
}

function SettingSlider({
  label,
  value,
  display,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string
  value: number
  display: string
  min: number
  max: number
  step?: number
  onChange: (v: number) => void
}) {
  return (
    <label className="block px-2 py-1.5">
      <span className="mb-1 flex items-center justify-between text-xs text-white">
        {label}
        <span className="tabular-nums text-white/50">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer accent-cyan-400"
      />
    </label>
  )
}

function formatTime(ms: number) {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = String(total % 60).padStart(2, "0")
  if (m < 60) return `${m}:${s}`
  return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, "0")}:${s}`
}
