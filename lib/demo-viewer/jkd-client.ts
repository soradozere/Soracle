/**
 * Typed wrapper around the JK2 demo engine's browser exports.
 *
 * The engine is an Emscripten build of JK2MV that plays .dm_15 demos. Everything
 * it exposes to a page goes through a handful of `JKD_*` C exports plus its own
 * console, so this file is the one place that knows those names -- React code
 * talks to the class, never to `window.Module`.
 *
 * The engine owns all playback state. Nothing here mirrors it: every getter asks
 * the engine, so the UI cannot drift out of sync with what is actually on screen.
 */

export type CameraMode = "follow" | "free"

/**
 * Field of view, fixed.
 *
 * Stock JK2 ships 110 and the wheel used to drive this, but a demo is watched,
 * not played -- there is no reason for the framing to move between clips, and
 * one wide setting reads better than whatever the last viewer left it on.
 */
export const FIXED_FOV = 120

/** Camera distances, in the engine's units. 80 is JK2's own default. */
export const RANGE_MIN = 0
export const RANGE_MAX = 400
export const RANGE_DEFAULT = 80
/** Below this the camera would be inside the player, so it becomes first person. */
const FIRST_PERSON_BELOW = 16

export interface DemoPlayerInfo {
  clientNum: number
  name: string
  /** 1 = red, 2 = blue. Spectators are filtered out before you see this. */
  team: number
  /** Whether this player is in the current snapshot, i.e. actually watchable. */
  visible: boolean
}

export interface KillEvent {
  target: number
  attacker: number
  /** Means-of-death index from the demo; kept raw for a future kill feed. */
  mod: number
  /** Whoever the viewer was watching when it happened. */
  viewed: number
}

export interface JkdEngineOptions {
  /**
   * Where jk2mv_wasm.js, .wasm and .data are served from, no trailing slash.
   * Separate from the site's own origin because the asset bundle is far too
   * large to sit in the Next app's static output.
   */
  baseUrl: string
  canvas: HTMLCanvasElement
  /**
   * Render at the display's real pixel density (the default), or at CSS
   * pixels, which is a quarter of the pixels on a 2x screen.
   *
   * Only settable here, not later: the engine reads r_highdpi when it creates
   * its window, and changing it afterwards needs a vid_restart -- which this
   * build survives with a black world, so it is not an option.
   */
  highDetail?: boolean
  onStatus?: (status: string) => void
  onReady?: () => void
  onKill?: (kill: KillEvent) => void
  /**
   * Flag and scoring announcements, already stripped of colour codes. These are
   * the engine's centre prints, forwarded because it can no longer draw them.
   */
  onAnnouncement?: (text: string) => void
  onPlaybackEnded?: (realDurationMs: number) => void
}

/** Shape of the Emscripten module object, narrowed to what we actually touch. */
interface EmscriptenModule {
  canvas: HTMLCanvasElement
  setStatus: (text: string) => void
  cwrap: (name: string, ret: string | null, args: string[]) => (...a: unknown[]) => never
  FS: { writeFile: (path: string, data: Uint8Array) => void }
  /** Emscripten's own rAF loop controls, exported by the engine's build. */
  pauseMainLoop?: () => void
  resumeMainLoop?: () => void
  /** Hands the loader the asset bundle directly, skipping its own download. */
  getPreloadedPackage?: (name: string, size: number) => ArrayBuffer
  /** SDL's Emscripten audio backend, whose context is the real sound switch. */
  SDL2?: { audioContext?: AudioContext }
  [key: string]: unknown
}

declare global {
  interface Window {
    Module?: EmscriptenModule
    JKD_ready?: () => void
    JKD_onKill?: (target: number, attacker: number, mod: number, viewed: number) => void
    JKD_onCenterPrint?: (text: string) => void
    JKD_playbackStopped?: (realDuration: number) => void
    JKD_seekDone?: () => void
  }
}

/**
 * Keep the engine's keyboard handlers out of the page's own text fields.
 *
 * SDL's Emscripten backend binds keydown, keypress and keyup to `window` and
 * calls preventDefault() on them while text input is active -- which JK2MV
 * switches on at startup and never switches off (IN_Init calls
 * SDL_StartTextInput unconditionally). The keypress half is what actually
 * swallows characters: a cancelled keypress means the browser never inserts
 * anything into the focused field, so every dialog on a page running the
 * engine silently refuses to accept typing. The keydown half separately drives
 * the camera, so editing a title used to pan the view as you typed.
 *
 * This listener sits on the same node in the same phase as SDL's, but is
 * registered before the engine boots, so it runs first and can take the event
 * away with stopImmediatePropagation. Bubbling at `window` is the very end of
 * the propagation path -- React, Radix and every other listener have already
 * had their turn by then, so nothing but the engine loses out.
 */
function pageOwnsKeyboard(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT") return true
  // Radix puts dialogs, menus and select popups in portals at the end of
  // <body>, so they are never inside the player's own subtree. Match on the
  // role they announce themselves with instead of on where they sit.
  return !!target.closest('[role="dialog"],[role="menu"],[role="listbox"],[role="textbox"]')
}

let keyboardGuardInstalled = false

/**
 * Resolves when the page's engine is up, whoever started it.
 *
 * Set by the first mount and never cleared: a wasm module cannot be unloaded,
 * so this doubles as the record that an engine exists and is (or will be)
 * usable, which is what lets a later mount attach rather than fail.
 */
let bootPromise: Promise<void> | null = null

function installKeyboardGuard() {
  if (keyboardGuardInstalled) return
  keyboardGuardInstalled = true
  const guard = (e: Event) => {
    if (pageOwnsKeyboard(e.target)) e.stopImmediatePropagation()
  }
  // keypress is deprecated in the DOM, but it is the event SDL reads text
  // from, so it is the one that has to be intercepted.
  for (const type of ["keydown", "keypress", "keyup"]) {
    window.addEventListener(type, guard)
  }
}

/**
 * The engine's render target, created once per page.
 *
 * A WebGL context belongs to the element it was created on and cannot be moved
 * to another, so this element has to outlive any React tree that displays it.
 * Moving between demos unmounts the viewer, and a freshly rendered <canvas>
 * would leave the engine drawing into the old, detached one -- a black picture
 * over a demo that is in fact playing perfectly.
 */
let engineCanvas: HTMLCanvasElement | null = null

export function getEngineCanvas(): HTMLCanvasElement {
  if (engineCanvas) return engineCanvas
  const canvas = document.createElement("canvas")
  // The engine looks its render target up by this exact id -- GLimp_SetMode
  // reads the size off a hard-coded "#canvas" selector, not Module.canvas.
  canvas.id = "canvas"
  canvas.className = "absolute inset-0 h-full w-full object-contain"
  canvas.tabIndex = -1
  // The engine binds right-click to a game action; the browser menu on top of
  // that is nobody's idea of a control.
  canvas.addEventListener("contextmenu", (e) => e.preventDefault())
  engineCanvas = canvas
  return canvas
}

/**
 * The asset bundle, fetched once per browser rather than once per page.
 *
 * The HTTP cache is not enough here: Firefox never disk-caches a response
 * this large (its per-entry ceiling is 50MB), so left to itself it re-downloads
 * the whole bundle on every single visit. The Cache Storage API has no such
 * ceiling. The bundle is fetched with progress, stored under its exact
 * versioned URL — a new engine deploy is a new URL, so a stale bundle can
 * never be served — and handed to Emscripten via getPreloadedPackage. Other
 * versions are evicted once a new one lands. Anything failing in here
 * (private windows, storage quota, an ancient browser) falls back to letting
 * the engine download the file itself, which is exactly the old behaviour.
 */
const DATA_CACHE = "jkd-engine-data"

async function loadEngineData(url: string, onStatus?: (s: string) => void): Promise<ArrayBuffer | null> {
  try {
    const cache = await caches.open(DATA_CACHE)
    const hit = await cache.match(url)
    if (hit) {
      onStatus?.("Loading game data…")
      return await hit.arrayBuffer()
    }

    const res = await fetch(url)
    if (!res.ok) return null
    const total = Number(res.headers.get("content-length") || 0)
    const reader = res.body?.getReader()
    let bytes: Uint8Array
    if (reader && total > 0) {
      const chunks: Uint8Array[] = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        // The viewer turns "(received/total)" statuses into its progress bar.
        onStatus?.(`Loading game data… (${received}/${total})`)
      }
      bytes = new Uint8Array(received)
      let at = 0
      for (const c of chunks) {
        bytes.set(c, at)
        at += c.length
      }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer())
    }

    try {
      await cache.put(
        url,
        new Response(bytes.slice(), { headers: { "Content-Type": "application/octet-stream" } }),
      )
      for (const key of await cache.keys()) {
        if (key.url !== url) await cache.delete(key)
      }
    } catch {
      // A refused write just means the next visit downloads again.
    }
    return bytes.buffer as ArrayBuffer
  } catch {
    return null
  }
}

/**
 * A running demo engine.
 *
 * One per page: the engine is a singleton inside the wasm module, and loading
 * its script twice would fight over `window.Module`.
 */
export class JkdEngine {
  private opts: JkdEngineOptions
  private exec!: (cmd: string) => void
  private ready = false
  /** Name of the demo in the engine's filesystem, for replays and restarts. */
  private demoName: string | null = null

  private fnGetCvar!: (name: string) => number
  private fnDemoTime!: () => number
  private fnElapsed!: () => number
  private fnMatchTime!: () => number
  private fnFurthest!: () => number
  private fnEstimate!: () => number
  private fnSeekTo!: (t: number) => number
  private fnIsSeeking!: () => number
  private fnConnected!: () => number
  private fnVisible!: () => number
  private fnPlayerInfo!: (n: number) => string
  private fnViewClient!: () => number
  private fnIsFollowing!: () => number

  /** Set while a seek is in flight, so callers can coalesce rather than stack. */
  private seeking = false
  private seekWaiters: Array<() => void> = []

  constructor(opts: JkdEngineOptions) {
    this.opts = opts
  }

  /**
   * Load and start the engine. Resolves once its exports are callable, which is
   * well before any demo has been opened.
   */
  async start(): Promise<void> {
    const { baseUrl, canvas, onStatus } = this.opts

    // A second mount -- the back button onto a page whose viewer was suspended,
    // say -- gets the engine that is already here. There is no way to unload a
    // wasm module, so the alternative is refusing to show anything at all.
    if (window.Module) {
      if (!bootPromise) throw new Error("A demo engine is already running on this page")
      this.installHooks()
      await bootPromise
      this.bind()
      this.ready = true
      this.applyViewerBinds()
      this.resume()
      this.opts.onReady?.()
      return
    }

    // Before the script loads, so this listener beats SDL's to the window.
    installKeyboardGuard()

    // The engine sizes its framebuffer to the canvas, but it finds the canvas by
    // a hard-coded `#canvas` selector rather than through Module.canvas. Without
    // the id that lookup fails, it falls back to 640x480, and the picture ends
    // up rendering into one corner of the element.
    if (canvas.id !== "canvas") canvas.id = "canvas"

    // Fetched (or read back from Cache Storage) before the engine script runs,
    // because getPreloadedPackage is consulted synchronously during its boot.
    onStatus?.("Loading game data…")
    const dataBuffer = await loadEngineData(`${baseUrl}/jk2mv_wasm.data`, onStatus)

    window.Module = {
      canvas,
      // Read by Com_Init as if they were command-line arguments, which is the
      // only way to land a cvar before the renderer starts.
      arguments: ["+set", "r_highdpi", this.opts.highDetail === false ? "0" : "1"],
      setStatus: (text: string) => onStatus?.(text),
      // Its .wasm and .data sit next to its .js, which is not this origin.
      locateFile: (path: string) => `${baseUrl}/${path}`,
      // The engine is chatty, but swallowing its output means a failure to open
      // a demo or a map looks identical to nothing happening at all.
      print: (text: string) => console.log("[jk2]", text),
      printErr: (text: string) => console.warn("[jk2]", text),
      // Only when the pre-fetch worked; otherwise the loader downloads the
      // bundle itself and nothing has changed from the old behaviour.
      ...(dataBuffer ? { getPreloadedPackage: () => dataBuffer } : {}),
    } as unknown as EmscriptenModule

    const readyPromise = new Promise<void>((resolve) => {
      window.JKD_ready = () => {
        this.bind()
        this.ready = true
        this.applyViewerBinds()
        this.opts.onReady?.()
        resolve()
      }
    })

    this.installHooks()

    bootPromise = loadScript(`${baseUrl}/jk2mv_wasm.js`).then(() => readyPromise)
    await bootPromise
  }

  /**
   * Point the engine's global callbacks at this instance.
   *
   * They live on `window` because the engine calls them by name, so the second
   * instance to mount has to claim them -- otherwise kill messages and seek
   * completions keep arriving at a component that has already unmounted.
   */
  private installHooks() {
    window.JKD_onKill = (target, attacker, mod, viewed) => {
      this.opts.onKill?.({ target, attacker, mod, viewed })
    }
    window.JKD_onCenterPrint = (text: string) => {
      const clean = stripColourCodes(text || "").replace(/\s+/g, " ").trim()
      if (clean) this.opts.onAnnouncement?.(clean)
    }
    window.JKD_playbackStopped = (realDuration: number) => {
      this.opts.onPlaybackEnded?.(realDuration)
    }
    window.JKD_seekDone = () => {
      this.seeking = false
      const waiters = this.seekWaiters
      this.seekWaiters = []
      waiters.forEach((w) => w())
    }
  }

  private bind() {
    const M = window.Module!
    this.exec = M.cwrap("JKD_Exec", null, ["string"]) as unknown as (c: string) => void
    this.fnGetCvar = M.cwrap("JKD_GetCvar", "number", ["string"]) as unknown as (n: string) => number
    this.fnDemoTime = M.cwrap("JKD_GetDemoTime", "number", []) as unknown as () => number
    this.fnElapsed = M.cwrap("JKD_GetElapsedTime", "number", []) as unknown as () => number
    this.fnMatchTime = M.cwrap("JKD_GetMatchTime", "number", []) as unknown as () => number
    this.fnFurthest = M.cwrap("JKD_GetFurthestTime", "number", []) as unknown as () => number
    this.fnEstimate = M.cwrap("JKD_GetEstimatedDuration", "number", []) as unknown as () => number
    this.fnSeekTo = M.cwrap("JKD_SeekTo", "number", ["number"]) as unknown as (t: number) => number
    this.fnIsSeeking = M.cwrap("JKD_IsSeeking", "number", []) as unknown as () => number
    this.fnConnected = M.cwrap("JKD_GetConnectedMask", "number", []) as unknown as () => number
    this.fnVisible = M.cwrap("JKD_GetVisibleMask", "number", []) as unknown as () => number
    this.fnPlayerInfo = M.cwrap("JKD_GetPlayerInfo", "string", ["number"]) as unknown as (n: number) => string
    this.fnViewClient = M.cwrap("JKD_GetViewClientNum", "number", []) as unknown as () => number
    this.fnIsFollowing = M.cwrap("JKD_IsFollowing", "number", []) as unknown as () => number
  }

  get isReady() {
    return this.ready
  }

  /**
   * Put the engine to sleep, for when the viewer is no longer on screen.
   *
   * There is no way to unload the wasm module, so a page that navigates away
   * from the player client-side leaves the engine resident: still holding a
   * frame loop, and still playing the demo's sound out loud from a page that
   * no longer shows it. Suspending the audio context is what actually silences
   * it -- SDL's Emscripten backend mixes from a Web Audio callback that runs
   * whether or not the engine's own loop does, so stopping the loop alone
   * leaves the last buffer looping.
   */
  suspend() {
    const M = window.Module
    if (!M) return
    // Frame loop first, since that is the thing still advancing playback --
    // going the other way round leaves it free-running through a few seconds
    // of demo while the canvas is being torn down. Freezing via cl_freezeDemo
    // would be too late either way: console commands only run on a frame.
    M.pauseMainLoop?.()
    void M.SDL2?.audioContext?.suspend()
  }

  /** Wake an engine left sleeping by a previous mount. */
  resume() {
    const M = window.Module
    if (!M) return
    M.resumeMainLoop?.()
    void M.SDL2?.audioContext?.resume()
  }

  /** Run a console command. JKD_Exec terminates it engine-side. */
  private command(cmd: string) {
    if (!this.ready) return
    this.exec(cmd)
  }

  /**
   * Rearrange the game's default keys for watching rather than playing.
   *
   * Space and M are taken away from the engine and given to the page (pause
   * and mute -- see the viewer's own keydown handler), because they are the
   * only controls that still need to work while the pointer is locked for
   * free-fly and there is no cursor to click anything with. Jump moves to the
   * right mouse button, which free-fly look leaves otherwise idle.
   */
  private applyViewerBinds() {
    this.command("bind MOUSE2 +moveup")
    this.command("unbind SPACE")
    this.command("unbind m")
  }

  private setCvar(name: string, value: string | number) {
    this.command(`${name} ${value}`)
  }

  // ---- loading -------------------------------------------------------------

  /**
   * Fetch a demo over HTTP and hand it to the engine.
   *
   * The engine reads from its own in-memory filesystem, so the bytes have to be
   * written there first; it cannot stream from a URL itself.
   */
  async loadDemo(url: string, onProgress?: (fraction: number) => void): Promise<void> {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`Could not fetch demo (${res.status})`)

    const total = Number(res.headers.get("content-length") || 0)
    const reader = res.body?.getReader()
    let bytes: Uint8Array

    if (reader && total > 0) {
      const chunks: Uint8Array[] = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        chunks.push(value)
        received += value.length
        onProgress?.(received / total)
      }
      bytes = new Uint8Array(received)
      let at = 0
      for (const c of chunks) {
        bytes.set(c, at)
        at += c.length
      }
    } else {
      bytes = new Uint8Array(await res.arrayBuffer())
      onProgress?.(1)
    }

    // Keep the original filename on disk: the engine reopens a demo by name to
    // seek backwards, so a name it cannot find again would break seeking.
    const file = decodeURIComponent(url.split("/").pop()?.split("?")[0] || "demo.dm_15")
    try {
      ;(window.Module as unknown as { FS: { mkdir: (p: string) => void } }).FS.mkdir("/base/demos")
    } catch {
      // already there
    }
    window.Module!.FS.writeFile(`/base/demos/${file}`, bytes)

    // The `demo` command appends the extension itself, so it has to be stripped
    // here -- passing the full filename sends it looking for `....dm_15.dm_15`.
    this.demoName = file.replace(/\.dm_\d+$/i, "")
    this.command(`demo "${this.demoName}"`)
  }

  /**
   * Start the current demo again from the top.
   *
   * Costs nothing over the network: the file is still sitting in the engine's
   * in-memory filesystem from the original load.
   */
  replay() {
    if (this.demoName) this.command(`demo "${this.demoName}"`)
  }


  // ---- playback ------------------------------------------------------------

  setPaused(paused: boolean) {
    this.setCvar("cl_freezeDemo", paused ? 1 : 0)
  }

  setSpeed(multiplier: number) {
    this.setCvar("timescale", multiplier)
  }

  /** Elapsed milliseconds from the demo's first frame, or -1 before it starts. */
  getElapsed(): number {
    return this.ready ? this.fnElapsed() : -1
  }

  /**
   * Milliseconds on the match clock, or -1 if the demo hasn't said.
   *
   * Not the same as getElapsed: that is a position in the file, this is the
   * time on the scoreboard. A recording that joins eight minutes into a match
   * is at elapsed 0 and match time 8:00.
   */
  getMatchTime(): number {
    return this.ready ? this.fnMatchTime() : -1
  }

  /**
   * Best available total length in milliseconds.
   *
   * A .dm_15 states no duration anywhere, so this sharpens as the file is read:
   * an estimate from the record count first, then the exact figure once a demo
   * has run to the end. `declared` wins when the caller knows better -- the demo
   * library records real durations at ingest.
   */
  getDuration(declaredMs = 0): number {
    if (!this.ready) return Math.max(declaredMs, 1000)
    return Math.max(declaredMs || this.fnEstimate(), this.fnElapsed(), this.fnFurthest(), 1000)
  }

  get isSeeking(): boolean {
    return this.ready ? this.fnIsSeeking() === 1 : false
  }

  /**
   * Seek to an elapsed position in milliseconds.
   *
   * Only one seek runs at a time. A drag produces dozens of positions, and
   * letting each land on top of an unfinished one makes the picture chase the
   * thumb from behind, so a seek issued while another is running waits for it.
   */
  async seekTo(elapsedMs: number): Promise<void> {
    if (!this.ready) return
    if (this.seeking) {
      await new Promise<void>((resolve) => this.seekWaiters.push(resolve))
    }
    const now = this.fnDemoTime()
    const elapsed = this.fnElapsed()
    if (now < 0 || elapsed < 0) return
    this.seeking = true
    // The engine works in absolute server time; the UI works in elapsed time.
    this.fnSeekTo(Math.round(now - elapsed + elapsedMs))
    await new Promise<void>((resolve) => this.seekWaiters.push(resolve))
  }

  // ---- camera --------------------------------------------------------------

  setCameraMode(mode: CameraMode) {
    switch (mode) {
      case "follow":
        this.setCvar("cg_demoCam", 0)
        this.setCvar("cg_thirdPerson", 0)
        break
      case "free":
        this.setCvar("cg_thirdPerson", 0)
        this.setCvar("cg_demoCam", 1)
        break
    }
  }

  /**
   * -1 watches whoever the demo recorded; otherwise a client number.
   *
   * Watching someone else is always third person. Their own recorded view is
   * available (cg_demoFollowEyes) but is not what you want by default -- a demo
   * reads better from behind the player than from inside their head.
   */
  setFollow(clientNum: number) {
    this.setCvar("cg_demoFollow", clientNum)
    if (clientNum >= 0) this.setCvar("cg_thirdPerson", 1)
  }

  setFov(degrees: number) {
    this.setCvar("cg_fov", degrees)
  }

  /**
   * How far the camera sits behind whoever is being watched.
   *
   * Pulled all the way in it becomes first person, which is what the engine's
   * own zero-range behaviour would look like anyway -- but going through
   * cg_thirdPerson makes it an actual view change rather than a camera clipped
   * inside the player's head.
   */
  setThirdPersonRange(units: number) {
    if (units < FIRST_PERSON_BELOW) {
      this.setCvar("cg_thirdPerson", 0)
      return
    }
    this.setCvar("cg_thirdPersonRange", Math.round(units))
    this.setCvar("cg_thirdPerson", 1)
  }

  /** 0 (silent) to 1. Sound effects only -- music stays permanently off. */
  setVolume(v: number) {
    this.setCvar("s_volume", v)
  }

  /** Mouse-look speed for the free camera. The engine's own default is 5. */
  setSensitivity(v: number) {
    this.setCvar("sensitivity", v)
  }

  /** Averages successive mouse deltas, which browser frame timing needs. */
  setMouseSmoothing(on: boolean) {
    this.setCvar("m_filter", on ? 1 : 0)
  }

  /** The sign of m_pitch is the invert: negative looks up when you push up. */
  setInvertLook(on: boolean) {
    this.setCvar("m_pitch", on ? -0.022 : 0.022)
  }

  getCvarNumber(name: string): number {
    return this.ready ? this.fnGetCvar(name) : 0
  }

  // ---- who's in the demo ---------------------------------------------------

  /**
   * Everyone worth watching, from the engine's own configstrings.
   *
   * Spectators are dropped: in a demobot recording that's the bot itself plus
   * any idle onlookers, none of whom have a view worth offering.
   */
  getPlayers(): DemoPlayerInfo[] {
    if (!this.ready) return []
    const connected = this.fnConnected()
    const visible = this.fnVisible()
    const out: DemoPlayerInfo[] = []
    for (let i = 0; i < 32; i++) {
      if (!(connected & (1 << i))) continue
      const info = this.fnPlayerInfo(i) || ""
      const team = Number(/\\t\\(\d+)/.exec(info)?.[1] ?? -1)
      if (team !== 1 && team !== 2) continue
      out.push({
        clientNum: i,
        name: playerNameFromConfigString(info, i),
        team,
        visible: !!(visible & (1 << i)),
      })
    }
    return out
  }

  getPlayerName(clientNum: number): string {
    if (!this.ready) return `client ${clientNum}`
    return playerNameFromConfigString(this.fnPlayerInfo(clientNum) || "", clientNum)
  }

  /** Whoever the recording client is watching, or -1 if there is no demo yet. */
  getViewClientNum(): number {
    return this.ready ? this.fnViewClient() : -1
  }

  /** True when the recorder was spectating someone rather than playing. */
  isFollowing(): boolean {
    return this.ready ? this.fnIsFollowing() === 1 : false
  }
}

/**
 * Strip colour markup from a name.
 *
 * Stock JK2 has one form, `^1`. The community's clients add three more, and all
 * of them carry a run of hex digits that a naive `^` + one character strip
 * leaves stranded in the middle of the name -- which is how "Prismatic" was
 * appearing as "a00Pa00rism0b2a19ct70cid0bc" and "rezenate" as
 * "a644468arezenate".
 *
 *   ^x + 3 hex   12-bit RGB
 *   ^X + 6 hex   24-bit RGB
 *   ^Y + 8 hex   32-bit RGBA
 *
 * Longest first, and case matters: `^x` and `^X` take different digit counts,
 * so a case-insensitive match would eat the wrong number of characters.
 */
function stripColourCodes(s: string): string {
  return s
    .replace(/\^Y[0-9a-fA-F]{8}/g, "")
    .replace(/\^X[0-9a-fA-F]{6}/g, "")
    .replace(/\^x[0-9a-fA-F]{3}/g, "")
    .replace(/\^./g, "")
}

function playerNameFromConfigString(info: string, clientNum: number): string {
  const raw = /^n\\([^\\]*)/.exec(info)?.[1]
  const name = raw ? stripColourCodes(raw).trim() : ""
  return name || `client ${clientNum}`
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const el = document.createElement("script")
    el.src = src
    el.async = true
    el.onload = () => resolve()
    el.onerror = () => reject(new Error(`Could not load the demo engine from ${src}`))
    document.body.appendChild(el)
  })
}
