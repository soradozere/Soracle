import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"

// Whoever holds a valid player session cookie, so the profile page knows
// whether to show the owner (non-admin) edit controls.
export async function GET() {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) return NextResponse.json({ playerId: null })

  const supabase = createServiceClient()
  const { data: player } = await supabase.from("players").select("id, name").eq("id", playerId).maybeSingle()
  if (!player) return NextResponse.json({ playerId: null })

  return NextResponse.json({ playerId: player.id, name: player.name })
}
