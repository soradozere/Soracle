import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

// A player's kill-matchup boards this month, for the bot's =owneds command.
// The scoreboard CSVs only carry per-match kill totals (no killer→victim data),
// so "owning" someone = out-fragging them across the stat-tracked matches you
// both played in, ranked by total kill differential. Two top-3 lists: opponents
// you're dominating ("owned") and opponents dominating you ("ownedBy").
// Resolved by Discord ID; mirrors the nemesis/friend endpoints.
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
  const nameById = new Map(allPlayers.map((p) => [p.id, p.name]))

  const supabase = await createClient()
  const now = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const monthLabel = now.toLocaleString("en-GB", { month: "long", year: "numeric" })

  const { data: matches, error: matchError } = await supabase
    .from("matches")
    .select("id, red_team, blue_team")
    .gte("created_at", monthStart.toISOString())
  if (matchError) {
    console.error(matchError)
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
  }

  // Only matches I actually played in can contribute to a matchup.
  const myMatches = (matches || []).filter(
    (m) => (m.red_team || []).includes(me) || (m.blue_team || []).includes(me),
  )
  const myMatchIds = myMatches.map((m) => m.id)

  let statRows: { match_id: string; player_id: string; kills: number }[] = []
  if (myMatchIds.length > 0) {
    const { data, error } = await supabase
      .from("match_stats")
      .select("match_id, player_id, kills")
      .in("match_id", myMatchIds)
    if (error) {
      console.error(error)
      return NextResponse.json({ error: "Failed to fetch stats" }, { status: 500 })
    }
    statRows = data || []
  }

  const killsByMatch = new Map<string, Map<string, number>>()
  for (const row of statRows) {
    const name = nameById.get(row.player_id)
    if (!name) continue
    if (!killsByMatch.has(row.match_id)) killsByMatch.set(row.match_id, new Map())
    killsByMatch.get(row.match_id)!.set(name, row.kills || 0)
  }

  // Accumulate my kills vs each opponent's kills over the stat-tracked matches
  // we shared. Matches where either side has no scoreboard row are skipped so
  // the comparison stays like-for-like.
  const matchups = new Map<string, { games: number; myKills: number; theirKills: number }>()
  for (const match of myMatches) {
    const kills = killsByMatch.get(match.id)
    if (!kills || !kills.has(me)) continue
    const myKills = kills.get(me)!
    const onRed = (match.red_team || []).includes(me)
    const opponents = onRed ? match.blue_team || [] : match.red_team || []
    for (const opp of opponents) {
      if (!kills.has(opp)) continue
      let rec = matchups.get(opp)
      if (!rec) {
        rec = { games: 0, myKills: 0, theirKills: 0 }
        matchups.set(opp, rec)
      }
      rec.games++
      rec.myKills += myKills
      rec.theirKills += kills.get(opp)!
    }
  }

  // Min 2 shared games so a single lopsided match doesn't crown anyone; ties on
  // differential broken by who you've shared more games with.
  const MIN_GAMES = 2
  const ranked = Array.from(matchups.entries())
    .map(([name, rec]) => ({ name, ...rec, diff: rec.myKills - rec.theirKills }))
    .filter((r) => r.games >= MIN_GAMES)

  const owned = ranked
    .filter((r) => r.diff > 0)
    .sort((a, b) => (b.diff !== a.diff ? b.diff - a.diff : b.games - a.games))
    .slice(0, 3)
  const ownedBy = ranked
    .filter((r) => r.diff < 0)
    .sort((a, b) => (a.diff !== b.diff ? a.diff - b.diff : b.games - a.games))
    .slice(0, 3)

  return NextResponse.json({ name: me, month: monthLabel, owned, ownedBy })
}
