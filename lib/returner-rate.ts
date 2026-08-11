import type { SupabaseClient } from "@supabase/supabase-js"

/**
 * Returns per minute, counting only the games a player actually spent returning.
 *
 * The plain version — career returns divided by every minute played — turned out
 * to measure role assignment rather than skill. A 6v6 side fields two cappers, a
 * base cleaner, a support and two returners; the first four aren't trying to
 * return, so a few games on cap sink your rate. Measured across August 2026,
 * fetchd returned at 0.09/min in high-flag-hold games and 0.47/min otherwise: a
 * five-fold swing driven entirely by what they were asked to play.
 *
 * So each team's two returners are identified per match and only their games
 * count. Roles are read off the scoreboard:
 *
 *   capper       - most flag hold time
 *   base cleaner - most mine grabs in their OWN base
 *   support      - most mine grabs in the ENEMY base
 *
 * Each player gets a 0-1 involvement score (their share of the team leader in
 * whichever of the three they rank highest), and the two lowest are the
 * returners. Note this keeps the two least-role-involved players rather than
 * excluding the four most involved: teams run two cappers as often as one, so
 * "exclude the single top flag holder" left co-cappers in the pool. It had
 * bizzle credited for games with 13 grabs and 3 caps, half a minute of hold
 * behind the team leader.
 *
 * LIMITATION - mid-game role swaps are invisible. match_stats stores one row of
 * end-of-match totals per player, so someone who capped the first half and
 * returned the second arrives as a single blended row. Nothing distinguishes
 * them from a player who did a bit of both throughout, and the JSON has no time
 * series either. In Aug 2026 the 2nd-vs-3rd boundary was decisive in 30 of 34
 * team-games (median involvement gap 0.49) and close in 4 — that ~12% is where
 * swaps hide. Fixing it properly needs time-sliced stats from the scoreboard.
 *
 * Unlike cap conversion this needs no kill matrix: flag hold, mine grabs and
 * team have been in the CSV since June 2026, so it applies to every past month.
 */

/** Fraction of the top player's returner games needed to make the board. */
export const RETURNER_GAME_FLOOR_FRACTION = 0.3

/** A 6v6 side fields two returners; scaled for short-handed teams. */
const RETURNERS_PER_TEAM = 1 / 3

export interface ReturnerRateRow {
  playerId: string
  name: string
  returns: number
  /** Minutes played across returner games only. */
  minutes: number
  /** Games counted, after role filtering. */
  games: number
  /** Games played in total, including those filtered out. */
  gamesPlayed: number
  /** returns / minutes. */
  perMinute: number
}

export interface ReturnerRate {
  rows: ReturnerRateRow[]
  /** Minimum returner games needed to qualify, for display. */
  gameFloor: number
}

interface StatRow {
  player_id: string
  match_id: string
  team: string | null
  returns: number | null
  time_played: number | null
  flag_hold_ms: number | null
  mine_grabs_red: number | null
  mine_grabs_blue: number | null
}

const PAGE_SIZE = 1000

async function fetchAll<T>(
  build: () => {
    range: (from: number, to: number) => PromiseLike<{
      data: unknown
      error: { message: string } | null
    }>
  },
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
}

/**
 * Pick the returners out of one team's rows for one match.
 *
 * Scores are shares of the team's leader in each role, so a team where nobody
 * touched a mine doesn't have a "support" invented for it — a zero maximum
 * contributes nothing rather than dividing by zero. That case is real: the
 * hand-rebuilt 8 Aug 2026 recovery CSV carries kills and returns but no mine
 * data, and there only the flag-hold term separates anyone.
 */
function pickReturners(rows: StatRow[]): StatRow[] {
  const isRed = (r: StatRow) => (r.team ?? "").toLowerCase() === "red"
  const homeMines = (r: StatRow) => (isRed(r) ? r.mine_grabs_red : r.mine_grabs_blue) ?? 0
  const awayMines = (r: StatRow) => (isRed(r) ? r.mine_grabs_blue : r.mine_grabs_red) ?? 0
  const hold = (r: StatRow) => r.flag_hold_ms ?? 0

  const maxOf = (f: (r: StatRow) => number) => Math.max(...rows.map(f), 0)
  const maxHold = maxOf(hold)
  const maxHome = maxOf(homeMines)
  const maxAway = maxOf(awayMines)

  const involvement = (r: StatRow) =>
    Math.max(
      maxHold > 0 ? hold(r) / maxHold : 0,
      maxHome > 0 ? homeMines(r) / maxHome : 0,
      maxAway > 0 ? awayMines(r) / maxAway : 0,
    )

  const keep = Math.max(1, Math.round(rows.length * RETURNERS_PER_TEAM))
  return [...rows].sort((a, b) => involvement(a) - involvement(b)).slice(0, keep)
}

export async function computeReturnerRate(
  supabase: SupabaseClient,
  nameById: Map<string, string>,
  /** Restrict to these matches (the site is month-scoped). Empty means none. */
  matchIds?: string[],
): Promise<ReturnerRate> {
  if (matchIds?.length === 0) return { rows: [], gameFloor: 0 }

  const stats = await fetchAll<StatRow>(() => {
    const q = supabase
      .from("match_stats")
      .select(
        "player_id, match_id, team, returns, time_played, flag_hold_ms, mine_grabs_red, mine_grabs_blue",
      )
    return matchIds ? q.in("match_id", matchIds) : q
  })
  if (stats.length === 0) return { rows: [], gameFloor: 0 }

  // One bucket per (match, team) — roles are only meaningful within a side.
  const sides = new Map<string, StatRow[]>()
  for (const s of stats) {
    const key = `${s.match_id}|${s.team ?? ""}`
    const bucket = sides.get(key)
    if (bucket) bucket.push(s)
    else sides.set(key, [s])
  }

  interface Agg {
    returns: number
    minutes: number
    games: number
  }
  const returnerGames = new Map<string, Agg>()
  for (const rows of sides.values()) {
    for (const r of pickReturners(rows)) {
      const agg = returnerGames.get(r.player_id) ?? { returns: 0, minutes: 0, games: 0 }
      agg.returns += r.returns ?? 0
      agg.minutes += r.time_played ?? 0
      agg.games++
      returnerGames.set(r.player_id, agg)
    }
  }

  const played = new Map<string, number>()
  for (const s of stats) played.set(s.player_id, (played.get(s.player_id) ?? 0) + 1)

  const all: ReturnerRateRow[] = [...returnerGames.entries()]
    .filter(([, a]) => a.minutes > 0)
    .map(([playerId, a]) => ({
      playerId,
      name: nameById.get(playerId) ?? "unknown",
      returns: a.returns,
      minutes: a.minutes,
      games: a.games,
      gamesPlayed: played.get(playerId) ?? a.games,
      perMinute: a.returns / a.minutes,
    }))

  // Relative floor, matching the other monthly qualifiers: a fixed game count
  // would be meaningless in a month with four matches and trivial in one with
  // sixty. Players keep only about a third of their games after role filtering,
  // so this is measured against returner games, not games played.
  const topGames = all.reduce((max, r) => Math.max(max, r.games), 0)
  const gameFloor = Math.ceil(topGames * RETURNER_GAME_FLOOR_FRACTION)

  const rows = all
    .filter((r) => r.games >= gameFloor)
    .sort((a, b) => b.perMinute - a.perMinute || b.games - a.games)

  return { rows, gameFloor }
}
