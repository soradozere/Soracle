import { NextResponse } from "next/server"
import { rankByName } from "@/lib/rank-order"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

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

export async function GET(request: Request, { params }: { params: Promise<{ stat: string }> }) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  const { stat } = await params
  if (!(stat in ALLOWED_STATS)) {
    return NextResponse.json({ error: "unknown stat" }, { status: 400 })
  }
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

function monthLabel(d: Date) {
  return d.toLocaleString("en-GB", { month: "long", year: "numeric" })
}
