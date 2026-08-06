/**
 * Live numbers out of a running engine, for hardware we cannot get at.
 *
 * The viewer refuses to start on touch devices, so nothing is known about how
 * it behaves there beyond "it does not come up on iOS" -- which is a report,
 * not a measurement. Everything here exists to turn a phone test into figures
 * somebody can act on: how much heap the engine actually took, what the ceiling
 * on that device is, what GL it got, and whether the context survived.
 *
 * Page-side in its entirety, deliberately. The engine and the page deploy
 * separately (see engine-version.mjs), and a diagnostic that needed an engine
 * rebuild to answer "does this engine boot" would be no use for the one
 * question being asked.
 */

/** Wasm counts memory in 64KiB pages; everything user-facing is in MB. */
const PAGE_BYTES = 65536
const MB = 1048576

const pagesToMb = (pages: number) => Math.round((pages * PAGE_BYTES) / MB)
export const bytesToMb = (bytes: number) => Math.round(bytes / MB)

// ---- wasm heap ------------------------------------------------------------

/**
 * The engine's memory, caught on its way past.
 *
 * It cannot be read off the module afterwards. `wasmMemory` and the HEAP views
 * are locals inside the generated glue, and EXPORTED_RUNTIME_METHODS is only
 * ['FS','run','callMain','ccall','cwrap'] -- none of which reach the heap. The
 * memory *is* a wasm export, but the release build minifies export names
 * (it is currently `Ie`), so reading it by name would work until the next
 * rebuild renamed it and then silently report nothing.
 *
 * So it is taken from the instance itself, by type rather than by name: of
 * everything a wasm module exports, exactly one thing is a WebAssembly.Memory.
 * That survives minification, and survives the engine being rebuilt.
 */
let capturedMemory: WebAssembly.Memory | null = null

/**
 * The high-water mark, kept because the current figure hides the interesting
 * part. ALLOW_MEMORY_GROWTH is on, so the heap climbs during play and never
 * comes back down; a reading taken after a crash-and-recover would understate
 * what the device was actually asked for at the worst moment.
 */
let peakHeapBytes = 0

/** Bytes the wasm binary asked for up front, once anything has told us. */
let declaredMemory: { initialMb: number; maximumMb: number | null } | null = null

export function getHeapBytes(): number | null {
  if (!capturedMemory) return null
  // Growth detaches the old buffer and installs a new one, so this is read
  // fresh every time rather than cached.
  const bytes = capturedMemory.buffer.byteLength
  if (bytes > peakHeapBytes) peakHeapBytes = bytes
  return bytes
}

export function getPeakHeapBytes(): number | null {
  if (!capturedMemory) return null
  getHeapBytes()
  return peakHeapBytes
}

export function getDeclaredMemory() {
  return declaredMemory
}

function rememberMemoryFrom(result: unknown): void {
  // instantiate() resolves to {module, instance} when given bytes, and to a
  // bare Instance when given an already-compiled Module. Both shapes occur.
  const source = result as { instance?: WebAssembly.Instance }
  const instance = (source?.instance ?? result) as WebAssembly.Instance | undefined
  const exports = instance?.exports
  if (!exports) return
  for (const value of Object.values(exports)) {
    if (value instanceof WebAssembly.Memory) {
      capturedMemory = value
      peakHeapBytes = value.buffer.byteLength
      return
    }
  }
}

/**
 * What the wasm binary declares it wants, read out of the binary.
 *
 * Nothing in JS knows this. The memory is defined inside the module rather than
 * imported, so the glue never sees a number -- 134217728 does not appear
 * anywhere in jk2mv_wasm.js -- and once instantiation has failed there is no
 * instance to ask either. The declaration itself is the only source.
 *
 * Section 5 is the memory section and its body is a vector of limits: a flags
 * byte (bit 0 = a maximum follows) then LEB128 page counts. Everything before
 * it has to be walked because sections are length-prefixed but not indexed.
 *
 * Returns null rather than throwing on anything unexpected. This runs on a
 * device that has already failed to boot, and a diagnostic that dies while
 * explaining a death is worse than one that says less.
 */
export function parseDeclaredMemory(bytes: Uint8Array): { initialMb: number; maximumMb: number | null } | null {
  try {
    // Magic + version.
    if (bytes.length < 8 || bytes[0] !== 0x00 || bytes[1] !== 0x61 || bytes[2] !== 0x73 || bytes[3] !== 0x6d) {
      return null
    }
    let at = 8

    const leb = (): number => {
      let result = 0
      let shift = 0
      for (;;) {
        if (at >= bytes.length) throw new Error("truncated")
        const byte = bytes[at++]
        result |= (byte & 0x7f) << shift
        if ((byte & 0x80) === 0) return result >>> 0
        shift += 7
        if (shift > 35) throw new Error("overlong")
      }
    }

    while (at < bytes.length) {
      const id = bytes[at++]
      const size = leb()
      if (id !== 5) {
        at += size
        continue
      }
      const count = leb()
      if (count < 1) return null
      const flags = bytes[at++]
      const initial = leb()
      const maximum = flags & 0x01 ? leb() : null
      return { initialMb: pagesToMb(initial), maximumMb: maximum === null ? null : pagesToMb(maximum) }
    }
    return null
  } catch {
    // A truncated read is the expected failure: when the binary is fetched in
    // a range request the memory section may sit past the end of the window.
    return null
  }
}

/**
 * The largest heap this browser will actually hand over, found by asking.
 *
 * Phase 1 of the mobile work turns on this number, and there is no way to look
 * it up: iOS Safari's wasm budget is not published, varies with device and with
 * what else the tab is holding, and `performance.memory` does not exist there.
 * Allocating is the only honest test.
 *
 * Descending rather than ascending, and the allocations are dropped as it goes,
 * so this costs one surviving allocation rather than a staircase of them.
 */
export function probeMemoryCeilingMb(): number | null {
  const steps = [2048, 1536, 1024, 768, 512, 384, 256, 192, 128, 64, 32]
  for (const mb of steps) {
    try {
      // Held only long enough to know it was granted.
      const probe = new WebAssembly.Memory({ initial: (mb * MB) / PAGE_BYTES })
      if (probe.buffer.byteLength > 0) return mb
    } catch {
      // Too much for this device; try the next size down.
    }
  }
  return null
}

/**
 * Whether declaring a large *maximum* is itself the thing that fails.
 *
 * Worth separating from the ceiling above, because the two have different fixes
 * and look identical from the outside. The build sets ALLOW_MEMORY_GROWTH with
 * no MAXIMUM_MEMORY, which means the binary declares the 2GB default ceiling
 * even though it starts at 128MB. Some WebKit builds reserve against the
 * declared maximum rather than the initial size, so a module that would run
 * happily in 200MB can be refused for a ceiling it was never going to reach.
 *
 * If this reports that a small initial with a 2GB maximum fails while the same
 * initial alone succeeds, then Phase 1 is a one-line MAXIMUM_MEMORY change
 * rather than a hunt for memory to save.
 */
export function probeMaximumDeclaration(initialMb: number, maximumMb: number): boolean {
  try {
    const probe = new WebAssembly.Memory({
      initial: (initialMb * MB) / PAGE_BYTES,
      maximum: (maximumMb * MB) / PAGE_BYTES,
    })
    return probe.buffer.byteLength > 0
  } catch {
    return false
  }
}

/**
 * Watch the engine instantiate, and keep what it produced.
 *
 * A wrapper round the globals rather than Module.instantiateWasm, which is the
 * documented hook and was the first attempt. instantiateWasm hands the whole
 * job over: the page would own fetching the binary, choosing streaming or not,
 * and the fallback when the server sends the wrong MIME type -- perhaps thirty
 * lines of glue logic, reimplemented, in the one code path where a mistake
 * costs every visitor the viewer. This delegates to the original instead and
 * only reads the result, so the boot path keeps behaving exactly as it did.
 *
 * Restored the moment boot finishes either way, so nothing else on the page
 * ever meets the wrapper.
 */
export function installWasmProbe(): () => void {
  const realStreaming = WebAssembly.instantiateStreaming
  const realInstantiate = WebAssembly.instantiate

  // Kept so a failure can report what was asked for. Only the non-streaming
  // path has the bytes to hand; the streaming path re-fetches on failure
  // rather than cloning a 3.3MB Response on a device that is already short of
  // memory, which is what the clone would cost exactly when it hurts.
  let seenBytes: Uint8Array | null = null

  if (realStreaming) {
    WebAssembly.instantiateStreaming = function (source, imports) {
      return realStreaming.call(WebAssembly, source, imports).then(
        (result) => {
          rememberMemoryFrom(result)
          return result
        },
        (err: unknown) => {
          // Not a boot failure on its own: the glue falls back to the
          // non-streaming path when this rejects, and that attempt may well
          // succeed. Recorded, not reported.
          lastInstantiateError = err
          throw err
        },
      )
    } as typeof WebAssembly.instantiateStreaming
  }

  WebAssembly.instantiate = function (source: unknown, imports: unknown) {
    if (source instanceof Uint8Array) seenBytes = source
    else if (source instanceof ArrayBuffer) seenBytes = new Uint8Array(source)
    if (seenBytes && !declaredMemory) declaredMemory = parseDeclaredMemory(seenBytes)
    return (realInstantiate as (s: unknown, i: unknown) => Promise<unknown>).call(WebAssembly, source, imports).then(
      (result: unknown) => {
        rememberMemoryFrom(result)
        return result
      },
      (err: unknown) => {
        lastInstantiateError = err
        throw err
      },
    )
  } as typeof WebAssembly.instantiate

  return () => {
    if (realStreaming) WebAssembly.instantiateStreaming = realStreaming
    WebAssembly.instantiate = realInstantiate
  }
}

let lastInstantiateError: unknown = null

/**
 * Turn a dead boot into a sentence with numbers in it.
 *
 * The failure this is written for is an out-of-memory at instantiation, which
 * arrives as a RangeError whose text differs per browser and names no size in
 * any of them. So the size is established here instead: what the binary asked
 * for, and what the device would in fact have given.
 */
export async function describeBootFailure(baseUrl: string): Promise<string> {
  const err = lastInstantiateError
  const raw = err instanceof Error ? err.message : err ? String(err) : ""

  // The streaming path never handed us bytes. One ranged fetch is cheap enough
  // to be worth the answer, and its failure costs only detail.
  if (!declaredMemory) {
    try {
      const res = await fetch(`${baseUrl}/jk2mv_wasm.wasm`, { headers: { Range: "bytes=0-524287" } })
      if (res.ok || res.status === 206) {
        declaredMemory = parseDeclaredMemory(new Uint8Array(await res.arrayBuffer()))
      }
    } catch {
      // Offline, blocked, or no range support. The probe below still answers.
    }
  }

  const ceiling = probeMemoryCeilingMb()
  const parts: string[] = []

  if (declaredMemory) {
    const max = declaredMemory.maximumMb === null ? "no stated ceiling" : `${declaredMemory.maximumMb} MB ceiling`
    parts.push(`The engine asked for ${declaredMemory.initialMb} MB up front (${max}).`)
    if (declaredMemory.maximumMb !== null) {
      const initialAlone = probeMaximumDeclaration(declaredMemory.initialMb, declaredMemory.initialMb)
      const withCeiling = probeMaximumDeclaration(declaredMemory.initialMb, declaredMemory.maximumMb)
      if (initialAlone && !withCeiling) {
        parts.push(
          `That much memory is available, but declaring the ${declaredMemory.maximumMb} MB ceiling is refused — ` +
            `the ceiling is the problem, not the size.`,
        )
      }
    }
  }
  parts.push(
    ceiling === null
      ? "This browser refused every heap size down to 32 MB."
      : `The most this browser would grant is about ${ceiling} MB.`,
  )
  if (raw) parts.push(`Reported as: ${raw}`)

  return parts.join(" ")
}

/** True when the engine died in a way this module recognises. */
export function sawInstantiateFailure(): boolean {
  return lastInstantiateError !== null && capturedMemory === null
}

// ---- frame rate -----------------------------------------------------------

/**
 * Frames per second, as a rolling average.
 *
 * Measured off requestAnimationFrame rather than from anything the engine
 * reports, which is fair here: the engine runs on emscripten_set_main_loop, and
 * its scheduler is rAF, so its frames and these ticks are the same queue. The
 * one thing this cannot see is the engine skipping work inside a tick it was
 * still given -- so read it as "how often the page is being painted", which on
 * a device dropping frames is the number that matters anyway.
 */
export function startFpsMeter(onSample: (fps: number) => void): () => void {
  const WINDOW = 30
  const intervals: number[] = []
  let last = performance.now()
  let frame = 0

  const tick = (now: number) => {
    const delta = now - last
    last = now
    // A tab returning from the background delivers one enormous interval that
    // would drag the average down for a full second of real playback.
    if (delta > 0 && delta < 1000) {
      intervals.push(delta)
      if (intervals.length > WINDOW) intervals.shift()
    }
    // Reporting every frame would re-render the overlay at frame rate, which
    // is itself a measurable cost on a phone.
    if (++frame % 10 === 0 && intervals.length) {
      const mean = intervals.reduce((a, b) => a + b, 0) / intervals.length
      onSample(Math.round(1000 / mean))
    }
    handle = requestAnimationFrame(tick)
  }

  let handle = requestAnimationFrame(tick)
  return () => cancelAnimationFrame(handle)
}

// ---- GL -------------------------------------------------------------------

export interface WebglInfo {
  version: string
  vendor: string
  renderer: string
  maxTextureSize: number
}

/**
 * What the engine is actually drawing with.
 *
 * getContext returns the context the canvas already has rather than making a
 * second one, and returns null when asked for a type that does not match -- so
 * asking in order is a safe way to find out which the engine took, without
 * disturbing it.
 */
export function readWebglInfo(canvas: HTMLCanvasElement): WebglInfo | null {
  const gl =
    (canvas.getContext("webgl2") as WebGL2RenderingContext | null) ??
    (canvas.getContext("webgl") as WebGLRenderingContext | null) ??
    (canvas.getContext("experimental-webgl") as WebGLRenderingContext | null)
  if (!gl) return null

  // Both vendor and renderer are masked to generic strings by default on most
  // browsers now. The unmasked pair is what identifies the GPU, and is what a
  // rendering artefact has to be attributed to, so it is worth asking for --
  // but it is a privacy-restricted extension and is often simply absent.
  const debug = gl.getExtension("WEBGL_debug_renderer_info")
  const ask = (unmasked: number | undefined, plain: number): string => {
    const value = unmasked === undefined ? null : (gl.getParameter(unmasked) as string | null)
    return value || (gl.getParameter(plain) as string) || "unknown"
  }

  return {
    version: (gl.getParameter(gl.VERSION) as string) || "unknown",
    vendor: ask(debug?.UNMASKED_VENDOR_WEBGL, gl.VENDOR),
    renderer: ask(debug?.UNMASKED_RENDERER_WEBGL, gl.RENDERER),
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
  }
}

// ---- context loss ---------------------------------------------------------

export interface DiagEvent {
  at: number
  text: string
}

const events: DiagEvent[] = []
const listeners = new Set<(events: DiagEvent[]) => void>()

export function logDiagEvent(text: string): void {
  events.push({ at: Date.now(), text })
  // A device that loses its context repeatedly would otherwise grow this
  // without limit, and only the recent ones say anything.
  if (events.length > 20) events.shift()
  const snapshot = [...events]
  listeners.forEach((fn) => fn(snapshot))
}

export function subscribeDiagEvents(fn: (events: DiagEvent[]) => void): () => void {
  listeners.add(fn)
  fn([...events])
  return () => {
    listeners.delete(fn)
  }
}

/**
 * Watch the canvas for the two events that mean the GPU took its context back.
 *
 * Phase 4 handles these properly. Here they are only recorded, because "did the
 * context survive two minutes of playback" is one of the questions the device
 * test has to answer, and a lost context otherwise presents as the picture
 * simply stopping with nothing said.
 */
export function watchContextLoss(canvas: HTMLCanvasElement): () => void {
  const onLost = () => logDiagEvent("webglcontextlost")
  const onRestored = () => logDiagEvent("webglcontextrestored")
  canvas.addEventListener("webglcontextlost", onLost)
  canvas.addEventListener("webglcontextrestored", onRestored)
  return () => {
    canvas.removeEventListener("webglcontextlost", onLost)
    canvas.removeEventListener("webglcontextrestored", onRestored)
  }
}

// ---- the flag -------------------------------------------------------------

/**
 * Diagnostics are opt-in per visit, via `?diag=1`.
 *
 * The same flag also lets the engine start on a touch device, which it
 * otherwise refuses to do. That pairing is deliberate rather than convenient:
 * the overlay exists to make a phone test informative, and on a phone there is
 * nothing to overlay unless the engine is allowed to boot in the first place.
 */
export function diagRequested(search: string): boolean {
  try {
    return new URLSearchParams(search).get("diag") === "1"
  } catch {
    return false
  }
}
