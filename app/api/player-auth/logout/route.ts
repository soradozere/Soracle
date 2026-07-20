import { NextResponse } from "next/server"
import { PLAYER_SESSION_COOKIE } from "@/lib/player-auth"

export async function POST() {
  const response = NextResponse.json({ ok: true })
  response.cookies.set(PLAYER_SESSION_COOKIE, "", { path: "/", maxAge: 0 })
  return response
}
