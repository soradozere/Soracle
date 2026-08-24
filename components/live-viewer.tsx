"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { Maximize2, Minimize2 } from "lucide-react"
import { JkdEngine } from "@/lib/demo-viewer/jkd-client"
import { formatReport, liveProbe, type LiveProbeReport } from "@/lib/demo-viewer/live-probe"
import { LIVE_SERVERS, describeLiveStatus, type LiveStatus } from "@/lib/live-servers"

/**
 * Watch a live match.
 *
 * Deliberately a thin page rather than a mode inside `demo-viewer.tsx`. That
 * component is ~2,500 lines and 120 hooks of demo-shaped state, and it drives
 * the site's most-used feature; adding a live branch through it was the larger
 * risk. The engine is shared either way -- `JkdEngine` is a page-scoped
 * singleton and live is simply another source of frames, which is the part of
 * "one player, two inputs" that actually matters.
 *
 * The intent is to lift the genuinely shared pieces (POV picker, camera
 * controls, kill feed) into components both pages use, once live has proven
 * what it really needs. Until then this keeps its own chrome minimal so that
 * convergence stays cheap.
 */

type Phase =
  | "idle"
  | "connecting"
  | "active"
  | "dropped"
  | "timedout"
  | "superseded"
  | "error"
  | "unsupported"

/**
 * Close code the bridge sends when a newer session for the same account takes
 * over. Reconnecting on it would start a fight with the tab that just replaced
 * this one -- each booting the other every few seconds, indefinitely, since a
 * connection that succeeds resets the backoff.
 */
const CLOSE_SUPERSEDED = 4409

/**
 * Backoff for an unexpected drop.
 *
 * Starts above three seconds because that is `sv_reconnectlimit`: the server
 * ignores a connect message arriving sooner than that after the last one, so
 * an earlier retry is not merely rude, it is thrown away and wasted.
 *
 * Capped at 30s rather than doubling away to a minute-plus. Doubling is the
 * right shape when each attempt is expensive, and these are not: a dial at a
 * dead bridge now fails in about a second (see the close-code check in the
 * state mirror), so the cost of an extra attempt is a WebSocket that refuses
 * immediately. Measured against the alternative -- the first version of this
 * took 2m45s to notice a bridge that had been back for 39 seconds, and used
 * every attempt it had doing so. A flatter tail covers roughly the same total
 * outage while recovering within 30s of the server returning.
 *
 * Finite on purpose. Silently retrying forever is how a page ends up holding a
 * connection nobody is watching.
 */
const RECONNECT_DELAYS_MS = [4000, 6000, 10000, 15000, 20000, 30000, 30000, 30000]

/**
 * How long a viewer can do nothing before we hand their slot back.
 *
 * The server has 32 of them and a spectator holds a real one. Long enough that
 * nobody watching a match ever sees this, short enough that a tab left open
 * overnight is not still occupying a slot at the next game.
 */
const IDLE_LIMIT_MS = 30 * 60 * 1000

/**
 * Brightness, shared with the demo viewer -- same storage key on purpose, so
 * the slider someone set over there is the brightness they get here. The
 * engine's r_gamma does nothing in this build (no post-processing, no display
 * ramp a web page could touch), so it is a CSS gamma curve over the canvas.
 *
 * The helpers are duplicated from demo-viewer.tsx rather than imported: that
 * file does not export them, and threading exports through the site's most
 * used component for a three-function saving is the wrong trade. If a third
 * page ever needs them, lift all three copies into lib/.
 */
const GAMMA_KEY = "soracle.demo.gamma"
const GAMMA_FILTER_ID = "soracle-live-gamma"
// Live defaults brighter than the demo viewer's neutral 1. The demo default
// deliberately shows the recording as rendered and leaves brightness to the
// viewer's slider -- but /live has no slider yet, and JK2 maps are dark
// enough that "as rendered" reads as murky on a first visit. Anyone with a
// stored demo-viewer preference gets that instead, same key, same meaning.
const GAMMA_LIVE_DEFAULT = 0.8
const readGamma = () => {
  if (typeof localStorage === "undefined") return GAMMA_LIVE_DEFAULT
  const stored = Number(localStorage.getItem(GAMMA_KEY))
  if (!Number.isFinite(stored) || stored < 0.5 || stored > 1) return GAMMA_LIVE_DEFAULT
  return stored
}
/** Safari accepts filter:url() on a composited canvas and silently ignores it. */
function prefersShorthandFilter(): boolean {
  if (typeof navigator === "undefined") return false
  return /^((?!chrome|chromium|crios|android|firefox|fxios|edg).)*safari/i.test(navigator.userAgent)
}
function gammaFilterFor(gamma: number): string {
  if (gamma === 1) return ""
  if (!prefersShorthandFilter()) return `url(#${GAMMA_FILTER_ID})`
  const lift = 1 - gamma
  return `brightness(${(1 + lift * 0.9).toFixed(3)}) contrast(${(1 - lift * 0.35).toFixed(3)})`
}

/**
 * How long each overlay keeps a line on the game before letting it fade.
 * The feed is a ticker; a centre print is a moment. (Chat is the engine's own
 * chatbox now, not an overlay here.)
 */
const FEED_OVERLAY_MS = 6000
const ANNOUNCE_MS = 3000

interface StampedLine {
  id: number
  text: string
  at: number
}

/**
 * "Is anything on?", for every server, without downloading a 125MB engine.
 *
 * Polled straight from each bridge rather than through a Soracle API route.
 * The bridges serve this unauthenticated with CORS open, and routing it through
 * Vercel would put a function invocation behind every tab that happens to be
 * sitting on this page -- the same shape of cost as the prefetch cascade that
 * ran the bill up in August.
 *
 * Keyed by server index rather than an array so a slow or dead bridge only
 * leaves its own entry missing instead of holding up the rest.
 */
function useLiveStatuses(active: boolean) {
  const [statuses, setStatuses] = useState<Record<number, LiveStatus | null>>({})

  useEffect(() => {
    // Stops while watching: the viewer can see for themselves, and the engine
    // already holds a live connection to the same box.
    if (active) return
    let cancelled = false

    const poll = async () => {
      await Promise.all(
        LIVE_SERVERS.map(async (server) => {
          let next: LiveStatus | null = null
          try {
            const res = await fetch(server.statusUrl, { cache: "no-store" })
            if (res.ok) next = (await res.json()) as LiveStatus
          } catch {
            // A bridge that is down is itself "nothing to watch". Reported as
            // such rather than as an error, because that is what it means to
            // someone deciding whether to watch.
          }
          if (!cancelled) {
            setStatuses((prev) => ({ ...prev, [server.index]: next }))
          }
        })
      )
    }

    void poll()
    const id = setInterval(poll, 15000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [active])

  return statuses
}

interface LiveViewerProps {
  signedIn: boolean
  playerName: string | null
}

export function LiveViewer({ signedIn, playerName }: LiveViewerProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const engineRef = useRef<JkdEngine | null>(null)
  const [log, setLog] = useState<Array<{ id: number; kind: "chat" | "feed"; text: string }>>([])
  // Open by default. It is the only readable record of what has been said --
  // the engine's own notify text is unreadable in this build -- so hiding it
  // behind a click meant most viewers never knew chat existed at all.
  const [logOpen, setLogOpen] = useState(true)
  const logIdRef = useRef(0)
  const logScrollRef = useRef<HTMLDivElement | null>(null)
  const [panelChat, setPanelChat] = useState("")
  const [panelTeam, setPanelTeam] = useState(false)

  // On-stage overlays, Eternal-style: chat sits low on the picture, the kill
  // feed ticks in the top corner, and centre prints ("You killed ...") land
  // where the game would put them. All drawn here because the engine's own
  // 2D text is unreadable in this build.
  const [feedLines, setFeedLines] = useState<StampedLine[]>([])
  const [announce, setAnnounce] = useState<StampedLine | null>(null)
  const [following, setFollowing] = useState<string | null>(null)
  const [gamma] = useState(readGamma)

  // Capped: a long match would otherwise grow this without limit, and nobody
  // scrolls back past a couple of hundred lines.
  const pushLog = useCallback((kind: "chat" | "feed", text: string) => {
    setLog((prev) => [...prev.slice(-199), { id: logIdRef.current++, kind, text }])
  }, [])

  // Follow the newest line. The panel is open from the start now, so it fills
  // on its own, and a log that quietly scrolls away from what just happened is
  // worse than one you had to open yourself.
  useEffect(() => {
    const el = logScrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [log])
  const [phase, setPhase] = useState<Phase>("idle")
  const [status, setStatus] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [serverIndex, setServerIndex] = useState(0)
  const [chat, setChat] = useState("")
  const [booting, setBooting] = useState(false)
  const statuses = useLiveStatuses(phase === "active" || phase === "connecting")
  const [probeReport, setProbeReport] = useState<LiveProbeReport | null>(null)
  const [probeCvars, setProbeCvars] = useState<string | null>(null)
  const stageRef = useRef<HTMLDivElement | null>(null)
  const [fullscreen, setFullscreen] = useState(false)
  // The CSS stand-in for fullscreen, used where the real API is unavailable.
  const [expanded, setExpanded] = useState(false)
  const filling = fullscreen || expanded

  const server = LIVE_SERVERS.find((s) => s.index === serverIndex) ?? LIVE_SERVERS[0]
  const liveStatus = statuses[serverIndex] ?? null

  // Fullscreen the stage, not the canvas: the chat line and the hint row are
  // absolutely positioned against it, and fullscreening the canvas alone would
  // leave them behind on the page where nobody can see them.
  //
  // Two mechanisms, because one is not available everywhere. iOS Safari
  // implements requestFullscreen on <video> and nothing else, so on a phone --
  // where filling the screen matters most, and where the browser chrome eats
  // the most of it -- the real API simply refuses. The fallback pins the stage
  // over the viewport with CSS, which needs no permission and works anywhere.
  const toggleFullscreen = useCallback(() => {
    const el = stageRef.current
    if (!el) return

    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    if (expanded) {
      setExpanded(false)
      return
    }
    if (typeof el.requestFullscreen === "function") {
      el.requestFullscreen().catch(() => setExpanded(true))
      return
    }
    setExpanded(true)
  }, [expanded])

  // Escape leaves the CSS version too. The real API gets this from the
  // browser; the fallback would otherwise be a room with no door on a device
  // that has a keyboard attached.
  useEffect(() => {
    if (!expanded) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setExpanded(false)
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [expanded])

  // Track the real state rather than assuming our own toggle won: Escape and
  // the browser's own chrome both exit fullscreen without telling us.
  useEffect(() => {
    const sync = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", sync)
    return () => document.removeEventListener("fullscreenchange", sync)
  }, [])

  // Whether the last disconnect was ours. Without this the page cannot tell
  // "the viewer pressed Leave" from "the server went away", and would either
  // reconnect people who chose to stop or strand people who did not.
  const intentionalRef = useRef(false)
  const attemptRef = useRef(0)
  const lastActivityRef = useRef(Date.now())
  // Whether this viewer ever got in at all, so "could not connect" and "lost
  // the connection" are not reported as the same thing.
  const everActiveRef = useRef(false)
  // The name the server confirmed, kept so it can be re-asserted once the
  // connection is up (see the state mirror below).
  const nameRef = useRef<string | null>(null)

  // Boot the engine on demand rather than on mount: it is a ~125MB download,
  // and someone opening /live to see whether anything is on should not pay for
  // it before they have chosen to watch.
  const boot = useCallback(async () => {
    if (engineRef.current || !canvasRef.current) return engineRef.current
    setBooting(true)
    const engine = new JkdEngine({
      baseUrl: process.env.NEXT_PUBLIC_DEMO_ENGINE_URL ?? "http://127.0.0.1:8090",
      canvas: canvasRef.current,
      onStatus: (s) => setStatus(s),
      // Chat and the kill/flag ticker share one log. In game these are
      // separate places on screen, but a spectator reading back over what they
      // missed wants one thing in order, not two half-stories -- and it is the
      // only scrollback there is, since the engine's own console cannot draw
      // text in this build.
      // Each line goes two places: the scrollback panel below the game, and
      // the matching on-stage overlay. The overlays are the watching
      // experience; the panel is the record.
      // Chat is drawn by the engine itself now (its own chatbox, in the
      // game's font, real colour codes) -- the page only keeps the record.
      onChat: (text) => pushLog("chat", text),
      onFeed: (text) => {
        pushLog("feed", text)
        setFeedLines((prev) => [...prev.slice(-4), { id: Date.now() + Math.random(), text, at: Date.now() }])
      },
      onAnnouncement: (text) => {
        pushLog("feed", text)
        setAnnounce({ id: Date.now(), text, at: Date.now() })
      },
      // Same decision the demo viewer makes: the kill only becomes "You
      // killed" or "Killed by" relative to whoever the camera is on. The
      // exports this reads answered nothing on live connections until engine
      // 20260815-1940, which is why this arrived with that build.
      onKill: ({ target, attacker, viewed }) => {
        if (viewed < 0) return
        const byPlayer = attacker >= 0 && attacker < 32 && attacker !== target
        if (!byPlayer) return
        const e = engineRef.current
        if (!e) return
        if (attacker === viewed) {
          setAnnounce({ id: Date.now(), text: `You killed ${e.getPlayerName(target)}`, at: Date.now() })
        } else if (target === viewed) {
          setAnnounce({ id: Date.now(), text: `Killed by ${e.getPlayerName(attacker)}`, at: Date.now() })
        }
      },
    })
    try {
      await engine.start()
      engineRef.current = engine
      return engine
    } finally {
      setBooting(false)
    }
  }, [])

  const connect = useCallback(async () => {
    setError(null)
    intentionalRef.current = false
    lastActivityRef.current = Date.now()
    setPhase("connecting")
    try {
      const engine = await boot()
      if (!engine) throw new Error("The viewer could not start.")

      // The engine that serves the demo library is built without the live
      // connect path, so a page newer than the deployed engine lands here.
      // Say so plainly rather than offering a button that cannot work.
      if (!engine.liveAvailable) {
        setPhase("unsupported")
        return
      }
      const res = await fetch("/api/live/token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ serverIndex }),
      })
      if (res.status === 401) {
        setError("Sign in to watch live.")
        setPhase("error")
        return
      }
      if (!res.ok) throw new Error("Could not get a viewing pass.")
      const { token, name } = await res.json()

      // Before connecting, not after: the name travels in the handshake's
      // userinfo. Taken from the token response rather than the prop, so it
      // is the name the server just confirmed against the players table --
      // whoever appears in game is who the bridge authenticated.
      nameRef.current = name ?? null
      if (name) engine.setPlayerName(name)
      engine.releaseChatKeys()
      engine.applyLiveDefaults()

      if (!engine.connectLive(serverIndex, token)) {
        throw new Error("That server is not available.")
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase("error")
    }
  }, [boot, serverIndex])

  const disconnect = useCallback(() => {
    intentionalRef.current = true
    attemptRef.current = 0
    engineRef.current?.disconnectLive()
    setPhase("idle")
  }, [])

  // Mirror the engine's own connection state rather than tracking a parallel
  // copy: it owns the truth, and a UI that guesses drifts from what is on
  // screen.
  useEffect(() => {
    if (phase !== "connecting" && phase !== "active") return
    const id = setInterval(() => {
      const s = engineRef.current?.getConnectionState() ?? 0
      setPhase((prev) => {
        if (s === 2) {
          // A connection that lasted is proof the trouble has passed, so the
          // backoff starts from scratch next time rather than carrying a
          // penalty from an outage that is over.
          attemptRef.current = 0
          if (!everActiveRef.current) {
            everActiveRef.current = true
            // Say the name again now the connection exists. It is set before
            // connecting, where it rides in the handshake's userinfo -- but a
            // reload has been seen to arrive as "Padawan" anyway, and nothing
            // corrected it afterwards. Re-asserting is a userinfo update the
            // server applies immediately, so the worst case is that it was
            // already right and this changes nothing.
            const name = nameRef.current
            if (name) engineRef.current?.setPlayerName(name)
            // Display defaults again too: the lagometer has been seen staying
            // off despite the pre-connect set, and every command here is
            // idempotent -- re-asserting costs nothing when it was applied.
            engineRef.current?.applyLiveDefaults()
          }
          return "active"
        }
        // Refs are read here rather than state because this closure is
        // recreated only when `phase` changes, and the decision needs the
        // value as it is now.
        const closeCode = engineRef.current?.lastCloseCode ?? 0

        if (s === 0 && prev === "active") {
          if (intentionalRef.current) return "idle"
          // Being replaced by another tab is a decision, not a fault. Retrying
          // would just take the session back off whoever is now using it.
          if (closeCode === CLOSE_SUPERSEDED) return "superseded"
          return "dropped"
        }

        // A dial that has already closed has failed -- there is nothing left
        // to wait for. Measured cost of not checking: a bridge that came back
        // after 39s took 2m45s to be noticed, because each dead attempt sat
        // out the full connecting timeout before the next was even scheduled.
        // `connectLive` zeroes this per attempt, so a code here is this
        // attempt's.
        if (prev === "connecting" && closeCode !== 0) {
          if (closeCode === CLOSE_SUPERSEDED) return "superseded"
          return "dropped"
        }
        return prev
      })
    }, 500)
    return () => clearInterval(id)
  }, [phase])

  // Backstop for a handshake that neither completes nor closes.
  //
  // The common failure -- nothing listening -- is caught in about a second by
  // the close-code check above. This covers the other shape: the WebSocket
  // opens, so nothing closes, but the game server behind it never answers
  // (mid map-change, or wedged). The engine sits in state 1 and the page would
  // otherwise read "Connecting…" forever.
  useEffect(() => {
    if (phase !== "connecting") return
    const id = setTimeout(() => setPhase("dropped"), 20000)
    return () => clearTimeout(id)
  }, [phase])

  // Get back in after an unexpected drop -- a map change, a server restart, a
  // laptop lid. The viewer did not ask to stop watching, so we do the retrying
  // instead of leaving them at a dead canvas wondering.
  useEffect(() => {
    if (phase !== "dropped") return

    const attempt = attemptRef.current
    if (attempt >= RECONNECT_DELAYS_MS.length) {
      // Stop the engine's own re-dial loop too. It retries about twice a
      // second independently of this component, so without this the page
      // reports "gave up" while still quietly hammering the bridge.
      engineRef.current?.disconnectLive()
      setError(
        everActiveRef.current
          ? "Lost the connection, and could not get back in."
          : "Could not reach the server. It may be down or between maps."
      )
      setPhase("error")
      return
    }
    attemptRef.current = attempt + 1

    const id = setTimeout(() => {
      // A fresh token every time: they last 60 seconds, so the one used for
      // the original connection is long dead by the later retries.
      void connect()
    }, RECONNECT_DELAYS_MS[attempt])
    return () => clearTimeout(id)
  }, [phase, connect])

  // Watch the socket, not the engine.
  //
  // Two jobs, both driven by the same fact -- how long the WebSocket has been
  // down -- because that is known immediately while the engine's own state
  // lags by its ~70s timeout:
  //
  //  1. Keep a live token in the engine's hands. The engine re-dials roughly
  //     twice a second on its own, and those dials are the fastest route back:
  //     a bridge restart was recovered in 660ms that way, invisibly, purely
  //     because the token happened to still be valid. Refreshing while down
  //     makes that the normal case rather than luck.
  //  2. Tell the page it has dropped, so the backoff can start now rather
  //     than in a minute.
  //
  // Only fetches while actually down, so watching costs no API calls.
  useEffect(() => {
    if (phase !== "active" && phase !== "connecting" && phase !== "dropped") return
    let cancelled = false
    let lastFetch = 0

    const tick = async () => {
      const down = engineRef.current?.liveSocketDownMs ?? 0
      if (!down) return

      // Three seconds of silence is a drop, not a hiccup -- long enough to
      // ride out the re-dial that usually succeeds, short enough that the
      // viewer is not staring at a frozen frame.
      if (down > 3000) setPhase((p) => (p === "active" ? "dropped" : p))

      // 20s against a 60s TTL: frequent enough that whichever dial gets
      // through is carrying something valid, cheap enough to be free.
      if (Date.now() - lastFetch < 20000) return
      lastFetch = Date.now()
      try {
        const res = await fetch("/api/live/token", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ serverIndex }),
        })
        if (!res.ok) return
        const { token } = await res.json()
        if (!cancelled && token) engineRef.current?.refreshLiveToken(token)
      } catch {
        // Offline, or the site is down. Not itself a reason to stop trying.
      }
    }

    const id = setInterval(() => void tick(), 1000)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [phase, serverIndex])

  // Let overlay lines expire, and keep the "Following" pill honest. One slow
  // timer for both: neither needs better than one-second resolution, and the
  // pruning only does work when something is actually due to fade.
  useEffect(() => {
    if (phase !== "active") return
    const id = setInterval(() => {
      const now = Date.now()
      setFeedLines((prev) => (prev.length && now - prev[0].at > FEED_OVERLAY_MS ? prev.filter((l) => now - l.at <= FEED_OVERLAY_MS) : prev))
      setAnnounce((prev) => (prev && now - prev.at > ANNOUNCE_MS ? null : prev))

      // Demo-gated engine exports return 0/-1 on today's live build, so this
      // stays null until the engine that un-gates them ships -- the pill
      // simply not appearing is the correct degraded behaviour.
      const e = engineRef.current
      if (e) {
        const n = e.isFollowing() ? e.getViewClientNum() : -1
        setFollowing(n >= 0 ? e.getPlayerName(n) : null)
      }
    }, 1000)
    return () => clearInterval(id)
  }, [phase])

  // Hand the slot back if nobody is really there.
  useEffect(() => {
    if (phase !== "active") return

    const bump = () => {
      lastActivityRef.current = Date.now()
    }
    const events = ["mousemove", "mousedown", "keydown", "wheel", "touchstart"]
    for (const type of events) {
      window.addEventListener(type, bump, { passive: true })
    }

    // Checked on a slow timer rather than a single long setTimeout, because a
    // backgrounded tab's timers are throttled and a machine that sleeps stops
    // them entirely -- comparing timestamps survives both.
    const id = setInterval(() => {
      if (Date.now() - lastActivityRef.current < IDLE_LIMIT_MS) return
      intentionalRef.current = true
      engineRef.current?.disconnectLive()
      setPhase("timedout")
    }, 30000)

    return () => {
      for (const type of events) window.removeEventListener(type, bump)
      clearInterval(id)
    }
  }, [phase])

  /**
   * The jitter probe, on `/live?probe=1` only.
   *
   * Opt-in by URL rather than a visible control: it answers a question we are
   * actively chasing, not one a viewer has, and the readout is a wall of
   * percentiles. Read from `window.location` rather than `useSearchParams`,
   * which forces the whole page under a Suspense boundary to build.
   *
   * The report is recomputed on a timer instead of on every sample -- at 100
   * snapshots a second, re-rendering per message would itself cost the frames
   * being measured.
   */
  useEffect(() => {
    if (phase !== "active") return
    if (!new URLSearchParams(window.location.search).has("probe")) return

    liveProbe.setTimeBaseSource(() => engineRef.current?.getTimeBase() ?? null)
    liveProbe.start()
    const id = setInterval(() => {
      setProbeReport(liveProbe.report())
      // What the client is ACTUALLY running, read from the engine rather than
      // from what applyLiveDefaults believes it set. These are the cvars the
      // timing behaviour depends on, and a stale archived value silently
      // overriding one of them would look exactly like an engine bug --
      // com_slowDriftAdjustMaxFPS in particular decides whether the drift
      // correction fires 25 times a second or on every single snapshot.
      const e = engineRef.current
      setProbeCvars(
        e
          ? ["com_slowDriftAdjustMaxFPS", "cl_timeNudge", "snaps", "com_maxfps", "cg_smoothClients"]
              .map((n) => `${n}=${e.getCvarNumber(n)}`)
              .join(" ")
          : null,
      )
    }, 500)
    return () => {
      clearInterval(id)
      liveProbe.stop()
      liveProbe.setTimeBaseSource(null)
      setProbeReport(null)
      setProbeCvars(null)
    }
  }, [phase])

  // A closed tab must not hold a slot on a 32-player server. The engine sends
  // a real disconnect, which frees it immediately instead of waiting out the
  // ~70s timeout.
  useEffect(() => {
    const leave = () => engineRef.current?.disconnectLive()
    window.addEventListener("pagehide", leave)
    return () => {
      window.removeEventListener("pagehide", leave)
      leave()
    }
  }, [])

  /*
   * Chat the way the game does it: a key opens a line, you type, Enter sends,
   * Escape cancels.
   *
   * This is UX parity, not a workaround -- jkd-client already installs a
   * keyboard guard that hands typing to any focused input instead of the
   * engine, so a plain box would receive characters fine. It is done this way
   * because it is what a JK2 player's hands already know, and because a
   * permanent box implies chat is the point of the page when watching is.
   *
   * The engine has its own messagemode, but it draws the prompt with the same
   * 2D text that renders as blank boxes in this build -- which is why chat
   * looked broken from inside the game too. Drawing it here is the same
   * approach the kill feed and centre prints already take.
   */
  const [chatOpen, setChatOpen] = useState(false)
  const [chatTeam, setChatTeam] = useState(false)
  const [consoleOpen, setConsoleOpen] = useState(false)
  const chatRef = useRef<HTMLInputElement | null>(null)

  const closeChat = useCallback(() => {
    setChatOpen(false)
    setChat("")
    // Hand the keyboard back to the game.
    canvasRef.current?.focus()
  }, [])

  useEffect(() => {
    if (phase !== "active") return
    const onKey = (e: KeyboardEvent) => {
      if (chatOpen) {
        // Escape cancels from wherever focus happens to be. Handled here as
        // well as on the input because focus is easy to lose -- clicking the
        // game to look around takes it, and then the input's own handler
        // never runs and the line sits there stuck, holding what was typed.
        if (e.key === "Escape") {
          e.preventDefault()
          e.stopPropagation()
          closeChat()
        }
        return
      }

      // The engine's own console, on the key JK2 has always used for it.
      // Matched by physical position (`e.code`) rather than by character:
      // the glyph on that key moves between keyboard layouts, its place
      // under the hand does not, and that is what players reach for.
      if (e.code === "Backquote") {
        e.preventDefault()
        e.stopPropagation()
        engineRef.current?.toggleConsole()
        setConsoleOpen((v) => !v)
        return
      }

      // With the console up the engine owns the keyboard -- Enter submits the
      // command being typed into it, so the page must not steal that key for
      // its own chat line.
      if (consoleOpen) return

      // JK2's own layout: y says, t says to the team. Enter is kept as a
      // synonym for y because it is what everyone tries first in a browser.
      const key = e.key.toLowerCase()
      if (key === "enter" || key === "y" || key === "t") {
        e.preventDefault()
        e.stopPropagation()
        setChatTeam(key === "t")
        setChatOpen(true)
        // After paint, or the input does not exist yet to focus.
        requestAnimationFrame(() => chatRef.current?.focus())
      }
    }
    // Capture phase: SDL's document-level listener would otherwise see the
    // keypress first and feed it to the game.
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [phase, chatOpen, consoleOpen, closeChat])

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault()
    const text = chat.trim()
    if (text) engineRef.current?.sendChat(text, chatTeam)
    closeChat()
  }

  if (!signedIn) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 text-center">
        <h1 className="text-2xl font-semibold">Watch live</h1>
        <p className="mt-3 text-muted-foreground">
          Watching live needs a player account, so the server knows who is connecting.
        </p>
        <Link href="/player-login" className="mt-6 inline-block underline">
          Sign in
        </Link>
        <p className="mt-8 text-sm text-muted-foreground">
          No password yet? Ask an admin — they can generate one for you.
        </p>
      </main>
    )
  }

  // The picker only earns its place once there is something to pick between.
  // With a single server it is a list of one and a click nobody wants to make,
  // so idle goes straight to the Watch button instead.
  const showPicker = LIVE_SERVERS.length > 1 && (phase === "idle" || phase === "error")

  return (
    <main className={filling ? "" : "mx-auto max-w-6xl px-4 py-6"}>
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <h1 className="flex items-center gap-2 text-xl font-semibold">
          {/* Red only while something is genuinely live, so it means what it
              looks like. A permanently-lit recording dot is decoration. */}
          {liveStatus?.online && (
            <span aria-hidden className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
          )}
          Live
        </h1>
        {(phase === "active" || phase === "connecting" || phase === "dropped") && (
          <span className="text-sm font-medium">{server?.name}</span>
        )}
        {/* Starting and leaving live in different places on purpose. Watch sits
            over the black stage below, where the thing you are about to start
            actually appears; Leave belongs up here, out of the picture, so it
            is not hovering over the match you are trying to watch. */}
        {(phase === "active" || phase === "connecting" || phase === "dropped") && (
          <button onClick={disconnect} className="rounded border px-3 py-1 text-sm">
            Leave
          </button>
        )}
        {phase === "active" && (
          <button
            onClick={toggleFullscreen}
            className="inline-flex items-center gap-1.5 rounded border border-primary/40 bg-primary/10 px-3 py-1 text-sm text-primary hover:bg-primary/20"
          >
            {filling ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            {filling ? "Exit full screen" : "Full screen"}
          </button>
        )}
        <span className="text-sm text-muted-foreground">
          {phase === "connecting" && (status || "Connecting…")}
          {phase === "active" && `Watching as ${playerName ?? "you"}`}
          {phase === "dropped" && "Connection lost — trying to get back in…"}
          {/* What is on is shown on the stage while idle, next to the button
              that acts on it, rather than repeated up here. */}
        </span>
      </div>

      {phase === "superseded" && (
        <p className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          You started watching in another tab or on another device, so this one
          stopped. One session per account keeps a single viewer from taking
          several spectator slots.
        </p>
      )}
      {phase === "timedout" && (
        <p className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          Still watching? You were idle for a while, so we gave your spectator slot
          back to the server. Press Resume to pick the match back up.
        </p>
      )}
      {phase === "unsupported" && (
        <p className="mb-4 rounded border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
          The deployed viewer engine does not support live spectating yet.
        </p>
      )}
      {error && <p className="mb-4 rounded border border-red-500/40 bg-red-500/10 p-3 text-sm">{error}</p>}

      {showPicker && (
        <div className="mb-4 grid gap-2">
          {LIVE_SERVERS.map((s) => {
            const st = statuses[s.index] ?? null
            return (
              <div
                key={s.index}
                className={`flex items-center gap-3 rounded border p-3 ${st?.online ? "" : "opacity-60"}`}
              >
                <span
                  aria-hidden
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${
                    st?.online ? "animate-pulse bg-red-500" : "bg-muted-foreground/40"
                  }`}
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium">{s.name}</span>
                  <span className="block text-sm text-muted-foreground">
                    {describeLiveStatus(st)}
                  </span>
                </span>
                {/* Offered even when nothing is on: a server can fill up between
                    two polls, and refusing the click would be wrong more often
                    than it would be right. */}
                <button
                  onClick={() => {
                    setServerIndex(s.index)
                    void connect()
                  }}
                  className="rounded border px-3 py-1 text-sm"
                >
                  Watch
                </button>
              </div>
            )
          })}
        </div>
      )}

      {/* The stage is what goes fullscreen, so everything drawn over the game
          travels with it. Black while idle rather than hidden: the page should
          not change shape the moment someone presses Watch. */}
      <div
        ref={stageRef}
        className={`bg-black ${
          expanded
            ? "fixed inset-0 z-50"
            : fullscreen
              ? "relative"
              : "relative min-h-[380px] rounded"
        }`}
      >
        {/* id="canvas" is required: the engine sizes its framebuffer through a
            hard-coded "#canvas" selector, not through Module.canvas. Its
            width/height are the engine's to set -- CSS scales the result. */}
        <canvas
          id="canvas"
          ref={canvasRef}
          className={`w-full bg-black object-contain ${filling ? "h-screen" : "rounded"}`}
          style={{ filter: gammaFilterFor(gamma) }}
        />

        {/* The gamma curve the canvas filter references. A definition, not a
            picture -- zero-sized, and set from state like anything else. */}
        <svg aria-hidden className="pointer-events-none absolute h-0 w-0" focusable="false">
          <filter id={GAMMA_FILTER_ID} colorInterpolationFilters="sRGB">
            <feComponentTransfer>
              <feFuncR type="gamma" exponent={gamma} />
              <feFuncG type="gamma" exponent={gamma} />
              <feFuncB type="gamma" exponent={gamma} />
            </feComponentTransfer>
          </filter>
        </svg>

        {/* The way out, and it has to live INSIDE the stage.

            Both fullscreen modes take the page's own controls away with them:
            the real API renders the stage element and nothing else, and the CSS
            fallback pins the stage over the viewport at z-50. Either way the
            header's Exit button is outside or behind it, so the only remaining
            door was Escape -- which the phones the fallback exists for do not
            have. Filling the screen was therefore a one-way trip on exactly the
            devices it was built for.

            Drawn over the game on purpose, like the kill feed and the
            spectating pill: a control that is only sometimes there is no use to
            someone looking for the way out. */}
        {filling && (
          <button
            onClick={toggleFullscreen}
            className="absolute right-2 top-2 z-10 inline-flex items-center gap-1.5 rounded bg-black/60 px-3 py-2 text-sm text-white hover:bg-black/80"
          >
            <Minimize2 className="h-4 w-4" />
            Exit full screen
          </button>
        )}

        {phase === "active" && (
          <>
            {/* Who the camera is on. Engine-fed, so it appears only once the
                deployed engine reports it. */}
            {following && (
              <div className="pointer-events-none absolute inset-x-0 top-2 flex justify-center">
                <span className="rounded bg-black/60 px-3 py-1 text-sm text-white">
                  Spectating <span className="font-medium">{following}</span>
                </span>
              </div>
            )}

            {/* Kill feed, top left -- a ticker, not a conversation. */}
            {feedLines.length > 0 && (
              <div className="pointer-events-none absolute left-2 top-2 space-y-0.5">
                {feedLines.map((l) => (
                  <div key={l.id} className="text-sm text-white/90 [text-shadow:0_1px_2px_rgba(0,0,0,0.9)]">
                    {l.text}
                  </div>
                ))}
              </div>
            )}

            {/* Centre prints -- "You killed ..." and friends -- where the game
                itself would draw them. */}
            {announce && (
              <div className="pointer-events-none absolute inset-x-0 top-[22%] text-center">
                <span className="text-lg font-medium text-white [text-shadow:0_1px_3px_rgba(0,0,0,0.9)]">
                  {announce.text}
                </span>
              </div>
            )}
          </>
        )}

        {/* Everything that starts or resumes watching, centred on the stage.
            The stage holds a minimum height so this has somewhere to sit before
            the engine has sized the canvas -- otherwise the page would jump the
            moment it loads. */}
        {!(phase === "active" || phase === "connecting" || phase === "dropped") && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
            {phase !== "unsupported" && (
              <button
                onClick={connect}
                disabled={booting}
                className="rounded bg-primary px-6 py-2.5 text-base font-medium text-primary-foreground disabled:opacity-70"
              >
                {booting
                  ? "Starting…"
                  : phase === "superseded"
                    ? "Watch here instead"
                    : phase === "timedout"
                      ? "Resume"
                      : phase === "error"
                        ? "Try again"
                        : "Watch"}
              </button>
            )}
            {phase === "idle" && !showPicker && (
              <span className="text-sm text-white/70">{describeLiveStatus(liveStatus)}</span>
            )}
            {booting && (
              <span className="text-sm text-white/70">
                First load downloads the game — about 125MB.
              </span>
            )}
          </div>
        )}

        {/* Over the game, where the game would draw it. */}
        {chatOpen && (
          <form
            onSubmit={sendChat}
            className="absolute inset-x-0 bottom-0 flex items-center gap-2 bg-black/70 px-3 py-2"
          >
            <span className="shrink-0 text-sm text-amber-300">{chatTeam ? "Team:" : "Say:"}</span>
            <input
              ref={chatRef}
              value={chat}
              onChange={(e) => setChat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.preventDefault()
                  closeChat()
                }
                // Keep every other key here rather than letting it reach the
                // game underneath.
                e.stopPropagation()
              }}
              maxLength={140}
              className="flex-1 bg-transparent text-sm text-white outline-none"
            />
          </form>
        )}
      </div>

      {phase === "active" && (
        <div className="mt-2 flex items-center gap-3 text-xs text-muted-foreground">
          {!chatOpen && (
            <span>
              <kbd className="rounded border px-1">Y</kbd> chat ·{" "}
              <kbd className="rounded border px-1">T</kbd> team ·{" "}
              <kbd className="rounded border px-1">Tab</kbd> scores ·{" "}
              <kbd className="rounded border px-1">~</kbd> console ·{" "}
              <kbd className="rounded border px-1">Esc</kbd> cancel
            </span>
          )}
          <button onClick={() => setLogOpen((v) => !v)} className="ml-auto underline">
            {logOpen ? "Hide" : "Show"} chat &amp; feed{log.length ? ` (${log.length})` : ""}
          </button>
        </div>
      )}

      {/* Scrollback, plus a way to talk that needs no keyboard.
          The keyboard route (y/t over the game) is the one a JK2 player will
          reach for, but it does not exist on a phone -- there is no y key and
          no way to summon one over a canvas. This box is the same chat by
          other means, and it doubles as somewhere to type when the overlay is
          not cooperating. */}
      {logOpen && phase === "active" && (
        <div className="mt-2 rounded border bg-muted/30">
          <div ref={logScrollRef} className="max-h-56 overflow-y-auto p-2 text-sm">
            {log.length === 0 && <p className="text-muted-foreground">Nothing yet.</p>}
            {log.map((l) => (
              <div key={l.id} className={l.kind === "chat" ? "" : "text-muted-foreground"}>
                {l.text}
              </div>
            ))}
          </div>
          <form
            onSubmit={(e) => {
              e.preventDefault()
              const text = panelChat.trim()
              if (!text) return
              engineRef.current?.sendChat(text, panelTeam)
              setPanelChat("")
            }}
            className="flex items-center gap-2 border-t p-2"
          >
            <button
              type="button"
              onClick={() => setPanelTeam((v) => !v)}
              aria-pressed={panelTeam}
              className={`shrink-0 rounded border px-2 py-1 text-xs ${
                panelTeam ? "border-amber-500/50 bg-amber-500/15 text-amber-300" : ""
              }`}
            >
              {panelTeam ? "Team" : "All"}
            </button>
            <input
              value={panelChat}
              onChange={(e) => setPanelChat(e.target.value)}
              // The engine sits behind this input and reads document-level key
              // events; without this, typing here would also drive the game.
              onKeyDown={(e) => e.stopPropagation()}
              placeholder={panelTeam ? "Message your team…" : "Message everyone…"}
              maxLength={140}
              className="min-w-0 flex-1 rounded border bg-background px-2 py-1 text-sm"
            />
            <button
              type="submit"
              disabled={!panelChat.trim()}
              className="shrink-0 rounded bg-primary px-3 py-1 text-sm text-primary-foreground disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}

      {/* Jitter probe readout (`?probe=1`). Copy rather than screenshot: the
          numbers are the point, and a screenshot of them cannot be diffed
          against the bridge's own reporter. */}
      {probeReport && (
        <div className="mt-2 rounded border border-amber-500/40 bg-amber-500/5 p-2">
          <div className="mb-1 flex items-center gap-2">
            <span className="text-xs font-medium text-amber-300">Jitter probe</span>
            <button
              onClick={() => navigator.clipboard?.writeText(formatReport(probeReport))}
              className="ml-auto text-xs underline"
            >
              Copy
            </button>
            <button onClick={() => liveProbe.reset()} className="text-xs underline">
              Reset
            </button>
          </div>
          <pre
            className={`overflow-x-auto whitespace-pre-wrap text-[11px] leading-relaxed ${
              probeReport.settled ? "" : "text-muted-foreground"
            }`}
          >
            {formatReport(probeReport)}
            {probeCvars ? `\ncvars:     ${probeCvars}` : ""}
          </pre>
          {probeReport.settled && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Arrivals p50 far below its mean means the browser is delivering snapshots in
              bursts. A high <code>starved</code> percentage means frames are rendering with
              nothing new to show.
            </p>
          )}
        </div>
      )}
    </main>
  )
}
