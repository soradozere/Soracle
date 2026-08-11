import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"
import { computeCapConversion } from "@/lib/cap-conversion"

// Cap conversion board for =caps: captures as a share of resolved flag runs.
//
// Deliberately its own endpoint rather than another field on monthly-aggregates.
// That route is scoped to a calendar month and reads only match_stats; this one
// spans the whole match_kills history (which starts 9 Aug 2026 and cannot be
// backfilled) and needs the kill matrix. Bolting it on would have meant a month
// filter that silently truncates the only window the data has.
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
    const { rows, matchCount, carryFloor } = await computeCapConversion(supabase, nameById)
    return NextResponse.json({
      // "since tracking began" rather than a month: match_kills has no history
      // before 9 Aug 2026, so a month label would imply data that isn't there.
      window: "since tracking began",
      matchCount,
      carryFloor: Math.ceil(carryFloor),
      top: rows.map((r) => ({
        name: r.name,
        captures: r.captures,
        caught: r.caught,
        carries: r.carries,
        conversion: r.conversion,
      })),
    })
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to compute cap conversion" }, { status: 500 })
  }
}
