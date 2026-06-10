import { timingSafeEqual } from "crypto"
import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { mapDbPlayer } from "@/lib/fetch-players-db"
import type { Player } from "@/lib/types"

/**
 * Auth gate for bot-facing API routes: requires `Authorization: Bearer <BOT_API_SECRET>`.
 * Returns a 401 response to send back, or null when the request is authorized.
 * Fails closed (401) when BOT_API_SECRET is not configured.
 */
export function requireBotAuth(request: Request): NextResponse | null {
  const secret = process.env.BOT_API_SECRET
  const header = request.headers.get("authorization")
  const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : null

  if (!secret || !token) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  const tokenBuf = Buffer.from(token)
  const secretBuf = Buffer.from(secret)
  if (tokenBuf.length !== secretBuf.length || !timingSafeEqual(tokenBuf, secretBuf)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 })
  }

  return null
}

/**
 * Server-side counterpart of fetchPlayersFromDB (which uses the browser client):
 * same query shape and row mapping, on the server Supabase client. Reads work
 * without a user session via the players_select_all RLS policy. Throws on query
 * failure — unlike fetchPlayersFromDB's empty-array fallback — so routes return
 * a 500 instead of treating every Discord ID as unlinked.
 */
export async function fetchPlayersForBot(): Promise<Player[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("players").select("*").order("name")

  if (error) {
    throw new Error(`Failed to fetch players from database: ${error.message}`)
  }

  return (data || []).map(mapDbPlayer)
}
