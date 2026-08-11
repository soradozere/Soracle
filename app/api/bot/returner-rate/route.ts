import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"
import { computeReturnerRate } from "@/lib/returner-rate"

// Returns per minute over returner games only, for =rets. Defaults to the
// current month to match the other monthly boards; ?range=all spans everything.
//
// Its own endpoint rather than a field on monthly-aggregates because the role
// filter needs per-match rows grouped by side (flag hold and mine grabs decide
// who was returning), and monthly-aggregates has already summed those away.
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

  try {
    const supabase = await createClient()
    const url = new URL(request.url)
    const allTime = url.searchParams.get("range") === "all"

    let matchIds: string[] | undefined
    let label = "all time"
    if (!allTime) {
      const now = new Date()
      const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
      const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))
      const { data: monthMatches, error } = await supabase
        .from("matches")
        .select("id")
        .gte("created_at", monthStart.toISOString())
        .lt("created_at", monthEnd.toISOString())
      if (error) {
        console.error(error)
        return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
      }
      matchIds = (monthMatches || []).map((m) => m.id)
      label = monthStart.toLocaleString("en-GB", { month: "long", year: "numeric" })
    }

    const { rows, gameFloor } = await computeReturnerRate(supabase, nameById, matchIds)
    return NextResponse.json({
      month: label,
      gameFloor,
      top: rows.map((r) => ({
        name: r.name,
        returns: r.returns,
        minutes: r.minutes,
        games: r.games,
        gamesPlayed: r.gamesPlayed,
        perMinute: r.perMinute,
      })),
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to compute returner rate" }, { status: 500 })
  }
}
