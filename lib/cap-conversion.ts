import type { SupabaseClient } from "@supabase/supabase-js"
import { rankByName } from "./rank-order"

/**
 * Cap conversion — what share of a player's *resolved* flag runs ended in a capture.
 *
 * The stat this replaces was minutes-of-flag-hold per cap, which the community
 * (rightly) complained about: it reads as a capper-main metric and punishes the
 * support role, where you routinely grab the flag and `/kill` so a capper can
 * run it. It also can't distinguish "held the flag a long time and scored" from
 * "held the flag a long time and died".
 *
 * A run RESOLVES two ways and only two ways:
 *   - you capped it                                    -> match_stats.captures
 *   - an enemy killed you while you carried it         -> match_kills.rets
 *
 * Everything else a grab can do — a `/kill` reset, a drop someone else picks up,
 * the round ending in your hands — resolves neither way and is simply absent
 * from both sides of the ratio. That is the point. `flag_grabs` counts all of
 * them, which is exactly why caps/grabs was the wrong denominator: it billed
 * support players for resets they made deliberately.
 *
 * Known gap: a carrier killed by the world rather than a player (a pit) records
 * no `rets` against anyone, so that run drops out of the denominator too. Rare,
 * and it flatters everyone equally, but it is not nothing.
 *
 * DATA WINDOW: match_kills only exists from 9 Aug 2026 (migration 037) and
 * cannot be backfilled — the CSV era has no kill matrix. Callers must present
 * this as "since tracking began", never as a monthly stat, or the numbers imply
 * a history they do not have.
 */

/** Fraction of the top player's resolved runs needed to make the board. */
export const CARRY_FLOOR_FRACTION = 0.3

export interface CapConversionRow {
  playerId: string
  name: string
  captures: number
  /** Times returned while carrying — runs that ended in an enemy's hands. */
  caught: number
  /** Resolved runs: captures + caught. Not `flag_grabs`. */
  carries: number
  /** captures / carries, as a percentage. */
  conversion: number
}

export interface CapConversion {
  rows: CapConversionRow[]
  /** Matches with kill-matrix data backing these numbers. */
  matchCount: number
  /** The computed carry floor, for display ("min N runs"). */
  carryFloor: number
}

export interface KillRow {
  match_id: string
  victim_player_id: string
  rets: number
}

export interface CaptureStatRow {
  player_id: string
  captures: number | null
}

const PAGE_SIZE = 1000

/**
 * Page through a table. supabase-js silently caps `.select()` at 1000 rows, and
 * every one of these tables is already past that — an unpaged read here would
 * quietly drop the oldest matches and no error would ever surface.
 *
 * `build` returns a fresh query per page: PostgREST builders are single-use, so
 * reusing one across iterations re-sends the previous range.
 */
async function fetchAll<T>(
  build: () => PromiseLike<{ data: unknown; error: { message: string } | null }> & {
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
 * Build the conversion board from already-fetched rows. Returns every player
 * with at least one resolved run, sorted best-first, already filtered to
 * those clearing the carry floor.
 *
 * The floor is relative — 30% of the leader's resolved runs — rather than an
 * absolute count, matching the existing monthly qualifiers and, unlike a fixed
 * number, staying meaningful whether the window holds three matches or three
 * hundred. It is deliberately on CARRIES, not captures: a support player with
 * two caps in thirty runs has a perfectly real conversion rate, and a floor on
 * cap volume would throw them out for not being a capper main — the very bias
 * this stat exists to remove.
 *
 * Pulled out of computeCapConversion as the pure half of the split: this takes
 * plain rows and does no I/O, so it's the part worth unit testing directly.
 */
export function aggregateCapConversion(
  kills: KillRow[],
  stats: CaptureStatRow[],
  nameById: Map<string, string>,
): CapConversion {
  if (kills.length === 0) return { rows: [], matchCount: 0, carryFloor: 0 }

  const coveredIds = [...new Set(kills.map((k) => k.match_id))]

  const caught = new Map<string, number>()
  for (const k of kills) {
    caught.set(k.victim_player_id, (caught.get(k.victim_player_id) ?? 0) + (k.rets ?? 0))
  }
  const captures = new Map<string, number>()
  for (const s of stats) {
    captures.set(s.player_id, (captures.get(s.player_id) ?? 0) + (s.captures ?? 0))
  }

  const all: CapConversionRow[] = [...new Set([...captures.keys(), ...caught.keys()])]
    .map((playerId) => {
      const caps = captures.get(playerId) ?? 0
      const returned = caught.get(playerId) ?? 0
      const carries = caps + returned
      return {
        playerId,
        name: nameById.get(playerId) ?? "unknown",
        captures: caps,
        caught: returned,
        carries,
        conversion: carries > 0 ? (caps / carries) * 100 : 0,
      }
    })
    .filter((r) => r.carries > 0)

  const topCarries = all.reduce((max, r) => Math.max(max, r.carries), 0)
  const carryFloor = topCarries * CARRY_FLOOR_FRACTION

  const rows = all
    .filter((r) => r.carries >= carryFloor)
    .sort(rankByName((a, b) => b.conversion - a.conversion || b.carries - a.carries))

  return { rows, matchCount: coveredIds.length, carryFloor }
}

// ---------------------------------------------------------------------------
// Cap conversion, per completed month, in capper-role games only
// ---------------------------------------------------------------------------

/**
 * Same conversion ratio as above, but sliced two extra ways: by calendar month,
 * and down to only the games a player was their side's CAPPER.
 *
 * This exists for Wesley's Prodigy, the month-resolved one-of-one crest (see
 * SECRET_ACHIEVEMENTS in lib/achievement-meta.ts). It is deliberately a pure
 * function over plain rows, like aggregateCapConversion above: the crest's
 * holder must come out identical whether it's resolved in the browser
 * (lib/player-profile.ts) or on the server (lib/achievements-server.ts), and
 * the only way to guarantee that is one implementation with no I/O in it.
 *
 * "Capper" is read off the scoreboard rather than the roster: the highest
 * flag_hold_ms on a side, that match. Same idea as pickReturners in
 * lib/returner-rate.ts, just taking the top of a side instead of the bottom
 * third — and with the same limitation, that a mid-game role swap arrives as
 * one blended row and is invisible. Ties take everyone tied, because a side
 * genuinely can run two cappers; a side where nobody held the flag at all has
 * no capper and contributes nothing.
 *
 * The CURRENT month is excluded. You cannot win a month that isn't over, and a
 * crest that could be claimed on the 3rd and lost by the 30th isn't a
 * one-of-one. Callers pass `now` rather than reading the clock here so this
 * stays testable.
 *
 * Rows come back for every (month, player) with at least one capper game,
 * INCLUDING those with no resolved carries (conversion 0) — the game floor is
 * measured against everyone who played the role, not only those who converted.
 */
export interface CapperMatchRow {
  id: string
  created_at: string
}

export interface CapperStatRow {
  match_id: string
  player_id: string
  team: string | null
  captures: number | null
  flag_hold_ms: number | null
}

/**
 * Looser than KillRow above, deliberately: the achievements layer's
 * KillPairRow carries `rets` only when the caller selected the column, so this
 * accepts both shapes and reads a missing value as zero. Tightening it would
 * force a cast at each of the two call sites, which is exactly where a silently
 * wrong `rets` would hide.
 */
export interface CapperKillRow {
  match_id: string
  victim_player_id: string
  rets?: number
}

export interface CapperMonthRow {
  /** UTC month bucket, "2026-09". */
  month: string
  playerId: string
  /** Matches this month they were their side's capper. */
  capperGames: number
  captures: number
  /** Resolved runs across those games: captures + times caught carrying. */
  carries: number
  /** captures / carries, as a percentage. 0 when nothing resolved. */
  conversion: number
  /** The capper game that closed out their month — what the crest points at. */
  lastMatchId: string
  lastDate: string
}

// UTC, matching monthKey in lib/player-profile.ts and the bot endpoints. Local
// bucketing puts NA-evening matches in different months for different viewers.
const monthKeyOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

export function capperMonths(
  matches: CapperMatchRow[],
  stats: CapperStatRow[],
  kills: CapperKillRow[],
  now: Date,
): CapperMonthRow[] {
  const currentKey = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`

  /*
   * Only matches the KILL MATRIX COVERS can be scored, and this gate is
   * load-bearing rather than defensive.
   *
   * `carries` is captures + times-caught, and times-caught exists only in
   * match_kills, which starts 9 Aug 2026 and cannot be backfilled. On a match
   * with no matrix row, nobody is ever recorded as caught — so every carry
   * resolves as a capture and EVERY capper reads as a flawless 100%.
   *
   * That is not hypothetical. Run without this gate against live data, June and
   * July 2026 both return a field of 100% cappers, and the crest is immediately
   * awarded off a month that structurally cannot produce a real number.
   *
   * Same rule computeCapConversion applies below ("counting a player's whole
   * career of caps against a partial history of returns would invent conversion
   * rates well over 100%"), for the same reason. It also self-maintains: no date
   * constant to keep in step, and a future gap in matrix coverage is excluded on
   * its own rather than quietly inflating a month.
   */
  const coveredMatchIds = new Set(kills.map((k) => k.match_id))
  if (coveredMatchIds.size === 0) return []

  const dateByMatch = new Map<string, string>()
  for (const m of matches) {
    if (monthKeyOf(m.created_at) >= currentKey) continue
    if (!coveredMatchIds.has(m.id)) continue
    dateByMatch.set(m.id, m.created_at)
  }
  if (dateByMatch.size === 0) return []

  // Times each player was caught carrying, per match — the other half of the
  // ratio, and the half that only exists from match_kills (JSON-era onward).
  const caughtByRow = new Map<string, number>()
  for (const k of kills) {
    if (!dateByMatch.has(k.match_id)) continue
    const key = `${k.match_id}|${k.victim_player_id}`
    caughtByRow.set(key, (caughtByRow.get(key) ?? 0) + (k.rets ?? 0))
  }

  // Who was the capper on each side of each match.
  const sides = new Map<string, CapperStatRow[]>()
  for (const s of stats) {
    if (!dateByMatch.has(s.match_id)) continue
    const key = `${s.match_id}|${s.team ?? ""}`
    const bucket = sides.get(key)
    if (bucket) bucket.push(s)
    else sides.set(key, [s])
  }
  const capperRows = new Set<string>()
  for (const rows of sides.values()) {
    const maxHold = Math.max(...rows.map((r) => r.flag_hold_ms ?? 0), 0)
    if (maxHold <= 0) continue
    for (const r of rows) {
      if ((r.flag_hold_ms ?? 0) === maxHold) capperRows.add(`${r.match_id}|${r.player_id}`)
    }
  }

  interface Agg {
    capperGames: number
    captures: number
    caught: number
    lastMatchId: string
    lastDate: string
  }
  const agg = new Map<string, Agg>()
  for (const s of stats) {
    const date = dateByMatch.get(s.match_id)
    if (!date) continue
    const rowKey = `${s.match_id}|${s.player_id}`
    if (!capperRows.has(rowKey)) continue

    const key = `${monthKeyOf(date)}|${s.player_id}`
    const rec = agg.get(key) ?? {
      capperGames: 0,
      captures: 0,
      caught: 0,
      lastMatchId: s.match_id,
      lastDate: date,
    }
    rec.capperGames++
    rec.captures += s.captures ?? 0
    rec.caught += caughtByRow.get(rowKey) ?? 0
    // Latest capper game of the month, on parsed timestamps — created_at
    // spelling varies (+00:00 vs Z), so a string compare would misorder them.
    // matchId breaks an exact-timestamp tie so this is stable across readers.
    const t = Date.parse(date)
    const best = Date.parse(rec.lastDate)
    if (t > best || (t === best && s.match_id > rec.lastMatchId)) {
      rec.lastMatchId = s.match_id
      rec.lastDate = date
    }
    agg.set(key, rec)
  }

  return [...agg.entries()].map(([key, a]) => {
    const [month, playerId] = [key.slice(0, key.indexOf("|")), key.slice(key.indexOf("|") + 1)]
    const carries = a.captures + a.caught
    return {
      month,
      playerId,
      capperGames: a.capperGames,
      captures: a.captures,
      carries,
      conversion: carries > 0 ? (a.captures / carries) * 100 : 0,
      lastMatchId: a.lastMatchId,
      lastDate: a.lastDate,
    }
  })
}

export async function computeCapConversion(
  supabase: SupabaseClient,
  nameById: Map<string, string>,
  /**
   * Restrict to these matches. The site's Reports tab is month-scoped and passes
   * the month's ids so the card matches every other card beside it; the bot omits
   * it and gets the whole (short) history. Passing an empty array means "no
   * matches", not "all" — a month with no kill-matrix data must come back empty
   * rather than silently widening to all time.
   */
  matchIds?: string[],
): Promise<CapConversion> {
  if (matchIds?.length === 0) return { rows: [], matchCount: 0, carryFloor: 0 }

  const kills = await fetchAll<KillRow>(() => {
    const q = supabase.from("match_kills").select("match_id, victim_player_id, rets")
    // Ordered because of the paging below, not for presentation: PostgREST
    // .range() over an unordered query has no stable row order between pages,
    // so rows can be skipped or repeated at a page boundary — which here would
    // silently under- or over-count someone's returns.
    return (matchIds ? q.in("match_id", matchIds) : q)
      .order("match_id")
      .order("victim_player_id")
  })
  if (kills.length === 0) return { rows: [], matchCount: 0, carryFloor: 0 }

  const coveredIds = [...new Set(kills.map((k) => k.match_id))]

  // Captures come from the same matches only. Counting a player's whole career
  // of caps against a partial history of returns would invent conversion rates
  // well over 100%.
  const stats = await fetchAll<CaptureStatRow>(() =>
    supabase
      .from("match_stats")
      .select("player_id, captures")
      .in("match_id", coveredIds)
      .order("player_id")
      .order("match_id"),
  )

  return aggregateCapConversion(kills, stats, nameById)
}
