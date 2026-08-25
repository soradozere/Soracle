import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { requireFullAdmin } from "@/lib/player-role"
import { generatePassword, hashPassword } from "@/lib/player-auth"

// Admin-only: (re)generate a player's login password. Returns the plaintext
// exactly once — it is never stored or logged, only the hash is persisted.
export async function POST(request: Request) {
  const authz = await requireFullAdmin()
  if (!authz.ok) return NextResponse.json({ error: "Unauthorized" }, { status: 403 })

  let body: { playerId?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }
  if (!body.playerId) return NextResponse.json({ error: "playerId is required" }, { status: 400 })

  const service = createServiceClient()
  const { data: player } = await service.from("players").select("id").eq("id", body.playerId).maybeSingle()
  if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 })

  const password = generatePassword()
  const { error } = await service.from("player_credentials").upsert({
    player_id: body.playerId,
    password_hash: hashPassword(password),
    failed_attempts: 0,
    locked_until: null,
    updated_at: new Date().toISOString(),
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true, password })
}
