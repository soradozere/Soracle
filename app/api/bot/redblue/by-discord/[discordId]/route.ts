import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

// A player's all-time record split by which base they defended: their W/L/D
// when on the Red team vs the Blue team. Unlike the monthly friend/nemesis
// endpoints this is all-time — red/blue tendency is a career trait and a single
// month is too thin a sample. Resolved by Discord ID.

type MatchRow = {
  red_team: string[] | null
  blue_team: string[] | null
  red_score: number
  blue_score: number
}

const PAGE_SIZE = 1000

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
  const me = player.name

  const supabase = await createClient()

  // All-time, so page through matches (supabase-js caps a select at 1000 rows).
  const matches: MatchRow[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("matches")
      .select("red_team, blue_team, red_score, blue_score")
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) {
      console.error(error)
      return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
    }
    matches.push(...((data ?? []) as MatchRow[]))
    if (!data || data.length < PAGE_SIZE) break
  }

  const red = { games: 0, wins: 0, losses: 0, draws: 0 }
  const blue = { games: 0, wins: 0, losses: 0, draws: 0 }
  for (const match of matches) {
    const onRed = (match.red_team || []).includes(me)
    const onBlue = (match.blue_team || []).includes(me)
    if (!onRed && !onBlue) continue
    const side = onRed ? red : blue
    side.games++
    if (match.red_score === match.blue_score) side.draws++
    else if ((match.red_score > match.blue_score) === onRed) side.wins++
    else side.losses++
  }

  return NextResponse.json({ name: me, red, blue })
}
