import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

// Month-to-date stats for one player, resolved by Discord ID. Powers the
// bot's /stats command. Aggregates match_stats rows whose parent match falls
// in the current calendar month; win/loss comes from the parent match teams.
export async function GET(request: Request, { params }: { params: Promise<{ discordId: string }> }) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  const { discordId } = await params

  let allPlayers
  try {
    allPlayers = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }

  const player = allPlayers.find((p) => p.discord_ids?.includes(discordId))
  if (!player) {
    return NextResponse.json({ error: "unlinked" }, { status: 404 })
  }

  const supabase = await createClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const { data: monthMatches, error: matchError } = await supabase
    .from("matches")
    .select("id, red_team, blue_team, red_score, blue_score, created_at")
    .gte("created_at", monthStart.toISOString())
  if (matchError) {
    console.error(matchError)
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
  }

  const matchById = new Map((monthMatches || []).map((m) => [m.id, m]))
  const matchIds = [...matchById.keys()]

  let statRows: any[] = []
  if (matchIds.length > 0) {
    const { data, error } = await supabase
      .from("match_stats")
      .select(
        "match_id, score, captures, returns, base_cleaner, assists, flag_grabs, flag_hold_ms, kills, deaths, time_played",
      )
      .eq("player_id", player.id)
      .in("match_id", matchIds)
    if (error) {
      console.error(error)
      return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
    }
    statRows = data || []
  }

  const totals = {
    score: 0,
    captures: 0,
    returns: 0,
    baseCleans: 0,
    assists: 0,
    flagGrabs: 0,
    flagHoldMs: 0,
    kills: 0,
    deaths: 0,
    timePlayedMs: 0,
  }
  let wins = 0
  let losses = 0
  let draws = 0
  const results: { at: string; r: "W" | "L" | "D" }[] = []

  for (const row of statRows) {
    totals.score += row.score ?? 0
    totals.captures += row.captures ?? 0
    totals.returns += row.returns ?? 0
    totals.baseCleans += row.base_cleaner ?? 0
    totals.assists += row.assists ?? 0
    totals.flagGrabs += row.flag_grabs ?? 0
    totals.flagHoldMs += row.flag_hold_ms ?? 0
    totals.kills += row.kills ?? 0
    totals.deaths += row.deaths ?? 0
    totals.timePlayedMs += row.time_played ?? 0

    const match = matchById.get(row.match_id)
    if (!match) continue
    const onRed = match.red_team?.includes(player.name)
    const onBlue = match.blue_team?.includes(player.name)
    if (!onRed && !onBlue) continue
    let r: "W" | "L" | "D"
    if (match.red_score === match.blue_score) {
      draws += 1
      r = "D"
    } else if ((match.red_score > match.blue_score) === !!onRed) {
      wins += 1
      r = "W"
    } else {
      losses += 1
      r = "L"
    }
    results.push({ at: match.created_at, r })
  }

  // Chronological W/L/D form (oldest -> newest), capped for the bot's display.
  results.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0))
  const form = results.map((x) => x.r).slice(-20)

  return NextResponse.json({
    name: player.name,
    tier: player.tierValue,
    tooltip: player.tooltip ?? null,
    month: now.toLocaleString("en-GB", { month: "long", year: "numeric" }),
    matches: statRows.length,
    wins,
    losses,
    draws,
    form,
    totals,
  })
}
