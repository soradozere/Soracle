import { createHmac, timingSafeEqual } from "crypto"

/**
 * Short-lived tokens that let a logged-in player open a live spectate session
 * through the WebSocket↔UDP bridge.
 *
 * Same shape as the session cookie in `player-auth.ts` — HMAC over a dotted
 * payload, no JWT library and no algorithm field to confuse — because the
 * payload is again just an id and a couple of numbers.
 *
 * **Deliberately a different secret from `PLAYER_SESSION_SECRET`, and this is
 * the point of the file.** The bridge has to verify these, so it must hold the
 * key — and the bridge is intended to run on the community's game server box,
 * which other people administer. If it held the session secret, anyone with
 * access to that machine could mint login cookies for any player on Soracle.
 * With a separate secret the worst case is forged *spectate* tokens: someone
 * could watch a match they could already have watched by asking. Losing this
 * key is a nuisance; losing the session key is an account-takeover.
 */

const TOKEN_TTL_MS = 60 * 1000

function bridgeSecret(): string {
  const secret = process.env.LIVE_BRIDGE_SECRET
  if (!secret) throw new Error("LIVE_BRIDGE_SECRET is not configured")
  return secret
}

function sign(payload: string): string {
  return createHmac("sha256", bridgeSecret()).update(payload).digest("hex")
}

/**
 * `<playerId>.<serverIndex>.<expiry>.<sig>`
 *
 * The token names the server it is good for, so a token minted for one
 * allowlisted server cannot be replayed against another. The TTL is a minute
 * because it is redeemed immediately at connect — it is a handoff, not a
 * session. The session itself lives as long as the socket does.
 *
 * Travels in `Sec-WebSocket-Protocol` rather than a query string: query
 * strings are written to access logs by every proxy in the path, and this is
 * a credential. Every character used here is valid in that header.
 */
export function createLiveToken(playerId: string, serverIndex: number): string {
  const expires = Date.now() + TOKEN_TTL_MS
  const payload = `${playerId}.${serverIndex}.${expires}`
  return `${payload}.${sign(payload)}`
}

export interface LiveTokenClaims {
  playerId: string
  serverIndex: number
}

/**
 * Verify and decode, or null. Mirrors `verifySessionValue`'s contract so the
 * two read the same way.
 *
 * Only used by tests and any future server-side check — the bridge does its
 * own verification in Python, since it must reject a socket before relaying a
 * single packet and cannot call into this.
 */
export function verifyLiveToken(value: string | undefined): LiveTokenClaims | null {
  if (!value) return null
  const parts = value.split(".")
  if (parts.length !== 4) return null
  const [playerId, serverIndexStr, expiresStr, sig] = parts
  const payload = `${playerId}.${serverIndexStr}.${expiresStr}`
  const expected = sign(payload)
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null
  const expires = Number(expiresStr)
  if (!Number.isFinite(expires) || Date.now() > expires) return null
  const serverIndex = Number(serverIndexStr)
  if (!Number.isInteger(serverIndex) || serverIndex < 0) return null
  return { playerId, serverIndex }
}

export const LIVE_TOKEN_TTL_MS = TOKEN_TTL_MS
