import { createClient } from "@/lib/supabase/server"
import { computeAchievements, type AchievementView } from "@/lib/achievements"
import type { AchMatch, AchStat } from "@/lib/achievement-meta"

// Server-side achievement computation, for the Discord bot flows (unlock pings +
// =achievements). Reuses the pure computeAchievements over the full history; the
// browser path (lib/player-profile.ts) computes one player at a time, this does
// every player in one pass so we can answer "who unlocked what in match X" and
// "how many players have reached this tier". Runs on approval (infrequent) and
// on the =achievements command, so pulling the whole table each call is fine.

interface ServerMatch {
  id: string
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
  created_at: string
}

// Every AchStat field, straight off match_stats.
interface ServerStat extends AchStat {
  match_id: string
  player_id: string
}

const STAT_COLUMNS =
  "match_id, player_id, score, captures, returns, base_cleaner, kills, deaths, flag_hold_ms, dbs_returns, yellow_kills, turret_kills, mine_returns, blue_returns, upcut_kills, bs_kills, doom_kills, mine_grabs_red, mine_grabs_blue, dfa_kills, dfa_attempts, blocks_enemy, time_played"

const PAGE_SIZE = 1000

async function fetchAll<T>(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: string,
  columns: string,
): Promise<T[]> {
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

export interface PlayerAchievements {
  playerId: string
  name: string
  views: AchievementView[]
}

// Compute every player's achievements in one pass over the full match history.
// Keyed by player id; players with no recorded matches are absent.
export async function computeAllPlayerAchievements(): Promise<Map<string, PlayerAchievements>> {
  const supabase = await createClient()
  const [matches, stats, players] = await Promise.all([
    fetchAll<ServerMatch>(supabase, "matches", "id, red_team, blue_team, red_score, blue_score, created_at"),
    fetchAll<ServerStat>(supabase, "match_stats", STAT_COLUMNS),
    fetchAll<{ id: string; name: string }>(supabase, "players", "id, name, created_at"),
  ])

  const idByName = new Map(players.map((p) => [p.name, p.id]))
  const nameById = new Map(players.map((p) => [p.id, p.name]))

  // stat row per (matchId, playerId)
  const statByKey = new Map<string, ServerStat>()
  for (const s of stats) statByKey.set(`${s.match_id}:${s.player_id}`, s)

  const toAchStat = (s: ServerStat | undefined): AchStat | null =>
    s
      ? {
          score: s.score,
          captures: s.captures,
          returns: s.returns,
          base_cleaner: s.base_cleaner,
          kills: s.kills,
          deaths: s.deaths,
          flag_hold_ms: s.flag_hold_ms,
          dbs_returns: s.dbs_returns,
          yellow_kills: s.yellow_kills,
          turret_kills: s.turret_kills,
          mine_returns: s.mine_returns,
          blue_returns: s.blue_returns,
          upcut_kills: s.upcut_kills,
          bs_kills: s.bs_kills,
          doom_kills: s.doom_kills,
          mine_grabs_red: s.mine_grabs_red,
          mine_grabs_blue: s.mine_grabs_blue,
          dfa_kills: s.dfa_kills,
          dfa_attempts: s.dfa_attempts,
          blocks_enemy: s.blocks_enemy,
          time_played: s.time_played,
        }
      : null

  // Build each player's chronological match sequence in a single pass over
  // matches (ascending), appending an entry to every participant.
  const seqByPlayer = new Map<string, AchMatch[]>()
  for (const m of matches) {
    if (!m.red_team?.length || !m.blue_team?.length) continue
    for (const [team, myScore, oppScore] of [
      [m.red_team, m.red_score, m.blue_score] as const,
      [m.blue_team, m.blue_score, m.red_score] as const,
    ]) {
      for (const name of team) {
        const pid = idByName.get(name)
        if (!pid) continue
        let seq = seqByPlayer.get(pid)
        if (!seq) {
          seq = []
          seqByPlayer.set(pid, seq)
        }
        seq.push({
          matchId: m.id,
          date: m.created_at,
          played: true,
          won: myScore > oppScore,
          lost: oppScore > myScore,
          myScore,
          oppScore,
          stat: toAchStat(statByKey.get(`${m.id}:${pid}`)),
        })
      }
    }
  }

  const result = new Map<string, PlayerAchievements>()
  for (const [pid, seq] of seqByPlayer) {
    result.set(pid, { playerId: pid, name: nameById.get(pid) ?? "Unknown", views: computeAchievements(seq) })
  }
  return result
}

export interface Unlock {
  playerId: string
  playerName: string
  view: AchievementView
  n: number // this player is the Nth to reach this achievement at >= this rank
}

// Achievements freshly unlocked in a specific match: any player whose current
// rank was crossed by exactly that match. `n` = how many players have reached
// at least that rank (the "Nth player to do so").
export async function computeMatchUnlocks(matchId: string): Promise<Unlock[]> {
  const byPlayer = await computeAllPlayerAchievements()

  // Highest earned rank per achievement id, per player — for the N counts.
  const rankByAch = new Map<string, number[]>()
  for (const { views } of byPlayer.values()) {
    for (const v of views) {
      if (!v.earned) continue
      if (!rankByAch.has(v.id)) rankByAch.set(v.id, [])
      rankByAch.get(v.id)!.push(v.rank)
    }
  }

  const unlocks: Unlock[] = []
  for (const { playerId, name, views } of byPlayer.values()) {
    for (const v of views) {
      if (!v.earned || v.earnedMatchId !== matchId) continue
      const ranks = rankByAch.get(v.id) ?? []
      const n = ranks.filter((r) => r >= v.rank).length
      unlocks.push({ playerId, playerName: name, view: v, n })
    }
  }
  // Rarest first so a combined message leads with the biggest flex.
  return unlocks.sort((a, b) => b.view.value - a.view.value)
}
