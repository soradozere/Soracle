import { describe, expect, it } from "vitest"
import { matchRank } from "./demo-search"

type Ranked = Parameters<typeof matchRank>[0]

const demo = (over: Partial<Ranked> = {}): Ranked => ({
  title: "Untitled",
  map: "ctf_yavin",
  uploaderName: null,
  players: [],
  protagonist: null,
  ...over,
})

const named = (name: string) => ({ id: name, name, avatarUrl: null }) as Ranked["players"][number]

describe("matchRank", () => {
  it("puts the demos someone stars in above the ones they are merely in", () => {
    const stars = demo({ protagonist: named("sora"), players: [named("sora"), named("devy")] })
    const appears = demo({ protagonist: named("devy"), players: [named("sora"), named("devy")] })
    expect(matchRank(stars, "sora")).toBeGreaterThan(matchRank(appears, "sora"))
  })

  it("ranks being in a match above merely having uploaded it", () => {
    const appears = demo({ players: [named("sora")] })
    const uploaded = demo({ uploaderName: "sora" })
    expect(matchRank(appears, "sora")).toBeGreaterThan(matchRank(uploaded, "sora"))
  })

  /*
   * The case that prompted this: searching a player returned their headline
   * clips mixed in with everything they happened to upload, in date order.
   */
  it("beats a plain upload even when the upload is the more recent thing", () => {
    const uploadedByThem = demo({ uploaderName: "sora", title: "some match" })
    const aboutThem = demo({ protagonist: named("sora"), uploaderName: "someone else" })
    expect(matchRank(aboutThem, "sora")).toBeGreaterThan(matchRank(uploadedByThem, "sora"))
  })

  it("matches on title and map, below the people involved", () => {
    const byTitle = demo({ title: "sora goes mental" })
    const byPlayer = demo({ players: [named("sora")] })
    expect(matchRank(byTitle, "sora")).toBeGreaterThan(0)
    expect(matchRank(byPlayer, "sora")).toBeGreaterThan(matchRank(byTitle, "sora"))
  })

  it("is case-insensitive and ignores surrounding space", () => {
    const d = demo({ protagonist: named("Cooky") })
    expect(matchRank(d, "cooky")).toBe(matchRank(d, "  COOKY "))
  })

  it("scores nothing for a miss, or for an empty query", () => {
    expect(matchRank(demo({ protagonist: named("sora") }), "glempa")).toBe(0)
    expect(matchRank(demo({ protagonist: named("sora") }), "   ")).toBe(0)
  })

  it("matches partial names, since people rarely type a clan tag", () => {
    expect(matchRank(demo({ protagonist: named("[Team Shish] Rufio") }), "rufio")).toBe(4)
  })
})
