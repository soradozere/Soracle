import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { createLiveToken, LIVE_TOKEN_TTL_MS } from "@/lib/live-token"

// Hands a logged-in player a short-lived token for one live spectate session.
//
// Login is required to watch — the deliberate consequence being that a player
// without a password cannot, until an admin issues one. That is the brief's
// call, and it is also what makes one-session-per-account meaningful: without
// an identity there is nothing to hold the limit against.
//
// The token is minted here and enforced by the bridge; this route never talks
// to the bridge, and the bridge never talks back to Soracle. They share only a
// secret, so a spectate session costs no round trip to the site and the site
// staying up is not a condition of a match staying watchable.
export async function POST(request: Request) {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) {
    return NextResponse.json({ error: "Sign in to watch live." }, { status: 401 })
  }

  let serverIndex = 0
  try {
    const body = await request.json()
    if (typeof body?.serverIndex === "number") serverIndex = body.serverIndex
  } catch {
    // No body is fine — default to the first allowlisted server.
  }
  if (!Number.isInteger(serverIndex) || serverIndex < 0) {
    return NextResponse.json({ error: "Bad server." }, { status: 400 })
  }

  // The player must still exist. A session cookie outlives an account that an
  // admin has since removed, and the bridge only sees an id — so the check for
  // "is this still a real player" belongs here, where the players table is.
  const supabase = createServiceClient()
  const { data: player } = await supabase
    .from("players")
    .select("id, name")
    .eq("id", playerId)
    .maybeSingle()
  if (!player) {
    return NextResponse.json({ error: "Sign in to watch live." }, { status: 401 })
  }

  return NextResponse.json({
    token: createLiveToken(player.id, serverIndex),
    expiresInMs: LIVE_TOKEN_TTL_MS,
    name: player.name,
  })
}
