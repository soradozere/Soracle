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

export type CameraMode = "follow" | "chase" | "free"

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
 * A running demo engine.
 *
 * One per page: the engine is a singleton inside the wasm module, and loading
 * its script twice would fight over `window.Module`.
 */
export class JkdEngine {
  private opts: JkdEngineOptions
  private exec!: (cmd: string) => void
  private ready = false

  private fnGetCvar!: (name: string) => number
  private fnDemoTime!: () => number
  private fnElapsed!: () => number
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

    if (window.Module) {
      throw new Error("A demo engine is already running on this page")
    }

    // The engine sizes its framebuffer to the canvas, but it finds the canvas by
    // a hard-coded `#canvas` selector rather than through Module.canvas. Without
    // the id that lookup fails, it falls back to 640x480, and the picture ends
    // up rendering into one corner of the element.
    if (canvas.id !== "canvas") canvas.id = "canvas"

    window.Module = {
      canvas,
      setStatus: (text: string) => onStatus?.(text),
      // Its .wasm and .data sit next to its .js, which is not this origin.
      locateFile: (path: string) => `${baseUrl}/${path}`,
      // The engine is chatty, but swallowing its output means a failure to open
      // a demo or a map looks identical to nothing happening at all.
      print: (text: string) => console.log("[jk2]", text),
      printErr: (text: string) => console.warn("[jk2]", text),
    } as unknown as EmscriptenModule

    const readyPromise = new Promise<void>((resolve) => {
      window.JKD_ready = () => {
        this.bind()
        this.ready = true
        this.opts.onReady?.()
        resolve()
      }
    })

    window.JKD_onKill = (target, attacker, mod, viewed) => {
      this.opts.onKill?.({ target, attacker, mod, viewed })
    }
    window.JKD_onCenterPrint = (text: string) => {
      const clean = (text || "").replace(/\^./g, "").replace(/\s+/g, " ").trim()
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

    await loadScript(`${baseUrl}/jk2mv_wasm.js`)
    await readyPromise
  }

  private bind() {
    const M = window.Module!
    this.exec = M.cwrap("JKD_Exec", null, ["string"]) as unknown as (c: string) => void
    this.fnGetCvar = M.cwrap("JKD_GetCvar", "number", ["string"]) as unknown as (n: string) => number
    this.fnDemoTime = M.cwrap("JKD_GetDemoTime", "number", []) as unknown as () => number
    this.fnElapsed = M.cwrap("JKD_GetElapsedTime", "number", []) as unknown as () => number
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

  /** Run a console command. JKD_Exec terminates it engine-side. */
  private command(cmd: string) {
    if (!this.ready) return
    this.exec(cmd)
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
    this.command(`demo "${file.replace(/\.dm_\d+$/i, "")}"`)
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
      case "chase":
        this.setCvar("cg_demoCam", 0)
        this.setCvar("cg_thirdPerson", 1)
        break
      case "free":
        this.setCvar("cg_thirdPerson", 0)
        this.setCvar("cg_demoCam", 1)
        break
    }
  }

  /** -1 watches whoever the demo recorded; otherwise a client number. */
  setFollow(clientNum: number) {
    this.setCvar("cg_demoFollow", clientNum)
  }

  setFov(degrees: number) {
    this.setCvar("cg_fov", degrees)
  }

  setChaseRange(units: number) {
    this.setCvar("cg_thirdPersonRange", units)
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

/** Strip JK2's `^1`-style colour codes; they are markup, not part of the name. */
function playerNameFromConfigString(info: string, clientNum: number): string {
  const raw = /^n\\([^\\]*)/.exec(info)?.[1]
  return raw ? raw.replace(/\^./g, "") : `client ${clientNum}`
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
