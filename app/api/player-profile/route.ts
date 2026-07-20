import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { computePlayersDirectory } from "@/lib/achievements-server"
import { earnedTitles, seasonFor, unlockedThemes, type ThemeId } from "@/lib/titles"

// Self-service profile save for a logged-in player (not an admin). Deliberately
// narrower than the admin path: no tooltip (that stays an admin-only "signature"),
// and title/theme are re-validated against the player's actual entitlement here —
// the dropdown on the client only ever offers earned options, but this route is
// what a malicious direct POST would hit, so it can't trust the client's list.
export async function POST(request: Request) {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) return NextResponse.json({ error: "Not logged in" }, { status: 401 })

  let body: { avatar_url?: string; spotlight_url?: string; title?: string; profile_theme?: string }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const avatar_url = (body.avatar_url ?? "").trim() || null
  const spotlight_url = (body.spotlight_url ?? "").trim() || null
  const titleId = (body.title ?? "").trim() || null
  const themeId = (body.profile_theme ?? "").trim() || null

  const supabase = createServiceClient()

  // Current month's summed in-game score, for the seasonal ladder — mirrors
  // MonthStatTotals.score in lib/player-profile.ts but scoped to one player.
  // Two plain queries + a JS intersect, rather than a PostgREST embed, so this
  // doesn't depend on which FK name Supabase picks for the join.
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)).toISOString()
  const { data: monthMatches } = await supabase.from("matches").select("id").gte("created_at", monthStart)
  const monthMatchIds = new Set((monthMatches ?? []).map((m: any) => m.id))
  const { data: statRows } = await supabase
    .from("match_stats")
    .select("match_id, score")
    .eq("player_id", playerId)
  const monthScore = (statRows ?? [])
    .filter((r: any) => monthMatchIds.has(r.match_id))
    .reduce((sum: number, r: any) => sum + (r.score ?? 0), 0)

  const directory = await computePlayersDirectory()
  const achievementScore = directory.find((p) => p.id === playerId)?.score ?? 0

  if (titleId) {
    const season = seasonFor(now.toISOString())
    const earned = earnedTitles(achievementScore, monthScore, season)
    if (!earned.some((t) => t.id === titleId)) {
      return NextResponse.json({ error: "Title not earned" }, { status: 403 })
    }
  }

  if (themeId) {
    const available = unlockedThemes(achievementScore)
    if (!available.includes(themeId as ThemeId)) {
      return NextResponse.json({ error: "Theme not unlocked" }, { status: 403 })
    }
  }

  const { error } = await supabase
    .from("players")
    .update({ avatar_url, spotlight_url, title: titleId, profile_theme: themeId })
    .eq("id", playerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
