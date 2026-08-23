import { describe, expect, it } from "vitest"
import { killDeathRatio } from "./kd"

describe("killDeathRatio", () => {
  it("is plain kills/deaths whenever the player died at least once", () => {
    expect(killDeathRatio(20, 2)).toBe(10)
    expect(killDeathRatio(7, 7)).toBe(1)
    expect(killDeathRatio(3, 12)).toBeCloseTo(0.25)
  })

  it("keeps a deathless player in the running rather than dropping them", () => {
    // The Reports tab used to require deaths > 0, so this player vanished from
    // the board entirely no matter how well they did.
    expect(killDeathRatio(28, 0)).toBeGreaterThan(0)
  })

  it("ranks a deathless player against a real ratio on the same scale", () => {
    // The player profile used to score a deathless player at their raw KILL
    // COUNT, so 5/0 read as "5.00 K/D" and lost to a genuine 20/2 — while 30/0
    // would have beaten it. Flooring the divisor at one death keeps both on the
    // same scale: 28 kills without dying outranks 20 kills for 2 deaths.
    expect(killDeathRatio(28, 0)).toBeGreaterThan(killDeathRatio(20, 2))
    expect(killDeathRatio(5, 0)).toBeLessThan(killDeathRatio(20, 2))
  })

  it("never returns Infinity or NaN for a deathless player", () => {
    expect(Number.isFinite(killDeathRatio(40, 0))).toBe(true)
    expect(Number.isFinite(killDeathRatio(0, 0))).toBe(true)
  })
})
