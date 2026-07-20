import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/admin"
import {
  isLockedOut,
  nextLockout,
  verifyPassword,
  createSessionValue,
  PLAYER_SESSION_COOKIE,
  PLAYER_SESSION_MAX_AGE_SECONDS,
} from "@/lib/player-auth"

// Player login: name + admin-issued password -> httpOnly session cookie.
// Deliberately generic errors throughout (no "no such player" vs "wrong
// password" distinction) so this can't be used to enumerate who has a login.
export async function POST(request: Request) {
  let body: { name?: string; password?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const name = body.name?.trim()
  const password = body.password
  if (!name || !password) {
    return NextResponse.json({ error: "Name and password are required" }, { status: 400 })
  }

  const supabase = createServiceClient()

  const { data: player } = await supabase
    .from("players")
    .select("id, name")
    .ilike("name", name)
    .maybeSingle()

  const invalid = () => NextResponse.json({ error: "Invalid name or password" }, { status: 401 })

  if (!player) return invalid()

  const { data: creds } = await supabase
    .from("player_credentials")
    .select("password_hash, failed_attempts, locked_until")
    .eq("player_id", player.id)
    .maybeSingle()

  if (!creds) return invalid()

  if (isLockedOut(creds.locked_until)) {
    return NextResponse.json({ error: "Too many attempts. Try again later." }, { status: 423 })
  }

  if (!verifyPassword(password, creds.password_hash)) {
    const { failedAttempts, lockedUntil } = nextLockout(creds.failed_attempts)
    await supabase
      .from("player_credentials")
      .update({ failed_attempts: failedAttempts, locked_until: lockedUntil })
      .eq("player_id", player.id)
    return invalid()
  }

  await supabase
    .from("player_credentials")
    .update({ failed_attempts: 0, locked_until: null })
    .eq("player_id", player.id)

  const response = NextResponse.json({ ok: true, playerId: player.id, name: player.name })
  response.cookies.set(PLAYER_SESSION_COOKIE, createSessionValue(player.id), {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: PLAYER_SESSION_MAX_AGE_SECONDS,
  })
  return response
}
