import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

// Top players by a single match-stat for the current calendar month. Powers bot
// leaderboards like =dbs. Only allow-listed stat columns are queryable.
const ALLOWED_STATS: Record<string, string> = {
  dbs_kills: "DBS kills",
  dbs_returns: "DBS return kills",
  dfa_kills: "DFA kills",
  captures: "captures",
  returns: "returns",
  base_cleaner: "base cleans",
  assists: "assists",
  flag_grabs: "flag grabs",
  kills: "kills",
  score: "score",
}

export async function GET(request: Request, { params }: { params: Promise<{ stat: string }> }) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  const { stat } = await params
  if (!(stat in ALLOWED_STATS)) {
    return NextResponse.json({ error: "unknown stat" }, { status: 400 })
  }

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
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)

  const { data: monthMatches, error: matchError } = await supabase
    .from("matches")
    .select("id")
    .gte("created_at", monthStart.toISOString())
  if (matchError) {
    console.error(matchError)
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
  }

  const matchIds = (monthMatches || []).map((m) => m.id)
  if (matchIds.length === 0) {
    return NextResponse.json({ stat, label: ALLOWED_STATS[stat], month: monthLabel(now), top: [] })
  }

  const { data, error } = await supabase
    .from("match_stats")
    .select(`player_id, ${stat}`)
    .in("match_id", matchIds)
  if (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
  }
  const rows = (data ?? []) as unknown as Array<{ player_id: string } & Record<string, number>>

  const totals = new Map<string, number>()
  for (const row of rows) {
    const value = row[stat] ?? 0
    totals.set(row.player_id, (totals.get(row.player_id) ?? 0) + value)
  }

  const top = [...totals.entries()]
    .map(([id, value]) => ({ name: nameById.get(id) ?? "unknown", value }))
    .filter((r) => r.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, 5)

  return NextResponse.json({ stat, label: ALLOWED_STATS[stat], month: monthLabel(now), top })
}

function monthLabel(d: Date) {
  return d.toLocaleString("en-GB", { month: "long", year: "numeric" })
}
