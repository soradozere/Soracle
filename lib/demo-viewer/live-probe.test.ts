import { describe, expect, it } from "vitest"
import { summarise, summarisePerFrame } from "./live-probe"

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
