import { NextResponse } from "next/server"
import { cookies } from "next/headers"
import { revalidateTag } from "next/cache"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { computeAllPlayerAchievements, HISTORY_TAG } from "@/lib/achievements-server"
import { scoreFromViews } from "@/lib/achievement-score"
import { earnedTitles, mergeRecordedTitles, oneOfOneTitles, seasonFor, unlockedThemes, type ThemeId } from "@/lib/titles"
import { fetchRecordedTitles, recordTitleChangeSafely } from "@/lib/titles-server"
import { findModelSkin, findPlayerModel, isKnownModel } from "@/lib/player-models"
import { isKnownHandSlot } from "@/lib/saber-colours"
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
    // One-of-one crest titles are equippable too; earnedCrestRanks only holds
    // this player's earned crests, so no one else's secrets can validate here.
    const earned = mergeRecordedTitles(
      [...earnedTitles(achievementScore, monthScore, season), ...oneOfOneTitles(earnedCrestRanks.keys())],
      recorded,
    )
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
  // handed to /api/model-url. "mines" is the other value this column can hold —
  // see isKnownHandSlot.
  if (saberId && !isKnownHandSlot(saberId)) {
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

  // Read the cache-relevant columns before overwriting them: of everything
  // written below, these are the ones a HISTORY_TAG-cached page actually
  // renders, so they alone decide whether the invalidation at the end is worth
  // paying for. See the note there for the full list and how it was derived.
  // One narrow select, against a route that already runs several.
  // `name` rides along for the title changelog below rather than costing a
  // second read; it is not part of the cache gate.
  const { data: before } = await supabase
    .from("players")
    .select("avatar_url, title, name")
    .eq("id", playerId)
    .maybeSingle()
  const cacheRelevantChanged =
    (before?.avatar_url ?? null) !== avatar_url || (before?.title ?? null) !== titleId

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

  // Log an equipped-title change for the bot's title ping (scripts/046).
  // After the update, so a failed write never produces a changelog entry for a
  // change that didn't land; best-effort, so a failed entry never fails the
  // save. No-ops when the title didn't move, which is the common case here --
  // this route is every profile save, not just a title swap.
  await recordTitleChangeSafely(
    supabase,
    playerId,
    before?.name ?? "",
    before?.title ?? null,
    titleId,
  )

  /*
   * Of the nine columns written above, exactly TWO are rendered by a page
   * cached under HISTORY_TAG, and they are read by two DIFFERENT queries --
   * which is the trap here:
   *   - avatar_url, via fetchHistoryRows' players select
   *     ("id, name, created_at, tier_value, avatar_url, manually_inactive")
   *     in lib/achievements-server.ts, feeding the /players board's avatars;
   *   - title, via resolveEquippedTitles' OWN select ("id, title") in
   *     lib/titles-server.ts, called by app/(main)/players/page.tsx and
   *     app/(main)/page.tsx to render the Title column and the homepage's
   *     active-players list.
   * The rest (model, saber, skin, profile_theme, both animations,
   * spotlight_url) are read only on /player/[slug], which is dynamic, so they
   * never invalidate anything.
   *
   * A first version of this gate watched avatar_url ONLY, on the strength of
   * an older comment here claiming the board's Title column was the top crest
   * name rather than players.title. That was factually wrong -- see
   * components/players-index.tsx, whose own comment says the column shows the
   * equipped profile title -- and it meant equipping a title silently stopped
   * refreshing both boards for up to an hour. Verify against the actual
   * queries, not against this comment.
   *
   * The gate still pays for itself: a save that touches neither column was
   * invalidating ~54 prerendered pages (/, /achievements, /players, and the 51
   * crest pages) for nothing, and measured 25 Aug 2026, 63 of 84 players have
   * no avatar at all.
   *
   * THE COUPLING IS SILENT, so change both sides together: add a column
   * written above to EITHER select and this quietly stops invalidating for it
   * -- no error, just a board that goes stale for up to an hour.
   *
   * revalidateTag, not updateTag: this is a Route Handler, and updateTag
   * throws outright outside a Server Action. "max" is the profile the
   * deprecation warning asks for when no read-your-own-writes guarantee is
   * needed -- nothing here reads the ledger back before responding.
   */
  if (cacheRelevantChanged) revalidateTag(HISTORY_TAG, "max")

  return NextResponse.json({ ok: true })
}
