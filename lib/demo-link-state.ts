/**
 * Reading playback state out of a shared link.
 *
 * Pulled out of the viewer so it can be tested without a browser, an engine, or
 * 120MB of assets. It is a handful of lines of string parsing, and it has
 * already shipped one bug that reached players: `Number(null)` is `0`, so a
 * link with no follow target resolved to client 0 and the viewer dutifully
 * followed whoever that was -- on a bot-recorded demo, a spectator standing
 * still. Exactly the shape of thing that is obvious in a test and invisible in
 * a component.
 */

export type CameraMode = "follow" | "free"

export interface LinkState {
  /** Camera mode the link asks for, or null if it does not say. */
  camera: CameraMode | null
  /**
   * Client number to follow, -1 for the recorded view, or null to leave alone.
   *
   * -1 is deliberate rather than absent: a link carrying camera state but no
   * target means the recorded view, and it has to be applied rather than
   * skipped, because the engine outlives a route change and would otherwise
   * keep following whoever was being watched on the previous demo.
   */
  follow: number | null
  /** Seconds to seek to, or null when there is nothing worth seeking to. */
  seekSeconds: number | null
}

const MAX_CLIENTS = 32

export function readLinkState(search: string): LinkState {
  const params = new URLSearchParams(search)

  const rawCam = params.get("cam")
  const camera: CameraMode | null = rawCam === "free" || rawCam === "follow" ? rawCam : null

  // Read before converting: Number(null) is 0, and 0 is a valid client.
  const rawFollow = params.get("follow")
  let follow: number | null = null
  if (rawFollow !== null && rawFollow.trim() !== "") {
    const n = Number(rawFollow)
    if (Number.isInteger(n) && n >= 0 && n < MAX_CLIENTS) follow = n
  }
  // A link that says where the camera is but not who it is on means the
  // recorded view.
  if (follow === null && camera !== null) follow = -1

  const rawT = params.get("t")
  const seconds = rawT === null ? NaN : Number(rawT)
  const seekSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : null

  return { camera, follow, seekSeconds }
}
