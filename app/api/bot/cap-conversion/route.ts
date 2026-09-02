import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"
import { computeCapConversion } from "@/lib/cap-conversion"

// Cap conversion board for =caps: captures as a share of resolved flag runs,
// for one calendar month.
//
// Scoped to a month like =potm / monthly-aggregates: `?year=&?month=`, or the
// current month with no params. computeCapConversion already takes a matchIds
// filter (the site's Reports tab passes one), and it self-limits to matches the
// kill matrix actually covers — so a month before match_kills existed (9 Aug
// 2026, migration 037) just comes back with a smaller matchCount, never a wrong
// ratio. The bot must not offer a month picker that reaches past that.
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
  // Date.UTC, not new Date(y, m, 1): the local-time constructor lands on the
  // previous month in any positive-UTC-offset zone, so `?month=7` would read
  // June's matches while still printing "July 2026". Matches monthly-aggregates.
  const target =
    yearParam && monthParam
      ? new Date(Date.UTC(Number(yearParam), Number(monthParam) - 1, 1))
      : new Date()
  const monthStart = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), 1))
  const monthEnd = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 1))
  const month = target.toLocaleString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" })

  const { data: monthMatches, error: matchError } = await supabase
    .from("matches")
    .select("id")
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", monthEnd.toISOString())
  if (matchError) {
    console.error(matchError)
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
  }
  const matchIds = (monthMatches ?? []).map((m) => m.id)

  try {
    const { rows, matchCount, carryFloor } = await computeCapConversion(supabase, nameById, matchIds)
    return NextResponse.json({
      month,
      // Matches this month with kill-matrix data behind the ratio — less than
      // the month's total for anything before Aug 2026, which is expected.
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
