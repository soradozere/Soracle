import type { SupabaseClient } from "@supabase/supabase-js"
import type { Rarity } from "@/lib/achievement-meta"
import {
  SEASONS,
  STANDING_LADDERS,
  progressFor,
  catalogueTitleById,
  type RecordedTitle,
  type TitleLadder,
} from "@/lib/titles"
import { computeCapConversion } from "@/lib/cap-conversion"
import { computeReturnerRate } from "@/lib/returner-rate"
import { createAnonClient } from "@/lib/supabase/anon"

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
  // Standing ladders run every month; a themed season is optional on top. A
  // month with neither has nothing to record.
  const standing = STANDING_LADDERS.filter((l) => !l.from || key >= l.from)
  if (!season && standing.length === 0) return 0
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
  const bank = (ladder: TitleLadder, seasonName: string, playerId: string, value: number) => {
    for (const tier of progressFor(ladder, value).earned) {
      rows.push({
        player_id: playerId,
        title_id: tier.id,
        season_key: key,
        season_name: seasonName,
        title: tier.title,
        rarity: tier.rarity,
      })
    }
  }

  if (season) {
    for (const [playerId, score] of scoreByPlayer) bank(season.ladder, season.name, playerId, score)
  }

  // Standing role ladders. Both helpers already take the month's match ids and
  // apply their own qualifying floors, so they return only players whose figure
  // is meaningful — no second floor needed here.
  for (const ladder of standing) {
    const values = await standingValues(supabase, ladder.metric, matchIds)
    for (const [playerId, value] of values) {
      if (playerIds && !playerIds.includes(playerId)) continue
      bank(ladder, ladder.label, playerId, value)
    }
  }
  if (!rows.length) return 0

  const { error } = await supabase
    .from("player_titles")
    .upsert(rows, { onConflict: "player_id,title_id", ignoreDuplicates: true })
  if (error) throw new Error(`Failed to record seasonal titles for ${key}: ${error.message}`)

  return rows.length
}

/**
 * Per-player value for a standing ladder's metric over one month's matches.
 *
 * Deliberately reuses the same functions the site and bot read, so a title can
 * never disagree with the board that displays the number behind it. Both apply
 * their own relative floor and return only qualifying players.
 */
async function standingValues(
  supabase: SupabaseClient,
  metric: TitleLadder["metric"],
  matchIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  // Names aren't needed — rows are keyed by player_id — but both helpers take
  // the map, so an empty one is passed rather than paying for a players read.
  const noNames = new Map<string, string>()
  if (metric === "cap_conversion") {
    const { rows } = await computeCapConversion(supabase, noNames, matchIds)
    for (const r of rows) out.set(r.playerId, r.conversion)
  } else if (metric === "ret_rate") {
    const { rows } = await computeReturnerRate(supabase, noNames, matchIds)
    for (const r of rows) out.set(r.playerId, r.perMinute)
  }
  return out
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

/**
 * The display info for a player's currently equipped title, or null. Prefers
 * the banked player_titles snapshot — it's authoritative and survives a season
 * leaving the catalogue — and falls back to the live catalogue for score-ladder
 * titles and for a seasonal one equipped before its first match banked it.
 *
 * Never throws: fetchRecordedTitles swallows its own errors, so a missing table
 * (pre-migration) or a read hiccup just yields the catalogue answer or null.
 */
export async function resolveEquippedTitle(
  supabase: SupabaseClient,
  playerId: string,
  titleId: string | null,
): Promise<{ title: string; rarity: Rarity; source: string } | null> {
  if (!titleId) return null
  const recorded = await fetchRecordedTitles(supabase, playerId)
  const rec = recorded.find((t) => t.titleId === titleId)
  if (rec) return { title: rec.title, rarity: rec.rarity, source: rec.seasonName }
  return catalogueTitleById(titleId)
}

/**
 * Batched resolveEquippedTitle for a set of players: two queries total,
 * regardless of how many players are asked for. Public data (select-all RLS),
 * so this builds its own anon client rather than asking the caller for one.
 *
 * It used to fan out — one player_titles query per player — which was tolerable
 * for the homepage's twelve active players and decidedly not for the /players
 * board, where it would have been one round trip per row on a roster of eighty.
 * Both recorded-title lookups now come back in a single `.in()`, resolved in
 * memory below.
 */
export async function resolveEquippedTitles(
  playerIds: string[],
): Promise<Map<string, { title: string; rarity: Rarity; source: string } | null>> {
  const results = new Map<string, { title: string; rarity: Rarity; source: string } | null>()
  if (!playerIds.length) return results
  const supabase = createAnonClient()

  const [{ data: players }, { data: recordedRows }] = await Promise.all([
    supabase.from("players").select("id, title").in("id", playerIds),
    supabase
      .from("player_titles")
      .select("player_id, title_id, season_name, title, rarity, earned_at")
      .in("player_id", playerIds)
      // Newest first, so the first match for a title id is the one to show —
      // the same ordering fetchRecordedTitles guarantees per player.
      .order("earned_at", { ascending: false }),
  ])

  const recordedByPlayer = new Map<string, { titleId: string; seasonName: string; title: string; rarity: Rarity }[]>()
  for (const row of (recordedRows ?? []) as {
    player_id: string
    title_id: string
    season_name: string
    title: string
    rarity: string
  }[]) {
    const list = recordedByPlayer.get(row.player_id) ?? []
    list.push({ titleId: row.title_id, seasonName: row.season_name, title: row.title, rarity: row.rarity as Rarity })
    recordedByPlayer.set(row.player_id, list)
  }

  for (const p of (players ?? []) as { id: string; title: string | null }[]) {
    if (!p.title) {
      results.set(p.id, null)
      continue
    }
    // A banked title (player_titles) wins over the catalogue: seasonal titles
    // lapse from the catalogue but stay earned.
    const rec = recordedByPlayer.get(p.id)?.find((t) => t.titleId === p.title)
    results.set(
      p.id,
      rec ? { title: rec.title, rarity: rec.rarity, source: rec.seasonName } : catalogueTitleById(p.title),
    )
  }
  return results
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
