import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

// Star Player of the Month and top rivalries for the current month — mirrors the
// computations on Soracle's report page (components/reports-tab.tsx) so the bot's
// =potm and =rivals match the website exactly. Derived from match results + tiers
// (no CSV stats needed).
export async function GET(request: Request) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  let players
  try {
    players = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }
  const tierByName = new Map(players.map((p) => [p.name, p.tierValue]))

  const supabase = await createClient()
  const url = new URL(request.url)
  const yearParam = url.searchParams.get("year")
  const monthParam = url.searchParams.get("month")
  const target = yearParam && monthParam ? new Date(Number(yearParam), Number(monthParam) - 1, 1) : new Date()
  const monthStart = new Date(target.getFullYear(), target.getMonth(), 1)
  const monthEnd = new Date(target.getFullYear(), target.getMonth() + 1, 1)
  const monthLabel = target.toLocaleString("en-GB", { month: "long", year: "numeric" })

  const { data: matchesRaw, error } = await supabase
    .from("matches")
    .select("red_team, blue_team, red_score, blue_score, created_at")
    .gte("created_at", monthStart.toISOString())
    .lt("created_at", monthEnd.toISOString())
  if (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch matches" }, { status: 500 })
  }
  const matches = matchesRaw || []
  const totalMatches = matches.length

  // --- Star Player of the Month (upset-weighted average win score) ---
  const starStats = new Map<string, { name: string; wins: number; losses: number; score: number; matches: number }>()
  for (const match of matches) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score
    if (!redWon && !blueWon) continue

    const redTier = (match.red_team || []).reduce((s: number, n: string) => s + (tierByName.get(n) ?? 5), 0)
    const blueTier = (match.blue_team || []).reduce((s: number, n: string) => s + (tierByName.get(n) ?? 5), 0)

    for (const [team, won, tierAdvantage] of [
      [match.red_team, redWon, blueTier - redTier] as const,
      [match.blue_team, blueWon, redTier - blueTier] as const,
    ]) {
      for (const name of team || []) {
        let s = starStats.get(name)
        if (!s) {
          s = { name, wins: 0, losses: 0, score: 0, matches: 0 }
          starStats.set(name, s)
        }
        s.matches++
        if (won) {
          s.wins++
          s.score += tierAdvantage > 0 ? 1.0 + tierAdvantage * 0.1 : Math.max(0.3, 1.0 + tierAdvantage * 0.05)
        } else {
          s.losses++
        }
      }
    }
  }

  const starMinMatches = Math.ceil(totalMatches * 0.35)
  const starPlayer =
    Array.from(starStats.values())
      .filter((p) => p.matches >= starMinMatches)
      .map((p) => ({ ...p, avgScore: p.score / p.matches }))
      .sort((a, b) => (b.avgScore !== a.avgScore ? b.avgScore - a.avgScore : b.matches - a.matches))[0] || null

  // --- Rivalries: pairs most often on opposite teams, with head-to-head ---
  const pairs = new Map<string, { player1: string; player2: string; count: number; player1Wins: number }>()
  for (const match of matches) {
    const redWon = match.red_score > match.blue_score
    for (const redPlayer of match.red_team || []) {
      for (const bluePlayer of match.blue_team || []) {
        const [player1, player2] = [redPlayer, bluePlayer].sort()
        const key = `${player1} vs ${player2}`
        let pair = pairs.get(key)
        if (!pair) {
          pair = { player1, player2, count: 0, player1Wins: 0 }
          pairs.set(key, pair)
        }
        pair.count++
        const player1OnRed = (match.red_team || []).includes(pair.player1)
        if ((player1OnRed && redWon) || (!player1OnRed && match.blue_score > match.red_score)) {
          pair.player1Wins++
        }
      }
    }
  }

  // Rivalry = the most-contested *even* matchup, not just the most-played pair.
  // Among pairs with enough meetings, rank by how close the head-to-head is to
  // 50/50; ties broken by more meetings (a longer even rivalry is more intense).
  const RIVALRY_MIN_MEETINGS = 4
  const closeness = (p: { count: number; player1Wins: number }) =>
    Math.abs(0.5 - p.player1Wins / p.count)
  const rivalries = Array.from(pairs.values())
    .filter((p) => p.count >= RIVALRY_MIN_MEETINGS)
    .sort((a, b) => (closeness(a) !== closeness(b) ? closeness(a) - closeness(b) : b.count - a.count))
    .slice(0, 5)

  // --- Duos: the month's best-winning team-mate pairs ("power couples") ---
  const duoPairs = new Map<string, { player1: string; player2: string; games: number; wins: number }>()
  for (const match of matches) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score
    for (const [team, won] of [
      [match.red_team, redWon] as const,
      [match.blue_team, blueWon] as const,
    ]) {
      const roster = team || []
      for (let i = 0; i < roster.length; i++) {
        for (let j = i + 1; j < roster.length; j++) {
          const [player1, player2] = [roster[i], roster[j]].sort()
          const key = `${player1} & ${player2}`
          let duo = duoPairs.get(key)
          if (!duo) {
            duo = { player1, player2, games: 0, wins: 0 }
            duoPairs.set(key, duo)
          }
          duo.games++
          if (won) duo.wins++
        }
      }
    }
  }

  // Best duo = highest win-RATE together (not raw volume), min 4 games as a pair
  // to match the rivalry floor; ties broken by more games played together.
  const DUO_MIN_GAMES = 4
  const duos = Array.from(duoPairs.values())
    .map((d) => ({ ...d, rate: d.wins / d.games }))
    .filter((d) => d.games >= DUO_MIN_GAMES)
    .sort((a, b) => (b.rate !== a.rate ? b.rate - a.rate : b.games - a.games))
    .slice(0, 5)

  // --- Longest win streaks of the month (chronological) ---
  const sortedMatches = [...matches].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const wonHistory = new Map<string, boolean[]>()
  for (const match of sortedMatches) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score
    for (const [team, won] of [
      [match.red_team, redWon] as const,
      [match.blue_team, blueWon] as const,
    ]) {
      for (const name of team || []) {
        if (!wonHistory.has(name)) wonHistory.set(name, [])
        wonHistory.get(name)!.push(won)
      }
    }
  }
  const streaks = Array.from(wonHistory.entries())
    .map(([name, history]) => {
      let cur = 0
      let max = 0
      for (const won of history) {
        cur = won ? cur + 1 : 0
        if (cur > max) max = cur
      }
      return { name, streak: max }
    })
    .filter((p) => p.streak > 1)
    .sort((a, b) => b.streak - a.streak)
    .slice(0, 5)

  // --- Red vs Blue ---
  const redWins = matches.filter((m) => m.red_score > m.blue_score).length
  const blueWins = matches.filter((m) => m.blue_score > m.red_score).length
  const draws = matches.filter((m) => m.red_score === m.blue_score).length

  return NextResponse.json({
    month: monthLabel,
    starPlayer: starPlayer
      ? {
          name: starPlayer.name,
          wins: starPlayer.wins,
          losses: starPlayer.losses,
          matches: starPlayer.matches,
          avgScore: Number(starPlayer.avgScore.toFixed(2)),
        }
      : null,
    rivalries,
    duos,
    streaks,
    redBlue: { redWins, blueWins, draws, total: totalMatches },
  })
}
