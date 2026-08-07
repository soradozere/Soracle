import { afterEach, describe, expect, it } from "vitest"
import { diagRequested, parseDeclaredMemory, startFpsMeter } from "./diagnostics"

/**
 * Tested here for the same reason demo-link-state is: this is byte handling
 * whose only other check is a phone that has already failed to boot. If the
 * parser is wrong, the failure card reports a confident wrong number and the
 * Phase 1 decision -- how far to cut the memory ceiling -- is made on it.
 *
 * The figures below are the real ones. The current release build declares 2048
 * pages initial and 32768 maximum, read straight out of jk2mv_wasm.wasm; if a
 * rebuild changes them, this test is where the expected values move.
 */

/** LEB128, unsigned -- how wasm writes every integer in a section body. */
function leb(value: number): number[] {
  const out: number[] = []
  let n = value
  do {
    let byte = n & 0x7f
    n >>>= 7
    if (n !== 0) byte |= 0x80
    out.push(byte)
  } while (n !== 0)
  return out
}

function wasmWithMemory(initialPages: number, maximumPages: number | null): Uint8Array {
  const limits =
    maximumPages === null ? [0x00, ...leb(initialPages)] : [0x01, ...leb(initialPages), ...leb(maximumPages)]
  const body = [0x01, ...limits] // one memory
  return new Uint8Array([
    0x00, 0x61, 0x73, 0x6d, // \0asm
    0x01, 0x00, 0x00, 0x00, // version 1
    0x05, body.length, ...body, // section 5: memory
  ])
}

describe("parseDeclaredMemory", () => {
  it("reads what the current release build declares", () => {
    expect(parseDeclaredMemory(wasmWithMemory(2048, 32768))).toEqual({ initialMb: 128, maximumMb: 2048 })
  })

  it("handles a memory with no declared ceiling", () => {
    expect(parseDeclaredMemory(wasmWithMemory(2048, null))).toEqual({ initialMb: 128, maximumMb: null })
  })

  it("walks past earlier sections to find the memory one", () => {
    const real = wasmWithMemory(1024, 4096)
    // A type section (id 1) and a function section (id 3) ahead of it, which is
    // the actual layout -- the memory section in the release build sits about
    // 7.5KB in, behind exactly this kind of preamble.
    const withPreamble = new Uint8Array([
      ...real.slice(0, 8),
      0x01, 0x03, 0xaa, 0xbb, 0xcc, // type section, 3 bytes of filler
      0x03, 0x02, 0xdd, 0xee, // function section, 2 bytes of filler
      ...real.slice(8),
    ])
    expect(parseDeclaredMemory(withPreamble)).toEqual({ initialMb: 64, maximumMb: 256 })
  })

  it("returns null rather than throwing on a truncated binary", () => {
    // The range-request path can cut the file before the memory section, which
    // must cost detail in the message and nothing else.
    const truncated = wasmWithMemory(2048, 32768).slice(0, 10)
    expect(parseDeclaredMemory(truncated)).toBeNull()
  })

  it("returns null on something that is not wasm at all", () => {
    expect(parseDeclaredMemory(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toBeNull()
  })
})

/**
 * The frame meter is driven here rather than in a browser on purpose.
 *
 * requestAnimationFrame does not fire at all in the preview pane -- it reports
 * document.hidden permanently, so a real run measures a flat zero and proves
 * nothing. Driving the callback by hand is the only way to check the averaging
 * before it goes to a phone, where a wrong figure would be indistinguishable
 * from a slow device and would send Phase 1 chasing a frame rate problem that
 * was really a bug in the meter.
 */
describe("startFpsMeter", () => {
  const realRaf = globalThis.requestAnimationFrame
  const realCancel = globalThis.cancelAnimationFrame
  afterEach(() => {
    globalThis.requestAnimationFrame = realRaf
    globalThis.cancelAnimationFrame = realCancel
  })

  /** Runs the meter over a list of frame gaps and returns everything it reported. */
  function run(gapsMs: number[]): number[] {
    // A holder rather than a bare `let`: the only assignment is inside the stub
    // below, which the compiler cannot see from the loop, so it narrows a plain
    // variable to null and calls the callback uncallable.
    const next: { cb: FrameRequestCallback | null } = { cb: null }
    globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
      next.cb = cb
      return 1
    }) as typeof globalThis.requestAnimationFrame
    globalThis.cancelAnimationFrame = (() => {}) as typeof globalThis.cancelAnimationFrame

    const samples: number[] = []
    const stop = startFpsMeter((fps) => samples.push(fps))
    // The meter seeds `last` from performance.now(), so the clock starts there.
    let clock = performance.now()
    for (const gap of gapsMs) {
      clock += gap
      const cb = next.cb
      next.cb = null
      cb?.(clock)
    }
    stop()
    return samples
  }

  it("reports a steady 60fps as 60", () => {
    // Ten frames is one reporting interval; the first gap seeds the clock.
    expect(run(Array(11).fill(1000 / 60)).at(-1)).toBe(60)
  })

  it("reports a steady 30fps as 30", () => {
    expect(run(Array(11).fill(1000 / 30)).at(-1)).toBe(30)
  })

  it("reports at most once every ten frames, not every frame", () => {
    expect(run(Array(21).fill(1000 / 60)).length).toBe(2)
  })

  it("ignores the huge gap a backgrounded tab produces", () => {
    // Nine ordinary 60fps frames, one four-second stall, then ten more. Left in
    // the average that stall would read as about 6fps for the next thirty
    // frames -- a device that paused would look like a device that cannot cope.
    const gaps = [...Array(9).fill(1000 / 60), 4000, ...Array(11).fill(1000 / 60)]
    expect(run(gaps).at(-1)).toBe(60)
  })
})

describe("diagRequested", () => {
  it("is on only for an explicit diag=1", () => {
    expect(diagRequested("?diag=1")).toBe(true)
    expect(diagRequested("?t=204&diag=1&cam=free")).toBe(true)
  })

  it("stays off for anything else", () => {
    // Notably diag=0 and a bare diag: this flag both shows the overlay and
    // lets a phone spend 141MB, so it opts in on exactly one spelling.
    expect(diagRequested("")).toBe(false)
    expect(diagRequested("?diag=0")).toBe(false)
    expect(diagRequested("?diag")).toBe(false)
    expect(diagRequested("?t=204")).toBe(false)
  })
})
