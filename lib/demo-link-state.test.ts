import { describe, expect, it } from "vitest"
import { readLinkState } from "./demo-link-state"

describe("readLinkState", () => {
  it("leaves everything alone for a bare link", () => {
    expect(readLinkState("")).toEqual({ camera: null, follow: null, seekSeconds: null })
  })

  /*
   * The bug this file exists for. A shared link with camera state but no
   * target used to resolve to client 0 -- Number(null) is 0, and 0 passes an
   * integer-and-in-range check without complaint. On a bot-recorded demo that
   * client is the spectator, so a link shared to show someone's play opened on
   * a Padawan standing still.
   */
  it("does not follow client 0 when the link names no target", () => {
    expect(readLinkState("?t=1&cam=follow").follow).toBe(-1)
    expect(readLinkState("?cam=free").follow).toBe(-1)
  })

  it("still honours an explicit target, including client 0", () => {
    expect(readLinkState("?cam=follow&follow=0").follow).toBe(0)
    expect(readLinkState("?cam=follow&follow=14").follow).toBe(14)
  })

  it("ignores targets that are not a real client", () => {
    for (const bad of ["-1", "32", "999", "1.5", "abc", ""]) {
      // Falls back to the recorded view rather than following something absurd.
      expect(readLinkState(`?cam=follow&follow=${bad}`).follow).toBe(-1)
    }
  })

  it("reads the camera mode, and only the two that exist", () => {
    expect(readLinkState("?cam=free").camera).toBe("free")
    expect(readLinkState("?cam=follow").camera).toBe("follow")
    expect(readLinkState("?cam=orbit").camera).toBe(null)
  })

  it("leaves follow untouched when the link says nothing about the camera", () => {
    // No camera state means this is not a playback link, so nothing is forced.
    expect(readLinkState("?t=30").follow).toBe(null)
  })

  it("seeks only to a positive time", () => {
    expect(readLinkState("?t=30").seekSeconds).toBe(30)
    expect(readLinkState("?t=0").seekSeconds).toBe(null)
    expect(readLinkState("?t=-5").seekSeconds).toBe(null)
    expect(readLinkState("?t=abc").seekSeconds).toBe(null)
    expect(readLinkState("").seekSeconds).toBe(null)
  })
})
