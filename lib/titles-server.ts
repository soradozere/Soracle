import type { SupabaseClient } from "@supabase/supabase-js"
import type { Rarity } from "@/lib/achievement-meta"
import { SEASONS, progressFor, type RecordedTitle } from "@/lib/titles"

// Recording earned seasonal titles.
//
// Seasonal entitlement is a function of ONE month's scoreboard against ONE
// month's catalogue, so unlike the score ladder it can't be recomputed after
// the fact — when August's season replaces July's in lib/titles.ts, July's
// ladder no longer exists to evaluate against. So we write the unlock down as
// it happens, snapshotting how it should render (see scripts/020).
//
// Called best-effort from the match-save path: seasonal standing can only
// change when a stats-backed match lands, which is exactly that moment.

const monthKeyOf = (iso: string) => iso.slice(0, 7)

// Half-open [start, end) bounds for a "YYYY-MM" key, in UTC — matches how the
// rest of the app buckets months.
function monthBounds(key: string): { start: string; end: string } {
  const [y, m] = key.split("-").map(Number)
  const start = new Date(Date.UTC(y, m - 1, 1))
  const end = new Date(Date.UTC(y, m, 1))
  return { start: start.toISOString(), end: end.toISOString() }
}

/**
 * Record every seasonal title cleared in the month containing `whenIso`.
 *
 * Keys off the MATCH's date rather than today's, so a backdated match logged
 * in a later month still credits the season it actually belongs to.
 *
 * `playerIds` scopes the work to the players in a match; omit it to evaluate
 * everyone with stats that month (the backfill path). Idempotent — existing
 * rows are left alone, so re-running is always safe.
 */
export async function recordSeasonalTitles(
  supabase: SupabaseClient,
  whenIso: string,
  playerIds?: string[],
): Promise<number> {
  const key = monthKeyOf(whenIso)
  const season = SEASONS[key]
  // A month with no catalogue entry has no seasonal ladder — nothing to record.
  if (!season) return 0
  if (playerIds && playerIds.length === 0) return 0

  const { start, end } = monthBounds(key)
  const { data: monthMatches, error: matchErr } = await supabase
    .from("matches")
    .select("id")
    .gte("created_at", start)
    .lt("created_at", end)
  if (matchErr) throw new Error(`Failed to read matches for ${key}: ${matchErr.message}`)

  const monthMatchIds = new Set((monthMatches ?? []).map((m: { id: string }) => m.id))
  if (monthMatchIds.size === 0) return 0

  // Scoped to this month's matches AND paged: supabase-js caps a select at 1000
  // rows and match_stats runs ~12 rows per match, so an unpaged read silently
  // truncates and under-counts scores — which would quietly withhold titles
  // players had actually earned. Same hazard lib/player-profile.ts pages around.
  const matchIds = [...monthMatchIds]
  const scoreByPlayer = new Map<string, number>()
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("match_stats")
      .select("player_id, match_id, score")
      .in("match_id", matchIds)
      .range(from, from + PAGE - 1)
    if (playerIds) q = q.in("player_id", playerIds)
    const { data, error } = await q
    if (error) throw new Error(`Failed to read match_stats for ${key}: ${error.message}`)
    const rows = (data ?? []) as { player_id: string; match_id: string; score: number | null }[]
    for (const row of rows) {
      scoreByPlayer.set(row.player_id, (scoreByPlayer.get(row.player_id) ?? 0) + (row.score ?? 0))
    }
    if (rows.length < PAGE) break
  }

  const rows: {
    player_id: string
    title_id: string
    season_key: string
    season_name: string
    title: string
    rarity: string
  }[] = []
  for (const [playerId, score] of scoreByPlayer) {
    for (const tier of progressFor(season.ladder, score).earned) {
      rows.push({
        player_id: playerId,
        title_id: tier.id,
        season_key: season.key,
        season_name: season.name,
        title: tier.title,
        rarity: tier.rarity,
      })
    }
  }
  if (!rows.length) return 0

  const { error } = await supabase
    .from("player_titles")
    .upsert(rows, { onConflict: "player_id,title_id", ignoreDuplicates: true })
  if (error) throw new Error(`Failed to record seasonal titles for ${key}: ${error.message}`)

  return rows.length
}

/** Never throws — a title-recording failure must not fail the match save it rides on. */
export async function recordSeasonalTitlesSafely(
  supabase: SupabaseClient,
  whenIso: string,
  playerIds?: string[],
): Promise<void> {
  try {
    await recordSeasonalTitles(supabase, whenIso, playerIds)
  } catch (err) {
    console.warn("Seasonal title recording failed:", err)
  }
}

/** A player's recorded titles, newest first. Public data (select-all RLS). */
export async function fetchRecordedTitles(
  supabase: SupabaseClient,
  playerId: string,
): Promise<RecordedTitle[]> {
  const { data, error } = await supabase
    .from("player_titles")
    .select("title_id, season_key, season_name, title, rarity, earned_at")
    .eq("player_id", playerId)
    .order("earned_at", { ascending: false })
  if (error) return []
  return (data ?? []).map((r: any) => ({
    titleId: r.title_id,
    seasonKey: r.season_key,
    seasonName: r.season_name,
    title: r.title,
    rarity: r.rarity as Rarity,
    earnedAt: r.earned_at,
  }))
}
