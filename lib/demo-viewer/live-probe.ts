/**
 * Where the live-spectate stutter actually happens.
 *
 * The bridge already answered its half of this question. Instrumented during a
 * 17-player game, snapshots arrived from the game server at a metronomic 10.0ms
 * (p95 11.2, p99 12.4) and left for the browser with no variance added at all.
 * Server, route, Nagle and the relay are therefore all exonerated by
 * measurement, which leaves everything past Caddy -- and that is not one thing
 * but two, with entirely different fixes:
 *
 *   1. The browser may not DELIVER the messages evenly. They cross a network
 *      stack, an IO thread and a main-thread task queue on the way in; a main
 *      thread busy rendering lets them pile up and then hands over three at
 *      once.
 *   2. The engine may not RENDER evenly, however evenly they arrive.
 *
 * **Mean inter-arrival time cannot tell those apart** -- bursty delivery still
 * averages 10ms, which is exactly why the bridge's own even-looking numbers
 * settled less than they appeared to. Two measurements here can:
 *
 * - **The median.** Evenly spaced arrivals put p50 near 10ms. Bursts put most
 *   gaps near zero and move the waiting into the tail, so p50 collapses while
 *   the mean stays put. A p50 far below the mean is the signature of batching.
 * - **Packets per frame**, which is the sharpest signal of the two. An engine
 *   fed 1,1,1,1 is being served smoothly. One fed 0,0,3,0 is starved and then
 *   flooded, and that is precisely what stutter looks like from the inside --
 *   frames with nothing new to show, followed by a frame that jumps.
 *
 * Deliberately measurement only: it changes no engine behaviour and ships
 * inert unless switched on. The lesson this exists to enforce is the one the
 * jitter chase kept teaching -- measure, do not port more cvars.
 */

/** Summary of a set of intervals, in milliseconds. */
export interface ProbeStats {
  n: number
  mean: number
  p50: number
  p95: number
  p99: number
  max: number
}

/** How well fed the renderer is: packets delivered per rendered frame. */
export interface PerFrameStats {
  mean: number
  max: number
  /** Percentage of frames that saw no new packet at all. */
  starvedPct: number
}

export interface LiveProbeReport {
  arrivals: ProbeStats | null
  frames: ProbeStats | null
  perFrame: PerFrameStats | null
  /**
   * Intervals discarded as not-jitter (see `MAX_PLAUSIBLE_INTERVAL_MS`). A
   * non-zero count here is context for the rest of the report, not a fault:
   * it usually means the tab was backgrounded.
   */
  gaps: number
  /**
   * Whether the window has rolled past the connect.
   *
   * **This is not a nicety -- reading the probe early gives a confidently
   * wrong answer.** Measured on the first real run: while the engine is still
   * connecting and loading the map, its main thread blocks for long stretches,
   * so messages queue in the browser and are handed over in huge batches the
   * moment it yields. That produces p50=0.4ms against a 9.8ms mean, bursts of
   * 34 packets, and 67% of frames starved -- textbook "the browser is
   * delivering in bursts", and entirely an artefact of loading. The same
   * connection measured over a clean window read p50=10.0ms and 0.8% starved.
   *
   * The ring buffer scrubs itself once it laps (~20s of a 100Hz stream), so
   * the only real hazard is reporting a partly-filled one. Callers should
   * treat an unsettled report as "still collecting", not as data.
   */
  settled: boolean
  /** Samples collected so far, against the window this needs to be trusted. */
  progress: { have: number; want: number }
}

/**
 * Above this, an interval is not stutter -- it is a backgrounded tab (where
 * `requestAnimationFrame` stops entirely) or a dropped connection. Including
 * those would put a 30-second outlier in `max` and drag the mean somewhere
 * meaningless, hiding the millisecond-scale effect actually being hunted.
 * Counted separately rather than silently dropped, so the report cannot
 * quietly describe a fraction of the session as if it were all of it.
 */
const MAX_PLAUSIBLE_INTERVAL_MS = 2000

/**
 * ~20 seconds of a 100Hz stream. Enough that p99 means something (200 samples
 * behind it) while staying a *recent* window -- a report averaged over the
 * whole session would blunt exactly the transient it is looking for.
 */
const CAPACITY = 2048

/**
 * Fixed-size ring of samples.
 *
 * A plain array with `shift()` would be O(n) per sample, and at 100 samples a
 * second against a 2048-long buffer that is 200k element moves a second spent
 * measuring smoothness -- which would itself cost frames and corrupt the
 * measurement.
 */
class Ring {
  private buf: Float64Array
  private i = 0
  private full = false

  constructor(capacity: number) {
    this.buf = new Float64Array(capacity)
  }

  push(v: number) {
    this.buf[this.i] = v
    this.i = (this.i + 1) % this.buf.length
    if (this.i === 0) this.full = true
  }

  values(): number[] {
    return Array.from(this.full ? this.buf : this.buf.subarray(0, this.i))
  }

  clear() {
    this.i = 0
    this.full = false
  }
}

/**
 * Percentiles by nearest-rank, matching the bridge's own reporter
 * (`xs[int(len(xs) * 0.95)]` in ws-udp-bridge.py) so the two sets of numbers
 * can be read side by side. Interpolating here would make the browser's p99
 * subtly incomparable with the bridge's for no gain at these sample counts.
 */
export function summarise(xs: number[]): ProbeStats | null {
  if (xs.length === 0) return null
  const sorted = [...xs].sort((a, b) => a - b)
  const at = (q: number) => sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]
  let total = 0
  for (const x of sorted) total += x
  return {
    n: sorted.length,
    mean: total / sorted.length,
    p50: at(0.5),
    p95: at(0.95),
    p99: at(0.99),
    max: sorted[sorted.length - 1],
  }
}

export function summarisePerFrame(counts: number[]): PerFrameStats | null {
  if (counts.length === 0) return null
  let total = 0
  let max = 0
  let starved = 0
  for (const c of counts) {
    total += c
    if (c > max) max = c
    if (c === 0) starved++
  }
  return {
    mean: total / counts.length,
    max,
    starvedPct: (starved / counts.length) * 100,
  }
}

class LiveProbe {
  private running = false
  private arrivals = new Ring(CAPACITY)
  private frames = new Ring(CAPACITY)
  private perFrame = new Ring(CAPACITY)
  private lastArrival: number | null = null
  private lastFrame: number | null = null
  private sinceFrame = 0
  private gaps = 0
  private rafId = 0

  get isRunning() {
    return this.running
  }

  start() {
    if (this.running || typeof window === "undefined") return
    this.running = true
    this.reset()
    this.rafId = requestAnimationFrame(this.tick)
  }

  stop() {
    if (!this.running) return
    this.running = false
    cancelAnimationFrame(this.rafId)
    // Both "last" marks are dropped so a later restart does not measure the
    // interval across the pause as though it were one frame.
    this.lastArrival = null
    this.lastFrame = null
  }

  reset() {
    this.arrivals.clear()
    this.frames.clear()
    this.perFrame.clear()
    this.lastArrival = null
    this.lastFrame = null
    this.sinceFrame = 0
    this.gaps = 0
  }

  /**
   * Called for every live WebSocket message.
   *
   * The listener behind this is registered unconditionally on the live socket
   * and this early-returns when idle, rather than the listener being attached
   * and detached as the probe is toggled: the probe can be switched on
   * mid-session, and a boolean check per message is far cheaper than the
   * bookkeeping to rewire listeners on a socket the engine re-dials by itself.
   */
  noteArrival() {
    if (!this.running) return
    const now = performance.now()
    if (this.lastArrival !== null) {
      const dt = now - this.lastArrival
      if (dt <= MAX_PLAUSIBLE_INTERVAL_MS) this.arrivals.push(dt)
      else this.gaps++
    }
    this.lastArrival = now
    this.sinceFrame++
  }

  private tick = (now: number) => {
    if (!this.running) return
    if (this.lastFrame !== null) {
      const dt = now - this.lastFrame
      if (dt <= MAX_PLAUSIBLE_INTERVAL_MS) {
        this.frames.push(dt)
        // Paired with the frame interval deliberately: a count recorded for a
        // frame whose interval was discarded would attribute a backgrounded
        // tab's whole backlog to one frame and read as an enormous burst.
        this.perFrame.push(this.sinceFrame)
      } else {
        this.gaps++
      }
    }
    this.lastFrame = now
    this.sinceFrame = 0
    this.rafId = requestAnimationFrame(this.tick)
  }

  report(): LiveProbeReport {
    const arrivalSamples = this.arrivals.values()
    return {
      arrivals: summarise(arrivalSamples),
      frames: summarise(this.frames.values()),
      perFrame: summarisePerFrame(this.perFrame.values()),
      gaps: this.gaps,
      settled: arrivalSamples.length >= CAPACITY,
      progress: { have: arrivalSamples.length, want: CAPACITY },
    }
  }
}

/**
 * One probe for the page, matching the engine it measures -- `JkdEngine` is
 * itself a page-scoped singleton, and a per-component probe would start over
 * every time the viewer re-rendered.
 */
export const liveProbe = new LiveProbe()

/** A one-line rendering of a stats block, for the readout and for pasting. */
export function formatStats(label: string, s: ProbeStats | null): string {
  if (!s) return `${label}: (no samples yet)`
  return (
    `${label}: n=${s.n} mean=${s.mean.toFixed(1)}ms p50=${s.p50.toFixed(1)} ` +
    `p95=${s.p95.toFixed(1)} p99=${s.p99.toFixed(1)} max=${s.max.toFixed(1)}`
  )
}

export function formatReport(r: LiveProbeReport): string {
  if (!r.settled) {
    return (
      `settling ${r.progress.have}/${r.progress.want} -- these numbers still ` +
      `include connecting and map load, which look exactly like bursty delivery`
    )
  }
  const lines = [
    formatStats("arrivals", r.arrivals),
    formatStats("frames  ", r.frames),
    r.perFrame
      ? `per-frame: mean=${r.perFrame.mean.toFixed(2)} max=${r.perFrame.max} ` +
        `starved=${r.perFrame.starvedPct.toFixed(1)}%`
      : "per-frame: (no samples yet)",
  ]
  if (r.gaps > 0) lines.push(`gaps discarded: ${r.gaps}`)
  return lines.join("\n")
}
