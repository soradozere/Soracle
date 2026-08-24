import type { SupabaseClient } from "@supabase/supabase-js"

/*
 * Auto-calibration switch.
 *
 * The seasonal tier calibrator (adjusts player tiers from match results as games
 * are played) is gated behind this site_settings flag so admins can turn it on
 * and off from the admin panel without a deploy. The engine itself must check
 * this key before making any change; while the row is absent the tier list only
 * moves when an admin edits it by hand.
 *
 * Row absent = OFF (the table's documented default state). Value "on" = ON, and
 * the row's updated_at is also the "since" boundary the engine evaluates from —
 * see readAutoCalibrationEnabledAt.
 */
export const AUTO_CALIBRATION_KEY = "auto_calibration"

/** Whether auto-calibration is switched on. Takes the caller's Supabase client
 * (server, browser, or service-role — SELECT on site_settings is public). */
export async function readAutoCalibrationEnabled(supabase: SupabaseClient): Promise<boolean> {
  return (await readAutoCalibrationEnabledAt(supabase)) !== null
}

/**
 * Whether auto-calibration is on, and if so, since when.
 *
 * The engine only counts matches logged at or after this moment — otherwise the
 * very first save after flipping the switch would immediately judge everyone
 * against whatever history already happened to exist, which can fire a burst of
 * moves off games nobody watched the switch for. Each enable is a clean restart:
 * setAutoCalibration() always writes a fresh updated_at, so toggling off and
 * back on later re-arms the clock rather than resuming the old one.
 */
export async function readAutoCalibrationEnabledAt(supabase: SupabaseClient): Promise<string | null> {
  try {
    const { data, error } = await supabase
      .from("site_settings")
      .select("value, updated_at")
      .eq("key", AUTO_CALIBRATION_KEY)
      .maybeSingle()
    if (error || data?.value !== "on") return null
    return data.updated_at
  } catch {
    // An unreadable flag must fail CLOSED: silently calibrating tiers when the
    // switch can't be read is worse than skipping a run.
    return null
  }
}

/*
 * The engine.
 *
 * Design signed off 21 Aug 2026. One signal only: actual vs expected win rate,
 * the same maths the admin panel's Rank Suggestions tool shows — expected win
 * probability is the team's share of the match's snapshot tier sum, and only
 * games played SINCE THE PLAYER'S LAST TIER CHANGE, AT THEIR CURRENT TIER,
 * count.
 *
 * That pair of filters is the admin-override protection: any tier change, human
 * or auto, makes older games stop counting, so a hand-set tier stands until the
 * player has produced MIN_GAMES of fresh evidence against it, and the engine can
 * never ping-pong with an admin. It takes both to hold. The snapshot-tier check
 * alone is blind to a player who was moved off a tier and later moved back —
 * the tier number reads the same on both spells, so the games that earned the
 * demotion would return as evidence against it. The reset timestamp alone is
 * blind to a move that never reached tier_changes, since that write is
 * best-effort.
 *
 * Deliberately NOT used: ELO, TrueSkill, win rate boards (month-scale split-half
 * reliability 0.13 / −0.22 / 0.03 — noise), per-stat performance and the Impact
 * rating (excluded by Sora while that board is still being reworked).
 *
 * Cadence is per-player, Overwatch-style: every saved match evaluates its twelve
 * participants, each against their own rolling window. Small samples pay a
 * higher evidence bar (GAP_SMALL) than settled ones (GAP_FULL), and every move
 * is a single tier step — a genuinely mis-ranked player gets there in hops,
 * re-proving at each level.
 */
/*
 * These defaults were not chosen by feel. A 290-match history replay swept the
 * whole parameter grid; every 5-game-floor config thrashed (the first draft at
 * MIN_GAMES 5 / gaps 0.25/0.15 produced 497 moves in five months, 380 of them
 * ping-pong reversals, and made the tiers WORSE at predicting matches than the
 * hand-set ones — win/loss over 5 games is noise, not form). This config moves
 * ~19 players a month, cuts reversals to 43, and its win probabilities score
 * better than the hand snapshots on Brier while trailing them ~1.5% on picking
 * favourites. Re-run the replay before changing any of these.
 */
export const CALIBRATION = {
  /** Games at the current tier before a player can move at all. */
  MIN_GAMES: 10,
  /** From this many games the evidence bar drops to GAP_FULL. */
  FULL_SAMPLE_GAMES: 15,
  /** Only the most recent N games at the current tier count — form, not history. */
  WINDOW_CAP: 15,
  /** Required |actual − expected| win-rate gap at 10–14 games. */
  GAP_SMALL: 0.3,
  /** Required gap at FULL_SAMPLE_GAMES+. */
  GAP_FULL: 0.2,
} as const

export type CalibrationMatch = {
  red_team: string[]
  blue_team: string[]
  red_tiers: number[] | null
  blue_tiers: number[] | null
  red_score: number
  blue_score: number
  created_at: string
}

export type TierMove = {
  name: string
  from: number
  to: number
  actualWinRate: number
  expectedWinRate: number
  gap: number
  games: number
}

/**
 * Pure core: which of `candidates` should move, given the match history and
 * current tiers. No I/O — the save-path runner, the tests, and the history
 * replay all call this same function.
 *
 * `matches` may arrive in any order; evaluation walks newest-first so the
 * WINDOW_CAP keeps recent form. Draws are skipped outright: a draw is evidence
 * about neither over- nor under-performance, and counting it as a loss for both
 * sides quietly biases everyone downward.
 *
 * `lastTierChangeAt` maps a player to when their tier last moved (ISO, from
 * tier_changes). Pass an empty map only where no such history exists — a player
 * missing from it is evaluated over their whole visible record.
 */
export function computeTierMoves(
  matches: CalibrationMatch[],
  currentTiers: Map<string, number>,
  candidates: string[],
  lastTierChangeAt: Map<string, string>,
  opts: typeof CALIBRATION = CALIBRATION,
): TierMove[] {
  const newestFirst = [...matches].sort((a, b) => b.created_at.localeCompare(a.created_at))
  const moves: TierMove[] = []

  for (const name of new Set(candidates)) {
    const currentTier = currentTiers.get(name)
    if (currentTier === undefined) continue

    // When the player was last moved. A malformed timestamp parses to NaN and
    // is treated as "no reset on record" — the snapshot check below still
    // stands, so a bad row costs coverage, never a wrongly-excluded game.
    const changedAt = lastTierChangeAt.get(name)
    const resetAt = changedAt ? Date.parse(changedAt) : Number.NaN

    let games = 0
    let wins = 0
    let expectedSum = 0

    for (const match of newestFirst) {
      if (games >= opts.WINDOW_CAP) break
      if (!match.red_tiers || !match.blue_tiers) continue
      if (match.red_score === match.blue_score) continue

      // Nothing from before the player's last tier change counts. The snapshot
      // check below cannot see this on its own: a player demoted off a tier and
      // later returned to it carries the SAME tier number both times, so their
      // pre-demotion games would sail back in as fresh evidence and undo the
      // very move that was made. Both filters are kept because neither covers
      // the other — tier_changes writes are best-effort, so a move can go
      // unlogged, and the snapshot check is what still holds the line when it
      // does.
      if (!Number.isNaN(resetAt) && Date.parse(match.created_at) < resetAt) continue

      const onRed = match.red_team.indexOf(name)
      const onBlue = onRed === -1 ? match.blue_team.indexOf(name) : -1
      if (onRed === -1 && onBlue === -1) continue

      const snapshotTier = onRed !== -1 ? match.red_tiers[onRed] : match.blue_tiers[onBlue]
      // Only games at the player's current tier count — the evidence window
      // resets on every tier change, admin edits included.
      if (snapshotTier !== currentTier) continue

      const redSum = match.red_tiers.reduce((a, b) => a + b, 0)
      const blueSum = match.blue_tiers.reduce((a, b) => a + b, 0)
      const total = redSum + blueSum
      if (total === 0) continue

      const expected = (onRed !== -1 ? redSum : blueSum) / total
      const won = onRed !== -1 ? match.red_score > match.blue_score : match.blue_score > match.red_score

      games++
      expectedSum += expected
      if (won) wins++
    }

    if (games < opts.MIN_GAMES) continue

    const actualWinRate = wins / games
    const expectedWinRate = expectedSum / games
    const gap = actualWinRate - expectedWinRate
    const bar = games >= opts.FULL_SAMPLE_GAMES ? opts.GAP_FULL : opts.GAP_SMALL
    if (Math.abs(gap) < bar) continue

    const to = Math.max(1, Math.min(10, currentTier + (gap > 0 ? 1 : -1)))
    if (to === currentTier) continue

    moves.push({ name, from: currentTier, to, actualWinRate, expectedWinRate, gap, games })
  }

  return moves
}

/** How many snapshot-bearing matches the runner fetches. WINDOW_CAP games per
 * player is the most that can matter; 300 recent matches is months of play. */
const RUNNER_MATCH_FETCH = 300

type PlayerRow = { id: string; name: string; tier_value: number }
type TierChangeRow = { player_id: string; changed_at: string }

/**
 * Newest tier change per player, keyed by name — the "evidence resets here"
 * boundary computeTierMoves takes.
 *
 * Order-independent by construction: it compares timestamps rather than
 * trusting the caller to sort, so no query's ORDER BY is load-bearing here.
 * Joined through player_id rather than the denormalised player_name, so a
 * rename can never orphan a player's reset.
 */
function lastTierChangeByName(players: PlayerRow[], changes: TierChangeRow[]): Map<string, string> {
  const nameById = new Map(players.map((p) => [p.id, p.name]))
  const latest = new Map<string, string>()
  for (const change of changes) {
    const name = nameById.get(change.player_id)
    if (!name) continue
    const seen = latest.get(name)
    if (!seen || Date.parse(change.changed_at) > Date.parse(seen)) latest.set(name, change.changed_at)
  }
  return latest
}

/**
 * The save-path runner: evaluate the participants of a just-saved match and
 * apply any moves. Gated on the admin switch (fail closed) and further scoped
 * to matches at or after the switch's last enable — see
 * readAutoCalibrationEnabledAt. Best-effort by contract — a calibration failure
 * must never fail the match save it rides on, mirroring
 * recordSeasonalTitlesSafely. Requires the service-role client: players writes
 * and tier_changes inserts bypass RLS the same way the other system writes do.
 */
export async function runAutoCalibrationSafely(
  service: SupabaseClient,
  matchPlayers: string[],
): Promise<TierMove[]> {
  try {
    const enabledAt = await readAutoCalibrationEnabledAt(service)
    if (!enabledAt) return []

    const [
      { data: players, error: playersError },
      { data: matches, error: matchesError },
      { data: tierChanges, error: tierChangesError },
    ] = await Promise.all([
      service.from("players").select("id, name, tier_value"),
      service
        .from("matches")
        .select("red_team, blue_team, red_tiers, blue_tiers, red_score, blue_score, created_at")
        .not("red_tiers", "is", null)
        .not("blue_tiers", "is", null)
        .gte("created_at", enabledAt)
        .order("created_at", { ascending: false })
        .limit(RUNNER_MATCH_FETCH),
      // Only changes since the switch was enabled can matter: the match fetch
      // above is bounded by the same moment, so an older reset excludes nothing
      // that is here anyway. `hidden` is deliberately not filtered — it hides a
      // row from the public changelog, it does not un-happen the tier move.
      service.from("tier_changes").select("player_id, changed_at").gte("changed_at", enabledAt),
    ])
    // Reading the reset log is not optional: without it the evidence window
    // silently reverts to counting games from before a demotion. Fail closed,
    // as with the switch itself.
    if (playersError || matchesError || tierChangesError || !players) return []

    const tiers = new Map(players.map((p) => [p.name as string, p.tier_value as number]))
    const ids = new Map(players.map((p) => [p.name as string, p.id as string]))

    const moves = computeTierMoves(
      (matches ?? []) as CalibrationMatch[],
      tiers,
      matchPlayers,
      lastTierChangeByName(players as PlayerRow[], tierChanges ?? []),
    )

    for (const move of moves) {
      const id = ids.get(move.name)
      if (!id) continue
      const { error: updateError } = await service.from("players").update({ tier_value: move.to }).eq("id", id)
      if (updateError) {
        console.error(`auto-calibration: failed to move ${move.name}: ${updateError.message}`)
        continue
      }
      // Changelog row after the tier write, same ordering as the admin edit
      // path. A failed insert leaves the move applied but unlogged — the known
      // trade-off the manual path already accepts.
      const { error: logError } = await service.from("tier_changes").insert({
        player_id: id,
        player_name: move.name,
        previous_tier: move.from,
        new_tier: move.to,
        source: "auto",
      })
      if (logError) console.error(`auto-calibration: move applied but not logged for ${move.name}: ${logError.message}`)
    }

    return moves
  } catch (error) {
    console.error("auto-calibration: run failed", error)
    return []
  }
}
