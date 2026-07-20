import { createClient } from "@/lib/supabase/client"
import { applyMatchElo, seedFromTier } from "@/lib/elo"
import { BADGE_PRIORITY } from "@/lib/badge-meta"
import {
  computeAchievements,
  resolveSecretHolders,
  secretViewsFor,
  type AchievementView,
  type SecretCandidate,
} from "@/lib/achievements"
import type { AchMatch, AchStat } from "@/lib/achievement-meta"
import type { RecordedTitle } from "@/lib/titles"
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
  dbs_returns: number
  // Extra counters the achievements layer reads (lib/achievements.ts).
  yellow_kills: number
  turret_kills: number
  mine_returns: number
  mine_kills: number
  blue_returns: number
  blubs_returns: number
  blubs_kills: number
  upcut_kills: number
  bs_kills: number
  dbs_kills: number
  red_kills: number
  blue_kills: number
  ydfa_kills: number
  doom_kills: number
  mine_grabs_red: number
  mine_grabs_blue: number
  dfa_kills: number
  dfa_attempts: number
  blocks_enemy: number
  time_played: number | null
  ping_mean: number | null
}

export interface MonthStatTotals {
  statMatches: number
  // Summed scoreboard score for the month — the metric the seasonal titles run on.
  score: number
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

export type BadgeId = "champion" | "star" | "highscore" | "dbs-god" | "top5" | "top-capper" | "top-kd"

// One earned month of a badge, with the stat that earned it ("2.31 K/D",
// "34 caps", "#3 · 12W–4L") for the badge tooltip.
export interface BadgeEntry {
  month: string
  detail: string
}

// Label/colour/icon live in lib/badge-meta.ts (BADGE_META), keyed by id — kept
// out of here so the data layer stays presentation-free.
export interface ProfileBadge {
  id: BadgeId
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
  currentMonth: MonthRecord
  careerHigh: CareerHigh | null
  series: SeriesPoint[]
  friends: PairRecord[]
  nemeses: OppRecord[]
  badges: ProfileBadge[]
  achievements: AchievementView[]
  totals: ProfileTotals
  matches: ProfileMatchEntry[]
  // Seasonal titles this player has banked. Read rather than computed: past
  // seasons are gone from the catalogue, so they can only come from the table.
  recordedTitles: RecordedTitle[]
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

// The full matches + match_stats tables, fetched once and shared. Both
// loadPlayerBadges (every balancer visit) and loadPlayerProfile (every profile
// view, including profile→profile hops) need the complete history, and before
// this cache each of them re-pulled both tables from Supabase. Short TTL keeps
// game-night flows fresh (log match → check stats) while de-duping the
// navigation-heavy paths; a hard reload always refetches.
const MATCH_DATA_TTL_MS = 60_000
let matchDataCache: { at: number; promise: Promise<{ matches: ProfileMatch[]; stats: StatRow[] }> } | null = null

function fetchMatchData(): Promise<{ matches: ProfileMatch[]; stats: StatRow[] }> {
  if (matchDataCache && Date.now() - matchDataCache.at < MATCH_DATA_TTL_MS) {
    return matchDataCache.promise
  }
  const promise = Promise.all([
    fetchAllRows<ProfileMatch>("matches", "id, red_team, blue_team, red_score, blue_score, match_type, created_at"),
    fetchAllRows<StatRow>(
      "match_stats",
      "match_id, player_id, captures, returns, assists, base_cleaner, flag_grabs, flag_hold_ms, kills, deaths, score, dbs_returns, yellow_kills, turret_kills, mine_returns, mine_kills, blue_returns, blubs_returns, blubs_kills, upcut_kills, bs_kills, dbs_kills, red_kills, blue_kills, ydfa_kills, doom_kills, mine_grabs_red, mine_grabs_blue, dfa_kills, dfa_attempts, blocks_enemy, time_played, ping_mean",
    ),
  ]).then(([matches, stats]) => ({ matches, stats }))
  matchDataCache = { at: Date.now(), promise }
  // A failed fetch shouldn't poison the cache for the whole TTL.
  promise.catch(() => {
    if (matchDataCache?.promise === promise) matchDataCache = null
  })
  return promise
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

// Months are bucketed in UTC everywhere, deliberately: this runs in the
// viewer's browser, and local-time bucketing made boundary matches (NA-East
// evenings = early-morning UTC) land in different months per viewer — two
// people could see different monthly champions. UTC matches the server-side
// bot endpoints and the production Stats tab.
const monthKey = (iso: string) => {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
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
  // De-duplicate: a mid-match reconnect can list the same player twice on one team,
  // which would otherwise count as two games played alongside (or against) them.
  return {
    played: true,
    won,
    lost,
    teammates: [...new Set(mine)].filter((n) => n !== name),
    opponents: [...new Set(theirs)].filter((n) => n !== name),
  }
}

// StatRow is a superset of AchStat (it also carries match_id / player_id / flag_grabs),
// so the achievements layer can read a row directly.
const toAchStat = (row: StatRow): AchStat => row

// ---------------------------------------------------------------------------
// Secret one-of-one achievements
// ---------------------------------------------------------------------------

// A one-of-one asks "was anyone earlier?", so it has to see EVERY player's rows, not
// just this profile's. fetchMatchData already pulls both tables in full (recordHolders
// needs them too), so this is a pass over data we're holding anyway — no extra queries.
function secretCandidates(
  matches: ProfileMatch[],
  stats: StatRow[],
  nameById: Map<string, string>,
): SecretCandidate[] {
  const matchById = new Map(matches.map((m) => [m.id, m]))
  const candidates: SecretCandidate[] = []
  for (const row of stats) {
    const match = matchById.get(row.match_id)
    const name = nameById.get(row.player_id)
    if (!match || !name) continue
    const onRed = (match.red_team || []).includes(name)
    const onBlue = (match.blue_team || []).includes(name)
    if (!onRed && !onBlue) continue
    const myScore = onRed ? match.red_score : match.blue_score
    const oppScore = onRed ? match.blue_score : match.red_score
    candidates.push({
      playerId: row.player_id,
      matchId: match.id,
      date: match.created_at,
      ctx: { won: myScore > oppScore, lost: oppScore > myScore, myScore, oppScore },
      stat: toAchStat(row),
    })
  }
  return candidates
}

// ---------------------------------------------------------------------------
// Monthly honours → badges
// ---------------------------------------------------------------------------

// Same qualifier the Reports tab / monthly leaderboard use: you must have played
// 30% of the month's matches to place on the board.
const MONTHLY_MIN_FRACTION = 0.3

interface BoardPlace {
  name: string
  rank: number
  wins: number
  losses: number
  winPct: number
}

interface MonthlyHonours {
  key: string
  champion: BoardPlace | null
  top5: BoardPlace[]
  topCapper: { name: string; captures: number } | null
  topKD: { name: string; kd: number } | null
}

// For every COMPLETED month, work out who topped the public monthly W/L
// leaderboard (champion + top 5), who was Star Player of the Month, who captured
// the most flags, and who had the best K/D. Champion/top-5 deliberately mirror
// Star Player for a set of matches (one month's worth): upset-weighted average
// win value, mirroring the Reports "Star Player of the Month". A win counts for
// more when your team was the underdog (lower combined current-tier) and less
// when favoured; draws are skipped. Qualifier is 35% of the matches. Used for
// both the monthly honours and the live current-month badge.
function computeStarPlayer(
  monthMatches: ProfileMatch[],
  tierByName: Map<string, number>,
): { name: string; wins: number; losses: number; avgScore: number } | null {
  const starStats = new Map<string, { wins: number; losses: number; score: number; matches: number }>()
  for (const match of monthMatches) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score
    if (!redWon && !blueWon) continue
    const redTier = match.red_team.reduce((s, n) => s + (tierByName.get(n) ?? 5), 0)
    const blueTier = match.blue_team.reduce((s, n) => s + (tierByName.get(n) ?? 5), 0)
    for (const [team, won, tierAdvantage] of [
      [match.red_team, redWon, blueTier - redTier] as const,
      [match.blue_team, blueWon, redTier - blueTier] as const,
    ]) {
      for (const name of team) {
        let s = starStats.get(name)
        if (!s) {
          s = { wins: 0, losses: 0, score: 0, matches: 0 }
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
  const starMinMatches = Math.ceil(monthMatches.length * 0.35)
  const bestStar = Array.from(starStats.entries())
    .filter(([, s]) => s.matches >= starMinMatches)
    .map(([name, s]) => ({ name, wins: s.wins, losses: s.losses, matches: s.matches, avgScore: s.score / s.matches }))
    .sort((a, b) => (b.avgScore !== a.avgScore ? b.avgScore - a.avgScore : b.matches - a.matches))[0]
  return bestStar
    ? { name: bestStar.name, wins: bestStar.wins, losses: bestStar.losses, avgScore: bestStar.avgScore }
    : null
}

// the Reports tab's leaderboard — win rate, then total wins, then games played,
// 30% qualifier — NOT the ELO/TrueSkill boards, since W/L is the one the
// community sees. Star Player mirrors the Reports "Star Player of the Month"
// (upset-weighted average win value, using current tiers). The current
// in-progress month never awards — you can't win a month that isn't over.
function computeMonthlyHonours(
  matches: ProfileMatch[],
  stats: StatRow[],
  nameById: Map<string, string>,
  tierByName: Map<string, number>,
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
    // --- Champion + top 5: the month's W/L standings, identical maths to the
    // Reports tab's public leaderboard (draws count as played, not as W or L).
    const records = new Map<string, { wins: number; losses: number; played: number }>()
    for (const match of monthMatches) {
      const redWon = match.red_score > match.blue_score
      const blueWon = match.blue_score > match.red_score
      for (const [team, won, lost] of [
        [match.red_team, redWon, blueWon] as const,
        [match.blue_team, blueWon, redWon] as const,
      ]) {
        for (const name of team) {
          let rec = records.get(name)
          if (!rec) {
            rec = { wins: 0, losses: 0, played: 0 }
            records.set(name, rec)
          }
          rec.played++
          if (won) rec.wins++
          else if (lost) rec.losses++
        }
      }
    }
    const minGames = Math.max(1, Math.ceil(monthMatches.length * MONTHLY_MIN_FRACTION))
    const board: BoardPlace[] = Array.from(records.entries())
      .filter(([, rec]) => rec.played >= minGames)
      .map(([name, rec]) => ({ name, ...rec, winPct: rec.played > 0 ? (rec.wins / rec.played) * 100 : 0 }))
      .sort((a, b) => {
        if (b.winPct !== a.winPct) return b.winPct - a.winPct
        if (b.wins !== a.wins) return b.wins - a.wins
        return b.played - a.played
      })
      .map((p, i) => ({ name: p.name, rank: i + 1, wins: p.wins, losses: p.losses, winPct: p.winPct }))


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

  const record = (p: BoardPlace) => `${p.wins}W–${p.losses}L (${Math.round(p.winPct)}%)`
  const champion = collect((h) => (h.champion?.name === name ? record(h.champion) : null))
  // A champion month is not double-counted as a top-5 finish. (Star Player is a
  // separate metric, so a player CAN hold both Champion and Star in one month.)
  const top5 = collect((h) => {
    if (h.champion?.name === name) return null
    const place = h.top5.find((p) => p.name === name)
    return place ? `#${place.rank} · ${record(place)}` : null
  })
  // Star Player is deliberately NOT collected here: it's a single "current star
  // player" title, awarded live in loadPlayerProfile, not one badge per month.
  const capper = collect((h) => (h.topCapper?.name === name ? `${h.topCapper.captures} caps` : null))
  const kd = collect((h) => (h.topKD?.name === name ? `${h.topKD.kd.toFixed(2)} K/D` : null))

  // Order here is cosmetic (chips render in this order); prestige ordering for
  // the single "best badge" on Player Cards lives in BADGE_PRIORITY.
  const badges: ProfileBadge[] = []
  if (champion.length) badges.push({ id: "champion", entries: champion })
  if (top5.length) badges.push({ id: "top5", entries: top5 })
  if (capper.length) badges.push({ id: "top-capper", entries: capper })
  if (kd.length) badges.push({ id: "top-kd", entries: kd })
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

// All-time, single-holder record badges computed from the full match_stats set:
// High Score = the highest single-match score on record; DBS God = the most
// cumulative DBS returns on record. Each returns the current holder's name +
// tooltip detail, or null if there's no data yet.
function recordHolders(
  stats: StatRow[],
  nameById: Map<string, string>,
): {
  highscore: { name: string; detail: string } | null
  dbsGod: { name: string; detail: string } | null
} {
  let topScore: StatRow | null = null
  const dbsByPlayer = new Map<string, number>()
  for (const r of stats) {
    if (!topScore || r.score > topScore.score) topScore = r
    if (r.dbs_returns) dbsByPlayer.set(r.player_id, (dbsByPlayer.get(r.player_id) ?? 0) + r.dbs_returns)
  }

  let dbsTop: { id: string; total: number } | null = null
  for (const [id, total] of dbsByPlayer) {
    if (!dbsTop || total > dbsTop.total) dbsTop = { id, total }
  }

  return {
    highscore:
      topScore && topScore.score > 0
        ? { name: nameById.get(topScore.player_id) ?? "Unknown player", detail: `${topScore.score} pts` }
        : null,
    dbsGod:
      dbsTop && dbsTop.total > 0
        ? { name: nameById.get(dbsTop.id) ?? "Unknown player", detail: `${dbsTop.total} DBS returns` }
        : null,
  }
}

// Seasonal titles this player has banked (public-readable). Queried here rather
// than via lib/titles-server.ts so this module — which runs in the browser —
// keeps its own client and can't pull a server-only import into the bundle.
async function fetchRecordedTitlesFor(playerId: string): Promise<RecordedTitle[]> {
  const supabase = createClient()
  const { data, error } = await supabase
    .from("player_titles")
    .select("title_id, season_key, season_name, title, rarity, earned_at")
    .eq("player_id", playerId)
    .order("earned_at", { ascending: false })
  // Degrade to "no banked titles" rather than breaking the whole profile —
  // this also keeps profiles rendering before migration 020 is applied.
  if (error) return []
  return (data ?? []).map((r) => ({
    titleId: r.title_id,
    seasonKey: r.season_key,
    seasonName: r.season_name,
    title: r.title,
    rarity: r.rarity,
    earnedAt: r.earned_at,
  }))
}

export async function loadPlayerProfile(player: Player, allPlayers: Player[]): Promise<PlayerProfileData> {
  const [{ matches, stats }, recordedTitles] = await Promise.all([
    fetchMatchData(),
    fetchRecordedTitlesFor(player.id),
  ])

  const name = player.name
  const nameById = new Map(allPlayers.map((p) => [p.id, p.name]))
  const tierByName = new Map(allPlayers.map((p) => [p.name, p.tierValue]))
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
    // Walk months in UTC so cursor keys line up with monthKey's UTC buckets.
    const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1))
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
      cursor.setUTCMonth(cursor.getUTCMonth() + 1)
    }
  }

  // --- Current month record + streak + CSV stat totals.
  const monthMatches = playable.filter((m) => monthKey(m.created_at) === nowKey)
  const current: MonthRecord = {
    label: monthLabelLong(nowKey),
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
      score: sum((r) => r.score),
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

  // --- Achievements: one chronological pass over the player's own matches +
  // scoreboard lines (playable is ascending, so streaks/totals accrue in order).
  const achSeq: AchMatch[] = []
  for (const match of playable) {
    const o = outcomeFor(name, match)
    if (!o.played) continue
    const onRed = (match.red_team || []).includes(name)
    const row = myStatByMatch.get(match.id)
    achSeq.push({
      matchId: match.id,
      date: match.created_at,
      played: true,
      won: o.won,
      lost: o.lost,
      myScore: onRed ? match.red_score : match.blue_score,
      oppScore: onRed ? match.blue_score : match.red_score,
      teammates: o.teammates,
      opponents: o.opponents,
      stat: row ? toAchStat(row) : null,
    })
  }
  // Secret crests are resolved globally, then only the holder is handed a view — so
  // for everyone else they don't exist, and can't leak through the earned/total count.
  const secretHolders = resolveSecretHolders(secretCandidates(playable, stats, nameById))
  const achievements = computeAchievements(achSeq, secretViewsFor(player.id, secretHolders))

  const honours = computeMonthlyHonours(playable, stats, nameById, tierByName)

  // Monthly badges + any all-time record this player currently holds, ordered by
  // prestige (BADGE_PRIORITY) so the chip row matches the Player Cards.
  const records = recordHolders(stats, nameById)
  const currentStar = computeStarPlayer(monthMatches, tierByName)
  const badges = badgesFor(name, honours)
  if (currentStar?.name === name)
    badges.push({
      id: "star",
      entries: [
        {
          month: monthLabelLong(nowKey),
          detail: `${currentStar.wins}W–${currentStar.losses}L · ${currentStar.avgScore.toFixed(2)} win-value`,
        },
      ],
    })
  if (records.highscore?.name === name)
    badges.push({ id: "highscore", entries: [{ month: "On record", detail: records.highscore.detail }] })
  if (records.dbsGod?.name === name)
    badges.push({ id: "dbs-god", entries: [{ month: "On record", detail: records.dbsGod.detail }] })
  badges.sort((a, b) => BADGE_PRIORITY.indexOf(a.id) - BADGE_PRIORITY.indexOf(b.id))

  return {
    currentMonth: current,
    careerHigh,
    series,
    friends: topFriends(name, playable),
    nemeses: topNemeses(name, playable),
    badges,
    achievements,
    matches: matchHistory,
    recordedTitles,
    totals: {
      ...totals,
      winRate: totals.games > 0 ? Math.round((totals.wins / totals.games) * 100) : null,
      firstMatch,
      peakElo: Math.round(peakElo),
    },
  }
}

/**
 * Every badge each player has earned, for the balancer's Player Cards: one pass
 * over all matches + stats computes every month's honours, then each player gets
 * their badges in BADGE_PRIORITY order (most prestigious first). Players with no
 * badge are absent from the map.
 */
export async function loadPlayerBadges(players: Player[]): Promise<Record<string, BadgeId[]>> {
  const { matches, stats } = await fetchMatchData()

  const nameById = new Map(players.map((p) => [p.id, p.name]))
  const tierByName = new Map(players.map((p) => [p.name, p.tierValue]))
  const playable = matches.filter((m) => m.red_team?.length && m.blue_team?.length)
  const honours = computeMonthlyHonours(playable, stats, nameById, tierByName)

  const earned: Record<BadgeId, Set<string>> = {
    champion: new Set(),
    star: new Set(),
    highscore: new Set(),
    "dbs-god": new Set(),
    top5: new Set(),
    "top-capper": new Set(),
    "top-kd": new Set(),
  }
  for (const h of honours) {
    if (h.champion) earned.champion.add(h.champion.name)
    for (const p of h.top5) earned.top5.add(p.name)
    if (h.topCapper) earned["top-capper"].add(h.topCapper.name)
    if (h.topKD) earned["top-kd"].add(h.topKD.name)
  }

  // Star Player is the single CURRENT-month title (not one badge per past month).
  const nowKey = monthKey(new Date().toISOString())
  const currentStar = computeStarPlayer(
    playable.filter((m) => monthKey(m.created_at) === nowKey),
    tierByName,
  )
  if (currentStar) earned.star.add(currentStar.name)

  // All-time record holders (single player each).
  const records = recordHolders(stats, nameById)
  if (records.highscore) earned.highscore.add(records.highscore.name)
  if (records.dbsGod) earned["dbs-god"].add(records.dbsGod.name)

  const byPlayer: Record<string, BadgeId[]> = {}
  for (const player of players) {
    const badges = BADGE_PRIORITY.filter((id) => earned[id].has(player.name))
    if (badges.length) byPlayer[player.name] = badges
  }
  return byPlayer
}

// Turn a pasted Vimeo/YouTube/Streamable link into an embeddable iframe src, or
// null if it isn't a recognised video URL (the profile then shows the raw link
// as a fallback). Handles the common share/watch/short forms of each service.
export function spotlightEmbedUrl(raw: string | null | undefined): string | null {
  if (!raw) return null
  const url = raw.trim()
  if (!url) return null

  // YouTube: youtu.be/ID, watch?v=ID, /embed/ID, /shorts/ID, /live/ID
  const yt =
    url.match(/(?:youtube\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/)|youtu\.be\/)([\w-]{11})/i)
  if (yt) return `https://www.youtube.com/embed/${yt[1]}`

  // Vimeo: vimeo.com/ID, vimeo.com/ID/HASH (unlisted), player.vimeo.com/video/ID
  const vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)(?:\/([\w-]+))?/i)
  if (vimeo) {
    return vimeo[2]
      ? `https://player.vimeo.com/video/${vimeo[1]}?h=${vimeo[2]}`
      : `https://player.vimeo.com/video/${vimeo[1]}`
  }

  // Streamable: streamable.com/CODE (share) or streamable.com/e/CODE (embed)
  const streamable = url.match(/streamable\.com\/(?:e\/)?([a-z0-9]+)/i)
  if (streamable) return `https://streamable.com/e/${streamable[1]}`

  return null
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
