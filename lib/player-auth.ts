import { randomBytes, randomInt, scryptSync, timingSafeEqual, createHmac } from "crypto"

// Player logins are a separate, much lower-stakes auth system from Supabase
// Auth (which only admins use). No accounts, no email, no password reset
// flow a player self-serves — an admin generates a password from the admin
// panel and hands it over. This file is server-only (uses Node's `crypto`
// and env secrets); never import it from a client component.

const SESSION_COOKIE = "soracle_player"
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000 // 30 days
const MAX_FAILED_ATTEMPTS = 8
const LOCKOUT_MS = 15 * 60 * 1000

function sessionSecret(): string {
  const secret = process.env.PLAYER_SESSION_SECRET
  if (!secret) throw new Error("PLAYER_SESSION_SECRET is not configured")
  return secret
}

// scrypt with a random salt per password; stored as "salt:hash" hex.
export function hashPassword(password: string): string {
  const salt = randomBytes(16)
  const hash = scryptSync(password, salt, 64)
  return `${salt.toString("hex")}:${hash.toString("hex")}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":")
  if (!saltHex || !hashHex) return false
  const salt = Buffer.from(saltHex, "hex")
  const expected = Buffer.from(hashHex, "hex")
  const actual = scryptSync(password, salt, 64)
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

// Readable random password: e.g. "K4X9-PW7T-2MRD". Excludes 0/O/1/I/L to
// avoid transcription mistakes when an admin reads it aloud or pastes it.
const PASSWORD_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

export function generatePassword(): string {
  const groups: string[] = []
  for (let g = 0; g < 3; g++) {
    let group = ""
    for (let i = 0; i < 4; i++) group += PASSWORD_ALPHABET[randomInt(PASSWORD_ALPHABET.length)]
    groups.push(group)
  }
  return groups.join("-")
}

export function isLockedOut(lockedUntil: string | null): boolean {
  return !!lockedUntil && new Date(lockedUntil).getTime() > Date.now()
}

export function nextLockout(failedAttempts: number): { failedAttempts: number; lockedUntil: string | null } {
  const next = failedAttempts + 1
  if (next >= MAX_FAILED_ATTEMPTS) {
    return { failedAttempts: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS).toISOString() }
  }
  return { failedAttempts: next, lockedUntil: null }
}

// --- Session cookie: HMAC-signed "<playerId>.<expiry>.<sig>", not a JWT
// (no library, no alg-confusion surface) since the payload is just an id.

function sign(payload: string): string {
  return createHmac("sha256", sessionSecret()).update(payload).digest("hex")
}

export function createSessionValue(playerId: string): string {
  const expires = Date.now() + SESSION_TTL_MS
  const payload = `${playerId}.${expires}`
  return `${payload}.${sign(payload)}`
}

export function verifySessionValue(value: string | undefined): string | null {
  if (!value) return null
  const parts = value.split(".")
  if (parts.length !== 3) return null
  const [playerId, expiresStr, sig] = parts
  const payload = `${playerId}.${expiresStr}`
  const expected = sign(payload)
  const sigBuf = Buffer.from(sig)
  const expectedBuf = Buffer.from(expected)
  if (sigBuf.length !== expectedBuf.length || !timingSafeEqual(sigBuf, expectedBuf)) return null
  const expires = Number(expiresStr)
  if (!Number.isFinite(expires) || Date.now() > expires) return null
  return playerId
}

export const PLAYER_SESSION_COOKIE = SESSION_COOKIE
export const PLAYER_SESSION_MAX_AGE_SECONDS = SESSION_TTL_MS / 1000
