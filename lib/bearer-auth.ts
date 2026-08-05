import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"

/**
 * Timing-safe `Authorization: Bearer <secret>` check for machine-facing routes.
 *
 * Lifted out of bot-api.ts so the render callback can reuse the comparison
 * rather than growing a second one beside it: two copies of a constant-time
 * check is exactly the kind of thing that drifts, and only one copy gets fixed.
 * The bot and the render callback hold *different* secrets -- a Discord bot and
 * a public repo's CI runners are different trust domains, so a leak of one
 * should not be a leak of the other -- but they share this implementation.
 *
 * Returns a 401 to send back, or null when the request is authorized.
 * Fails closed when the secret is not configured: an unset env var must never
 * mean "let everyone in", which is how a misconfigured deploy becomes an open
 * endpoint.
 */
export function requireBearer(request: Request, secret: string | undefined): NextResponse | null {
  const header = request.headers.get("authorization")
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null

  if (!secret || !token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const tokenBuf = Buffer.from(token)
  const secretBuf = Buffer.from(secret)
  // Length is compared first because timingSafeEqual throws on a mismatch --
  // this does leak the length of the expected secret, which is the same
  // trade-off the bot endpoints have always made.
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  return null
}
