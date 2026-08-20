import { describe, expect, it } from "vitest"
import {
  formatReport,
  summarise,
  summariseDepth,
  summarisePerFrame,
  type LiveProbeReport,
} from "./live-probe"

describe("summariseDepth", () => {
  it("returns null rather than NaN for an empty sample", () => {
    expect(summariseDepth([])).toBeNull()
  })

  it("reports a buffer holding steady at the configured nudge", () => {
    const s = summariseDepth(Array.from({ length: 200 }, () => 60))!
    expect(s.mean).toBeCloseTo(60)
    expect(s.min).toBe(60)
    expect(s.emptyPct).toBe(0)
  })

  /**
   * The measurement this exists for. A buffer that spends most of its time
   * healthy but periodically hits zero is a client that has caught up with its
   * own data and is extrapolating -- and the mean alone calls that fine, which
   * is why the low end is summarised instead.
   */
  it("catches a buffer that periodically empties, which the mean hides", () => {
    const xs = [...Array.from({ length: 90 }, () => 60), ...Array.from({ length: 10 }, () => 0)]
    const s = summariseDepth(xs)!
    expect(s.mean).toBeCloseTo(54)
    expect(s.min).toBe(0)
    expect(s.p5).toBe(0)
    expect(s.emptyPct).toBeCloseTo(10)
  })

  it("counts a negative buffer as empty, not as a small one", () => {
    const s = summariseDepth([-5, -1, 60, 60])!
    expect(s.emptyPct).toBe(50)
    expect(s.min).toBe(-5)
  })
})

describe("formatReport", () => {
  const settledish = {
    arrivals: summarise([10, 10, 10]),
    frames: summarise([10, 10, 10]),
    perFrame: summarisePerFrame([1, 1, 1]),
    gaps: 0,
    depth: summariseDepth([60, 60, 60]),
    advance: summariseDepth([10, 10, 10]),
  }

  /**
   * The trap this guards, hit on the probe's first real run: read while the
   * engine is still loading the map, the numbers say "bursty delivery, 67% of
   * frames starved" -- which is a real-looking diagnosis of a problem that
   * isn't there. A partly-filled window must never render as findings.
   */
  it("refuses to present an unsettled window as findings", () => {
    const r: LiveProbeReport = { ...settledish, settled: false, progress: { have: 300, want: 2048 } }
    const out = formatReport(r)
    expect(out).toContain("settling 300/2048")
    expect(out).not.toContain("p50")
  })

  it("presents the stats once settled", () => {
    const r: LiveProbeReport = { ...settledish, settled: true, progress: { have: 2048, want: 2048 } }
    const out = formatReport(r)
    expect(out).toContain("arrivals:")
    expect(out).toContain("p50")
    expect(out).toContain("starved")
  })
})

describe("summarise", () => {
  it("returns null rather than NaN for an empty sample", () => {
    expect(summarise([])).toBeNull()
  })

  it("reports the shape of an evenly paced 100Hz stream", () => {
    const even = Array.from({ length: 1000 }, () => 10)
    const s = summarise(even)!
    expect(s.n).toBe(1000)
    expect(s.mean).toBeCloseTo(10)
    expect(s.p50).toBe(10)
    expect(s.max).toBe(10)
  })

  /**
   * The premise the whole probe rests on, and the reason it records a median
   * at all: batched delivery is indistinguishable from smooth delivery by mean
   * alone. Both streams below average 10ms. Only the median separates them.
   */
  it("separates bursty delivery from smooth delivery, which the mean cannot", () => {
    const smooth = Array.from({ length: 999 }, () => 10)
    // The same packets, delivered three at a time: two near-instant gaps, then
    // one long wait covering all three packets' worth of time.
    const bursty = Array.from({ length: 999 }, (_, i) => (i % 3 === 2 ? 30 : 0))

    const a = summarise(smooth)!
    const b = summarise(bursty)!

    expect(b.mean).toBeCloseTo(a.mean, 5)
    expect(a.p50).toBe(10)
    expect(b.p50).toBe(0)
    expect(b.max).toBe(30)
  })

  it("puts the tail in p95/p99 rather than the middle", () => {
    // 990 good intervals and 10 bad ones: the median should be unmoved and the
    // p99 should find the hitches.
    const xs = [...Array.from({ length: 990 }, () => 10), ...Array.from({ length: 10 }, () => 120)]
    const s = summarise(xs)!
    expect(s.p50).toBe(10)
    expect(s.p99).toBe(120)
    expect(s.max).toBe(120)
  })

  it("does not mutate the caller's array", () => {
    const xs = [30, 10, 20]
    summarise(xs)
    expect(xs).toEqual([30, 10, 20])
  })
})

describe("summarisePerFrame", () => {
  it("returns null rather than NaN for an empty sample", () => {
    expect(summarisePerFrame([])).toBeNull()
  })

  it("reports a well-fed renderer as never starved", () => {
    const s = summarisePerFrame(Array.from({ length: 100 }, () => 1))!
    expect(s.mean).toBeCloseTo(1)
    expect(s.max).toBe(1)
    expect(s.starvedPct).toBe(0)
  })

  /**
   * Starve-then-flood is what stutter looks like from inside the engine:
   * frames with nothing new to show, then a frame that jumps several
   * snapshots at once. Same average feed rate as the smooth case above.
   */
  it("catches a starved-then-flooded renderer at the same mean", () => {
    const s = summarisePerFrame([0, 0, 3, 0, 0, 3, 0, 0, 3])!
    expect(s.mean).toBeCloseTo(1)
    expect(s.max).toBe(3)
    expect(s.starvedPct).toBeCloseTo(66.7, 0)
  })
})
