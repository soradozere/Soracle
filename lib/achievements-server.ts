import { unstable_cache } from "next/cache"
import { createAnonClient } from "@/lib/supabase/anon"
import {
  computeAchievements,
  resolveSecretHolders,
  resolveScoreSecretHolders,
  secretViewsFor,
  unlockEventsFor,
  type AchievementView,
  type SecretCandidate,
  type KillPairRow,
  unansweredKillsByMatchPlayer,
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
import { RARITY_ORDER, bestRarity, pointsForSecret, scoreFor } from "@/lib/achievement-score"
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
  "match_id, player_id, team, score, captures, returns, base_cleaner, assists, kills, deaths, flag_hold_ms, flag_grabs, dbs_returns, red_returns, yellow_returns, dfa_returns, yellow_kills, turret_kills, mine_returns, mine_kills, blue_returns, blubs_returns, blubs_kills, upcut_kills, bs_kills, dbs_kills, red_kills, blue_kills, ydfa_kills, doom_kills, tele_kills, mine_grabs_red, mine_grabs_blue, dfa_kills, dfa_attempts, blocks_enemy, time_played, ping_mean"

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

interface RawPlayerRow {
  id: string
  name: string
  tier_value: number
  avatar_url: string | null
  manually_inactive: boolean | null
}

interface RawHistory {
  matches: ServerMatch[]
  stats: ServerStat[]
  players: RawPlayerRow[]
  killPairs: KillPairRow[]
}

/*
 * Three full-table scans, and they used to run fresh on every one of the 62+
 * pages that call buildHistoryIndex (home, /achievements, one static route
 * per crest, /players) on each page's own independent revalidate clock --
 * 60s on the home page. None of those pages shared a result, so the busiest
 * window paid for all three round-trips repeatedly rather than once. That
 * combination -- an expensive shared core with no shared cache, behind a
 * revalidate window shorter than the data actually changes -- was the direct
 * cause of Fluid CPU and ISR Writes both running high in the same billing
 * period (found auditing Vercel usage, 5 Aug 2026).
 *
 * Cached at the raw-row layer, not around buildHistoryIndex itself: that
 * function's result is built entirely of Maps, and unstable_cache round-trips
 * its return value through JSON to store it -- a Map survives that as `{}`,
 * silently. Caching stops at the plain-array boundary instead; everything
 * below (the Map-building, the per-match sequence pass, one-of-one
 * resolution) stays exactly as it was, uncached, running fresh on the shared
 * arrays every call. Cheap in-memory work was never the cost here -- three
 * paginated network round-trips were, and this captures the whole saving
 * without touching a line of the logic those Maps get built from.
 *
 * The tag is what keeps this correct rather than just cheaper: a match only
 * changes on an infrequent, well-defined set of writes (see
 * app/admin/actions.ts), so those call updateTag(HISTORY_TAG) themselves on
 * success -- updateTag rather than revalidateTag because one of those writers
 * needs the very next read in the same action to see fresh data, not just
 * future requests -- and the 1-hour window below exists only as a safety net
 * for a write path that bypasses that: Sora edits players/matches by hand in
 * Supabase sometimes, and that's real, not hypothetical.
 */
export const HISTORY_TAG = "achievement-history"

const fetchHistoryRows = unstable_cache(fetchHistoryRowsUncached, ["achievement-history"], {
  tags: [HISTORY_TAG],
  revalidate: 3600,
})

async function fetchHistoryRowsUncached(): Promise<RawHistory> {
  // Anon, not the cookie-backed server client: every one of these reads is public
  // and identical for all callers, and reading cookies would force the pages that
  // depend on this to re-render per request instead of honouring `revalidate`.
  const supabase = createAnonClient()
  const [matches, stats, killPairs, players] = await Promise.all([
    fetchAll<ServerMatch>(supabase, "matches", "id, red_team, blue_team, red_score, blue_score, created_at"),
    fetchAll<ServerStat>(supabase, "match_stats", STAT_COLUMNS),
    // The kill matrix, for crests about who beat whom rather than raw totals
    // (Bully). Small on purpose: it only exists for JSON-era matches.
    fetchAll<KillPairRow>(supabase, "match_kills", "match_id, killer_player_id, victim_player_id, kills"),
    // tier_value / avatar_url / manually_inactive ride along for the /players
    // board: same row, same round-trip, and the achievement passes ignore them.
    //
    // ADDING A COLUMN HERE IS NOT FREE. app/api/player-profile/route.ts only
    // invalidates HISTORY_TAG when avatar_url changes, on the grounds that it
    // is the sole profile-writable column in this list. Add another one the
    // profile save writes (model, saber, skin, profile_theme, title, either
    // animation, spotlight_url) and that gate silently stops firing for it --
    // no error, just a stale board until the next revalidate. Update both.
    fetchAll<RawPlayerRow>(
      supabase,
      "players",
      "id, name, created_at, tier_value, avatar_url, manually_inactive",
    ),
  ])
  return { matches, stats, players, killPairs }
}

async function buildHistoryIndex(): Promise<HistoryIndex> {
  const { matches, stats, players, killPairs } = await fetchHistoryRows()

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
          flag_grabs: s.flag_grabs,
          dbs_returns: s.dbs_returns,
          red_returns: s.red_returns,
          yellow_returns: s.yellow_returns,
          dfa_returns: s.dfa_returns,
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
          tele_kills: s.tele_kills,
          mine_grabs_red: s.mine_grabs_red,
          team: s.team,
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
  const unanswered = unansweredKillsByMatchPlayer(killPairs)
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
            ctx: { won, lost, myScore, oppScore, maxUnansweredKills: unanswered.get(`${m.id}:${pid}`) ?? 0 },
            stat,
          })
        }
      }
    }
  }

  // Match-resolved and score-resolved secrets answer different questions off the
  // same history, so they're resolved separately and merged into one map. Ids
  // never overlap: a def has claim() or scoreThreshold, never both.
  const holders = resolveSecretHolders(candidates)
  for (const [id, holder] of resolveScoreSecretHolders(seqByPlayer)) holders.set(id, holder)
  return { seqByPlayer, nameById, metaById, holders }
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
      titled: true, // a one-of-one's name is its own; there is no family to number against
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
  /** In-game score accumulated this calendar month (UTC), across stat-tracked
   *  matches. Zero for a player who hasn't played, or whose month's matches have
   *  no scoreboard uploaded. */
  monthScore: number
  /** Matches played this calendar month (UTC) — the denominator for monthScore,
   *  counted from matches played rather than from scoreboards uploaded. */
  monthMatches: number
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
  // UTC, like every other monthly bucket on the site.
  const nowUtc = new Date()
  const monthKey = `${nowUtc.getUTCFullYear()}-${String(nowUtc.getUTCMonth() + 1).padStart(2, "0")}`
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
        // Mirrors displayName: rank I never takes a numeral, since an unnamed
        // first rank simply IS the family name.
        const label =
          ev.totalRanks > 1 && ev.rank > 1 && !ev.titled ? `${ev.title} ${roman(ev.rank)}` : ev.title
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
    // Its POINTS come from the def, not the rarity: The GOAT is worth 0 (see
    // pointsForSecret), while still counting as a one-of-one for the rarity
    // breakdown and the board's accent colour.
    let secretPoints = 0
    for (const def of SECRET_ACHIEVEMENTS) {
      if (holders.get(def.id)?.playerId !== pid) continue
      rarities.push(SECRET_RARITY)
      secretPoints += pointsForSecret(def.id)
      topEvent = { rarity: SECRET_RARITY, rank: 1, date: holders.get(def.id)!.date, label: def.title }
    }

    const rarityCounts = Object.fromEntries(RARITY_ORDER.map((r) => [r, 0])) as Record<Rarity, number>
    for (const r of rarities) rarityCounts[r]++

    // seq is chronological, so the tail is the recent end.
    const lastPlayed = seq.length ? seq[seq.length - 1].date : null
    const thisMonth = seq.filter((m) => m.date.slice(0, 7) === monthKey)
    const monthScore = thisMonth.reduce((sum, m) => sum + (m.stat?.score ?? 0), 0)
    const monthMatches = thisMonth.filter((m) => m.played).length
    const recent = seq.slice(-FORM_WINDOW).reverse()
    const form = recent.map((m) => (m.won ? "W" : m.lost ? "L" : "D") as "W" | "L" | "D")

    rows.push({
      id: pid,
      name: meta.name,
      tierValue: meta.tierValue,
      avatarUrl: meta.avatarUrl,
      score: scoreFor(rarities.filter((r) => r !== SECRET_RARITY)) + secretPoints,
      unlocks: rarities.length,
      best: bestRarity(rarities),
      title: topEvent?.label ?? null,
      rarityCounts,
      form,
      formWins: form.filter((f) => f === "W").length,
      formLosses: form.filter((f) => f === "L").length,
      matches: seq.length,
      monthScore,
      monthMatches,
      lastPlayed,
      inactive: meta.manuallyInactive || !lastPlayed || Date.parse(lastPlayed) < inactiveBefore,
    })
  }

  return rows.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
}

export interface HomeMatch {
  id: string
  red_team: string[] | null
  blue_team: string[] | null
  red_score: number
  blue_score: number
  created_at: string
}

export interface StreakRecord {
  name: string
  streak: number
  /** ISO date of the last win in the run — rendered as the month it happened. */
  endedAt: string
}

/**
 * The longest run of consecutive wins any player has ever put together, for the
 * Stats page's streaks panel to measure this month against.
 *
 * Off the cached history rows rather than a query of its own: the ledger has
 * already paid for every match on any render that needs this, and an all-time
 * answer over ~270 matches is trivial in-memory work. A draw breaks a run, the
 * same way it does in the monthly streaks on the Stats page — a run of wins is
 * a run of wins.
 */
export async function computeStreakRecord(): Promise<StreakRecord | null> {
  const { matches } = await fetchHistoryRows()

  // fetchHistoryRows pages ascending, but sort explicitly: a streak read in the
  // wrong order is silently wrong rather than obviously broken.
  const ordered = [...matches]
    .filter((m) => m.red_team?.length && m.blue_team?.length)
    .sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at))

  const running = new Map<string, { current: number; lastWin: string }>()
  let best: StreakRecord | null = null

  for (const match of ordered) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score

    for (const [team, won] of [
      [match.red_team ?? [], redWon],
      [match.blue_team ?? [], blueWon],
    ] as const) {
      for (const name of team) {
        if (!won) {
          running.delete(name)
          continue
        }
        const next = (running.get(name)?.current ?? 0) + 1
        running.set(name, { current: next, lastWin: match.created_at })
        if (!best || next > best.streak) {
          best = { name, streak: next, endedAt: match.created_at }
        }
      }
    }
  }

  return best
}

export interface HomeSummary {
  /** Newest first, and only matches with both teams -- what the feed counts. */
  matches: HomeMatch[]
  killsThisMonth: number
  /** Keyed by player *name*, the way red_team/blue_team store them. */
  monthlyPlayerStats: Record<string, { wins: number; losses: number; draws: number }>
}

/**
 * The homepage's three aggregates, off the history rows already in cache.
 *
 * These used to be three separate queries against `matches` and `match_stats`
 * (getMatches / getMatchStatsByMonth / getMonthlyPlayerStats in
 * app/admin/actions.ts), which re-read tables fetchHistoryRows had already
 * fetched for the ledger on the very same render -- and read them through the
 * cookie-carrying client, which is what kept the homepage rendering per request
 * no matter what its `revalidate` said. Deriving them here removes the round
 * trips outright rather than merely making them cacheable, and the page inherits
 * HISTORY_TAG with them, so approving a match still refreshes the homepage
 * immediately instead of waiting out the window.
 *
 * The admin functions stay exactly as they are: they run behind auth where the
 * session is the point, and this is not a caller they should have to serve.
 */
export async function computeHomeSummary(): Promise<HomeSummary> {
  const { matches, stats } = await fetchHistoryRows()

  // fetchHistoryRows pages through ascending (oldest first) because the
  // achievement passes walk each player's career forwards. The homepage wants
  // the opposite -- it slices the newest few for the feed and numbers them
  // backwards from the total -- so this reverses rather than inheriting an
  // order that would quietly surface the fifteen *oldest* matches.
  const ordered = [...matches].reverse().filter((m) => m.red_team?.length && m.blue_team?.length)

  const now = new Date()
  const monthKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`
  const inThisMonth = (iso: string) => {
    const d = new Date(iso)
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` === monthKey
  }

  const monthMatchIds = new Set(matches.filter((m) => inThisMonth(m.created_at)).map((m) => m.id))
  let killsThisMonth = 0
  for (const s of stats) {
    if (monthMatchIds.has(s.match_id)) killsThisMonth += s.kills ?? 0
  }

  // Same tally as getMonthlyPlayerStats: a draw counts for both sides, and a
  // player named on both teams in one match (it happens -- a partial player
  // logged in two stints) is credited once per appearance, as it was before.
  const tally: Record<string, { wins: number; losses: number; draws: number }> = {}
  const credit = (name: string, outcome: "wins" | "losses" | "draws") => {
    tally[name] ??= { wins: 0, losses: 0, draws: 0 }
    tally[name][outcome]++
  }
  for (const m of matches) {
    if (!inThisMonth(m.created_at)) continue
    const redWon = m.red_score > m.blue_score
    const blueWon = m.blue_score > m.red_score
    for (const p of m.red_team ?? []) credit(p, redWon ? "wins" : blueWon ? "losses" : "draws")
    for (const p of m.blue_team ?? []) credit(p, blueWon ? "wins" : redWon ? "losses" : "draws")
  }

  return { matches: ordered, killsThisMonth, monthlyPlayerStats: tally }
}
