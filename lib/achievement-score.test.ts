import { describe, expect, it } from "vitest"
import { RARITY_POINTS, bestRarity, scoreFor, scoreFromViews } from "./achievement-score"
import { ACHIEVEMENTS } from "./achievement-meta"
import { SCORE_LADDER, progressFor } from "./titles"
import type { Rarity } from "./achievement-meta"

/*
 * Achievement Score is the number the /players board sorts on and the score
 * ladder's titles hang off, so the two ways of computing it have to agree: the
 * server ledger sums one entry per rank crossed, and scoreFromViews reconstructs
 * the same total from a profile's current ranks. A drift between them would show
 * as a player's title disagreeing with their own board position.
 */

describe("RARITY_POINTS", () => {
  // The curve is the whole design: fifty commons to match one mythic is what
  // stops the board being farmable. If these move, the ladder thresholds in
  // titles.ts are no longer calibrated against anything.
  it("keeps the steep curve the board is balanced around", () => {
    expect(RARITY_POINTS).toEqual({
      common: 1,
      rare: 3,
      epic: 8,
      legendary: 20,
      mythic: 50,
      oneofone: 150,
    })
  })
})

describe("scoreFor", () => {
  it("sums a mixed handful", () => {
    expect(scoreFor(["common", "rare", "epic"])).toBe(12)
  })

  it("is zero for a player holding nothing", () => {
    expect(scoreFor([])).toBe(0)
  })

  it("weights one mythic above fifty commons' worth of grinding", () => {
    const grind: Rarity[] = Array(49).fill("common")
    expect(scoreFor(grind)).toBeLessThan(scoreFor(["mythic"]))
  })
})

describe("bestRarity", () => {
  it("picks the rarest thing held, not the most recent", () => {
    expect(bestRarity(["common", "legendary", "rare"])).toBe("legendary")
    expect(bestRarity(["oneofone", "mythic"])).toBe("oneofone")
  })

  it("is null when there is nothing to colour by", () => {
    expect(bestRarity([])).toBeNull()
  })
})

describe("scoreFromViews", () => {
  /*
   * The rule that is easy to get backwards: reaching rank N on a tiered family
   * means every rank below it was crossed too, and each one scores. Cap God at
   * rank 3 is common + rare + epic = 12, NOT epic's 8 on its own. This mirrors
   * the ledger, which stores one row per rank crossed -- and it is deliberate,
   * so a deep ladder rewards the climb rather than only the summit.
   */
  it("counts every rank climbed on a tiered family, not just the highest", () => {
    const capGod = ACHIEVEMENTS.find((a) => a.id === "cap-god")!
    const [r1, r2, r3] = capGod.ranks!
    const expected = RARITY_POINTS[r1.rarity] + RARITY_POINTS[r2.rarity] + RARITY_POINTS[r3.rarity]

    expect(scoreFromViews([{ id: "cap-god", rank: 3, rarity: r3.rarity }])).toBe(expected)
    // Explicitly more than the top rank alone would give.
    expect(scoreFromViews([{ id: "cap-god", rank: 3, rarity: r3.rarity }])).toBeGreaterThan(
      RARITY_POINTS[r3.rarity],
    )
  })

  it("scores rank 1 of a family as just that rank", () => {
    const capGod = ACHIEVEMENTS.find((a) => a.id === "cap-god")!
    expect(scoreFromViews([{ id: "cap-god", rank: 1, rarity: capGod.ranks![0].rarity }])).toBe(
      RARITY_POINTS[capGod.ranks![0].rarity],
    )
  })

  it("ignores a locked crest", () => {
    expect(scoreFromViews([{ id: "cap-god", rank: 0, rarity: "common" }])).toBe(0)
  })

  it("scores an untiered crest once, at its own rarity", () => {
    const untiered = ACHIEVEMENTS.find((a) => !a.ranks?.length)!
    expect(scoreFromViews([{ id: untiered.id, rank: 1, rarity: "legendary" }])).toBe(
      RARITY_POINTS.legendary,
    )
  })

  // A view whose id is not in the catalogue (a claimed one-of-one, or a crest
  // retired since the profile was rendered) still has to score something
  // sensible rather than throwing or silently vanishing.
  it("falls back to the view's own rarity for an unknown id", () => {
    expect(scoreFromViews([{ id: "not-a-real-crest", rank: 1, rarity: "oneofone" }])).toBe(150)
  })

  it("adds up across several families", () => {
    const capGod = ACHIEVEMENTS.find((a) => a.id === "cap-god")!
    const bomb = ACHIEVEMENTS.find((a) => a.id === "bomb")!
    const expected =
      RARITY_POINTS[capGod.ranks![0].rarity] +
      RARITY_POINTS[capGod.ranks![1].rarity] +
      RARITY_POINTS[bomb.ranks![0].rarity]
    expect(
      scoreFromViews([
        { id: "cap-god", rank: 2, rarity: capGod.ranks![1].rarity },
        { id: "bomb", rank: 1, rarity: bomb.ranks![0].rarity },
      ]),
    ).toBe(expected)
  })
})

describe("the score ladder", () => {
  const titlesAt = (score: number) => progressFor(SCORE_LADDER, score).earned.map((t) => t.title)

  it("opens each tier exactly on its threshold", () => {
    expect(titlesAt(74)).toEqual([])
    expect(titlesAt(75)).toEqual(["Decorated"])
    expect(titlesAt(149)).toEqual(["Decorated"])
    expect(titlesAt(150)).toEqual(["Decorated", "Distinguished"])
    expect(titlesAt(300)).toEqual(["Decorated", "Distinguished", "Illustrious"])
    expect(titlesAt(550)).toEqual(["Decorated", "Distinguished", "Illustrious", "JK2 God"])
  })

  /*
   * The GOAT sits above JK2 God at 1337 and is hidden until crossed -- it must
   * not leak into the progress bar or the "N to go" label for anyone below it,
   * which is the whole point of the flag.
   */
  it("keeps the GOAT out of sight until someone actually clears it", () => {
    expect(titlesAt(550)).not.toContain("The GOAT")
    expect(titlesAt(1337)).toContain("The GOAT")
  })

  it("earns titles cumulatively, never swapping one for the next", () => {
    expect(titlesAt(600)).toContain("Decorated")
    expect(titlesAt(600)).toContain("JK2 God")
  })
})
