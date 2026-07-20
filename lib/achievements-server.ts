import { createAnonClient } from "@/lib/supabase/anon"
import {
  computeAchievements,
  resolveSecretHolders,
  secretViewsFor,
  unlockEventsFor,
  type AchievementView,
  type SecretCandidate,
  type SecretHolder,
  type UnlockEvent,
} from "@/lib/achievements"
import {
  ACHIEVEMENTS,
  RARITY_META,
  SECRET_ACHIEVEMENTS,
  SECRET_RARITY,
  type AchMatch,
  type AchStat,
  type Rarity,
} from "@/lib/achievement-meta"
import { RARITY_ORDER, bestRarity, scoreFor } from "@/lib/achievement-score"
import { roman } from "@/lib/achievement-format"

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
  "match_id, player_id, score, captures, returns, base_cleaner, assists, kills, deaths, flag_hold_ms, dbs_returns, yellow_kills, turret_kills, mine_returns, mine_kills, blue_returns, blubs_returns, blubs_kills, upcut_kills, bs_kills, dbs_kills, red_kills, blue_kills, ydfa_kills, doom_kills, mine_grabs_red, mine_grabs_blue, dfa_kills, dfa_attempts, blocks_enemy, time_played, ping_mean"

const PAGE_SIZE = 1000

async function fetchAll<T>(
  supabase: ReturnType<typeof createAnonClient>,
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

// The whole history, reshaped into what every achievement computation needs: each
// player's chronological match sequence, their name, and the resolved one-of-one
// holders. Built once and shared, because the three table reads behind it are the
// expensive part — the pure passes over the result are not.
interface PlayerMeta {
  name: string
  tierValue: number
  avatarUrl: string | null
  manuallyInactive: boolean
}

interface HistoryIndex {
  seqByPlayer: Map<string, AchMatch[]>
  nameById: Map<string, string>
  metaById: Map<string, PlayerMeta>
  holders: Map<string, SecretHolder>
}

async function buildHistoryIndex(): Promise<HistoryIndex> {
  // Anon, not the cookie-backed server client: every one of these reads is public
  // and identical for all callers, and reading cookies would force the pages that
  // depend on this to re-render per request instead of honouring `revalidate`.
  const supabase = createAnonClient()
  const [matches, stats, players] = await Promise.all([
    fetchAll<ServerMatch>(supabase, "matches", "id, red_team, blue_team, red_score, blue_score, created_at"),
    fetchAll<ServerStat>(supabase, "match_stats", STAT_COLUMNS),
    // tier_value / avatar_url / manually_inactive ride along for the /players
    // board: same row, same round-trip, and the achievement passes ignore them.
    fetchAll<{
      id: string
      name: string
      tier_value: number
      avatar_url: string | null
      manually_inactive: boolean | null
    }>(supabase, "players", "id, name, created_at, tier_value, avatar_url, manually_inactive"),
  ])

  const idByName = new Map(players.map((p) => [p.name, p.id]))
  const nameById = new Map(players.map((p) => [p.id, p.name]))
  const metaById = new Map<string, PlayerMeta>(
    players.map((p) => [
      p.id,
      {
        name: p.name,
        tierValue: p.tier_value,
        avatarUrl: p.avatar_url ?? null,
        manuallyInactive: !!p.manually_inactive,
      },
    ]),
  )

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
          assists: s.assists,
          kills: s.kills,
          deaths: s.deaths,
          flag_hold_ms: s.flag_hold_ms,
          dbs_returns: s.dbs_returns,
          yellow_kills: s.yellow_kills,
          turret_kills: s.turret_kills,
          mine_returns: s.mine_returns,
          mine_kills: s.mine_kills,
          blue_returns: s.blue_returns,
          blubs_returns: s.blubs_returns,
          blubs_kills: s.blubs_kills,
          upcut_kills: s.upcut_kills,
          bs_kills: s.bs_kills,
          dbs_kills: s.dbs_kills,
          red_kills: s.red_kills,
          blue_kills: s.blue_kills,
          ydfa_kills: s.ydfa_kills,
          doom_kills: s.doom_kills,
          mine_grabs_red: s.mine_grabs_red,
          mine_grabs_blue: s.mine_grabs_blue,
          dfa_kills: s.dfa_kills,
          dfa_attempts: s.dfa_attempts,
          blocks_enemy: s.blocks_enemy,
          time_played: s.time_played,
          ping_mean: s.ping_mean,
        }
      : null

  // Build each player's chronological match sequence in a single pass over
  // matches (ascending), appending an entry to every participant. The same pass
  // collects the flat (player, match, stat) rows that the one-of-one crests are
  // resolved from — they ask "was anyone earlier?", which no single player's
  // sequence can answer.
  const seqByPlayer = new Map<string, AchMatch[]>()
  const candidates: SecretCandidate[] = []
  for (const m of matches) {
    if (!m.red_team?.length || !m.blue_team?.length) continue
    for (const [team, other, myScore, oppScore] of [
      [m.red_team, m.blue_team, m.red_score, m.blue_score] as const,
      [m.blue_team, m.red_team, m.blue_score, m.red_score] as const,
    ]) {
      // De-duplicate both rosters: a mid-match reconnect lists the same player
      // twice on a team, which would push two sequence entries for one match
      // (double-counting every careerSum) and count them twice as a team-mate.
      const mine = [...new Set(team)]
      const theirs = [...new Set(other)]
      for (const name of mine) {
        const pid = idByName.get(name)
        if (!pid) continue
        let seq = seqByPlayer.get(pid)
        if (!seq) {
          seq = []
          seqByPlayer.set(pid, seq)
        }
        const stat = toAchStat(statByKey.get(`${m.id}:${pid}`))
        const won = myScore > oppScore
        const lost = oppScore > myScore
        seq.push({
          matchId: m.id,
          date: m.created_at,
          played: true,
          won,
          lost,
          myScore,
          oppScore,
          teammates: mine.filter((n) => n !== name),
          opponents: theirs.filter((n) => n !== name),
          stat,
        })
        if (stat) {
          candidates.push({
            playerId: pid,
            matchId: m.id,
            date: m.created_at,
            ctx: { won, lost, myScore, oppScore },
            stat,
          })
        }
      }
    }
  }

  return { seqByPlayer, nameById, metaById, holders: resolveSecretHolders(candidates) }
}

// Compute every player's achievements in one pass over the full match history.
// Keyed by player id; players with no recorded matches are absent.
export async function computeAllPlayerAchievements(): Promise<Map<string, PlayerAchievements>> {
  const { seqByPlayer, nameById, holders } = await buildHistoryIndex()

  const result = new Map<string, PlayerAchievements>()
  for (const [pid, seq] of seqByPlayer) {
    result.set(pid, {
      playerId: pid,
      name: nameById.get(pid) ?? "Unknown",
      views: computeAchievements(seq, secretViewsFor(pid, holders)),
    })
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
// at least that rank (the "Nth player to do so"). Secret one-of-one crests fall
// out of this for free — their view carries `earned` and the claiming matchId,
// and only one player is ever handed one, so `n` is always 1.
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
  // Rarest first so a combined message leads with the biggest flex. Rarity, not raw
  // value: a One of One has value 1 and would otherwise sort below a 250-kill Rambo.
  return unlocks.sort((a, b) => {
    const r = RARITY_META[b.view.rarity].order - RARITY_META[a.view.rarity].order
    return r || b.view.value - a.view.value
  })
}

// ---------------------------------------------------------------------------
// Achievement ledger — the public /achievements pages
// ---------------------------------------------------------------------------

// One player crossing one rank. The ledger is the flat list of every one of these
// that has ever happened, which is what "who holds this, and who got there first"
// is answered from.
export interface LedgerEntry extends UnlockEvent {
  playerId: string
  playerName: string
}

export interface AchievementLedger {
  // Keyed by achievement id, chronological. Families nobody has touched are absent.
  byAchievement: Map<string, LedgerEntry[]>
  // Every entry, most recent first — the "latest earned" feed reads off the front.
  recent: LedgerEntry[]
  // One-of-ones that have actually been claimed. Unclaimed ones are deliberately
  // absent: the page publishes a sealed count, never a condition (see the vault).
  claimedSecrets: LedgerEntry[]
  playerCount: number
}

// Two players can cross the same rank in the same match, so date alone doesn't
// order them. Same total, stable rule as the one-of-one tiebreak in
// lib/achievements.ts — the "3rd to reach this" ordinals must not reshuffle
// between renders.
function compareEntries(a: LedgerEntry, b: LedgerEntry): number {
  const t = Date.parse(a.date) - Date.parse(b.date)
  if (t) return t
  if (a.matchId !== b.matchId) return a.matchId < b.matchId ? -1 : 1
  if (a.rank !== b.rank) return a.rank - b.rank
  return a.playerId < b.playerId ? -1 : a.playerId > b.playerId ? 1 : 0
}

// Every rank ever crossed, by every player, over the full history. Same three
// table reads as computeAllPlayerAchievements — the extra work is a pure pass.
export async function computeAchievementLedger(): Promise<AchievementLedger> {
  const { seqByPlayer, nameById, holders } = await buildHistoryIndex()

  const all: LedgerEntry[] = []
  for (const [playerId, seq] of seqByPlayer) {
    const playerName = nameById.get(playerId) ?? "Unknown"
    for (const def of ACHIEVEMENTS) {
      for (const ev of unlockEventsFor(def, seq)) all.push({ ...ev, playerId, playerName })
    }
  }

  // Claimed one-of-ones aren't rank crossings, so they don't come out of
  // unlockEventsFor — they're resolved globally, first-past-the-post.
  const claimedSecrets: LedgerEntry[] = []
  for (const def of SECRET_ACHIEVEMENTS) {
    const holder = holders.get(def.id)
    if (!holder) continue
    claimedSecrets.push({
      achId: def.id,
      rank: 1,
      totalRanks: 1,
      rarity: SECRET_RARITY,
      title: def.title,
      date: holder.date,
      matchId: holder.matchId,
      playerId: holder.playerId,
      playerName: nameById.get(holder.playerId) ?? "Unknown",
    })
  }
  all.push(...claimedSecrets)

  all.sort(compareEntries)

  const byAchievement = new Map<string, LedgerEntry[]>()
  for (const e of all) {
    let list = byAchievement.get(e.achId)
    if (!list) {
      list = []
      byAchievement.set(e.achId, list)
    }
    list.push(e)
  }

  return {
    byAchievement,
    recent: [...all].reverse(),
    claimedSecrets: claimedSecrets.sort(compareEntries),
    playerCount: seqByPlayer.size,
  }
}

// ---------------------------------------------------------------------------
// Players directory
// ---------------------------------------------------------------------------

// One row of the /players board. Everything here comes off the same three table
// reads the ledger uses, so the board costs no extra round-trips.
export interface PlayerRow {
  id: string
  name: string
  tierValue: number
  avatarUrl: string | null
  score: number
  unlocks: number
  best: Rarity | null
  // The rarest crest the player holds, named — the board's Title column. Ties on
  // rarity go to the higher rank, then the earlier unlock.
  title: string | null
  rarityCounts: Record<Rarity, number>
  // Most recent first, capped at FORM_WINDOW — the pip row on the board.
  form: ("W" | "L" | "D")[]
  formWins: number
  formLosses: number
  matches: number
  lastPlayed: string | null
  inactive: boolean
}

const FORM_WINDOW = 5

// Mirrors isPlayerInactive in lib/fetch-players-db.ts. Duplicated rather than
// imported because that module builds a browser Supabase client at import time,
// which a server component must not pull in.
const INACTIVE_DAYS = 27

// The board in one pass: achievement score per player plus their recent form.
// Players who have never played are omitted — they'd be an empty row with a
// zero score and no form, which says nothing.
export async function computePlayersDirectory(): Promise<PlayerRow[]> {
  const { seqByPlayer, metaById, holders } = await buildHistoryIndex()

  const inactiveBefore = Date.now() - INACTIVE_DAYS * 86_400_000
  const rows: PlayerRow[] = []
  for (const [pid, seq] of seqByPlayer) {
    const meta = metaById.get(pid)
    if (!meta) continue

    const rarities: Rarity[] = []
    let topEvent: { rarity: Rarity; rank: number; date: string; label: string } | null = null
    for (const def of ACHIEVEMENTS) {
      for (const ev of unlockEventsFor(def, seq)) {
        rarities.push(ev.rarity)
        // A rank without its own bespoke title reuses the family name, so a
        // tiered one needs its numeral back to be distinguishable ("On Fire II"
        // rather than a second "On Fire").
        const label =
          ev.totalRanks > 1 && ev.title === def.title ? `${ev.title} ${roman(ev.rank)}` : ev.title
        if (
          !topEvent ||
          RARITY_META[ev.rarity].order > RARITY_META[topEvent.rarity].order ||
          (ev.rarity === topEvent.rarity &&
            (ev.rank > topEvent.rank || (ev.rank === topEvent.rank && ev.date < topEvent.date)))
        ) {
          topEvent = { rarity: ev.rarity, rank: ev.rank, date: ev.date, label }
        }
      }
    }
    // A claimed one-of-one outranks everything, so it takes the title outright.
    for (const def of SECRET_ACHIEVEMENTS) {
      if (holders.get(def.id)?.playerId !== pid) continue
      rarities.push(SECRET_RARITY)
      topEvent = { rarity: SECRET_RARITY, rank: 1, date: holders.get(def.id)!.date, label: def.title }
    }

    const rarityCounts = Object.fromEntries(RARITY_ORDER.map((r) => [r, 0])) as Record<Rarity, number>
    for (const r of rarities) rarityCounts[r]++

    // seq is chronological, so the tail is the recent end.
    const lastPlayed = seq.length ? seq[seq.length - 1].date : null
    const recent = seq.slice(-FORM_WINDOW).reverse()
    const form = recent.map((m) => (m.won ? "W" : m.lost ? "L" : "D") as "W" | "L" | "D")

    rows.push({
      id: pid,
      name: meta.name,
      tierValue: meta.tierValue,
      avatarUrl: meta.avatarUrl,
      score: scoreFor(rarities),
      unlocks: rarities.length,
      best: bestRarity(rarities),
      title: topEvent?.label ?? null,
      rarityCounts,
      form,
      formWins: form.filter((f) => f === "W").length,
      formLosses: form.filter((f) => f === "L").length,
      matches: seq.length,
      lastPlayed,
      inactive: meta.manuallyInactive || !lastPlayed || Date.parse(lastPlayed) < inactiveBefore,
    })
  }

  return rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}
