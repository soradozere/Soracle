import { describe, expect, it } from "vitest"
import { resolveCompletionistHolder } from "./achievements"
import { ACHIEVEMENTS, SECRET_ACHIEVEMENTS, SECRET_RARITY, findAchievementDef } from "./achievement-meta"
import type { AchMatch, AchStat } from "./achievement-meta"

/*
 * All Too Easy — the completionist secret, resolved by resolveCompletionistHolder
 * in lib/achievements.ts.
 *
 * Unlike capperMonths or the match-resolved claim() crests, this resolver reads
 * the real, current ACHIEVEMENTS catalogue directly (same as resolveScoreSecretHolders
 * does for The GOAT) rather than taking it as a parameter — so a test can't swap
 * in a small fake catalogue to deterministically drive a player to "complete
 * everything" without either reimplementing dozens of real metrics or mocking a
 * module this codebase has no precedent for mocking. What's testable without
 * that is the resolver's own catalogue-agnostic behaviour: empty input, and a
 * player who has touched little or nothing never reading as complete. The
 * "someone actually finishes" path is the same gap resolveScoreSecretHolders
 * already has zero coverage for.
 */

const stat = (over: Partial<AchStat> = {}): AchStat => ({
  score: 0,
  captures: 0,
  returns: 0,
  base_cleaner: 0,
  assists: 0,
  kills: 0,
  deaths: 0,
  flag_hold_ms: 0,
  flag_grabs: 0,
  dbs_returns: 0,
  red_returns: 0,
  yellow_returns: 0,
  dfa_returns: 0,
  yellow_kills: 0,
  turret_kills: 0,
  mine_returns: 0,
  mine_kills: 0,
  blue_returns: 0,
  blubs_returns: 0,
  blubs_kills: 0,
  upcut_kills: 0,
  bs_kills: 0,
  dbs_kills: 0,
  red_kills: 0,
  blue_kills: 0,
  ydfa_kills: 0,
  doom_kills: 0,
  tele_kills: 0,
  mine_grabs_red: 0,
  team: "Red",
  mine_grabs_blue: 0,
  dfa_kills: 0,
  dfa_attempts: 0,
  blocks_enemy: 0,
  time_played: 20,
  ping_mean: 40,
  ...over,
})

const match = (id: string, iso: string, over: Partial<AchMatch> = {}): AchMatch => ({
  matchId: id,
  date: iso,
  played: true,
  won: true,
  lost: false,
  myScore: 10,
  oppScore: 2,
  teammates: [],
  opponents: [],
  stat: stat(),
  ...over,
})

describe("the all-too-easy catalogue entry", () => {
  it("is flagged completionist and resolves to the transcendent rarity, not SECRET_RARITY", () => {
    const def = SECRET_ACHIEVEMENTS.find((d) => d.id === "all-too-easy")
    expect(def?.completionist).toBe(true)
    expect(findAchievementDef("all-too-easy")?.rarity).toBe("transcendent")
    expect(findAchievementDef("all-too-easy")?.rarity).not.toBe(SECRET_RARITY)
  })

  it("is the only completionist def, so the resolver has exactly one target", () => {
    expect(SECRET_ACHIEVEMENTS.filter((d) => d.completionist)).toHaveLength(1)
  })
})

describe("resolveCompletionistHolder", () => {
  it("returns nothing for an empty history", () => {
    expect(resolveCompletionistHolder(new Map()).size).toBe(0)
  })

  it("never awards a player who has one ordinary match and nothing else", () => {
    // One modest match cannot max out every family in a catalogue this size —
    // if this ever starts passing, either ACHIEVEMENTS shrank to almost
    // nothing or the resolver stopped checking completeness.
    const seqByPlayer = new Map([["p1", [match("m1", "2026-01-01T00:00:00Z")]]])
    expect(resolveCompletionistHolder(seqByPlayer).size).toBe(0)
  })

  it("never awards a player who played many matches but logged no stats", () => {
    const seq: AchMatch[] = Array.from({ length: 50 }, (_, i) =>
      match(`m${i}`, `2026-01-${String((i % 28) + 1).padStart(2, "0")}T00:00:00Z`, { stat: null }),
    )
    const seqByPlayer = new Map([["p1", seq]])
    expect(resolveCompletionistHolder(seqByPlayer).size).toBe(0)
  })

  it("a player absent from the map contributes nothing — no crash on a sparse roster", () => {
    const seqByPlayer = new Map([
      ["a", [match("m1", "2026-01-01T00:00:00Z")]],
      ["b", []],
    ])
    expect(() => resolveCompletionistHolder(seqByPlayer)).not.toThrow()
    expect(resolveCompletionistHolder(seqByPlayer).size).toBe(0)
  })

  it("only ever sets the all-too-easy id, never anything else", () => {
    const seqByPlayer = new Map([["p1", [match("m1", "2026-01-01T00:00:00Z")]]])
    const holders = resolveCompletionistHolder(seqByPlayer)
    for (const id of holders.keys()) {
      expect(SECRET_ACHIEVEMENTS.find((d) => d.id === id)?.completionist).toBe(true)
    }
  })
})

// Sanity check on the premise the tests above lean on: the catalogue is big
// enough that "one match" or "no stats" genuinely can't complete it. If this
// ever fails, the "never awards" tests above need a second look, not a shrug.
describe("sanity: the catalogue has real size", () => {
  it("has more than a handful of families to climb", () => {
    expect(ACHIEVEMENTS.length).toBeGreaterThan(10)
  })
})
