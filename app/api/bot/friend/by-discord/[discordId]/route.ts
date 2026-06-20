import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

// A player's best team-mate this month: the player they've won the most games
// alongside (min 2 games together), with the shared record. Resolved by Discord ID.
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
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthLabel = now.toLocaleString("en-GB", { month: "long", year: "numeric" })

  const { data: matches, error } = await supabase
    .from("matches")
    .select("red_team, blue_team, red_score, blue_score")
    .gte("created_at", monthStart.toISOString())
  if (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
  }

  // For each team-mate shared with: games played together, plus wins and losses
  // (their team result is the same as mine, since we were on the same side).
  const together = new Map<string, { games: number; wins: number; losses: number }>()
  for (const match of matches || []) {
    const onRed = (match.red_team || []).includes(me)
    const onBlue = (match.blue_team || []).includes(me)
    if (!onRed && !onBlue) continue
    const myTeamWon = onRed ? match.red_score > match.blue_score : match.blue_score > match.red_score
    const myTeamLost = onRed ? match.blue_score > match.red_score : match.red_score > match.blue_score
    const teammates = (onRed ? match.red_team || [] : match.blue_team || []).filter(
      (n: string) => n !== me,
    )
    for (const mate of teammates) {
      let rec = together.get(mate)
      if (!rec) {
        rec = { games: 0, wins: 0, losses: 0 }
        together.set(mate, rec)
      }
      rec.games++
      if (myTeamWon) rec.wins++
      if (myTeamLost) rec.losses++
    }
  }

  // Best team-mate = most wins together; ties broken by most games together.
  const friend =
    Array.from(together.entries())
      .map(([name, rec]) => ({ name, ...rec }))
      .filter((r) => r.games >= 2)
      .sort((a, b) => (b.wins !== a.wins ? b.wins - a.wins : b.games - a.games))[0] || null

  return NextResponse.json({ name: me, month: monthLabel, friend })
}
