import { describe, expect, it } from "vitest"
import { createNameResolver, normalizeName, type PlayerAlias } from "./name-match"
import type { Player } from "./types"

/*
 * Name resolution decides who a scoreboard row belongs to, and it is the one
 * import step where being confidently wrong is worse than giving up: a bad
 * match files someone else's match into a player's career stats, where it then
 * feeds ELO, achievements and the leaderboard. So the interesting cases here
 * are not the happy ones -- they are the boundary between "match" and "ask an
 * admin", and the ambiguity rule that decides when not to guess at all.
 */

const player = (id: string, name: string): Player => ({
  id,
  name,
  tierValue: 5,
  mic: false,
  roles: { Capper: 0, Chase: 0, Camp: 0, Cleaner: 0, Support: 0 },
})

const ROSTER: Player[] = [
  player("p-sora", "sora"),
  player("p-original", "Original"),
  player("p-suvix", "Suvix"),
  player("p-craken", "Christian Craken"),
  player("p-ewok", "Ewok"),
]

describe("normalizeName", () => {
  it("strips engine colour codes", () => {
    expect(normalizeName("^1Ewok")).toBe("ewok")
    expect(normalizeName("^1E^2w^3o^4k")).toBe("ewok")
  })

  it("strips a bracketed clan tag, including one with inner spaces", () => {
    expect(normalizeName("{FoU} Original")).toBe("original")
    expect(normalizeName("[Big Clan] Suvix")).toBe("suvix")
    expect(normalizeName("(clan) sora")).toBe("sora")
  })

  it("strips a symbol-led tag up to the first space", () => {
    expect(normalizeName(".:FoU:. Original")).toBe("original")
    expect(normalizeName("=DBD= Suvix")).toBe("suvix")
  })

  it("strips symbols glued to the front, and trailing ones", () => {
    expect(normalizeName("_-}-_Suvix")).toBe("suvix")
    expect(normalizeName("Original.")).toBe("original")
  })

  /*
   * The deliberate limit. A bare-word tag has nothing to distinguish it from a
   * real first name, and stripping leading words would turn "Christian Craken"
   * into "Craken" -- a different person as far as the roster is concerned.
   * Those are handled by learned aliases instead, which is a decision someone
   * made rather than a guess this function made.
   */
  it("leaves a bare-word prefix alone rather than eating a real name", () => {
    expect(normalizeName("Christian Craken")).toBe("christian craken")
    expect(normalizeName("CoS # uruma")).toBe("cos # uruma")
  })
})

describe("createNameResolver", () => {
  it("prefers an exact name over everything else", () => {
    const r = createNameResolver(ROSTER)
    expect(r.resolve("sora")).toEqual({ playerId: "p-sora", method: "exact" })
  })

  it("matches a learned alias that looks nothing like the real name", () => {
    const aliases: PlayerAlias[] = [{ player_id: "p-sora", alias: "totally different handle" }]
    const r = createNameResolver(ROSTER, aliases)
    expect(r.resolve("totally different handle")).toEqual({ playerId: "p-sora", method: "alias" })
  })

  it("falls through to normalisation for tags and colour codes", () => {
    const r = createNameResolver(ROSTER)
    expect(r.resolve("{FoU} Original")).toEqual({ playerId: "p-original", method: "normalized" })
    expect(r.resolve("^1Ewok")).toEqual({ playerId: "p-ewok", method: "normalized" })
    expect(r.resolve("_-}-_Suvix")).toEqual({ playerId: "p-suvix", method: "normalized" })
  })

  // An alias is normalised too, so one learned spelling covers every clan tag
  // that player ever wears it behind.
  it("normalises aliases as well as roster names", () => {
    const r = createNameResolver(ROSTER, [{ player_id: "p-craken", alias: "craken" }])
    expect(r.resolve("{XYZ} Craken")).toEqual({ playerId: "p-craken", method: "normalized" })
  })

  it("reaches for fuzzy only when the stronger methods miss", () => {
    const r = createNameResolver(ROSTER)
    const hit = r.resolve("Suvixx")
    expect(hit).toEqual({ playerId: "p-suvix", method: "fuzzy" })
  })

  it("gives up rather than guessing at a name nobody owns", () => {
    const r = createNameResolver(ROSTER)
    expect(r.resolve("qwertyuiop")).toBeNull()
    expect(r.resolve("")).toBeNull()
    expect(r.resolve("   ")).toBeNull()
  })

  /*
   * Two players whose names fold to the same key is the case where a guess is
   * actively harmful -- there is no right answer, and picking one silently
   * files matches under the wrong career. The key is dropped entirely so the
   * row reaches an admin.
   */
  it("refuses a normalised key two players both claim", () => {
    const clash = [player("p-a", "{ONE} rex"), player("p-b", "[TWO] rex")]
    const r = createNameResolver(clash)
    const hit = r.resolve("<THREE> rex")
    // Never resolves via the ambiguous normalised key.
    expect(hit?.method).not.toBe("normalized")
  })
})
