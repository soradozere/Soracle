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

import { describeBootFailure, installWasmProbe, noteEngineLine, sawInstantiateFailure } from "./diagnostics"

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

/**
 * The generation of the demo cut this page is willing to use.
 *
 * 1 was the original: one standalone frame at the in-point, which silently
 * produced unplayable files from any demo whose frames delta more than one
 * message back. 2 writes enough standalone frames to cover the delta window.
 * Raise this in step with JKD_TrimRevision whenever a cut written by an older
 * engine would be wrong rather than merely worse.
 */
const TRIM_REVISION = 2

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
  /**
   * One line of the kill feed: an obituary, or who took, returned or capped the
   * flag. Colour codes already stripped. Chat never arrives here -- the engine
   * feeds this from the obituary and CTF printers, not from the console.
   */
  onFeed?: (text: string) => void
  onPlaybackEnded?: (realDurationMs: number) => void
}

/** Shape of the Emscripten module object, narrowed to what we actually touch. */
interface EmscriptenModule {
  canvas: HTMLCanvasElement
  setStatus: (text: string) => void
  cwrap: (name: string, ret: string | null, args: string[]) => (...a: unknown[]) => never
  FS: {
    writeFile: (path: string, data: Uint8Array) => void
    readFile: (path: string) => Uint8Array
    readdir: (path: string) => string[]
    unlink: (path: string) => void
    mkdir: (path: string) => void
  }
  /** The packager's own directory helper, idempotent and available in preRun. */
  FS_createPath?: (parent: string, path: string, canRead: boolean, canWrite: boolean) => void
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
    JKD_onFeed?: (text: string) => void
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

/*
 * Community pk3s, written into the engine's filesystem at boot.
 *
 * The same seven the renderer stages, so a demo looks here as it does in a
 * published video -- which matters most for the player models. A demo records
 * each player's model as a configstring, and when the model is missing the
 * engine silently substitutes a default, so those demos have been showing the
 * wrong character. The sky, saber blades, saber sounds and flag art are the
 * other kind: they make playback look like something other than what the
 * players saw, deliberately.
 *
 * Side-loaded rather than built into the bundle. --preload-file maps
 * GameData/base-min to /base, FS is in EXPORTED_RUNTIME_METHODS, and preRun
 * runs after the package is unpacked but before main -- so writing them into
 * /base there lands them before FS_Startup scans for pk3s. That avoids a full
 * emscripten rebuild, a ~110MB re-upload and a change of engine URL for 20MB of
 * content, and lets these move independently of the engine.
 *
 * The cost is real: 20MB on top of an 89MB bundle, once, for every cold
 * visitor. Cached separately from the engine data, whose cache evicts
 * everything but the current version whenever a new engine lands.
 */
const EXTRAS_CACHE = "jkd-extras"
const EXTRAS_VERSION = "20260806"

/*
 * A subset of what the renderer stages, deliberately.
 *
 * z_flag-console-field-scoreboard.pk3 is missing, and has to stay missing until
 * someone works out why. Its flag shader renders correctly in the native render
 * build and makes the flag vanish entirely in here -- not untextured, not
 * mis-coloured, absent. The difference between the two is GL4ES translating to
 * WebGL, and the shader leans on four things that are candidates for it:
 * `deformVertexes wave`, `tcGen environment`, a `glow` stage, and a
 * GL_ZERO/GL_ONE_MINUS_SRC_COLOR first stage. Which one is unknown; narrowing it
 * costs a repack, an upload and a reload per guess, and the flag is a CTF
 * viewer's least losable object.
 *
 * The rest of that pk3 -- HUD art, console overlay, forcefields -- goes with it,
 * since pk3s are all-or-nothing. Renders keep the lot, so the two disagree about
 * the flag until this is chased down.
 *
 * z_basemin_chrome2.pk3 is not community content but a repair. base-min is a
 * trimmed asset set, and it dropped gfx/effects/chrome2.jpg, which the bones
 * shader maps additively (GL_ONE GL_ONE) over the whole model. A missing texture
 * resolves to the default white one, so bones rendered as a grey blob -- in the
 * renderer as much as here, it simply had not come up in a render yet. Nine
 * kilobytes of retail texture, restored under the same version prefix so clients
 * holding the other six fetch only this one. That is what fixed bones: the skin
 * is a skeleton, and it was rendering as a pale blob because the shader mapped a
 * texture that had been trimmed away, additively, over the whole model.
 *
 * zzz_transparent_flags.pk3 is the replacement flag, and doubles as an
 * experiment. It is shaders only -- no textures, no models -- and every image it
 * maps is already in base-min, so it cannot fail the way bones did. Against the
 * stock flag shader it adds exactly three things: `sort seeThrough`, an additive
 * GL_ONE GL_ONE blend (which is what makes it transparent), and `glow`.
 *
 * It settled the earlier mystery halfway. `glow` was one of four suspects for
 * the old flag vanishing, alongside deformVertexes wave, tcGen environment and a
 * GL_ZERO/GL_ONE_MINUS_SRC_COLOR stage; this pack keeps only `glow`, and it
 * renders. So glow is exonerated and the cause is one of the other three --
 * worth knowing if that pack is ever revisited.
 *
 * Both this and the chrome2 fix took a while to show up after deploying, and
 * both looked like failures in the meantime -- close enough that they were very
 * nearly reverted. Between the Vercel deploy and this file's own Cache Storage
 * there is more than one thing holding the old state, so give a pk3 change a
 * few minutes and a hard refresh before concluding it does not work.
 *
 * Viewer only for now. Renders keep the flag from
 * z_flag-console-field-scoreboard.pk3, which works there and which Sam has seen,
 * so the two disagree about flags until this is settled either way.
 */
const EXTRA_PK3S = [
  // One 9KB texture the trimmed bundle dropped -- see the note above.
  "z_basemin_chrome2.pk3",
  "solar_yavinsky2.pk3",
  "eoi_imperialworker_v2_sounds.pk3",
  "x_kestis_sounds.pk3",
  "z_nightmares.pk3",
  "zzz_bones.pk3",
  "zzzTricolor_Sabers_by_Apple.pk3",
  "zzz_transparent_flags.pk3",
]

/**
 * Fetch the extras, and never let them stop the viewer starting.
 *
 * Every failure path returns what it has rather than throwing: a missing pk3
 * costs one wrong player model, while a rejected promise here would cost the
 * whole viewer. Local development has no R2 to fetch from, so returning nothing
 * is the normal case there rather than an error worth reporting.
 */
interface ExtraPk3 {
  name: string
  bytes: Uint8Array
}

async function loadExtraPk3s(baseUrl: string, onStatus?: (s: string) => void): Promise<ExtraPk3[]> {
  let prefix: string
  try {
    prefix = `${new URL(baseUrl, window.location.href).origin}/render-assets/extras/${EXTRAS_VERSION}/`
  } catch {
    return []
  }

  let cache: Cache | null = null
  try {
    cache = await caches.open(EXTRAS_CACHE)
  } catch {
    // Private windows and quota refusals: fetch every time instead.
  }

  onStatus?.("Loading community content…")
  const loaded = await Promise.all(
    EXTRA_PK3S.map(async (name): Promise<ExtraPk3 | null> => {
      const url = prefix + name
      try {
        const hit = await cache?.match(url)
        if (hit) return { name, bytes: new Uint8Array(await hit.arrayBuffer()) }

        const res = await fetch(url)
        if (!res.ok) return null
        const bytes = new Uint8Array(await res.arrayBuffer())
        try {
          await cache?.put(url, new Response(bytes.slice()))
        } catch {
          // Next visit downloads it again; nothing else breaks.
        }
        return { name, bytes }
      } catch {
        return null
      }
    }),
  )

  // Drop anything from an older version. These are versioned URLs so a stale
  // one can never be served, but it would sit in the user's storage forever.
  try {
    if (cache) {
      for (const key of await cache.keys()) {
        if (!key.url.startsWith(prefix)) await cache.delete(key)
      }
    }
  } catch {
    // Eviction is housekeeping, not correctness.
  }

  return loaded.filter((x): x is ExtraPk3 => x !== null)
}

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
  private fnConfigString!: (n: number) => string
  private fnTrimDemo!: ((endMs: number, name: string) => number) | null
  private fnTrimRevision!: (() => number) | null
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
    // Together: the extras are a fifth of the bundle's size and independent of
    // it, so serialising them would add their download to the wait for no
    // reason.
    const [dataBuffer, extras] = await Promise.all([
      loadEngineData(`${baseUrl}/jk2mv_wasm.data`, onStatus),
      loadExtraPk3s(baseUrl, onStatus),
    ])

    /*
     * A boot that dies has to reach the caller, and on its own it does not.
     *
     * Emscripten answers an instantiation failure by calling abort(), which
     * throws inside its own loader. JKD_ready is never reached, so the promise
     * this method awaits stays pending for the life of the page: the viewer
     * shows "Starting the engine…" and a progress bar forever, which is the
     * dead page an out-of-memory phone actually presents. Nothing in the glue
     * rejects anything, so the only route out is onAbort.
     */
    let failBoot: (err: Error) => void = () => {}
    const abortedPromise = new Promise<never>((_, reject) => {
      failBoot = reject
    })

    window.Module = {
      canvas,
      /*
       * Called by the engine on any fatal error, instantiation included.
       *
       * The text it passes is not something to put in front of a visitor --
       * "Aborted(RuntimeError: Aborted(...))" and similar -- so the message is
       * built from what the diagnostics module can establish about the device
       * instead, and only when the failure really was the wasm refusing to
       * instantiate. Anything else keeps the engine's own words, which are at
       * least accurate about what broke.
       */
      onAbort: (what: unknown) => {
        if (!sawInstantiateFailure()) {
          /*
           * The renderer failing to start is now a case worth naming, because
           * touch devices are no longer refused up front and this is what the
           * ones that cannot cope actually hit. Firefox on iOS is the known
           * example: it has WebAssembly, it has WebGL, it passes the pre-boot
           * check, and it still cannot give SDL the context it asks for.
           *
           * There is no page-side test that predicts this -- the same probe
           * that passes on Firefox passes on Safari, where it works -- so the
           * honest place to say so is here, after the fact, rather than by
           * guessing from the user agent beforehand.
           */
          const text = String(what)
          if (/GLimp_Init|OpenGL subsystem|could not load OpenGL/i.test(text)) {
            failBoot(
              new Error(
                "This browser couldn't start the 3D view. It has WebGL, but not in a form the " +
                  "game engine can use. On iPhone and iPad, Safari works where other browsers " +
                  "currently don't — the rest of this page is fine either way.",
              ),
            )
            return
          }
          failBoot(new Error(`The demo engine stopped: ${text}`))
          return
        }
        describeBootFailure(baseUrl)
          .then((detail) => failBoot(new Error(`This device could not start the demo engine. ${detail}`)))
          .catch(() => failBoot(new Error("This device could not start the demo engine.")))
      },
      // Read by Com_Init as if they were command-line arguments, which is the
      // only way to land a cvar before the renderer starts.
      arguments: ["+set", "r_highdpi", this.opts.highDetail === false ? "0" : "1"],
      setStatus: (text: string) => onStatus?.(text),
      // Its .wasm and .data sit next to its .js, which is not this origin.
      locateFile: (path: string) => `${baseUrl}/${path}`,
      // The engine is chatty, but swallowing its output means a failure to open
      // a demo or a map looks identical to nothing happening at all.
      // Tapped as well as logged: the console is unreachable on the phone this
      // has to be diagnosed on, so complaints are also kept for the overlay.
      print: (text: string) => {
        noteEngineLine(text)
        console.log("[jk2]", text)
      },
      printErr: (text: string) => {
        noteEngineLine(text)
        console.warn("[jk2]", text)
      },
      // Only when the pre-fetch worked; otherwise the loader downloads the
      // bundle itself and nothing has changed from the old behaviour.
      ...(dataBuffer ? { getPreloadedPackage: () => dataBuffer } : {}),
      /*
       * Staged in preRun, which runs before the preloaded package is unpacked.
       *
       * Worth being exact, because assuming the opposite is why the first
       * version of this silently staged nothing. The generated loader is:
       *
       *   async function run() { preRun(); if (runDependencies) await ...; }
       *
       * preRun first, dependencies second -- and the file packager registers
       * its own unpack (runWithFS, which is what calls FS_createPath("/","base"))
       * by pushing onto Module.preRun. Ours is pushed before the engine script
       * even loads, so it runs first of all, when /base does not yet exist.
       *
       * So create the directory rather than expecting it. FS_createPath is
       * idempotent and the packager calls it again moments later, and the
       * package writes different filenames, so both sets survive -- and both
       * are in place long before FS_Startup scans for pk3s inside main.
       *
       * Wrapped because a throw here aborts the boot: a failed write should
       * cost the content it carried, not the viewer.
       */
      preRun: [
        () => {
          if (!extras.length) return
          const mod = window.Module
          let staged = 0
          try {
            mod?.FS_createPath?.("/", "base", true, true)
          } catch {
            // Already there, or the packager beat us to it. Either is fine.
          }
          for (const { name, bytes } of extras) {
            try {
              mod?.FS?.writeFile(`/base/${name}`, bytes)
              staged++
            } catch (err) {
              console.warn("[jk2] could not stage", name, err)
            }
          }
          // Said out loud, and counted. The quiet version of this was a
          // per-file console.warn nobody was looking at, so seven failures read
          // exactly like a feature that had never been deployed.
          const msg = `[jk2] staged ${staged}/${extras.length} community pk3s`
          if (staged === extras.length) console.log(msg)
          else console.warn(msg)
        },
      ],
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

    /*
     * In place before the engine script runs, because the instantiation it
     * watches for happens during that script's own boot -- there is no later
     * moment at which the heap can still be caught. Removed as soon as boot
     * settles either way, so nothing else on the page meets the wrapper.
     */
    const removeProbe = installWasmProbe()

    bootPromise = loadScript(`${baseUrl}/jk2mv_wasm.js`)
      .then(() => Promise.race([readyPromise, abortedPromise]))
      .finally(removeProbe)
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
    window.JKD_onFeed = (text: string) => {
      const clean = stripColourCodes(text || "").replace(/\s+/g, " ").trim()
      if (clean) this.opts.onFeed?.(clean)
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
    /*
     * Optional export: the page and the engine ship separately, so a browser
     * can be running today's page against last week's engine. A missing
     * export must degrade to "this feature is unavailable" rather than throw
     * -- an exception here once took the POV picker down with it, because it
     * escaped the polling loop before the players were read.
     */
    try {
      this.fnConfigString = M.cwrap("JKD_GetConfigString", "string", ["number"]) as unknown as (
        n: number,
      ) => string
    } catch {
      this.fnConfigString = () => ""
    }
    /*
     * Same deal, but asking the right question.
     *
     * cwrap does *not* throw on a missing export -- it binds lazily and hands
     * back a function that dies with "func is not a function" the first time
     * anyone calls it. So a try/catch around it, which is what this used to be,
     * never fires and every engine claims it can trim. The export itself is the
     * only honest test.
     */
    const exports = M as unknown as Record<string, unknown>
    const trimExport = exports._JKD_TrimDemo
    this.fnTrimDemo =
      typeof trimExport === "function"
        ? (M.cwrap("JKD_TrimDemo", "number", ["number", "string"]) as unknown as (
            endMs: number,
            name: string,
          ) => number)
        : null
    // Which generation of the cut this engine implements. Absent on every build
    // before the delta-chain fix, which is the point: see canTrim.
    const revisionExport = exports._JKD_TrimRevision
    this.fnTrimRevision =
      typeof revisionExport === "function"
        ? (M.cwrap("JKD_TrimRevision", "number", []) as unknown as () => number)
        : null
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
    /*
     * The arrows are the page's, for placing the chase camera.
     *
     * The game binds them to +left/+right/+forward/+back, which feed usercmd
     * angle deltas into the engine's own orbit around the followed player --
     * a second, invisible set of camera angles the page cannot see or reset.
     * Pressing an arrow therefore moved the camera twice, and Reset only put
     * one of the two back, so the view never quite returned.
     */
    for (const key of ["UPARROW", "DOWNARROW", "LEFTARROW", "RIGHTARROW"]) {
      this.command(`unbind ${key}`)
    }
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

  /**
   * Whether this engine build can trim *correctly*.
   *
   * Exporting JKD_TrimDemo is no longer enough. The first version of the cut
   * wrote a single standalone frame at the in-point, which is only sufficient
   * when every following frame deltas one message back -- true of demos the
   * bot records beside the server, false of anything recorded by a player with
   * real ping, where frames reference ten or more messages back and the ones
   * they want are on the far side of the cut. Those files opened, played about
   * a second, and died; see JKD_TrimRevision in cl_main.cpp.
   *
   * So the question is a revision, not an existence check, and an engine that
   * cannot answer it is by definition the one that got this wrong.
   */
  get canTrim(): boolean {
    return this.ready && !!this.fnTrimDemo && (this.fnTrimRevision?.() ?? 0) >= TRIM_REVISION
  }

  /**
   * Cut the demo down to [startMs, endMs] and hand back the new file's bytes.
   *
   * The seek happens here and the cut happens in the engine, and the split is
   * deliberate. Seeking backwards restarts the demo, which rebuilds cgame --
   * safe between frames, which is why seekTo goes through the engine's own
   * frame-sliced path, and a crash if done underneath a single call from here.
   * Everything after that point is a read loop with the recorder attached, so
   * the engine runs it at seek speed rather than making anyone watch the clip
   * play through.
   *
   * Playback is left sitting at the out-point; the caller decides where the
   * viewer should go next.
   */
  async trimDemo(startMs: number, endMs: number): Promise<Uint8Array> {
    if (!this.ready) throw new Error("Engine not ready.")
    if (!this.fnTrimDemo) throw new Error("This viewer's engine is too old to trim demos.")
    if (!(startMs >= 0) || !(endMs > startMs)) throw new Error("Invalid trim range.")

    const wasPaused = this.fnGetCvar("cl_freezeDemo") === 1

    await this.seekTo(startMs)
    if (this.fnElapsed() < 0) throw new Error("Lost the demo while seeking to the start point.")
    // The engine refuses to cut mid-seek, and seekTo can return with the tail
    // of one still being worked through.
    for (let i = 0; i < 200 && this.isSeeking; i++) await this.sleep(50)

    const name = `jkdtrim${Date.now().toString(36)}`
    const size = this.fnTrimDemo(endMs, name)
    if (size < 0) throw new Error(`The engine could not cut this demo (${size}).`)
    if (size < 32) throw new Error("The cut came out empty.")

    // Back to however the viewer had it -- a trim from a paused demo should
    // not leave it running.
    this.setPaused(wasPaused)

    const path = `/base/demos/${name}.dm_15`
    const FS = window.Module!.FS
    const bytes = FS.readFile(path)
    try {
      FS.unlink(path)
    } catch {
      // best effort -- a leftover temp file in the virtual FS costs nothing real
    }
    return bytes
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
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

  /**
   * Where the chase camera sits around whoever is being watched: `angle` swings
   * it horizontally (0 is directly behind, 180 is head-on), `pitch` raises and
   * lowers it.
   *
   * Both are the engine's own third-person cvars, so they compose with the
   * range control above rather than fighting it. They only mean anything while
   * a chase camera is up -- the free camera flies on its own angles.
   */
  setThirdPersonAngle(degrees: number) {
    this.setCvar("cg_thirdPersonAngle", Math.round(degrees))
  }

  setThirdPersonPitch(degrees: number) {
    this.setCvar("cg_thirdPersonPitchOffset", Math.round(degrees))
  }

  /**
   * Stop the camera spinning on its own.
   *
   * cg_cameraOrbit winds cg_thirdPersonAngle round by a few degrees every
   * cg_cameraOrbitDelay milliseconds. Nothing here asks for that, but the
   * game's own end-of-match handlers do (CG_spWin_f / CG_spLose_f both set it
   * to 2 along with a fixed range) -- so a recording that runs through a win
   * ends up orbiting for the rest of playback, and dragging the viewer's own
   * camera-angle setting along with it. Pinned off, and re-pinned after a seek
   * for the same reason the angles are: it is cheat-flagged.
   */
  stopAutoOrbit() {
    this.setCvar("cg_cameraOrbit", 0)
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

  /**
   * The map this demo is on, as the recording itself states it.
   *
   * Read out of CS_SERVERINFO rather than asked for at upload time -- the
   * demo has always known, and a person typing it in is a person getting it
   * wrong. Empty until the gamestate has arrived.
   */
  getMapName(): string {
    if (!this.ready) return ""
    try {
      const serverInfo = this.fnConfigString(0) || ""
      return /\\mapname\\([^\\]+)/.exec(serverInfo)?.[1]?.trim().toLowerCase() ?? ""
    } catch {
      // An engine older than this page has no such export; the map stays
      // whatever the library already knew.
      return ""
    }
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
  /*
   * Scanned rather than regex-replaced, because a caret is not always a code.
   *
   * "^^" is JK2's escape for a literal caret, and the previous version's
   * catch-all /\^./ ran last and swallowed it along with the character after
   * it -- a real player called "^^x8afkaese" came out as "aese", quietly one
   * letter short everywhere their name appeared on the site.
   *
   * Hex widths are checked longest first and case matters: ^x takes 3 digits,
   * ^X takes 6, ^Y takes 8, so a case-insensitive match eats the wrong number.
   */
  let out = ""
  let i = 0
  while (i < s.length) {
    if (s[i] !== "^" || i + 1 >= s.length) {
      out += s[i++]
      continue
    }
    const next = s[i + 1]
    if (next === "^") {
      out += "^" // an escaped caret is a caret
      i += 2
      continue
    }
    const hex = (mark: string, digits: number) =>
      next === mark && new RegExp(`^[0-9a-fA-F]{${digits}}$`).test(s.substr(i + 2, digits))
    if (hex("Y", 8)) { i += 10; continue }
    if (hex("X", 6)) { i += 8; continue }
    if (hex("x", 3)) { i += 5; continue }
    i += 2 // an ordinary ^n colour code
  }
  return out
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
