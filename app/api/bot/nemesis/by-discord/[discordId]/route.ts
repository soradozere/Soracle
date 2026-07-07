import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

// A player's nemesis this month: the opponent whose teams have beaten them most
// (min 2 meetings), with the head-to-head record. Resolved by Discord ID.
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
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const monthLabel = now.toLocaleString("en-GB", { month: "long", year: "numeric" })

  const { data: matches, error } = await supabase
    .from("matches")
    .select("red_team, blue_team, red_score, blue_score")
    .gte("created_at", monthStart.toISOString())
  if (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
  }

  // For each opponent faced: meetings, plus losses (their team beat mine) and wins.
  const h2h = new Map<string, { meetings: number; theirWins: number; myWins: number }>()
  for (const match of matches || []) {
    const onRed = (match.red_team || []).includes(me)
    const onBlue = (match.blue_team || []).includes(me)
    if (!onRed && !onBlue) continue
    const myTeamWon = onRed ? match.red_score > match.blue_score : match.blue_score > match.red_score
    const theirTeamWon = onRed ? match.blue_score > match.red_score : match.red_score > match.blue_score
    const opponents = onRed ? match.blue_team || [] : match.red_team || []
    for (const opp of opponents) {
      let rec = h2h.get(opp)
      if (!rec) {
        rec = { meetings: 0, theirWins: 0, myWins: 0 }
        h2h.set(opp, rec)
      }
      rec.meetings++
      if (theirTeamWon) rec.theirWins++
      if (myTeamWon) rec.myWins++
    }
  }

  // Nemeses = highest win-rate AGAINST you (not raw volume), min 3 meetings so
  // it's not noise; ties broken by who you've faced more.
  const MIN_MEETINGS = 3
  const ranked = Array.from(h2h.entries())
    .map(([name, rec]) => ({ name, ...rec, rate: rec.theirWins / rec.meetings }))
    .filter((r) => r.meetings >= MIN_MEETINGS)
    .sort((a, b) => (b.rate !== a.rate ? b.rate - a.rate : b.meetings - a.meetings))

  // Top 3 nemeses. `nemesis` kept as the single worst for backwards compatibility
  // with bot versions that predate the top-3 rollout.
  const nemeses = ranked.slice(0, 3)
  const nemesis = nemeses[0] || null

  return NextResponse.json({ name: me, month: monthLabel, nemesis, nemeses })
}
