import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

// Per-player summed match stats for the current calendar month, plus the month's
// match count. The bot derives leaderboards from this (kills+K/D, caps-per-run,
// player of the month, etc.) without a new endpoint per metric.
export async function GET(request: Request) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  let allPlayers
  try {
    allPlayers = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }
  const nameById = new Map(allPlayers.map((p) => [p.id, p.name]))

  const supabase = await createClient()
  const url = new URL(request.url)
  const yearParam = url.searchParams.get("year")
  const monthParam = url.searchParams.get("month")
  const target = yearParam && monthParam ? new Date(Number(yearParam), Number(monthParam) - 1, 1) : new Date()
  const monthStart = new Date(target.getFullYear(), target.getMonth(), 1)
  const monthEnd = new Date(target.getFullYear(), target.getMonth() + 1, 1)

  const { data: monthMatches, error: matchError } = await supabase
    .from("matches")
    .select("id, red_team, blue_team, red_score, blue_score")
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", monthEnd.toISOString())
  if (matchError) {
    console.error(matchError)
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
  }

  const matchById = new Map((monthMatches || []).map((m) => [m.id, m]))
  const matchIds = [...matchById.keys()]
  const monthLabel = target.toLocaleString("en-GB", { month: "long", year: "numeric" })

  if (matchIds.length === 0) {
    return NextResponse.json({ month: monthLabel, matchCount: 0, players: [] })
  }

  const { data: rows, error } = await supabase
    .from("match_stats")
    .select(
      "match_id, player_id, team, score, captures, returns, base_cleaner, assists, flag_grabs, flag_hold_ms, kills, deaths, dfa_kills, dbs_kills, time_played",
    )
    .in("match_id", matchIds)
  if (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }

  type Agg = {
    name: string
    matches: number
    wins: number
    losses: number
    draws: number
    kills: number
    deaths: number
    captures: number
    returns: number
    baseCleans: number
    assists: number
    flagGrabs: number
    flagHoldMs: number
    dfaKills: number
    dbsKills: number
    score: number
    timePlayed: number
  }
  const byPlayer = new Map<string, Agg>()
  const matchesWithStats = new Set<string>()

  for (const row of rows || []) {
    matchesWithStats.add(row.match_id)
    let agg = byPlayer.get(row.player_id)
    if (!agg) {
      agg = {
        name: nameById.get(row.player_id) ?? "unknown",
        matches: 0, wins: 0, losses: 0, draws: 0,
        kills: 0, deaths: 0, captures: 0, returns: 0, baseCleans: 0,
        assists: 0, flagGrabs: 0, flagHoldMs: 0, dfaKills: 0, dbsKills: 0, score: 0, timePlayed: 0,
      }
      byPlayer.set(row.player_id, agg)
    }
    agg.matches += 1
    agg.kills += row.kills ?? 0
    agg.deaths += row.deaths ?? 0
    agg.captures += row.captures ?? 0
    agg.returns += row.returns ?? 0
    agg.baseCleans += row.base_cleaner ?? 0
    agg.assists += row.assists ?? 0
    agg.flagGrabs += row.flag_grabs ?? 0
    agg.flagHoldMs += row.flag_hold_ms ?? 0
    agg.dfaKills += row.dfa_kills ?? 0
    agg.dbsKills += row.dbs_kills ?? 0
    agg.score += row.score ?? 0
    agg.timePlayed += row.time_played ?? 0

    const match = matchById.get(row.match_id)
    if (match) {
      const onRed = row.team === "Red"
      if (match.red_score === match.blue_score) agg.draws += 1
      else if ((match.red_score > match.blue_score) === onRed) agg.wins += 1
      else agg.losses += 1
    }
  }

  return NextResponse.json({
    month: monthLabel,
    matchCount: matchesWithStats.size,
    players: [...byPlayer.values()],
  })
}
