"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import {
  ChevronLeft,
  ChevronRight,
  Pause,
  Play,
  Eye,
  Compass,
  Link2,
  Maximize,
  Minimize,
  Monitor,
  RotateCcw,
  Settings,
  Volume2,
  VolumeX,
  X,
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
import { readLinkState } from "@/lib/demo-link-state"
import { useTouchPrimary } from "@/hooks/use-touch-primary"
import { canRunEngine, diagRequested, logDiagEvent } from "@/lib/demo-viewer/diagnostics"
import { DemoViewerDiag } from "@/components/demo-viewer-diag"
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

/**
 * Where the chase camera sits around the player being followed.
 *
 * Angle is a full circle expressed as a swing either way from directly behind,
 * so 0 is the default over-the-shoulder shot and ±180 both land head-on. Pitch
 * stops short of straight up and down, where a camera looking along its own
 * axis has nothing left to orient by.
 */
const CAM_ANGLE_MIN = -180
const CAM_ANGLE_MAX = 180
const CAM_PITCH_MIN = -60
const CAM_PITCH_MAX = 60
/** How far one arrow-key press nudges the camera, in degrees. */
const CAM_NUDGE = 5

/**
 * The kill feed, top left, as the game prints it.
 *
 * Held for eight seconds of *demo* time rather than wall time, so slow motion
 * reads them at the pace of the fight they describe. Five lines is what a busy
 * CTF exchange produces in that window without the feed becoming the picture.
 */
const FEED_MAX_LINES = 5
const FEED_HOLD_MS = 8000

// Kept out of the engine because the engine cannot act on it after boot -- the
// choice has to survive a page load to be applied at all.
const DETAIL_KEY = "soracle.demo.detail"
const readHighDetail = () => localStorage.getItem(DETAIL_KEY) !== "low"

/**
 * Brightness, as a gamma curve over the finished picture.
 *
 * The engine's own r_gamma does nothing here: JK2MV prefers a post-processing
 * pass needing GL_ARB_fragment_program, which GL4ES does not translate, so it
 * falls back to setting the display's gamma ramp -- which a web page cannot do
 * -- and from there to no gamma at all. Verified by setting r_gamma 3 and
 * getting a pixel-identical frame.
 *
 * A CSS filter on the canvas gets there instead, and gamma specifically rather
 * than `brightness()`: JK2's dark areas are not clipped to black, they are
 * squeezed into a narrow band of low values, so a curve that stretches that
 * band into a visible range recovers real detail, where a linear multiply just
 * washes the whole image out.
 *
 * 1 is the recording as it was rendered, and the default -- lower lifts the
 * shadows. Kept below 1 because there is no reason to make a demo darker.
 */
const GAMMA_FILTER_ID = "soracle-demo-gamma"
const GAMMA_KEY = "soracle.demo.gamma"
const GAMMA_MIN = 0.5
const GAMMA_MAX = 1
const GAMMA_DEFAULT = 1
const readGamma = () => {
  const stored = Number(localStorage.getItem(GAMMA_KEY))
  if (!Number.isFinite(stored) || stored < GAMMA_MIN || stored > GAMMA_MAX) return GAMMA_DEFAULT
  return stored
}

/**
 * Safari does not apply this filter, so it gets an approximation instead.
 *
 * WebKit's support for `filter: url(#...)` against an inline SVG is partial,
 * and feComponentTransfer on a composited layer -- which a WebGL canvas always
 * is -- lands in the gap: the declaration is accepted and simply does nothing.
 * There is no feature test for "accepted but ignored", so this asks which
 * browser it is, which is the honest shape of a known vendor bug. Chromium and
 * Firefox both carry "Safari" in their UA strings, hence the exclusions.
 *
 * The fallback is deliberately not the same picture. Shorthand filters have no
 * gamma, so it lifts with brightness and takes a little contrast back out to
 * stop the highlights blowing -- close in feel, less good in the shadows, which
 * is exactly where gamma earns its keep. Better than a control that lies about
 * doing something.
 */
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
  /**
   * The map the recording says it is on, handed over once the gamestate has
   * arrived. Nobody types this in at upload time; the demo already knows.
   */
  onMapDetected?: (map: string) => void
  /**
   * The moments worth watching for, in milliseconds from the first frame.
   * Drawn onto the scrubber and clickable, so a two-minute clip says where
   * its two seconds of interest are.
   */
  moments?: { id: string; atMs: number; label: string | null; tag: string | null }[]
  /**
   * Lets whoever is watching take a moment back off the timeline. Left unset
   * for anyone who isn't allowed to edit this demo -- their moment chips are
   * plain, not editable.
   */
  onRemoveMoment?: (id: string) => void
  /** Playback position, pushed out so the page can stamp a moment with it. */
  onPositionChange?: (ms: number) => void
  /**
   * Hands the page a way to drive playback, so a timestamp written in a
   * comment can jump the player to it.
   */
  onSeekReady?: (seek: (ms: number) => void) => void
  /**
   * Hands the page the cutter, or null on an engine too old to have one. The
   * page owns the in/out points and what happens to the bytes; all this side
   * knows is how to produce them.
   */
  onTrimReady?: (trim: ((startMs: number, endMs: number) => Promise<Uint8Array>) | null) => void
  /**
   * Hands the page a reader for the camera as it stands right now, so a render
   * can start from what someone has already framed rather than from defaults.
   *
   * A getter rather than a value, for the same reason onPositionChange is not
   * state: the camera moves constantly, and this only matters at the instant a
   * dialog opens.
   */
  onCameraStateReady?: (
    read: (() => { camera: CameraMode; follow: number; players: DemoPlayerInfo[] }) | null,
  ) => void
  /**
   * Where to go when this one finishes. Named rather than just arrows, because
   * "next" means nothing on its own and the title is what someone is choosing
   * between.
   */
  previousDemo?: { id: string; title: string } | null
  nextDemo?: { id: string; title: string } | null
  /** Shown as a lit region on the scrubber while a cut is being framed up. */
  trimRange?: { startMs: number; endMs: number } | null
}

export function DemoViewer({
  demoUrl,
  durationMs = 0,
  engineBaseUrl,
  followName,
  onPlaybackStarted,
  onMapDetected,
  moments = [],
  onRemoveMoment,
  onPositionChange,
  onSeekReady,
  onTrimReady,
  onCameraStateReady,
  trimRange = null,
  previousDemo = null,
  nextDemo = null,
}: DemoViewerProps) {
  // Where the engine's canvas gets parked. React owns this div; it does not
  // own the canvas inside it (see getEngineCanvas).
  const holderRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const engineRef = useRef<JkdEngine | null>(null)
  const [fullscreen, setFullscreen] = useState(false)

  /**
   * Two words apart, because they fail differently.
   *
   * This initial value is what the server renders, before any of this
   * component's code has run. "Starting the engine…" used to sit here, and it
   * claimed something untrue: on a page whose hydration never completed, no
   * effect ever ran, no engine was ever asked for, and the viewer sat on that
   * sentence indefinitely. It reads exactly like an engine failing to boot, and
   * cost a real debugging session on an iPhone that turned out to be fine --
   * the dev server was blocking cross-origin dev resources over the LAN (see
   * allowedDevOrigins in next.config.mjs) and the same thing reproduced in
   * desktop Chromium.
   *
   * So the server-rendered state now says only that the page is loading, and
   * the engine is not mentioned until the boot effect actually starts one.
   * Stuck on "Loading…" is a page problem; stuck on "Starting the engine…" is
   * an engine problem. That distinction costs one string and is the difference
   * between reading the symptom right and looking in the wrong place.
   */
  const [status, setStatus] = useState<string | null>("Loading…")
  // -1 when there is nothing measurable to show, otherwise 0..1.
  const [progress, setProgress] = useState(-1)
  const [failed, setFailed] = useState<string | null>(null)
  const [ready, setReady] = useState(false)

  const [paused, setPaused] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [camera, setCamera] = useState<CameraMode>("follow")
  // Lets the pointerlockchange handler read the current mode without going
  // stale -- that listener is registered once on mount (see below) and would
  // otherwise always see the "follow" it closed over at the time.
  const cameraRef = useRef(camera)
  cameraRef.current = camera
  const [follow, setFollow] = useState(-1)
  const [players, setPlayers] = useState<DemoPlayerInfo[]>([])
  /*
   * Same reason cameraRef above exists: onCameraStateReady's getter is handed
   * up once, when the engine becomes ready, so a closure over this state would
   * answer with whatever it was at that moment and never change.
   */
  const followRef = useRef(follow)
  const playersRef = useRef(players)
  followRef.current = follow
  playersRef.current = players
  const [volume, setVolume] = useState(DEFAULT_VOLUME)
  const [muted, setMuted] = useState(false)

  // Engine settings the viewer can reach, mirrored here only so the controls
  // can render their current position -- the engine remains the owner.
  const [range, setRange] = useState(RANGE_DEFAULT)
  const [camAngle, setCamAngle] = useState(0)
  const [camPitch, setCamPitch] = useState(0)
  const [sensitivity, setSensitivity] = useState(SENSITIVITY_DEFAULT)
  const [invertLook, setInvertLook] = useState(false)
  const [smoothMouse, setSmoothMouse] = useState(true)
  const [highDetail, setHighDetail] = useState(true)
  const [gamma, setGamma] = useState(GAMMA_DEFAULT)
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
  /**
   * Distinct from touchOnly above, which asks only about hover and governs how
   * the control bar behaves. This is the same test the boot gate uses, and it
   * governs what is worth offering at all -- a laptop with a touchscreen is
   * touchOnly=false, touchPrimary=false, and wants the full desktop viewer.
   */
  const touchPrimary = useTouchPrimary()
  const [tapShowsChrome, setTapShowsChrome] = useState(true)
  /** Where and when a touch began, so a drag can be told from a tap. */
  const tapStartRef = useRef<{ x: number; y: number; at: number } | null>(null)
  /** Bumped whenever a control is touched, to restart the auto-hide timer. */
  const [chromeBumpAt, setChromeBumpAt] = useState(0)
  /**
   * The browser took the GL context back. Terminal for this page load: the
   * engine builds its GL state once at startup and cannot be made to do it
   * again from here.
   */
  const [contextLost, setContextLost] = useState(false)
  /**
   * Phones are told, rather than shown a broken picture.
   *
   * The engine wants a keyboard, a mouse and a desktop-sized heap, and on iOS
   * it does not come up at all -- so the alternative to saying so plainly is a
   * black box and a spinner that never resolves. Decided before the engine is
   * started, so nobody on a phone pays for a 120MB download to find out.
   */
  const [unsupported, setUnsupported] = useState(false)
  /**
   * `?diag=1`: show the instrumentation, and let the engine start on a phone.
   *
   * The gate above is the reason mobile behaviour is unmeasured -- every figure
   * worth having (heap at boot, heap after two minutes, frame rate, whether the
   * GL context survives) requires the engine to be running on the device, and
   * on a phone it currently never is. This is the way past it, opt-in per
   * visit, so an ordinary visitor's experience is untouched.
   */
  const [diag, setDiag] = useState(false)
  /**
   * On a phone, starting means downloading ~141MB (a 121MB bundle plus 20MB of
   * community pk3s), and the gate has until now meant nobody could do that by
   * accident. Reopening a diagnostics tab on cellular should not silently spend
   * that, so the phone path asks first. Desktop is not asked: it was always
   * going to download this, and nothing has changed there.
   */
  const [confirmNeeded, setConfirmNeeded] = useState(false)
  const [confirmed, setConfirmed] = useState(false)
  /**
   * The same canvas as canvasRef, as state.
   *
   * The overlay has to re-render when the canvas arrives -- it reads the GL
   * context and the backing-store size off it -- and assigning a ref does not
   * cause that. Held in both places rather than converting the ref: everything
   * else that touches the canvas reads it from callbacks that must not be
   * rebuilt, which is what the ref is for.
   */
  const [canvasEl, setCanvasEl] = useState<HTMLCanvasElement | null>(null)

  const [elapsed, setElapsed] = useState(0)
  // The match clock, which is what anyone discussing the game would quote --
  // -1 until the demo's gamestate says when the level started.
  const [matchTime, setMatchTime] = useState(-1)
  const [span, setSpan] = useState(Math.max(durationMs, 1000))
  const [seeking, setSeeking] = useState(false)
  const [killMessage, setKillMessage] = useState<{ lead: string; who: string } | null>(null)
  const [announcement, setAnnouncement] = useState<string | null>(null)
  /**
   * The running kill feed, newest last, as the game would print it.
   *
   * Each line carries the demo time it arrived at so it can expire on the
   * *demo's* clock rather than the wall clock -- otherwise watching at 0.25x
   * would blink lines away mid-fight, and a seek would leave stale ones sitting
   * there describing something that has not happened yet.
   */
  const [feed, setFeed] = useState<{ id: number; text: string; atMs: number }[]>([])

  // Scrub state lives in refs: the drag handlers run far more often than React
  // should re-render, and the gesture has to survive a re-render mid-drag.
  const draggingRef = useRef(false)
  // Distinct from draggingRef: whether any interaction with the scrubber --
  // pointer or keyboard -- is genuinely live. Safari streams change events
  // after a drag is released, and this is how they are told apart from real
  // ones. Same idea as SettingSlider's activeRef, for the same WebKit bug.
  const scrubActiveRef = useRef(false)
  const resumeAfterSeekRef = useRef(false)
  const pendingTargetRef = useRef<number | null>(null)
  const killShownAtRef = useRef(-1)
  const announceShownAtRef = useRef(-1)
  const feedIdRef = useRef(0)
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
  // Same reason as speedRef: a backward seek reopens the demo, and these are
  // cheat-flagged cvars the engine is entitled to reset on the way through.
  const camAngleRef = useRef(0)
  const camPitchRef = useRef(0)
  // Where the scrubber currently sits, so the release handler knows the target
  // even though it fires on the window rather than on the input.
  const scrubValueRef = useRef(0)
  // Held in a ref so the polling effect never has to restart just because the
  // parent re-rendered and handed us a new closure.
  const onStartedRef = useRef(onPlaybackStarted)
  onStartedRef.current = onPlaybackStarted
  const onMapRef = useRef(onMapDetected)
  onMapRef.current = onMapDetected
  const onPositionRef = useRef(onPositionChange)
  onPositionRef.current = onPositionChange
  // Reported once per loaded recording, not once per poll.
  const mapReportedRef = useRef(false)

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
    // Parsed in lib/demo-link-state, where it can be tested without a browser
    // or an engine -- it is a few lines of string handling that has already
    // shipped one bug to players (Number(null) is 0, so a link with no target
    // followed client 0), and that is exactly the shape of thing worth pinning
    // down in a test rather than re-reading carefully.
    const { camera: linkCamera, follow: linkFollow, seekSeconds } = readLinkState(window.location.search)

    if (linkCamera) {
      engine.setCameraMode(linkCamera)
      setCamera(linkCamera)
    }
    if (linkFollow !== null) {
      engine.setFollow(linkFollow)
      setFollow(linkFollow)
    }

    if (seekSeconds === null) return
    // Seeking has to wait for the first frame: the engine works in absolute
    // server time and cannot place a position until a snapshot has told it
    // where the demo begins.
    for (let i = 0; i < 100; i++) {
      if (engine.getElapsed() >= 0) break
      await new Promise((r) => setTimeout(r, 100))
    }
    if (engine.getElapsed() < 0) return
    setSeeking(true)
    await engine.seekTo(seekSeconds * 1000)
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
      const params = new URLSearchParams(window.location.search)
      // A shared link's own camera wins over any default.
      if (params.get("cam") || params.get("follow")) return

      const wanted = followName ? normaliseName(followName) : ""

      /*
       * Open on the recorded view, unless the recording was made by a bot.
       *
       * The recorded view is editorial intent: on a demo that has been merged
       * and reframed -- which is most of what this community publishes -- the
       * file has already been centred on the player who matters, and no
       * guess here beats that. It also needs no name matching, so it cannot
       * pick the wrong person.
       *
       * The exception is a raw demobot recording, where the recorded view is
       * the bot itself: a spectator floating nowhere near the play. Spectators
       * are filtered out of getPlayers(), so "is the recorded client one of
       * the actual players" is the whole test, and when it fails the
       * protagonist is the better answer.
       *
       * Both gates below matter on a swap: the engine still holds the previous
       * recording's roster for a moment after a new demo opens, and elapsed
       * only goes non-negative once this demo's own first snapshot is parsed.
       */
      for (let i = 0; i < 100; i++) {
        const ours = engineRef.current === engine && engine.getElapsed() >= 0
        const players = ours ? engine.getPlayers() : []
        if (players.length > 0) {
          const recorded = engine.getViewClientNum()
          const recordedIsPlaying = players.some((p) => p.clientNum === recorded)
          if (recordedIsPlaying) {
            engine.setFollow(-1)
            setFollow(-1)
            return
          }

          if (wanted) {
            // The library says "sora"; the demo says "^8^5^8sora" or
            // "[TSB] sora", so both sides are normalised before matching.
            const norm = players.map((p) => ({ p, n: normaliseName(p.name) }))
            const exact = norm.filter((x) => x.n === wanted)
            const partial = norm.filter((x) => x.n.includes(wanted))
            const hit = exact.length === 1 ? exact[0] : exact.length === 0 && partial.length === 1 ? partial[0] : null
            if (hit) {
              engine.setFollow(hit.p.clientNum)
              setFollow(hit.p.clientNum)
              return
            }
          }

          // A bot recording with nobody named: the recorded view is still the
          // honest answer, even if it is a dull one.
          engine.setFollow(-1)
          setFollow(-1)
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
    const wantsDiag = diagRequested(window.location.search)
    setDiag(wantsDiag)
    // The standard "touch is the primary input" test: true on phones and
    // tablets, false on a laptop with a touchscreen (which can still hover).
    // Checked here, first thing, so the engine is never started on one.
    const touchPrimary = window.matchMedia("(hover: none) and (pointer: coarse)").matches
    /*
     * This used to refuse every touch device outright, on the grounds that the
     * engine wanted a keyboard, a mouse and more memory than a phone would
     * give it. Two of those turned out to be wrong. Measured on an iPhone: the
     * heap sits at 207MB against a budget that never complained, and it holds
     * 64fps at devicePixelRatio 3. What it genuinely cannot do -- fly the free
     * camera, cut a clip -- is now simply not offered, and the card that used
     * to say no has become a card that says what it costs and what is missing.
     *
     * What is refused now is a device that actually cannot run this, tested
     * rather than inferred from having a touchscreen. Note it does not catch
     * everything: Firefox on iOS passes both checks and still dies later in
     * GLimp_Init, so the failure path has to stay readable too.
     */
    if (!canRunEngine()) {
      setUnsupported(true)
      setStatus(null)
      return
    }
    // Both of these return before the engine is constructed, so re-running this
    // effect when the answer changes cannot start a second one.
    if (touchPrimary && !confirmed) {
      setConfirmNeeded(true)
      setStatus(null)
      return
    }
    // Past every gate, so an engine really is about to be started -- which is
    // the point at which saying so stops being a guess. See the status state.
    setStatus("Starting the engine…")
    let cancelled = false

    // Reclaim the page's one canvas. On a first visit this creates it; on a
    // move from one demo to another it takes the live one -- context and all --
    // out of the unmounted viewer and puts it in this one.
    const canvas = getEngineCanvas()
    holderRef.current.appendChild(canvas)
    canvasRef.current = canvas
    setCanvasEl(canvas)

    // Read here rather than in a state initialiser: this only exists in the
    // browser, and the engine needs it before its first frame.
    /*
     * Read here rather than in a state initialiser: this only exists in the
     * browser, and the engine needs it before its first frame.
     *
     * This briefly forced r_highdpi off on touch, on the theory that an iPhone
     * reporting devicePixelRatio 3 was asking for a drawing buffer too large to
     * grant. The device disproved it: it offers 4096x4096 with depth and
     * stencil, against the 1512x852 the engine actually wanted. The real cause
     * was the diagnostics overlay taking the canvas's context (see
     * readWebglInfo), so the cap was reverted rather than left in resting on a
     * dead argument -- and so the next device run changes one thing, not two.
     *
     * Capping it may still be worth doing on its own merits, since a phone
     * rendering nine times the pixels of the element it draws into is nine
     * times the fill rate. That is a frame-rate question, and there is no
     * frame-rate measurement from a phone yet to answer it with.
     */
    const detail = readHighDetail()
    setHighDetail(detail)
    setGamma(readGamma())

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
      onFeed: (text) => {
        if (cancelled) return
        const atMs = engine.getElapsed()
        setFeed((prev) => [...prev, { id: feedIdRef.current++, text, atMs }].slice(-FEED_MAX_LINES))
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
        engine.stopAutoOrbit()
        // Sensitivity is not set here: it is gated on the camera mode, by the
        // effect that watches it.
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
    // on a prop change would try to boot a second one over the first. The one
    // exception is the phone confirmation above, which is answered after mount
    // and which bails out long before an engine exists.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmed])

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
    setFeed([])
    killShownAtRef.current = -1
    announceShownAtRef.current = -1
    playedRef.current = false
    startedNotifiedRef.current = false
    mapReportedRef.current = false
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
      if (now >= 0) onPositionRef.current?.(now)
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
      // Before the optional extras below: this drives the POV picker, and it
      // must not be hostage to anything newer or more fragile.
      setPlayers(engine.getPlayers())

      // The game can switch the orbit on partway through -- its end-of-match
      // handlers do exactly that -- so pinning it at boot is not enough. Read
      // first and only write when it has actually drifted: the read is a plain
      // C call, while the write goes through the command buffer.
      if (engine.getCvarNumber("cg_cameraOrbit") !== 0) engine.stopAutoOrbit()

      // The recording states its own map; hand it over the first time it is
      // readable so nobody has to type it in at upload. Wrapped because this
      // is the newest thing the engine is asked for, and the page can be
      // running against an engine that predates it.
      if (!mapReportedRef.current) {
        try {
          const map = engine.getMapName()
          if (map) {
            mapReportedRef.current = true
            onMapRef.current?.(map)
          }
        } catch {
          // Nothing to do: the map stays whatever the library already knew.
          mapReportedRef.current = true
        }
      }

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
      // Same rule for the feed, line by line. A negative age means the demo has
      // been seeked back behind the line, which describes something that has
      // not happened again yet.
      if (now >= 0) {
        setFeed((prev) => {
          const kept = prev.filter((l) => {
            const age = now - l.atMs
            return age >= 0 && age <= FEED_HOLD_MS
          })
          return kept.length === prev.length ? prev : kept
        })
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

  /**
   * Picking whose shoulder to watch over.
   *
   * Asking to chase the player the demo was recorded from is really a request
   * for the recorded view, and has to be sent as one: the chase camera tracks
   * its target through cg_entities[], where the recording client's own body
   * does not appear (their state arrives as the playerState instead). Chasing
   * them lands on the last valid target's stale position -- a camera parked in
   * an empty corridor -- so it is routed to the recorded view, which is the
   * same picture anyone asking for it wanted.
   */
  const chooseFollow = useCallback((clientNum: number) => {
    const recorded = engineRef.current?.getViewClientNum() ?? -1
    const target = clientNum >= 0 && clientNum === recorded ? -1 : clientNum
    engineRef.current?.setFollow(target)
    setFollow(target)
  }, [])

  /**
   * Full screen, or the closest thing the browser will allow.
   *
   * iPhone Safari has no Fullscreen API on ordinary elements at all -- only
   * <video> gets webkitEnterFullscreen, and a WebGL canvas is not that. So
   * `containerRef.current.requestFullscreen` is simply undefined there, and the
   * old code called it through an optional chain: the button did nothing, said
   * nothing, and looked exactly like a button that worked. That is precisely
   * the trap the brief warns about, and it is why a phone in landscape was
   * stuck watching a sliver of picture under the site masthead.
   *
   * So: use the real API where it exists, and otherwise pin the player over the
   * viewport with CSS. The pseudo version is not as good -- the browser's own
   * chrome stays -- but it is the difference between a usable landscape picture
   * and a letterbox.
   */
  const [pseudoFullscreen, setPseudoFullscreen] = useState(false)

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current
    if (document.fullscreenElement) {
      void document.exitFullscreen()
      return
    }
    if (pseudoFullscreen) {
      setPseudoFullscreen(false)
      return
    }
    // Tested rather than assumed: the method's absence is the whole point.
    if (el && typeof el.requestFullscreen === "function") {
      void el.requestFullscreen().catch(() => setPseudoFullscreen(true))
      return
    }
    setPseudoFullscreen(true)
  }, [pseudoFullscreen])

  // Track it from the event rather than from the click: Escape and the browser's
  // own controls leave fullscreen too, and the button would otherwise lie.
  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement)
    document.addEventListener("fullscreenchange", onChange)
    return () => document.removeEventListener("fullscreenchange", onChange)
  }, [])

  /*
   * Stop the page behind scrolling while the player is pinned over it.
   * Without this, dragging the scrubber near the edge scrolls the article
   * underneath and the gesture is lost to the page.
   */
  useEffect(() => {
    if (!pseudoFullscreen) return
    const previous = document.body.style.overflow
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = previous
    }
  }, [pseudoFullscreen])

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
      engine.setThirdPersonAngle(camAngleRef.current)
      engine.setThirdPersonPitch(camPitchRef.current)
      engine.stopAutoOrbit()
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

  /**
   * Hand the page a seek it can call. Registered once ready, so a comment's
   * timestamp cannot drive an engine that has not loaded a demo yet.
   */
  useEffect(() => {
    if (!ready) return
    onSeekReady?.((ms) => {
      setEnded(false)
      requestSeek(ms, true)
    })
    // onSeekReady is a prop the parent redefines every render; depending on it
    // would re-register on every keystroke elsewhere on the page.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, requestSeek])

  /**
   * Hand the page the cutter, or null if this engine has no such export -- the
   * page and the engine deploy separately, so a viewer can be newer than the
   * build it is talking to.
   */
  useEffect(() => {
    if (!ready) return
    const engine = engineRef.current

    // Handed up before the trim check below, not after: rendering needs the
    // camera and the roster, which every engine has. Gating it on canTrim
    // meant an engine too old to cut also refused to render, which are
    // unrelated capabilities.
    onCameraStateReady?.(() => ({
      camera: cameraRef.current,
      follow: followRef.current,
      players: playersRef.current,
    }))

    if (!engine?.canTrim) {
      onTrimReady?.(null)
      return
    }
    onTrimReady?.(async (startMs: number, endMs: number) => {
      const bytes = await engine.trimDemo(startMs, endMs)
      // The cut leaves playback at the out-point and the page's own idea of
      // where it is now wrong; put it back where the clip begins.
      setEnded(false)
      requestSeek(startMs, true)
      return bytes
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, requestSeek])

  const onScrubStart = useCallback(() => {
    const engine = engineRef.current
    if (!engine) return
    // Scrubbing back into the demo is its own way of un-ending it.
    setEnded(false)
    draggingRef.current = true
    scrubActiveRef.current = true
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
   *
   * mouseup as well as pointerup, and for the same Safari: on a held drag it
   * swallows the pointerup entirely -- window included -- but still delivers
   * the mouseup. The settings sliders learned this first (see SettingSlider);
   * the scrubber kept sticking after they were fixed because this listener
   * predated that lesson.
   */
  useEffect(() => {
    const end = () => {
      scrubActiveRef.current = false
      if (!draggingRef.current) return
      onScrubEnd(scrubValueRef.current)
    }
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    window.addEventListener("mouseup", end)
    return () => {
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      window.removeEventListener("mouseup", end)
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

  const changeGamma = useCallback((v: number) => {
    const clamped = Math.min(GAMMA_MAX, Math.max(GAMMA_MIN, v))
    setGamma(clamped)
    localStorage.setItem(GAMMA_KEY, String(clamped))
  }, [])

  /**
   * Paint the gamma curve onto the canvas.
   *
   * Set on the element rather than through React, because the canvas is a
   * module-level singleton that outlives this component (see getEngineCanvas)
   * -- React never owns it. Cleared at 1 rather than left as an identity
   * filter, so the compositor keeps its fast path when nobody has asked for
   * anything.
   */
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.style.filter = gammaFilterFor(gamma)
    return () => {
      canvas.style.filter = ""
    }
  }, [gamma, ready])

  const changeSensitivity = useCallback((v: number) => {
    setSensitivity(v)
  }, [])

  const changeCamAngle = useCallback((v: number) => {
    // Wraps rather than clamps: swinging past head-on should come round the
    // other side, not stick against the end of the slider.
    const wrapped = ((((v + 180) % 360) + 360) % 360) - 180
    setCamAngle(wrapped)
    camAngleRef.current = wrapped
    engineRef.current?.setThirdPersonAngle(wrapped)
  }, [])

  const changeCamPitch = useCallback((v: number) => {
    const clamped = Math.min(CAM_PITCH_MAX, Math.max(CAM_PITCH_MIN, v))
    setCamPitch(clamped)
    camPitchRef.current = clamped
    engineRef.current?.setThirdPersonPitch(clamped)
  }, [])

  const resetCamera = useCallback(() => {
    changeCamAngle(0)
    changeCamPitch(0)
  }, [changeCamAngle, changeCamPitch])

  /**
   * Only let the mouse steer when steering is what the mouse is for.
   *
   * SDL feeds every mousemove over the canvas straight to the engine's view
   * angles -- so while following a player, merely passing the cursor across
   * the picture used to swing the camera, which reads as the view drifting on
   * its own. Zeroing sensitivity is the switch: the events still arrive, they
   * just scale to nothing.
   *
   * The mode is the whole test, deliberately, and pointer lock is not part of
   * it. Free fly does not depend on the lock -- it is requested but does not
   * always land (the browser refuses it outside a user gesture, and in an
   * embedded frame it can fail outright) and mouse-look works regardless, so
   * gating on it took the mouse away from the one mode whose point is looking
   * around. Following does not want the mouse at all: the chase camera will
   * happily orbit off a usercmd delta, which is what made the view lurch the
   * moment anyone clicked the picture, and the camera-angle controls do that
   * job deliberately now.
   */
  useEffect(() => {
    if (!ready) return
    engineRef.current?.setSensitivity(camera === "free" ? sensitivity : 0)
  }, [ready, camera, sensitivity])

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
      if (!ready || e.metaKey || e.ctrlKey || e.altKey) return
      // Some remote-input paths deliver an arrow as the legacy unprefixed name.
      const arrow = /^(Arrow)?(Left|Right|Up|Down)$/.exec(e.key)?.[2] ?? null
      // Auto-repeat is a mis-fire for a toggle but exactly right for the
      // arrows, where holding one should sweep the camera round.
      if (e.repeat && !arrow) return
      if (e.target instanceof HTMLElement) {
        // Sliders and text fields own the arrow keys outright, so those always
        // win. Buttons do not use them -- and after clicking any control the
        // focus is sitting on one, so bailing there would mean the arrows
        // stopped working the moment you touched the player's own chrome.
        const owner = e.target.closest("button, a, input, select, textarea")
        if (owner && (!arrow || !owner.matches("button, a"))) return
      }
      // Match on key as well as code: virtual keyboards and remote-input
      // software deliver real keydowns with an empty `code`.
      if (e.code === "Space" || e.key === " ") {
        e.preventDefault()
        if (ended) replay()
        else togglePaused()
      } else if (e.code === "KeyM" || e.key.toLowerCase() === "m") {
        toggleMuted()
      } else if (arrow) {
        // Only while a chase camera is up: in free fly the arrows are the
        // engine's own, and the third-person angles mean nothing anyway.
        if (camera !== "follow") return
        e.preventDefault()
        // Off the refs, not off state: auto-repeat fires faster than React
        // re-renders, so reading state here would have every press in a burst
        // start from the same stale angle and the camera would crawl.
        if (arrow === "Left") changeCamAngle(camAngleRef.current - CAM_NUDGE)
        else if (arrow === "Right") changeCamAngle(camAngleRef.current + CAM_NUDGE)
        else if (arrow === "Up") changeCamPitch(camPitchRef.current - CAM_NUDGE)
        else if (arrow === "Down") changeCamPitch(camPitchRef.current + CAM_NUDGE)
      }
    }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [ready, ended, replay, togglePaused, toggleMuted, camera, changeCamAngle, changeCamPitch])

  // Asked once on mount rather than from a userAgent guess: `hover: none` is
  // the actual question -- can this input device hover at all.
  useEffect(() => {
    setTouchOnly(window.matchMedia("(hover: none)").matches)
  }, [])


  /**
   * Free-fly grabs the pointer for mouse-look (SDL's relative mouse mode maps
   * to the browser's real Pointer Lock API). There's no cursor to hover the
   * bar with at that point, so its visibility has to react to lock state, not
   * just mouse position.
   *
   * The engine's own Escape handling swallows the key during playback rather
   * than opening its in-game menu (see the __EMSCRIPTEN__ block guarding
   * clc.demoplaying in cl_keys.cpp) -- deliberately, because a public demo
   * viewer has no business routing into Join/Add Bot/Setup. What that leaves
   * Escape to do is exactly what the browser already guarantees on its own:
   * release the pointer lock. The page finds out about that release here,
   * same as any other -- but if it happens while still in free fly, camera
   * state is left claiming a mode that no longer has the one thing that made
   * it meaningful, since nothing steers the camera without the pointer. Left
   * alone, the next click on the picture would silently re-request it and
   * trap the cursor right back -- which is what "Escape doesn't seem to do
   * anything" looks like from the outside: the key worked, but nothing
   * changed about the state a follow-up click would land back in. Falling
   * back to Follow here is what actually finishes leaving free fly, matching
   * what clicking the Follow button itself would do.
   */
  useEffect(() => {
    const onChange = () => {
      const locked = !!document.pointerLockElement
      setPointerLocked(locked)
      if (!locked && cameraRef.current === "free") chooseCamera("follow")
    }
    document.addEventListener("pointerlockchange", onChange)
    return () => document.removeEventListener("pointerlockchange", onChange)
    // chooseCamera is a useCallback with no dependencies of its own -- stable
    // across renders, so this can safely run once on mount rather than
    // re-subscribing on every camera change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /**
   * Give the cursor back the moment there is nothing to look around with.
   *
   * The engine takes the pointer itself, from inside SDL, on a click in the
   * picture -- the page only finds out afterwards. So it can end up held in
   * situations the page would never have asked for it, and the worst of those
   * is a demo running out while the free camera has it: the "watch again"
   * overlay appears over a locked pointer, so there is no cursor to click it
   * with and nothing on screen explaining that Escape is the way out. Someone
   * reported closing the browser to get their mouse back, which is a fair
   * response to a page that appears to have eaten it.
   *
   * Escape does still work, and always did -- browsers guarantee it. Knowing
   * that is the part we cannot rely on, so the lock is simply dropped whenever
   * it is not earning its place: following a player (where the mouse steers
   * nothing anyway), at the end of a demo, or before the engine is up.
   */
  useEffect(() => {
    if (!pointerLocked) return
    if (camera === "free" && ready && !ended) return
    document.exitPointerLock?.()
  }, [pointerLocked, camera, ready, ended])

  // Nothing is being watched until a snapshot has arrived; asking before that
  // gets -1 back and renders as the literal "client -1".
  const viewClient = follow >= 0 ? follow : ready ? (engineRef.current?.getViewClientNum() ?? -1) : -1
  const watching = viewClient >= 0 ? engineRef.current?.getPlayerName(viewClient) : null

  /*
   * Whether the recording currently knows where the followed player is.
   *
   * Only asked of an explicitly chosen POV. The recorded view is by definition
   * someone the recording was watching, so it is never out of view -- and a
   * demobot's own spectator does not appear in this list at all.
   *
   * Read from the same poll that drives the picker, so it changes with the
   * play rather than being a fixed claim about the demo.
   */
  const followedOutOfView =
    follow >= 0 && players.length > 0 && players.some((p) => p.clientNum === follow && !p.visible)

  // Hidden once playing and the mouse has left, or the whole time the
  // pointer is locked (no cursor to hover with). Visible while paused, still
  // loading, mid-scrub or finished, so the controls that matter are never
  // hiding. On touch, where there is no hover, the tap state stands in.
  /*
   * On touch, the controls get out of the way on their own.
   *
   * A mouse has hover to say "I am still here", and the bar uses it. A thumb
   * has nothing equivalent, so the bar would sit over the picture until it was
   * deliberately dismissed -- and on a phone in landscape it covers most of
   * what you came to watch. Sam found the clean view by accident and then had
   * no way back to it.
   *
   * So playback hides it, and a tap brings it back. Only while genuinely
   * playing: paused, seeking, still loading or ended all mean someone is
   * looking for a control rather than watching, and those already force the bar
   * on below.
   */
  useEffect(() => {
    if (!touchOnly || !tapShowsChrome) return
    if (!ready || paused || seeking || ended) return
    const timer = setTimeout(() => setTapShowsChrome(false), 3500)
    return () => clearTimeout(timer)
  }, [touchOnly, tapShowsChrome, ready, paused, seeking, ended, chromeBumpAt])

  /*
   * Spend every user gesture on unlocking the sound until it takes.
   *
   * iOS refuses to start an AudioContext outside a gesture, and the obvious one
   * -- the tap on the confirmation card -- is spent long before SDL creates the
   * context, which is well into a 141MB boot. So it arrives suspended and
   * playback is silent, with nothing logged anywhere to say why.
   *
   * Listening on the window in the capture phase, so it works wherever the tap
   * lands and cannot be swallowed by a handler that stops propagation -- the
   * control bar stops pointer events, and the controls are exactly where a
   * first tap tends to go. Removed as soon as the context is running.
   */
  useEffect(() => {
    if (!ready) return
    const engine = engineRef.current
    if (!engine) return
    const unlock = () => {
      engine.unlockAudio()
      // Cheap to leave attached, but there is no reason to keep asking once
      // the browser has stopped saying no.
      if (window.Module?.SDL2?.audioContext?.state === "running") detach()
    }
    const detach = () => {
      window.removeEventListener("pointerdown", unlock, true)
      window.removeEventListener("keydown", unlock, true)
    }
    window.addEventListener("pointerdown", unlock, true)
    window.addEventListener("keydown", unlock, true)
    // The mount itself may follow a gesture closely enough to count.
    unlock()
    return detach
  }, [ready])

  /*
   * Backgrounding the tab stops playback rather than letting it run on.
   *
   * requestAnimationFrame already stops when the tab is hidden, so the frame
   * loop halts on its own -- but the engine's audio does not, because SDL mixes
   * from a Web Audio callback that is not tied to the frame loop. Left alone, a
   * phone that switches apps keeps talking. Worse, the demo clock is driven off
   * real time, so a demo left "running" through five minutes in the background
   * comes back five minutes further on with nothing rendered in between.
   *
   * Deliberately does not resume on return: coming back to a paused picture and
   * pressing play is predictable, whereas sound restarting by itself when a
   * phone is unlocked is not.
   */
  useEffect(() => {
    const onVisibility = () => {
      if (!document.hidden) return
      const engine = engineRef.current
      if (!engine || !engine.isReady) return
      engine.setPaused(true)
      setPaused(true)
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [])

  /*
   * A lost GL context is a dead canvas, and it must not look like a stall.
   *
   * The browser takes the context back under memory pressure -- likeliest on
   * exactly the phones this work is for -- and once it is gone the engine
   * cannot draw again. preventDefault is what allows a restore to be attempted
   * at all; without it the browser will not bother. But the engine reads its GL
   * state once at startup and there is no page-side way to rebuild it, so even
   * a restored context comes back to an engine that has stopped drawing. Saying
   * so and offering a reload is the honest option, and the one the brief asks
   * for: never a dead canvas with no explanation.
   */
  useEffect(() => {
    if (!canvasEl) return
    const onLost = (e: Event) => {
      e.preventDefault()
      logDiagEvent("webglcontextlost")
      engineRef.current?.setPaused(true)
      setPaused(true)
      setContextLost(true)
    }
    const onRestored = () => logDiagEvent("webglcontextrestored")
    canvasEl.addEventListener("webglcontextlost", onLost)
    canvasEl.addEventListener("webglcontextrestored", onRestored)
    return () => {
      canvasEl.removeEventListener("webglcontextlost", onLost)
      canvasEl.removeEventListener("webglcontextrestored", onRestored)
    }
  }, [canvasEl])

  const showChrome =
    !unsupported &&
    !confirmNeeded &&
    !contextLost &&
    !pointerLocked &&
    ((touchOnly ? tapShowsChrome : hovering) || paused || !ready || seeking || ended)

  return (
    <div
      ref={containerRef}
      onMouseEnter={() => setHovering(true)}
      onMouseLeave={() => setHovering(false)}
      /*
       * Tap the picture to show or hide the controls -- but only a real tap.
       *
       * This was a plain onClick, which fires at the end of any gesture that
       * began here: a swipe, a scroll that did not take, a drag that started on
       * the picture and ended somewhere else. So the controls flipped when
       * nobody asked, and the one deliberate tap arrived looking like all the
       * accidents. Measuring the gesture instead is what makes it predictable,
       * and predictable is the whole feature: with no keyboard there is no
       * other way back to a clean picture, or out of one.
       *
       * Still touch only -- with a mouse this fights the hover behaviour, and
       * clicking the picture is how you enter free fly.
       */
      onPointerDown={
        touchOnly
          ? (e) => {
              tapStartRef.current = { x: e.clientX, y: e.clientY, at: Date.now() }
            }
          : undefined
      }
      onPointerUp={
        touchOnly
          ? (e) => {
              const start = tapStartRef.current
              tapStartRef.current = null
              if (!start) return
              // Generous on distance because a thumb rolls, strict on time
              // because a long press is a different intention.
              const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
              if (moved > 14 || Date.now() - start.at > 600) return
              setTapShowsChrome((s) => !s)
            }
          : undefined
      }
      // A gesture the browser took over -- a scroll, a system edge swipe -- is
      // not a tap, and must not be treated as one when it comes back.
      onPointerCancel={touchOnly ? () => { tapStartRef.current = null } : undefined}
      className={cn(
        "relative h-full w-full overflow-hidden bg-black",
        fullscreen || pseudoFullscreen ? "rounded-none" : "rounded-xl",
        // Pinned over the viewport where the real API is unavailable. Fixed
        // rather than absolute so it escapes the aspect-video box the page
        // gives it, which is what was squeezing landscape into a letterbox.
        pseudoFullscreen && "fixed inset-0 z-[100] h-auto w-auto",
      )}
    >
      {/* The curve the brightness slider drives, referenced by the canvas's CSS
          filter. Zero-sized and aria-hidden: it is a definition, not a picture.
          Exponents are set from state rather than by mutating the DOM, so the
          filter is just another thing React renders. */}
      <svg aria-hidden className="pointer-events-none absolute h-0 w-0" focusable="false">
        <filter id={GAMMA_FILTER_ID} colorInterpolationFilters="sRGB">
          <feComponentTransfer>
            <feFuncR type="gamma" exponent={gamma} />
            <feFuncG type="gamma" exponent={gamma} />
            <feFuncB type="gamma" exponent={gamma} />
          </feComponentTransfer>
        </filter>
      </svg>

      {/* The canvas lives inside here but is not rendered by React -- it is a
          per-page singleton that survives moving between demos, because the
          WebGL context on it cannot be moved to a replacement element. The
          engine owns the drawing buffer too: it picks its own resolution and
          sizes the canvas to match, so nothing here sets width/height, and
          object-contain (on the canvas itself) only scales the result. */}
      <div ref={holderRef} className="absolute inset-0" />

      {/* Said once, plainly, instead of a spinner that never finishes. */}
      {unsupported && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 px-6 text-center">
          <Monitor className="h-7 w-7 text-white/40" />
          <p className="text-sm font-medium text-white/90">This browser can&rsquo;t run the demo player</p>
          <p className="max-w-xs text-xs leading-relaxed text-white/50">
            It needs WebGL and WebAssembly, and this browser is missing one of them. A current
            Safari, Chrome or Firefox will play it — phones included. Everything else on this page
            works fine here.
          </p>
        </div>
      )}

      {/* The diagnostics path onto a phone: say what it costs before spending
          it. Nobody arrives here without ?diag=1 in the URL, so this is not a
          consent banner for visitors -- it is a guard against reopening a test
          tab on cellular and losing 141MB to it. */}
      {confirmNeeded && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/70 px-6 text-center">
          <p className="text-sm font-medium text-white/90">Watch this demo on your phone?</p>
          {/*
            Both facts up front, because both are things someone would want to
            know before committing rather than discover afterwards: what it
            costs to load, and what will not be here when it has. Naming the
            missing features by name beats "some features are unavailable" --
            the whole point is that a person can tell whether the ones they
            came for are in the list.
          */}
          <p className="max-w-xs text-xs leading-relaxed text-white/50">
            This loads the game itself — about 141MB the first time, then cached. Playback, the
            timeline and switching between players all work.
          </p>
          <p className="max-w-xs text-xs leading-relaxed text-white/40">
            The free-fly camera and trimming clips are desktop only: both need a mouse and keyboard.
          </p>
          <button
            onClick={(e) => {
              // The container's own onClick toggles the control bar on touch;
              // without this the same tap would do both.
              e.stopPropagation()
              setConfirmNeeded(false)
              setStatus("Starting the engine…")
              setConfirmed(true)
            }}
            className="mt-1 rounded-full bg-white/10 px-5 py-3 text-sm font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
          >
            Load and watch
          </button>
        </div>
      )}

      {/* The GPU took its context back. Nothing will draw again on this page
          load, so say so and offer the one thing that does fix it. */}
      {contextLost && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-3 bg-black/80 px-6 text-center">
          <p className="text-sm font-medium text-white/90">The viewer lost the graphics context</p>
          <p className="max-w-xs text-xs leading-relaxed text-white/50">
            The browser reclaimed it, usually because something else needed the memory. Reloading
            starts it again — the demo will be cached, so it won&rsquo;t download twice.
          </p>
          <button
            onClick={(e) => {
              e.stopPropagation()
              window.location.reload()
            }}
            className="mt-1 flex items-center gap-2 rounded-full bg-white/10 px-5 py-3 text-sm font-medium text-white ring-1 ring-white/20 transition-colors hover:bg-white/20"
          >
            <RotateCcw className="h-4 w-4" />
            Reload the viewer
          </button>
        </div>
      )}

      {/* Mounted only on request, and only once there is a canvas to measure.
          Reading the GL context or the backing-store size before the engine has
          made one answers nothing. */}
      {diag && <DemoViewerDiag canvas={canvasEl} engineReady={ready} />}

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
          {/*
            Say when the recording stops knowing where they are.

            A demo only contains what the recorder could see. Follow someone who
            has gone round a corner and the camera holds their last known
            position -- they stand still, or slide, or vanish -- which reads as
            the player being broken rather than the recording ending at the
            recorder's line of sight.

            The POV list already dims whoever is out of view, but that is a
            hover tooltip you only meet before choosing. This is the same fact
            at the moment it actually matters, and it comes and goes with the
            play, because that is how the coverage itself behaves.
          */}
          {followedOutOfView && (
            <div className="mt-1 text-[11px] text-amber-200/90 drop-shadow-[0_1px_4px_rgba(0,0,0,0.9)]">
              Out of view — the recorder couldn&rsquo;t see them here
            </div>
          )}
        </div>
      )}
      {ready && !failed && camera === "free" && (
        <div className="pointer-events-none absolute inset-x-0 top-5 text-center text-xl font-semibold text-white drop-shadow-[0_2px_10px_rgba(0,0,0,0.85)]">
          Free camera
        </div>
      )}

      {/* The kill feed, where the game puts it. Obituaries and flag events only
          -- the engine feeds this from those two printers rather than from the
          console, so chat never reaches it. Monospaced and left-aligned, since
          it is a log being skimmed rather than prose. Sits below the match
          clock, which owns the top-left corner and is always up. */}
      {feed.length > 0 && (
        <div className="pointer-events-none absolute left-4 top-14 flex max-w-[min(30rem,55%)] flex-col gap-0.5">
          {feed.map((line) => (
            <span
              key={line.id}
              className="w-fit rounded bg-black/45 px-1.5 py-0.5 font-mono text-[11px] leading-snug text-white/90 drop-shadow-[0_1px_3px_rgba(0,0,0,0.9)]"
            >
              {line.text}
            </span>
          ))}
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
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 px-6">
          {/* A failure used to be one short line. The boot-failure message now
              carries the numbers behind it -- what the engine asked for, what
              the device would grant -- so it needs room to wrap rather than
              running off both edges of a phone. */}
          <div
            className={cn(
              "max-w-md text-center text-sm leading-relaxed",
              failed ? "text-red-300" : "text-white/70",
            )}
          >
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

          {/* Somewhere to go next. The end of a demo is the moment someone
              decides whether to keep watching, and until now the only thing
              offered was the one they had just finished. Ordinary links, so
              they route client-side and reuse the resident engine. */}
          {(previousDemo || nextDemo) && (
            <div className="flex max-w-[min(36rem,90%)] flex-wrap items-center justify-center gap-2">
              {previousDemo && (
                <Link
                  href={`/demos/${previousDemo.id}`}
                  className="flex max-w-[16rem] items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/15 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <ChevronLeft className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{previousDemo.title}</span>
                </Link>
              )}
              {nextDemo && (
                <Link
                  href={`/demos/${nextDemo.id}`}
                  className="flex max-w-[16rem] items-center gap-1.5 rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/80 ring-1 ring-white/15 transition-colors hover:bg-white/15 hover:text-white"
                >
                  <span className="truncate">{nextDemo.title}</span>
                  <ChevronRight className="h-3.5 w-3.5 shrink-0" />
                </Link>
              )}
            </div>
          )}
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
            Right-click to fly up
          </div>
        </div>
      )}

      {/* How to get the cursor back, said plainly and where it will be read.
          The corner strip carried this and it was missed -- understandably: the
          pointer has just vanished, which is the moment someone is looking at
          the middle of the picture, not its edges. */}
      {pointerLocked && (
        <div className="pointer-events-none absolute inset-x-0 top-4 flex justify-center">
          <span className="rounded-full bg-black/80 px-3 py-1.5 text-xs text-white/90 ring-1 ring-white/20">
            Mouse hidden for free look — press <kbd className="font-semibold text-white">Esc</kbd> to get the cursor back
          </span>
        </div>
      )}

      {/* Controls. */}
      <div
        /*
         * Taps that land on a control stop here.
         *
         * On touch the picture toggles this whole bar, and the bar sits on top
         * of the picture -- so without this, the tap that grabs the scrubber
         * also bubbles up and hides the thing being grabbed, mid-gesture. The
         * bar goes to opacity-0 and pointer-events-none, so the drag dies at
         * the moment it starts. That is why the scrubber could not be used on a
         * phone at all: not the size of the target, which is a separate problem
         * fixed separately, but that touching it dismissed it.
         */
        onPointerDown={(e) => {
          e.stopPropagation()
          // Using a control counts as being here, so the bar should not time
          // out from under a slider halfway through a drag.
          setChromeBumpAt(Date.now())
        }}
        onPointerUp={(e) => e.stopPropagation()}
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
            <SettingSlider
              label="Brightness"
              value={GAMMA_MAX + GAMMA_MIN - gamma}
              display={gamma === 1 ? "As recorded" : `+${Math.round((1 - gamma) * 100)}%`}
              min={GAMMA_MIN}
              max={GAMMA_MAX}
              step={0.05}
              // Inverted so the slider runs dark-to-bright left-to-right, which
              // is the way round anyone expects. Gamma itself goes the other way.
              onChange={(v) => changeGamma(GAMMA_MAX + GAMMA_MIN - v)}
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
            {/* Only while a chase camera is up -- the free camera flies on its
                own angles and these would do nothing. */}
            {camera === "follow" && (
              <>
                <SettingSlider
                  label="Camera angle"
                  value={camAngle}
                  display={camAngle === 0 ? "Behind" : `${camAngle > 0 ? "+" : ""}${camAngle}°`}
                  min={CAM_ANGLE_MIN}
                  max={CAM_ANGLE_MAX}
                  step={CAM_NUDGE}
                  onChange={changeCamAngle}
                />
                <SettingSlider
                  label="Camera height"
                  value={camPitch}
                  display={camPitch === 0 ? "Level" : `${camPitch > 0 ? "+" : ""}${camPitch}°`}
                  min={CAM_PITCH_MIN}
                  max={CAM_PITCH_MAX}
                  step={CAM_NUDGE}
                  onChange={changeCamPitch}
                />
                <div className="flex items-center justify-between gap-2 px-2 py-1.5">
                  <span className="text-[11px] text-white/40">Arrow keys nudge {CAM_NUDGE}°</span>
                  <button
                    type="button"
                    onClick={resetCamera}
                    disabled={camAngle === 0 && camPitch === 0}
                    className="rounded border border-white/15 px-2 py-0.5 text-[11px] text-white/70 transition-colors enabled:hover:border-white/30 enabled:hover:bg-white/10 enabled:hover:text-white disabled:opacity-30"
                  >
                    Reset
                  </button>
                </div>
                <div className="my-1 border-t border-white/10" />
              </>
            )}
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
          {/* The scrubber and its heat marks share a stacking context so the
              glow can sit under the thumb without intercepting the drag. */}
          <div className="relative flex-1">
            {/* The stretch a trim would keep. Under the moment glow and the
                thumb, so neither is obscured by it. */}
            {trimRange && span > 1000 && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full">
                <span
                  style={{
                    left: `${Math.max(0, Math.min(100, (100 * trimRange.startMs) / span))}%`,
                    width: `${Math.max(0.5, Math.min(100, (100 * (trimRange.endMs - trimRange.startMs)) / span))}%`,
                  }}
                  className="absolute inset-y-0 bg-cyan-400/70 shadow-[0_0_6px_1px_rgba(34,211,238,0.7)]"
                />
              </div>
            )}
            {moments.length > 0 && span > 1000 && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full">
                {moments.map((m) => {
                  const pct = Math.min(100, Math.max(0, (100 * m.atMs) / span))
                  return (
                    <span
                      key={m.id}
                      // Centred on the moment and a little wider than a hairline:
                      // this is "look around here", not a frame-exact cut.
                      style={{ left: `calc(${pct}% - 1.1%)`, width: "2.2%" }}
                      className="absolute inset-y-0 rounded-full bg-amber-300/80 shadow-[0_0_6px_1px_rgba(252,211,77,0.9)]"
                    />
                  )
                })}
              </div>
            )}
          <input
            type="range"
            min={0}
            max={1000}
            value={Math.round((1000 * elapsed) / Math.max(span, 1))}
            disabled={!ready || span <= 1000}
            onPointerDown={onScrubStart}
            onChange={(e) => {
              // No live interaction means this is Safari still dragging a
              // thumb the user let go of. Put it back and say nothing --
              // the same phantom-change gate as SettingSlider.
              if (!scrubActiveRef.current) {
                e.currentTarget.value = String(Math.round((1000 * elapsed) / Math.max(span, 1)))
                return
              }
              onScrubMove((Number(e.target.value) / 1000) * span)
            }}
            // Keyboard is an interaction too, or the gate above would eat the
            // arrow keys.
            onKeyDown={() => {
              scrubActiveRef.current = true
            }}
            // The release is handled on the window, not here -- see the effect
            // by onScrubEnd for why.
            onKeyUp={(e) => {
              if (draggingRef.current) return
              onScrubEnd((Number((e.target as HTMLInputElement).value) / 1000) * span)
            }}
            /*
             * Four pixels tall is a mouse target, not a thumb one. A range
             * input centres its track in whatever box it is given and treats
             * the whole box as grabbable, so height here buys hit area without
             * thickening the line or moving the markers, which are centred on
             * the same axis. Touch only, so desktop keeps the thin bar it has.
             */
            className="relative h-1 w-full cursor-pointer bg-transparent accent-cyan-400 disabled:cursor-not-allowed disabled:opacity-40 [@media(hover:none)_and_(pointer:coarse)]:h-9"
          />
          </div>
          <span className="tabular-nums">{formatTime(span)}</span>
        </div>

        {/* Named moments, jumpable. The glow says where; these say what. */}
        {moments.length > 0 && (
          <div className="mb-2 flex flex-wrap items-center gap-1.5">
            {moments.map((m) => (
              <span
                key={m.id}
                className="flex items-center gap-1.5 rounded-full border border-amber-300/40 bg-amber-300/10 pl-2 pr-0.5 py-0.5 text-[11px] text-amber-100"
              >
                <button
                  onClick={() => {
                    setEnded(false)
                    requestSeek(m.atMs, true)
                  }}
                  disabled={!ready}
                  title={`Jump to ${formatTime(m.atMs)}`}
                  className="flex items-center gap-1.5 py-0.5 transition-colors hover:text-white disabled:opacity-40"
                >
                  <span className="tabular-nums opacity-70">{formatTime(m.atMs)}</span>
                  {m.label && <span className="max-w-[14rem] truncate">{m.label}</span>}
                </button>
                {onRemoveMoment && (
                  <button
                    onClick={() => onRemoveMoment(m.id)}
                    title="Remove moment"
                    aria-label="Remove moment"
                    className="rounded-full p-0.5 text-amber-100/60 transition-colors hover:bg-amber-300/25 hover:text-amber-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

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
            {/*
              Free fly is not offered on touch, and this is a decision rather
              than an omission. The engine takes its camera from mouse-look
              deltas and WASD through the usercmd, so flying needs pointer lock
              and a keyboard -- neither of which a phone has. Reaching it would
              mean a virtual stick synthesising SDL input, quite possibly a new
              engine export and a rebuild, for a camera nobody wants to fly with
              their thumbs. The button is removed rather than disabled: a
              greyed-out control invites asking why, and the honest answer is
              that it is not coming.
            */}
            {CAMERAS.filter((c) => !(touchPrimary && c.id === "free")).map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => chooseCamera(id)}
                disabled={!ready}
                className={cn(
                  "flex items-center gap-1 rounded px-2 py-1 text-xs",
                  camera === id ? "bg-cyan-500 text-black" : "bg-white/10 text-white hover:bg-white/20",
                  // The filter above removes this once React knows what device
                  // it is on, which is one render too late -- the server-rendered
                  // markup offers Free fly to everyone, so a phone shows it for
                  // a beat and then takes it away. The same query in CSS covers
                  // that window.
                  id === "free" && "[@media(hover:none)_and_(pointer:coarse)]:hidden",
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
              // Its own input rather than a SettingSlider, so it needs the
              // same touch hit area spelled out here. Wider too: 64px of track
              // is a fiddly drag with a thumb even once it is tall enough.
              className="h-1 w-16 cursor-pointer accent-cyan-400 [@media(hover:none)_and_(pointer:coarse)]:h-9 [@media(hover:none)_and_(pointer:coarse)]:w-24"
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
            title={fullscreen || pseudoFullscreen ? "Exit full screen" : "Full screen"}
            className="rounded-md bg-white/10 p-1.5 text-white hover:bg-white/20"
          >
            {fullscreen || pseudoFullscreen ? (
              <Minimize className="h-4 w-4" />
            ) : (
              <Maximize className="h-4 w-4" />
            )}
          </button>
        </div>

        {players.length > 0 && (
          <div className="mt-3">
            <div className="mb-1 text-[11px] uppercase tracking-wider text-white/50">Watching</div>
            {/*
              Wrapping is right with a mouse and wrong with a thumb. Thirteen
              names wrap to three rows, and in landscape on a phone that is a
              third of the screen spent on a list, over the picture. One row
              that scrolls sideways costs a fixed 40pt instead, and scrolling it
              is a drag rather than a tap so it cannot be confused for one.

              overscroll-contain so reaching the end of the names does not hand
              the gesture to the page and start scrolling the article behind.
            */}
            <div className="flex flex-wrap gap-1.5 [@media(hover:none)_and_(pointer:coarse)]:flex-nowrap [@media(hover:none)_and_(pointer:coarse)]:overflow-x-auto [@media(hover:none)_and_(pointer:coarse)]:overscroll-x-contain [@media(hover:none)_and_(pointer:coarse)]:pb-1">
              <button
                onClick={() => chooseFollow(-1)}
                className={cn(
                  "rounded px-2 py-1 text-xs",
                  // shrink-0 or flex squeezes every name to nothing rather than
                  // letting the row scroll; nowrap or they break mid-name.
                  "[@media(hover:none)_and_(pointer:coarse)]:shrink-0 [@media(hover:none)_and_(pointer:coarse)]:whitespace-nowrap [@media(hover:none)_and_(pointer:coarse)]:px-3 [@media(hover:none)_and_(pointer:coarse)]:py-2",
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
                    "[@media(hover:none)_and_(pointer:coarse)]:shrink-0 [@media(hover:none)_and_(pointer:coarse)]:whitespace-nowrap [@media(hover:none)_and_(pointer:coarse)]:px-3 [@media(hover:none)_and_(pointer:coarse)]:py-2",
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
  const inputRef = useRef<HTMLInputElement>(null)
  /** True between starting an interaction and letting go of it. */
  const activeRef = useRef(false)

  /**
   * Ignore the change events Safari keeps sending after the button is up.
   *
   * Safari leaves a range input in its drag after the release, so it goes on
   * firing change as the mouse moves and the thumb follows a pointer that is
   * not holding it. Three attempts at this treated it as a lost `pointerup` --
   * releasing the capture, then blurring -- and none of them worked, because
   * the phantom events keep coming regardless of capture or focus.
   *
   * The scrubber looked immune and is not: its value is rewritten from the
   * playback poll five times a second, so a phantom drag is overwritten before
   * anyone sees it. These sliders have no such second opinion -- their value
   * only ever comes from this handler -- so the phantom events are authoritative
   * and nothing corrects them.
   *
   * So: gate the handler on the interaction actually being live, and put the
   * element back where the state says it belongs when it is not. Keyboard
   * counts as an interaction too, or the arrow keys would stop adjusting it.
   */
  useEffect(() => {
    const end = () => {
      activeRef.current = false
    }
    window.addEventListener("pointerup", end)
    window.addEventListener("pointercancel", end)
    window.addEventListener("mouseup", end)
    return () => {
      window.removeEventListener("pointerup", end)
      window.removeEventListener("pointercancel", end)
      window.removeEventListener("mouseup", end)
    }
  }, [])

  // Whatever the DOM value drifted to during a phantom drag, the prop is right.
  useEffect(() => {
    const el = inputRef.current
    if (el && el.value !== String(value)) el.value = String(value)
  }, [value])

  return (
    <label className="block px-2 py-1.5">
      <span className="mb-1 flex items-center justify-between text-xs text-white">
        {label}
        <span className="tabular-nums text-white/50">{display}</span>
      </span>
      <input
        ref={inputRef}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onPointerDown={() => {
          activeRef.current = true
        }}
        onMouseDown={() => {
          activeRef.current = true
        }}
        onKeyDown={() => {
          activeRef.current = true
        }}
        onTouchStart={() => {
          activeRef.current = true
        }}
        onChange={(e) => {
          // No live interaction means Safari is still dragging something the
          // user let go of. Put the thumb back and say nothing.
          if (!activeRef.current) {
            e.currentTarget.value = String(value)
            return
          }
          onChange(Number(e.target.value))
        }}
        // Same reasoning as the scrubber: the box is the hit area, the track
        // stays where it is. Touch only, so desktop is unchanged.
        className="h-1 w-full cursor-pointer accent-cyan-400 [@media(hover:none)_and_(pointer:coarse)]:h-9"
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
