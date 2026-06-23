import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

const MATCH_SELECT =
  "id, red_team, blue_team, red_score, blue_score, match_type, created_at, match_played_at"

// The most recently recorded match on Soracle, with its per-player scoreboard if a
// stats CSV was logged. With ?discordId=, returns that player's last match instead
// (=lg @player). Powers the bot's =lg / /lastgame in-depth view.
export async function GET(request: Request) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  const discordId = new URL(request.url).searchParams.get("discordId")
  const supabase = await createClient()

  let match: Record<string, any> | null = null
  let playerName: string | null = null

  if (discordId) {
    // Resolve the player, then find their most recent match on either team.
    let players
    try {
      players = await fetchPlayersForBot()
    } catch (e) {
      console.error(e)
      return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
    }
    const player = players.find((p) => p.discord_ids?.includes(discordId))
    if (!player) {
      return NextResponse.json({ error: "unlinked" }, { status: 404 })
    }
    playerName = player.name

    const [red, blue] = await Promise.all([
      supabase.from("matches").select(MATCH_SELECT).contains("red_team", [player.name]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
      supabase.from("matches").select(MATCH_SELECT).contains("blue_team", [player.name]).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    ])
    if (red.error || blue.error) {
      console.error(red.error || blue.error)
      return NextResponse.json({ error: "Failed to fetch match" }, { status: 500 })
    }
    match =
      [red.data, blue.data]
        .filter(Boolean)
        .sort((a, b) => new Date((b as any).created_at).getTime() - new Date((a as any).created_at).getTime())[0] || null
  } else {
    const { data, error } = await supabase
      .from("matches")
      .select(MATCH_SELECT)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle()
    if (error) {
      console.error(error)
      return NextResponse.json({ error: "Failed to fetch match" }, { status: 500 })
    }
    match = data
  }

  if (!match) {
    return NextResponse.json({ error: "no_matches" }, { status: 404 })
  }

  const { data: statRows, error: statsError } = await supabase
    .from("match_stats")
    .select("team, captures, returns, kills, deaths, score, in_game_name, players(name)")
    .eq("match_id", match.id)
  if (statsError) {
    console.error(statsError)
    return NextResponse.json({ error: "Failed to fetch match stats" }, { status: 500 })
  }

  const stats = (statRows || []).map((r) => {
    // players(name) comes back as an object or a single-element array depending on
    // the join shape; normalise to a plain name, falling back to the in-game name.
    const joined = r.players as { name: string } | { name: string }[] | null
    const name =
      (Array.isArray(joined) ? joined[0]?.name : joined?.name) || r.in_game_name || "Unknown"
    return {
      name,
      team: r.team as "Red" | "Blue",
      caps: r.captures,
      returns: r.returns,
      kills: r.kills,
      deaths: r.deaths,
      score: r.score,
    }
  })

  const winner =
    match.red_score > match.blue_score
      ? "Red"
      : match.blue_score > match.red_score
        ? "Blue"
        : "Tie"

  return NextResponse.json({
    id: match.id,
    date: match.match_played_at || match.created_at,
    matchType: match.match_type,
    redTeam: match.red_team || [],
    blueTeam: match.blue_team || [],
    redScore: match.red_score,
    blueScore: match.blue_score,
    winner,
    playerName,
    stats,
  })
}
