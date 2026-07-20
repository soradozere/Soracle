import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, verifyPassword, hashPassword, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"

// Self-service password change for a logged-in player. Requires the current
// password even though the session already proves identity — a borrowed or
// left-open browser shouldn't be enough to lock the real owner out.
const MIN_LENGTH = 8

export async function POST(request: Request) {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) return NextResponse.json({ error: "Not logged in" }, { status: 401 })

  let body: { currentPassword?: string; newPassword?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const current = body.currentPassword ?? ""
  const next = body.newPassword ?? ""
  if (!current || !next) {
    return NextResponse.json({ error: "Both passwords are required" }, { status: 400 })
  }
  if (next.length < MIN_LENGTH) {
    return NextResponse.json({ error: `New password must be at least ${MIN_LENGTH} characters` }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: creds } = await supabase
    .from("player_credentials")
    .select("password_hash")
    .eq("player_id", playerId)
    .maybeSingle()
  if (!creds) return NextResponse.json({ error: "No password is set for this account" }, { status: 400 })

  if (!verifyPassword(current, creds.password_hash)) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 403 })
  }

  const { error } = await supabase
    .from("player_credentials")
    .update({
      password_hash: hashPassword(next),
      // A successful change clears any lockout — the owner has proven themselves.
      failed_attempts: 0,
      locked_until: null,
      updated_at: new Date().toISOString(),
    })
    .eq("player_id", playerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
