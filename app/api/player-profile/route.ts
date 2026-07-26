import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { computeAllPlayerAchievements } from "@/lib/achievements-server"
import { scoreFromViews } from "@/lib/achievement-score"
import { earnedTitles, mergeRecordedTitles, seasonFor, unlockedThemes, type ThemeId } from "@/lib/titles"
import { fetchRecordedTitles } from "@/lib/titles-server"
import { findModelSkin, findPlayerModel, isKnownModel } from "@/lib/player-models"
import { isKnownSaberColour } from "@/lib/saber-colours"
import { isKnownActionAnimation, isKnownIdleAnimation } from "@/lib/animations"

// Self-service profile save for a logged-in player (not an admin). Deliberately
// narrower than the admin path: no tooltip (that stays an admin-only "signature"),
// and title/theme are re-validated against the player's actual entitlement here —
// the dropdown on the client only ever offers earned options, but this route is
// what a malicious direct POST would hit, so it can't trust the client's list.
export async function POST(request: Request) {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) return NextResponse.json({ error: "Not logged in" }, { status: 401 })

  let body: {
    avatar_url?: string
    spotlight_url?: string
    title?: string
    profile_theme?: string
    model?: string
    saber?: string
    skin?: string
    idle_animation?: string
    action_animation?: string
  }
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 })
  }

  const avatar_url = (body.avatar_url ?? "").trim() || null
  const spotlight_url = (body.spotlight_url ?? "").trim() || null
  const titleId = (body.title ?? "").trim() || null
  const themeId = (body.profile_theme ?? "").trim() || null
  const modelId = (body.model ?? "").trim() || null
  const saberId = (body.saber ?? "").trim() || null
  const skinId = (body.skin ?? "").trim() || null
  const idleAnimationId = (body.idle_animation ?? "").trim() || null
  const actionAnimationId = (body.action_animation ?? "").trim() || null

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

  // The player's earned crests drive both the title ladder (via Achievement Score)
  // and the crest-gated profile themes — computed server-side so a crafted POST
  // can't claim a theme/title the player hasn't actually earned.
  const allAchievements = await computeAllPlayerAchievements()
  const views = allAchievements.get(playerId)?.views ?? []
  const achievementScore = scoreFromViews(views)
  const earnedCrestRanks = new Map(views.filter((v) => v.earned).map((v) => [v.id, v.rank] as const))

  if (titleId) {
    const season = seasonFor(now.toISOString())
    // Banked seasonal titles count too — otherwise a player wearing a past
    // season's title would be rejected the next time they saved anything.
    const recorded = await fetchRecordedTitles(supabase, playerId)
    const earned = mergeRecordedTitles(earnedTitles(achievementScore, monthScore, season), recorded)
    if (!earned.some((t) => t.id === titleId)) {
      return NextResponse.json({ error: "Title not earned" }, { status: 403 })
    }
  }

  if (themeId) {
    const available = unlockedThemes(achievementScore, earnedCrestRanks)
    if (!available.includes(themeId as ThemeId)) {
      return NextResponse.json({ error: "Theme not unlocked" }, { status: 403 })
    }
  }

  // Models aren't gated on entitlement (any player may pick any model we ship),
  // but the id still has to be one we recognise — otherwise a crafted POST could
  // park arbitrary text in the column for /api/model-url to be handed later.
  if (modelId && !isKnownModel(modelId)) {
    return NextResponse.json({ error: "Unknown model" }, { status: 400 })
  }

  // Same for the blade colour, and for the same reason — it becomes an asset id
  // handed to /api/model-url.
  if (saberId && !isKnownSaberColour(saberId)) {
    return NextResponse.json({ error: "Unknown saber colour" }, { status: 400 })
  }

  // A skin id only means something paired with the model it belongs to — Kyle's
  // "red" and Reborn's "boss" aren't interchangeable — so this checks the
  // submitted skin against the submitted model's OWN list, not a flat catalogue.
  // No model means no skin: there's nothing for it to repaint.
  if (skinId && !findModelSkin(findPlayerModel(modelId), skinId)) {
    return NextResponse.json({ error: "Unknown skin for this model" }, { status: 400 })
  }

  // Same reasoning as model/saber: these become clip names handed straight to
  // <ModelViewer>, so an unrecognised one has to be rejected rather than silently
  // parked in the column for later.
  if (idleAnimationId && !isKnownIdleAnimation(idleAnimationId)) {
    return NextResponse.json({ error: "Unknown idle animation" }, { status: 400 })
  }
  if (actionAnimationId && !isKnownActionAnimation(actionAnimationId)) {
    return NextResponse.json({ error: "Unknown action animation" }, { status: 400 })
  }

  const { error } = await supabase
    .from("players")
    .update({
      avatar_url,
      spotlight_url,
      title: titleId,
      profile_theme: themeId,
      model: modelId,
      saber: saberId,
      skin: skinId,
      idle_animation: idleAnimationId,
      action_animation: actionAnimationId,
    })
    .eq("id", playerId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ok: true })
}
