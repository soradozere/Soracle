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
 * Build the conversion board. Returns every player with at least one resolved
 * run, sorted best-first, already filtered to those clearing the carry floor.
 *
 * The floor is relative — 30% of the leader's resolved runs — rather than an
 * absolute count, matching the existing monthly qualifiers and, unlike a fixed
 * number, staying meaningful whether the window holds three matches or three
 * hundred. It is deliberately on CARRIES, not captures: a support player with
 * two caps in thirty runs has a perfectly real conversion rate, and a floor on
 * cap volume would throw them out for not being a capper main — the very bias
 * this stat exists to remove.
 */
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

  const kills = await fetchAll<{ match_id: string; victim_player_id: string; rets: number }>(
    () => {
      const q = supabase.from("match_kills").select("match_id, victim_player_id, rets")
      // Ordered because of the paging below, not for presentation: PostgREST
      // .range() over an unordered query has no stable row order between pages,
      // so rows can be skipped or repeated at a page boundary — which here would
      // silently under- or over-count someone's returns.
      return (matchIds ? q.in("match_id", matchIds) : q)
        .order("match_id")
        .order("victim_player_id")
    },
  )
  if (kills.length === 0) return { rows: [], matchCount: 0, carryFloor: 0 }

  const coveredIds = [...new Set(kills.map((k) => k.match_id))]

  // Captures come from the same matches only. Counting a player's whole career
  // of caps against a partial history of returns would invent conversion rates
  // well over 100%.
  const stats = await fetchAll<{ player_id: string; captures: number | null }>(() =>
    supabase
      .from("match_stats")
      .select("player_id, captures")
      .in("match_id", coveredIds)
      .order("player_id")
      .order("match_id"),
  )

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
