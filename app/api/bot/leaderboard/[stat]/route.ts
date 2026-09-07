import { NextResponse } from "next/server"
import { rankByName } from "@/lib/rank-order"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"
import {
  ALL_TIME_MIN_MATCHES,
  MONTHLY_MIN_FRACTION,
  computeProductionBoard,
  type ProductionMatch,
  type ProductionPlayer,
  type ProductionStatRow,
} from "@/lib/production-rating"

// Top players by a single match-stat. Defaults to the current calendar month;
// `?range=all` sums the whole history instead, for stats too rare to fill a
// monthly board (doom kills run about one a week community-wide). Powers bot
// leaderboards like =dbs and =doom. Only allow-listed stat columns are queryable.
const ALLOWED_STATS: Record<string, string> = {
  dbs_kills: "DBS kills",
  dbs_returns: "DBS return kills",
  dfa_kills: "DFA kills",
  dfa_returns: "DFA return kills",
  captures: "captures",
  returns: "returns",
  base_cleaner: "base cleans",
  assists: "assists",
  flag_grabs: "flag grabs",
  kills: "kills",
  score: "score",
  doom_kills: "doom kills",
}

// Stats that carry a companion column alongside the ranked value — shown for
// context, never used for ranking. DFA kills alone doesn't say whether it was
// efficient or spammed; pairing it with attempts (=dfa reads "897 (attempts:
// 1230)") does. Nothing else needs this yet, so it's a lookup rather than a
// blanket second-column fetch.
const COMPANION_STATS: Record<string, string> = {
  dfa_kills: "dfa_attempts",
}

// Stats that aren't a single match_stats column and so get their own code path
// below. They still share the { stat, label, month, top } response shape.
const SPECIAL_STATS: Record<string, string> = {
  matches_played: "matches played",
  impact: "Impact",
}

// Rolling windows for `?period=` on matches_played, measured back from now. Used
// by the bot's /top command. `month` here is a rolling 30 days, deliberately not
// the calendar month the bare endpoint defaults to — `/top month` reads as "the
// last month", not "since the 1st".
const PERIOD_DAYS: Record<string, number> = {
  day: 1,
  week: 7,
  month: 30,
  year: 365,
}

const PERIOD_LABEL: Record<string, string> = {
  day: "the last 24 hours",
  week: "the last 7 days",
  month: "the last 30 days",
  year: "the last 365 days",
}

export async function GET(request: Request, { params }: { params: Promise<{ stat: string }> }) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  const { stat } = await params
  if (!(stat in ALLOWED_STATS) && !(stat in SPECIAL_STATS)) {
    return NextResponse.json({ error: "unknown stat" }, { status: 400 })
  }

  if (stat === "matches_played") return matchesPlayed(request)
  if (stat === "impact") return impact(request)

  const allTime = new URL(request.url).searchParams.get("range") === "all"

  let players
  try {
    players = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }
  const nameById = new Map(players.map((p) => [p.id, p.name]))

  const supabase = await createClient()
  const now = new Date()
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))

  const rangeLabel = allTime ? "all time" : monthLabel(now)

  // All-time wants every match, so skip the id filter entirely rather than
  // building an .in() out of hundreds of UUIDs — that would be a ~10KB query
  // string for no benefit, since every match_stats row qualifies anyway.
  let matchIds: string[] | null = null
  if (!allTime) {
    const { data: monthMatches, error: matchError } = await supabase
      .from("matches")
      .select("id")
      .gte("created_at", monthStart.toISOString())
    if (matchError) {
      console.error(matchError)
      return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
    }
    matchIds = (monthMatches || []).map((m) => m.id)
    if (matchIds.length === 0) {
      return NextResponse.json({ stat, label: ALLOWED_STATS[stat], month: rangeLabel, top: [] })
    }
  }

  // Paged: supabase-js caps a select at 1000 rows and match_stats is already
  // past that all-time, so an unpaged read would silently drop the oldest games
  // and under-count the board.
  const companion = COMPANION_STATS[stat]
  const selectCols = companion ? `player_id, ${stat}, ${companion}` : `player_id, ${stat}`
  const PAGE = 1000
  const totals = new Map<string, number>()
  const companionTotals = new Map<string, number>()
  for (let from = 0; ; from += PAGE) {
    let q = supabase.from("match_stats").select(selectCols).range(from, from + PAGE - 1)
    if (matchIds) q = q.in("match_id", matchIds)
    const { data, error } = await q
    if (error) {
      console.error(error)
      return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
    }
    const rows = (data ?? []) as unknown as Array<{ player_id: string } & Record<string, number>>
    for (const row of rows) {
      totals.set(row.player_id, (totals.get(row.player_id) ?? 0) + (row[stat] ?? 0))
      if (companion) {
        companionTotals.set(row.player_id, (companionTotals.get(row.player_id) ?? 0) + (row[companion] ?? 0))
      }
    }
    if (rows.length < PAGE) break
  }

  const top = [...totals.entries()]
    .map(([id, value]) => ({
      name: nameById.get(id) ?? "unknown",
      value,
      ...(companion ? { companion: companionTotals.get(id) ?? 0 } : {}),
    }))
    .filter((r) => r.value > 0)
    .sort(rankByName((a, b) => b.value - a.value))
    .slice(0, 5)

  return NextResponse.json({ stat, label: ALLOWED_STATS[stat], month: rangeLabel, top })
}

/**
 * matches_played — how many matches each player appears in, by team membership on
 * the matches table (the canonical record of who played, unlike match_stats which
 * needs a scoreboard upload). Defaults to the current calendar month like the
 * column stats; `?range=all` counts every match; `?period=day|week|month|year`
 * counts a rolling window back from now, for the bot's /top command.
 */
async function matchesPlayed(request: Request) {
  const url = new URL(request.url)
  const allTime = url.searchParams.get("range") === "all"
  const period = url.searchParams.get("period")
  if (period !== null && !(period in PERIOD_DAYS)) {
    return NextResponse.json({ error: "period must be one of day, week, month, year" }, { status: 400 })
  }

  let players
  try {
    players = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }
  // Only roster names are ranked, so a guest or a since-renamed alias in an old
  // red_team/blue_team array doesn't show up as its own leaderboard row.
  const known = new Set(players.map((p) => p.name))

  const now = new Date()
  let since: Date | null = null
  let label: string
  if (period) {
    since = new Date(now.getTime() - PERIOD_DAYS[period] * 24 * 60 * 60 * 1000)
    label = PERIOD_LABEL[period]
  } else if (allTime) {
    label = "all time"
  } else {
    since = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
    label = monthLabel(now)
  }

  const supabase = await createClient()
  const PAGE = 1000
  const counts = new Map<string, number>()
  // Ordered on id (unique) so .range() paging is stable across statements.
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("matches")
      .select("red_team, blue_team")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (since) q = q.gte("created_at", since.toISOString())
    const { data, error } = await q
    if (error) {
      console.error(error)
      return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
    }
    const rows = (data ?? []) as Array<{ red_team: string[] | null; blue_team: string[] | null }>
    for (const row of rows) {
      for (const name of [...(row.red_team ?? []), ...(row.blue_team ?? [])]) {
        if (!known.has(name)) continue
        counts.set(name, (counts.get(name) ?? 0) + 1)
      }
    }
    if (rows.length < PAGE) break
  }

  const top = [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .filter((r) => r.value > 0)
    .sort(rankByName((a, b) => b.value - a.value))
    .slice(0, 5)

  return NextResponse.json({ stat: "matches_played", label: SPECIAL_STATS.matches_played, month: label, top })
}

/**
 * impact — the site's Impact board rating (lib/production-rating.ts), the same
 * number that feeds tier calibration. `?range=all` builds the all-time board and
 * is the intended call: impact is a current standing, not a monthly total, so
 * "all" here means "as it stands now". Without it, the current calendar month.
 *
 * The whole sorted pool is returned, not a top-5 — the bot paginates =impact
 * locally, ten at a time.
 */
async function impact(request: Request) {
  const allTime = new URL(request.url).searchParams.get("range") === "all"
  const now = new Date()

  let botPlayers
  try {
    botPlayers = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }
  const players: ProductionPlayer[] = botPlayers.map((p) => ({
    id: p.id,
    name: p.name,
    tier_value: p.tierValue ?? null,
  }))

  const supabase = await createClient()
  const PAGE = 1000

  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const matches: Array<ProductionMatch & { created_at: string }> = []
  for (let from = 0; ; from += PAGE) {
    let q = supabase
      .from("matches")
      .select("id, red_team, blue_team, red_score, blue_score, created_at")
      .order("id", { ascending: true })
      .range(from, from + PAGE - 1)
    if (!allTime) q = q.gte("created_at", monthStart.toISOString())
    const { data, error } = await q
    if (error) {
      console.error(error)
      return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
    }
    const rows = (data ?? []) as Array<ProductionMatch & { created_at: string }>
    matches.push(...rows)
    if (rows.length < PAGE) break
  }
  const playedMatches = matches.filter((m) => m.red_team?.length && m.blue_team?.length)

  const monthIds = playedMatches.map((m) => m.id)
  const statRows: ProductionStatRow[] = []
  if (allTime || monthIds.length > 0) {
    const cols =
      "match_id, player_id, team, captures, flag_grabs, flag_hold_ms, returns, assists, base_cleaner, " +
      "mine_kills, mine_grabs_red, mine_grabs_blue, mine_returns, time_played"
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from("match_stats").select(cols).order("id", { ascending: true }).range(from, from + PAGE - 1)
      if (!allTime) q = q.in("match_id", monthIds)
      const { data, error } = await q
      if (error) {
        console.error(error)
        return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
      }
      const rows = (data ?? []) as unknown as ProductionStatRow[]
      statRows.push(...rows)
      if (rows.length < PAGE) break
    }
  }

  const board = computeProductionBoard(
    playedMatches,
    statRows,
    players,
    allTime ? { minGames: ALL_TIME_MIN_MATCHES } : { minGamesFraction: MONTHLY_MIN_FRACTION },
  )

  // board.rows is already sorted best-first (production + W/L adjustment, then
  // games, then name); `rating` is that same quantity on a 50/12 scale, so
  // handing back the rows in order preserves the board's order.
  //
  // `matches` is the count that fed the rating (statted games only — impact is a
  // per-match total averaged over matches played, and this is that denominator).
  // `wins`/`losses` are over every match in scope, statted or not, so they can
  // sum past `matches`. `role` is the board's own detected main role for the
  // period (detectRole in lib/production-rating.ts): cap | base | returns | support.
  const top = board.rows.map((r) => ({
    name: r.name,
    value: r.rating,
    matches: r.games,
    role: r.mainRole,
    wins: r.wins,
    losses: r.losses,
  }))

  return NextResponse.json({
    stat: "impact",
    label: SPECIAL_STATS.impact,
    month: allTime ? "current" : monthLabel(now),
    top,
  })
}

function monthLabel(d: Date) {
  return d.toLocaleString("en-GB", { month: "long", year: "numeric" })
}
