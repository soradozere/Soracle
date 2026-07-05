import { createClient } from "@/lib/supabase/client"
import { applyMatchElo, seedFromTier } from "@/lib/elo"
import type { Player } from "@/lib/types"

// Everything a player profile shows, computed client-side from one pass over
// matches + match_stats (both public-readable). Nothing is persisted — like the
// ELO leaderboard, it's derived fresh on every load.

export interface ProfileMatch {
  id: string
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
  match_type: string | null
  created_at: string
}

// One row of the profile's personal match history (most recent first): the
// match result from this player's perspective, plus their own scoreboard line
// when the match has CSV stats.
export interface ProfileMatchEntry {
  id: string
  date: string
  team: "Red" | "Blue"
  result: "W" | "L" | "D"
  redScore: number
  blueScore: number
  redTeam: string[]
  blueTeam: string[]
  matchType: string | null
  my: {
    score: number
    captures: number
    returns: number
    kills: number
    deaths: number
    flagHoldMs: number
  } | null
}

// The match_stats columns the profile needs (the table has ~40; fetching all of
// them for every match ever played is pointless weight).
interface StatRow {
  match_id: string
  player_id: string
  captures: number
  returns: number
  assists: number
  base_cleaner: number
  flag_grabs: number
  flag_hold_ms: number
  kills: number
  deaths: number
  score: number
}

export interface MonthStatTotals {
  statMatches: number
  captures: number
  returns: number
  assists: number
  baseCleaner: number
  flagGrabs: number
  flagHoldMs: number
  kills: number
  deaths: number
}

export interface MonthRecord {
  label: string
  games: number
  wins: number
  losses: number
  draws: number
  winRate: number | null
  bestStreak: number
  stats: MonthStatTotals | null
}

export interface CareerHigh {
  score: number
  date: string
}

export interface SeriesPoint {
  key: string // "2026-05"
  label: string // "May 26"
  games: number
  wins: number
  losses: number
  draws: number
  winRate: number | null
  elo: number
}

export interface PairRecord {
  name: string
  games: number
  wins: number
  losses: number
  rate: number
}

export interface OppRecord {
  name: string
  meetings: number
  theirWins: number
  myWins: number
  rate: number
}

export type BadgeId = "champion" | "top5" | "top-capper" | "top-kd"

// One earned month of a badge, with the stat that earned it ("2.31 K/D",
// "34 caps", "#3 finish", "1732 ELO") for the badge tooltip.
export interface BadgeEntry {
  month: string
  detail: string
}

export interface ProfileBadge {
  id: BadgeId
  label: string
  entries: BadgeEntry[] // most recent first
}

export interface ProfileTotals {
  games: number
  wins: number
  losses: number
  draws: number
  winRate: number | null
  firstMatch: string | null
  peakElo: number
}

export interface PlayerProfileData {
  aliases: string[]
  currentMonth: MonthRecord
  careerHigh: CareerHigh | null
  series: SeriesPoint[]
  friends: PairRecord[]
  nemeses: OppRecord[]
  badges: ProfileBadge[]
  totals: ProfileTotals
  matches: ProfileMatchEntry[]
}

// ---------------------------------------------------------------------------
// Fetching
// ---------------------------------------------------------------------------

// supabase-js caps a select at 1000 rows; match_stats outgrows that quickly
// (12 rows per match), so page through in chunks.
const PAGE_SIZE = 1000

async function fetchAllRows<T>(table: string, columns: string): Promise<T[]> {
  const supabase = createClient()
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(`Failed to fetch ${table}: ${error.message}`)
    rows.push(...((data ?? []) as T[]))
    if (!data || data.length < PAGE_SIZE) break
  }
  return rows
}

async function fetchAliases(playerId: string): Promise<string[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("player_aliases")
    .select("alias")
    .eq("player_id", playerId)
  if (error) throw new Error(`Failed to fetch aliases: ${error.message}`)
  return (data ?? []).map((r) => r.alias)
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

const monthKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`
}

const monthLabelLong = (key: string) => {
  const [y, m] = key.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "long", year: "numeric" })
}

const monthLabelShort = (key: string) => {
  const [y, m] = key.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleString("en-GB", { month: "short", year: "2-digit" })
}

interface MatchOutcome {
  played: boolean
  won: boolean
  lost: boolean
  teammates: string[]
  opponents: string[]
}

function outcomeFor(name: string, match: ProfileMatch): MatchOutcome {
  const onRed = (match.red_team || []).includes(name)
  const onBlue = (match.blue_team || []).includes(name)
  if (!onRed && !onBlue) {
    return { played: false, won: false, lost: false, teammates: [], opponents: [] }
  }
  const won = onRed ? match.red_score > match.blue_score : match.blue_score > match.red_score
  const lost = onRed ? match.blue_score > match.red_score : match.red_score > match.blue_score
  const mine = onRed ? match.red_team || [] : match.blue_team || []
  const theirs = onRed ? match.blue_team || [] : match.red_team || []
  return { played: true, won, lost, teammates: mine.filter((n) => n !== name), opponents: theirs }
}

// ---------------------------------------------------------------------------
// Monthly honours → badges
// ---------------------------------------------------------------------------

// Same qualifier the Reports tab / monthly leaderboard use: you must have played
// 30% of the month's matches to place on the board.
const MONTHLY_MIN_FRACTION = 0.3

interface MonthlyHonours {
  key: string
  champion: { name: string; elo: number } | null
  top5: { name: string; rank: number; elo: number }[]
  topCapper: { name: string; captures: number } | null
  topKD: { name: string; kd: number } | null
}

// For every COMPLETED month, work out who topped the flat-seeded monthly ELO
// board (champion + top 5), who captured the most flags, and who had the best
// K/D. The current in-progress month never awards — you can't win a month that
// isn't over.
function computeMonthlyHonours(
  matches: ProfileMatch[],
  stats: StatRow[],
  nameById: Map<string, string>,
): MonthlyHonours[] {
  const currentKey = monthKey(new Date().toISOString())

  const matchesByMonth = new Map<string, ProfileMatch[]>()
  for (const match of matches) {
    if (!match.red_team?.length || !match.blue_team?.length) continue
    const key = monthKey(match.created_at)
    if (key >= currentKey) continue
    if (!matchesByMonth.has(key)) matchesByMonth.set(key, [])
    matchesByMonth.get(key)!.push(match)
  }

  const statsByMatch = new Map<string, StatRow[]>()
  for (const row of stats) {
    if (!statsByMatch.has(row.match_id)) statsByMatch.set(row.match_id, [])
    statsByMatch.get(row.match_id)!.push(row)
  }

  const honours: MonthlyHonours[] = []
  for (const [key, monthMatches] of Array.from(matchesByMonth.entries()).sort()) {
    // --- Champion + top 5: flat-seeded ELO over this month only, matching the
    // monthly leaderboard (pure this-month form, no tier inheritance).
    const elo = new Map<string, number>()
    const games = new Map<string, number>()
    for (const match of monthMatches) {
      applyMatchElo(elo, match)
      for (const name of [...match.red_team, ...match.blue_team]) {
        games.set(name, (games.get(name) ?? 0) + 1)
      }
    }
    // applyMatchElo seeds every unseen name at the neutral mid-tier value, so
    // starting from an empty map IS the flat-seeded monthly board.
    const minGames = Math.max(1, Math.ceil(monthMatches.length * MONTHLY_MIN_FRACTION))
    const board = Array.from(elo.entries())
      .filter(([name]) => (games.get(name) ?? 0) >= minGames)
      .sort((a, b) => b[1] - a[1])
      .map(([name, rating], i) => ({ name, rank: i + 1, elo: Math.round(rating) }))

    // --- Top capper / top K/D from CSV stats (only matches that had a CSV count).
    const caps = new Map<string, number>()
    const kd = new Map<string, { kills: number; deaths: number; statMatches: number }>()
    let statMatchCount = 0
    for (const match of monthMatches) {
      const rows = statsByMatch.get(match.id)
      if (!rows?.length) continue
      statMatchCount++
      for (const row of rows) {
        const name = nameById.get(row.player_id)
        if (!name) continue
        caps.set(name, (caps.get(name) ?? 0) + row.captures)
        let rec = kd.get(name)
        if (!rec) {
          rec = { kills: 0, deaths: 0, statMatches: 0 }
          kd.set(name, rec)
        }
        rec.kills += row.kills
        rec.deaths += row.deaths
        rec.statMatches++
      }
    }

    const bestCaps = Array.from(caps.entries())
      .filter(([, total]) => total > 0)
      .sort((a, b) => b[1] - a[1])[0]
    const topCapper = bestCaps ? { name: bestCaps[0], captures: bestCaps[1] } : null

    // K/D needs a floor too, or someone who played one clean match takes it.
    const minStatMatches = Math.max(2, Math.ceil(statMatchCount * MONTHLY_MIN_FRACTION))
    const bestKD = Array.from(kd.entries())
      .filter(([, r]) => r.statMatches >= minStatMatches && r.kills > 0)
      .map(([name, r]) => [name, r.deaths === 0 ? r.kills : r.kills / r.deaths] as const)
      .sort((a, b) => b[1] - a[1])[0]
    const topKD = bestKD ? { name: bestKD[0], kd: bestKD[1] } : null

    honours.push({
      key,
      champion: board[0] ?? null,
      top5: board.slice(0, 5),
      topCapper,
      topKD,
    })
  }

  return honours
}

function badgesFor(name: string, honours: MonthlyHonours[]): ProfileBadge[] {
  // Each collect maps a month's honours to a tooltip entry carrying the stat
  // that earned the badge; null = not earned that month. Most recent first.
  const collect = (pick: (h: MonthlyHonours) => string | null) =>
    honours
      .map((h) => {
        const detail = pick(h)
        return detail === null ? null : { month: monthLabelLong(h.key), detail }
      })
      .filter((e): e is BadgeEntry => e !== null)
      .reverse()

  const champion = collect((h) => (h.champion?.name === name ? `${h.champion.elo} ELO` : null))
  // A champion month is not double-counted as a top-5 finish.
  const top5 = collect((h) => {
    if (h.champion?.name === name) return null
    const place = h.top5.find((p) => p.name === name)
    return place ? `#${place.rank} · ${place.elo} ELO` : null
  })
  const capper = collect((h) => (h.topCapper?.name === name ? `${h.topCapper.captures} caps` : null))
  const kd = collect((h) => (h.topKD?.name === name ? `${h.topKD.kd.toFixed(2)} K/D` : null))

  const badges: ProfileBadge[] = []
  if (champion.length) badges.push({ id: "champion", label: "Player of the Month", entries: champion })
  if (top5.length) badges.push({ id: "top5", label: "Top 5 Finish", entries: top5 })
  if (capper.length) badges.push({ id: "top-capper", label: "Top Capper", entries: capper })
  if (kd.length) badges.push({ id: "top-kd", label: "Top K/D", entries: kd })
  return badges
}

// ---------------------------------------------------------------------------
// Friends & nemeses (all-time versions of the bot's monthly endpoints)
// ---------------------------------------------------------------------------

// All-time floors: try the strict floor first, and relax for players with a
// thin history so the section isn't empty for newer players.
const PAIR_FLOORS = [10, 5, 3, 2]

function topFriends(name: string, matches: ProfileMatch[]): PairRecord[] {
  const together = new Map<string, { games: number; wins: number; losses: number }>()
  for (const match of matches) {
    const o = outcomeFor(name, match)
    if (!o.played) continue
    for (const mate of o.teammates) {
      let rec = together.get(mate)
      if (!rec) {
        rec = { games: 0, wins: 0, losses: 0 }
        together.set(mate, rec)
      }
      rec.games++
      if (o.won) rec.wins++
      if (o.lost) rec.losses++
    }
  }
  const all = Array.from(together.entries()).map(([mate, rec]) => ({
    name: mate,
    ...rec,
    rate: rec.wins / rec.games,
  }))
  for (const floor of PAIR_FLOORS) {
    const qualified = all.filter((r) => r.games >= floor)
    if (qualified.length) {
      return qualified
        .sort((a, b) => (b.rate !== a.rate ? b.rate - a.rate : b.games - a.games))
        .slice(0, 3)
    }
  }
  return []
}

function topNemeses(name: string, matches: ProfileMatch[]): OppRecord[] {
  const h2h = new Map<string, { meetings: number; theirWins: number; myWins: number }>()
  for (const match of matches) {
    const o = outcomeFor(name, match)
    if (!o.played) continue
    for (const opp of o.opponents) {
      let rec = h2h.get(opp)
      if (!rec) {
        rec = { meetings: 0, theirWins: 0, myWins: 0 }
        h2h.set(opp, rec)
      }
      rec.meetings++
      if (o.lost) rec.theirWins++
      if (o.won) rec.myWins++
    }
  }
  const all = Array.from(h2h.entries()).map(([opp, rec]) => ({
    name: opp,
    ...rec,
    rate: rec.theirWins / rec.meetings,
  }))
  for (const floor of PAIR_FLOORS) {
    const qualified = all.filter((r) => r.meetings >= floor)
    if (qualified.length) {
      return qualified
        .sort((a, b) => (b.rate !== a.rate ? b.rate - a.rate : b.meetings - a.meetings))
        .slice(0, 3)
    }
  }
  return []
}

// ---------------------------------------------------------------------------
// Main entry
// ---------------------------------------------------------------------------

export async function loadPlayerProfile(player: Player, allPlayers: Player[]): Promise<PlayerProfileData> {
  const [matches, stats, aliases] = await Promise.all([
    fetchAllRows<ProfileMatch>("matches", "id, red_team, blue_team, red_score, blue_score, match_type, created_at"),
    fetchAllRows<StatRow>(
      "match_stats",
      "match_id, player_id, captures, returns, assists, base_cleaner, flag_grabs, flag_hold_ms, kills, deaths, score",
    ),
    fetchAliases(player.id),
  ])

  const name = player.name
  const nameById = new Map(allPlayers.map((p) => [p.id, p.name]))
  const playable = matches.filter((m) => m.red_team?.length && m.blue_team?.length)

  const nowKey = monthKey(new Date().toISOString())
  const matchDateById = new Map(playable.map((m) => [m.id, m.created_at]))
  const myStats = stats.filter((r) => r.player_id === player.id)

  // --- All-time totals + per-month W/L + all-time tier-seeded ELO, one pass.
  // Matches arrive sorted ascending, so month boundaries are contiguous.
  const elo = new Map<string, number>()
  for (const p of allPlayers) elo.set(p.name, seedFromTier(p.tierValue))

  const byMonth = new Map<string, { games: number; wins: number; losses: number; draws: number; elo: number }>()
  const totals = { games: 0, wins: 0, losses: 0, draws: 0 }
  let peakElo = elo.get(name) ?? seedFromTier(player.tierValue)
  let firstMatch: string | null = null

  for (const match of playable) {
    applyMatchElo(elo, match)
    const rating = elo.get(name) ?? peakElo
    if (rating > peakElo) peakElo = rating

    const key = monthKey(match.created_at)
    let bucket = byMonth.get(key)
    if (!bucket) {
      bucket = { games: 0, wins: 0, losses: 0, draws: 0, elo: rating }
      byMonth.set(key, bucket)
    }
    // Rating after the month's last match = the month-end sample for the graph.
    bucket.elo = rating

    const o = outcomeFor(name, match)
    if (!o.played) continue
    if (!firstMatch) firstMatch = match.created_at
    totals.games++
    bucket.games++
    if (o.won) {
      totals.wins++
      bucket.wins++
    } else if (o.lost) {
      totals.losses++
      bucket.losses++
    } else {
      totals.draws++
      bucket.draws++
    }
  }

  // Series runs from the player's first-ever match to now, including months they
  // sat out (no bar, but the rating line stays continuous).
  const series: SeriesPoint[] = []
  if (firstMatch) {
    const start = new Date(firstMatch)
    const cursor = new Date(start.getFullYear(), start.getMonth(), 1)
    const now = new Date()
    let lastElo = seedFromTier(player.tierValue)
    while (cursor <= now) {
      const key = monthKey(cursor.toISOString())
      const bucket = byMonth.get(key)
      if (bucket) lastElo = bucket.elo
      const games = bucket?.games ?? 0
      const wins = bucket?.wins ?? 0
      series.push({
        key,
        label: monthLabelShort(key),
        games,
        wins,
        losses: bucket?.losses ?? 0,
        draws: bucket?.draws ?? 0,
        winRate: games > 0 ? Math.round((wins / games) * 100) : null,
        elo: Math.round(lastElo),
      })
      cursor.setMonth(cursor.getMonth() + 1)
    }
  }

  // --- Current month record + streak + CSV stat totals.
  const monthMatches = playable.filter((m) => monthKey(m.created_at) === nowKey)
  const current: MonthRecord = {
    label: new Date().toLocaleString("en-GB", { month: "long", year: "numeric" }),
    games: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    winRate: null,
    bestStreak: 0,
    stats: null,
  }
  let streak = 0
  const monthMatchIds = new Set<string>()
  for (const match of monthMatches) {
    monthMatchIds.add(match.id)
    const o = outcomeFor(name, match)
    if (!o.played) continue
    current.games++
    if (o.won) {
      current.wins++
      streak++
      if (streak > current.bestStreak) current.bestStreak = streak
    } else {
      streak = 0
      if (o.lost) current.losses++
      else current.draws++
    }
  }
  current.winRate = current.games > 0 ? Math.round((current.wins / current.games) * 100) : null

  const monthRows = myStats.filter((r) => monthMatchIds.has(r.match_id))
  if (monthRows.length) {
    const sum = (pick: (r: StatRow) => number) => monthRows.reduce((s, r) => s + pick(r), 0)
    current.stats = {
      statMatches: monthRows.length,
      captures: sum((r) => r.captures),
      returns: sum((r) => r.returns),
      assists: sum((r) => r.assists),
      baseCleaner: sum((r) => r.base_cleaner),
      flagGrabs: sum((r) => r.flag_grabs),
      flagHoldMs: sum((r) => r.flag_hold_ms),
      kills: sum((r) => r.kills),
      deaths: sum((r) => r.deaths),
    }
  }

  // --- Career-high single-match score (CSV-covered matches only).
  let careerHigh: CareerHigh | null = null
  for (const row of myStats) {
    if (!careerHigh || row.score > careerHigh.score) {
      careerHigh = { score: row.score, date: matchDateById.get(row.match_id) ?? "" }
    }
  }

  // --- Personal match history (every match they played, most recent first).
  const myStatByMatch = new Map(myStats.map((r) => [r.match_id, r]))
  const matchHistory: ProfileMatchEntry[] = []
  for (const match of playable) {
    const o = outcomeFor(name, match)
    if (!o.played) continue
    const stat = myStatByMatch.get(match.id)
    matchHistory.push({
      id: match.id,
      date: match.created_at,
      team: (match.red_team || []).includes(name) ? "Red" : "Blue",
      result: o.won ? "W" : o.lost ? "L" : "D",
      redScore: match.red_score,
      blueScore: match.blue_score,
      redTeam: match.red_team || [],
      blueTeam: match.blue_team || [],
      matchType: match.match_type,
      my: stat
        ? {
            score: stat.score,
            captures: stat.captures,
            returns: stat.returns,
            kills: stat.kills,
            deaths: stat.deaths,
            flagHoldMs: stat.flag_hold_ms,
          }
        : null,
    })
  }
  matchHistory.reverse() // playable is chronological ascending

  const honours = computeMonthlyHonours(playable, stats, nameById)

  return {
    aliases,
    currentMonth: current,
    careerHigh,
    series,
    friends: topFriends(name, playable),
    nemeses: topNemeses(name, playable),
    badges: badgesFor(name, honours),
    matches: matchHistory,
    totals: {
      ...totals,
      winRate: totals.games > 0 ? Math.round((totals.wins / totals.games) * 100) : null,
      firstMatch,
      peakElo: Math.round(peakElo),
    },
  }
}

// URL slug for a player name: lowercase, spaces → dashes. Resolution compares
// slugs, so "Dark Jedi" ↔ /player/dark-jedi round-trips.
export const playerSlug = (name: string) => encodeURIComponent(name.trim().toLowerCase().replace(/\s+/g, "-"))

export function resolvePlayerSlug(slug: string, players: Player[]): Player | null {
  let decoded: string
  try {
    decoded = decodeURIComponent(slug)
  } catch {
    decoded = slug
  }
  const target = decoded.trim().toLowerCase()
  return players.find((p) => p.name.trim().toLowerCase().replace(/\s+/g, "-") === target) ?? null
}
