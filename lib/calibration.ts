import type { SupabaseClient } from "@supabase/supabase-js"
import {
  awayMinesPerMinute,
  calibrationProduction,
  detectAppearanceRole,
  type Job,
  type ProductionStatRow,
} from "@/lib/production-rating"

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
 * WIN RATE NO LONGER DECIDES ANYTHING. It is still computed and shown, because
 * it is the number people expect to see next to a tier move, but the decision is
 * made on production — see computeTierMoves for the evidence and the reasoning.
 * Also deliberately unused: ELO and TrueSkill (month-scale split-half reliability
 * 0.13 and −0.22, i.e. noise).
 *
 * Cadence is per-player, Overwatch-style: every saved match evaluates its twelve
 * participants, each against their own rolling window, and moves them a fraction
 * of a tier toward what their play suggests. Writes are a single tier step — a
 * genuinely mis-ranked player gets there in hops, re-proving at each level.
 */
export const CALIBRATION = {
  /**
   * Games at the current tier before a player can move at all.
   *
   * Was 10, moved to 5 on 26 Aug 2026 at Sora's request AND on fresh evidence.
   * The original 10 came from a replay that found 5 thrashed badly (497 moves /
   * 380 reversals over 5 months). **That no longer reproduces.** Re-replayed
   * over all 301 matches (Mar–Aug 2026), out-of-sample, averaged across five
   * train/test splits:
   *
   *   MIN_GAMES=5   63.8% favourite accuracy, 38 moves, 8.4 reversals (21%)
   *   MIN_GAMES=8   63.1%                     30 moves, 5.2
   *   MIN_GAMES=10  61.4%                     29 moves, 4.6
   *   MIN_GAMES=12  58.1%                     28 moves, 3.6
   *
   * So 5 is the BEST of the tested floors on accuracy, and its reversal rate
   * (21%) is nothing like the old 76%. The likely reason the old result does
   * not reproduce: it predates PR #183 (24 Aug), which stopped a player's
   * pre-demotion games counting as fresh evidence after they returned to a
   * tier — exactly the bug that would manufacture thrashing.
   *
   * ALL OF THE ABOVE MEASURES THE OLD WIN-RATE RULE and is kept only as the
   * record of why the floor is 5. It no longer justifies it: that rule was
   * later shown to be worse than doing nothing (see computeTierMoves), so
   * "best of the tested floors" was best among bad options. The floor stayed at
   * 5 on Sora's instruction — the league plays ~50 matches a month and a longer
   * window would put a player out of reach of correction for months. What
   * changed instead is what happens at the floor: an evaluation now nudges a
   * fraction of a tier rather than jumping a whole one, so a 5-game window
   * being noisy costs a rounding error instead of a tier.
   *
   * READ THE BIGGER FINDING BEFORE TUNING THIS FURTHER: in that same replay,
   * hand tiers left alone scored 67.8%, beating EVERY calibrator setting.
   */
  MIN_GAMES: 5,
  /** Only the most recent N games at the current tier count — form, not history. */
  WINDOW_CAP: 15,

  /**
   * How far a player's production z moves per tier. The estimator inverts this:
   * a z of +0.207 says "you played like someone one tier above this lobby".
   *
   * Measured at +0.207 over 1,973 appearances, with captures removed and each
   * appearance standardised against the other eleven players on its own board.
   *
   * IT IS AN UNDERESTIMATE, AND THAT DIRECTION MATTERS. It is fitted against
   * ASSIGNED tiers, which are themselves noisy copies of the truth, so it is
   * attenuated — the true-tier slope is nearer 0.28. Dividing by too small a
   * number makes every estimate too extreme and pushes tiers outward. That is
   * what NUDGE_RATE and MAX_DRIFT are for, and it is why both are set low.
   */
  PRODUCTION_Z_PER_TIER: 0.207,

  /**
   * The share of the gap between a player's current tier and what their
   * production implies that one evaluation closes.
   *
   * THIS IS THE SAFETY DIAL, and it is deliberately at the timid end. A
   * ground-truth simulation put the best value near 0.12, but that optimum sat
   * on the simulator's own generative constant, which is not measurable here —
   * quoting it would be fitting to our own model. Across the range a real
   * implementation could plausibly land in, the outcome ranged from a large
   * improvement to a small harm, and the harm case is a roster whose tiers were
   * already good. Sora's are. So this errs slow: a genuinely mis-tiered player
   * still converges, a correctly-tiered one is barely touched by a lucky month.
   *
   * Raise it to move faster and risk more; lower it toward zero to approach
   * doing nothing, which is the safe limit rather than a failure mode.
   */
  NUDGE_RATE: 0.1,

  /**
   * How far the latent tier may drift from the tier an admin last set, in tiers.
   *
   * A backstop, not a tuning knob. Even with the rate low, a persistent bias in
   * the production signal — a role the price list flatters, a player who always
   * draws weak lobbies — would otherwise accumulate indefinitely. Two tiers is
   * far more than any legitimate correction and still bounded.
   */
  MAX_DRIFT: 2,
} as const

export type CalibrationMatch = {
  id: string
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
  /** Win-rate context, still shown in the admin panel — no longer the decider. */
  actualWinRate: number
  expectedWinRate: number
  gap: number
  games: number
  /** What this player's production says their tier is, averaged over the window. */
  estimatedTier: number
  /** The fractional tier after nudging. The displayed tier is its rounding. */
  latent: number
  /** Appearances carrying a usable scoreboard — the evidence the move rests on. */
  productionGames: number
}

/** One player's scoreboard line, as the calibrator reads it. */
export type Appearance = {
  /** Priced production. Raw points — computeTierMoves standardises per board. */
  points: number
  /** What they were doing, so the estimate can be corrected for it. */
  role: Job
}

/** Appearances per player per match, keyed by match id. */
export type ProductionByMatch = Map<string, Map<string, Appearance>>

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
/**
 * Standardise one match's production against that board, so a fast game and a
 * slow one are comparable.
 *
 * Roughly 40% of the spread in a single appearance's production is a whole-match
 * effect — pace, length, how open the game was — shared by all twelve players.
 * That is noise about the player and it averages away only slowly. Scoring each
 * player against the others who played THAT game removes it outright, and it is
 * the single cheapest improvement available to this signal.
 */
function standardiseBoard(board: Map<string, Appearance>): Map<string, number> {
  const values = [...board.values()].map((a) => a.points)
  const out = new Map<string, number>()
  if (values.length < MIN_BOARD_ROWS) return out
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length
  const sd = Math.sqrt(variance)
  if (!(sd > 0)) return out
  for (const [name, a] of board) out.set(name, (a.points - mean) / sd)
  return out
}

/** A board thinner than this is a walkover or a broken upload, not evidence. */
const MIN_BOARD_ROWS = 8

/** Appearances a role needs before its offset is trusted rather than skipped. */
const MIN_ROLE_SAMPLE = 30

/**
 * Which players should move tier, and to what.
 *
 * WHAT CHANGED, AND WHY
 *
 * This used to threshold a win-rate gap and jump a whole tier. Both halves were
 * wrong, and a ground-truth simulation — where the true tier is set by us, so
 * error is measurable rather than inferred — put numbers on it. Over a simulated
 * season, mean distance from the true tier:
 *
 *   the old rule ..................... 0.83
 *   leaving tiers alone .............. 0.60
 *   this rule ........................ 0.21-0.46
 *
 * The old rule was WORSE THAN DOING NOTHING, losing in 91% of seasons, and the
 * reason is specific: broken out by how wrong each player started,
 *
 *   started correct (the majority) ... it moved them 0.78 tiers AWAY
 *   started two tiers out ............ it recovered 1.06
 *
 * It rescued the badly-placed by wrecking the correctly-placed, and most of a
 * roster is correctly placed. Both fixes below attack exactly that.
 *
 * FIX ONE — READ PRODUCTION, NOT WHO WON. A win is one bit per match, and one
 * tier is worth only 5.55 points of win probability against a 12.9-point wobble
 * over 15 games; the old bar of 0.2 was therefore about four tiers' worth of
 * evidence, so it fired on noise long before it fired on a real error. At a
 * 5-game window it moved a correctly-tiered player 18% of the time, and roughly
 * two thirds of its moves were undeserved. Production carries a continuous
 * number per match instead, with about twice the resolution per game — with
 * captures removed so it is not the match result wearing a hat.
 *
 * FIX TWO — NUDGE, DO NOT JUMP. A one-tier step off a threshold is the worst
 * available estimator: it converts a coin flip into a full tier of damage. This
 * accumulates a fractional latent tier instead, moving NUDGE_RATE of the way
 * toward what production implies at each evaluation. Weak evidence produces a
 * tiny move that the next evaluation undoes; a genuine misplacement accumulates
 * in one direction and eventually crosses a rounding boundary. Nothing is
 * written until the ROUNDED tier changes, so the changelog stays as legible as
 * it was.
 *
 * STATELESS BY CONSTRUCTION. The latent is not stored. It is replayed from the
 * player's last tier change — admin or auto — which is also where their evidence
 * window resets, so the two always agree. That keeps this a pure function of the
 * inputs, which is what lets the admin preview and the live runner share it.
 *
 * HONEST LIMIT: the simulation says this beats the old rule in every world
 * tested, but whether it beats leaving tiers ALONE depends on how good the hand
 * tiers already are. If more than about 82% of the roster is exactly right,
 * nothing automatic helps, this included. Every measurement taken on the real
 * league points that way, which is why NUDGE_RATE is set timid.
 */
export function computeTierMoves(
  matches: CalibrationMatch[],
  currentTiers: Map<string, number>,
  candidates: string[],
  lastTierChangeAt: Map<string, string>,
  production: ProductionByMatch = new Map(),
  opts: typeof CALIBRATION = CALIBRATION,
): TierMove[] {
  // Oldest first: the latent is built forward from the last tier change.
  const oldestFirst = [...matches].sort((a, b) => a.created_at.localeCompare(b.created_at))
  const zByMatch = new Map<string, Map<string, number>>()
  for (const [matchId, board] of production) {
    zByMatch.set(matchId, standardiseBoard(board))
  }

  /**
   * How far each ROLE's estimate sits from the tiers those players actually
   * hold, so it can be subtracted back out.
   *
   * Without this the signal is not role-neutral and it is not close. Measured
   * over 1,973 appearances, the estimate ran +1.32 tiers high for base cleaners
   * and −0.71 low for support: a 2.0-tier spread, which is the same size as the
   * errors this exists to detect. Left in, it would not calibrate players, it
   * would slowly sort them by what job they like playing.
   *
   * The correction is measured from the same matches being judged rather than
   * hard-coded, so it tracks the league instead of going stale — and it is
   * computed across ALL appearances, not just the candidates', so one player's
   * form cannot move the baseline they are judged against.
   *
   * What it deliberately does NOT do is flatten differences WITHIN a role: after
   * correction the spread of a single appearance's estimate is still ~4 tiers
   * inside every role, which is the signal. Only the average difference BETWEEN
   * roles is removed.
   */
  const roleTotals = new Map<Job, { sum: number; n: number }>()
  for (const match of oldestFirst) {
    if (!match.red_tiers || !match.blue_tiers) continue
    const z = zByMatch.get(match.id)
    const board = production.get(match.id)
    if (!z || !board) continue
    const lobbyTiers = [...match.red_tiers, ...match.blue_tiers]
    if (lobbyTiers.length === 0) continue
    const lobbyMean = lobbyTiers.reduce((a, b) => a + b, 0) / lobbyTiers.length
    for (const [name, appearance] of board) {
      const onRed = match.red_team.indexOf(name)
      const onBlue = onRed === -1 ? match.blue_team.indexOf(name) : -1
      if (onRed === -1 && onBlue === -1) continue
      const tier = onRed !== -1 ? match.red_tiers[onRed] : match.blue_tiers[onBlue]
      const zv = z.get(name)
      if (tier === undefined || zv === undefined) continue
      const bucket = roleTotals.get(appearance.role) ?? { sum: 0, n: 0 }
      bucket.sum += lobbyMean + zv / opts.PRODUCTION_Z_PER_TIER - tier
      bucket.n++
      roleTotals.set(appearance.role, bucket)
    }
  }
  const roleOffset = new Map<Job, number>()
  for (const [role, { sum, n }] of roleTotals) {
    // A role too thinly represented to average is left uncorrected rather than
    // corrected by a number built from a handful of games.
    if (n >= MIN_ROLE_SAMPLE) roleOffset.set(role, sum / n)
  }

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
    let estimateSum = 0
    let productionGames = 0
    let latent = currentTier

    for (const match of oldestFirst) {
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

      // The production estimate. A player's z says how far above the standard of
      // THAT lobby they played, so the lobby's own mean tier is the baseline the
      // z is added to — a strong game against tier 9s means more than the same
      // game against tier 4s, without needing a separate schedule correction.
      const z = zByMatch.get(match.id)?.get(name)
      const appearance = production.get(match.id)?.get(name)
      if (z !== undefined && appearance !== undefined) {
        const lobbyTiers = [...match.red_tiers, ...match.blue_tiers]
        const lobbyMean = lobbyTiers.reduce((a, b) => a + b, 0) / lobbyTiers.length
        const offset = roleOffset.get(appearance.role) ?? 0
        estimateSum += lobbyMean + z / opts.PRODUCTION_Z_PER_TIER - offset
        productionGames++
      }

      // One evaluation per MIN_GAMES games, on the evidence gathered so far.
      // Capped at WINDOW_CAP so a long unbroken run at one tier does not let
      // ancient form keep voting.
      if (productionGames > 0 && productionGames % opts.MIN_GAMES === 0 && productionGames <= opts.WINDOW_CAP) {
        const estimate = estimateSum / productionGames
        const stepped = latent + opts.NUDGE_RATE * (estimate - latent)
        latent = Math.min(
          currentTier + opts.MAX_DRIFT,
          Math.max(currentTier - opts.MAX_DRIFT, stepped),
        )
      }
    }

    if (games < opts.MIN_GAMES) continue
    // No scoreboard, no move. Falling back to the win-rate rule here would
    // reinstate exactly the behaviour this replaced.
    if (productionGames < opts.MIN_GAMES) continue

    // One tier per write, always. The latent may sit up to MAX_DRIFT away — a
    // genuinely two-tier misplacement needs to keep earning it — but a player
    // never moves more than a single tier at a time, because a two-tier jump is
    // both alarming to the person it happens to and harder for an admin to
    // sanity-check. After the move the evidence window resets and the latent
    // restarts from the new tier, so the second step has to be earned again.
    const rounded = Math.max(1, Math.min(10, Math.round(latent)))
    const to = Math.max(currentTier - 1, Math.min(currentTier + 1, rounded))
    if (to === currentTier) continue

    const actualWinRate = wins / games
    const expectedWinRate = expectedSum / games
    moves.push({
      name,
      from: currentTier,
      to,
      actualWinRate,
      expectedWinRate,
      gap: actualWinRate - expectedWinRate,
      games,
      estimatedTier: estimateSum / productionGames,
      latent,
      productionGames,
    })
  }

  return moves
}

/** How many snapshot-bearing matches the runner fetches. WINDOW_CAP games per
 * player is the most that can matter; 300 recent matches is months of play. */
/** Exactly the columns calibrationProduction reads. */
const CALIBRATION_STAT_COLUMNS =
  "match_id, player_id, team, captures, flag_grabs, flag_hold_ms, returns, assists, " +
  "base_cleaner, mine_kills, mine_grabs_red, mine_grabs_blue, mine_returns, time_played"

type CalibrationStatRow = ProductionStatRow & { match_id: string; player_id: string }

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

export type CalibrationInputs = {
  matches: CalibrationMatch[]
  currentTiers: Map<string, number>
  lastTierChangeAt: Map<string, string>
  idByName: Map<string, string>
  /** Empty when scoreboards could not be read — which means nobody moves. */
  production: ProductionByMatch
}

/**
 * Everything computeTierMoves needs, read in one round trip. Shared so the
 * save-path runner and the admin panel's preview cannot drift apart: they ran
 * separate hand-rolled versions of this query and of the maths for months, and
 * disagreed on draws, the window and duplicate names by the end of it.
 *
 * `since` bounds both the match history and the reset log — pass the switch's
 * last enable to see exactly what the engine would act on, or null to read the
 * most recent matches with no lower bound. Bounding the two together is what
 * keeps them consistent: a reset older than the oldest match in scope cannot
 * exclude anything that is in scope.
 *
 * Throws rather than returning a partial read: calibrating on half the evidence
 * is worse than not calibrating. Both callers already catch.
 */
export async function fetchCalibrationInputs(
  supabase: SupabaseClient,
  since: string | null,
): Promise<CalibrationInputs> {
  let matchQuery = supabase
    .from("matches")
    .select("id, red_team, blue_team, red_tiers, blue_tiers, red_score, blue_score, created_at")
    .not("red_tiers", "is", null)
    .not("blue_tiers", "is", null)
    .order("created_at", { ascending: false })
    .limit(RUNNER_MATCH_FETCH)
  // `hidden` is deliberately not filtered — it hides a row from the public
  // changelog, it does not un-happen the tier move.
  //
  // Ordered newest-first purely as insurance: lastTierChangeByName compares
  // timestamps and does not care about order, but PostgREST caps an unpaged
  // select at 1000 rows, and the row this needs is each player's LATEST. At 119
  // rows the cap is years away; ordering means that when it does arrive it
  // truncates the oldest changes rather than an arbitrary thousand, which is
  // the difference between losing nothing and silently reviving the very bug
  // this bound exists to close.
  let changeQuery = supabase.from("tier_changes").select("player_id, changed_at").order("changed_at", { ascending: false })
  if (since) {
    matchQuery = matchQuery.gte("created_at", since)
    changeQuery = changeQuery.gte("changed_at", since)
  }

  const [
    { data: players, error: playersError },
    { data: matches, error: matchesError },
    { data: tierChanges, error: tierChangesError },
  ] = await Promise.all([supabase.from("players").select("id, name, tier_value"), matchQuery, changeQuery])

  const failure = playersError || matchesError || tierChangesError
  if (failure) throw new Error(failure.message)
  if (!players) throw new Error("calibration: players returned no rows")

  const roster = players as PlayerRow[]
  const rows = (matches ?? []) as CalibrationMatch[]

  // Scoreboards for exactly those matches. Fetched second because it needs their
  // ids; a failure here is NOT fatal — it leaves `production` empty, and an empty
  // map means no player clears the production floor, so nobody moves. Degrading
  // to "no moves" is correct; degrading to the old win-rate rule would not be.
  const production: ProductionByMatch = new Map()
  const nameById = new Map(roster.map((p) => [p.id, p.name]))
  if (rows.length > 0) {
    const { data: stats } = await supabase
      .from("match_stats")
      .select(CALIBRATION_STAT_COLUMNS)
      .in("match_id", rows.map((m) => m.id))
    const statRows = (stats ?? []) as unknown as CalibrationStatRow[]
    // Role detection compares a player's enemy-base mine rate against the pool's,
    // so the pool average is taken over exactly the rows being classified.
    const poolAwayMines =
      statRows.length > 0
        ? statRows.reduce((a, r) => a + awayMinesPerMinute(r), 0) / statRows.length
        : 0
    for (const row of statRows) {
      const name = nameById.get(row.player_id)
      if (!name) continue
      let board = production.get(row.match_id)
      if (!board) {
        board = new Map()
        production.set(row.match_id, board)
      }
      board.set(name, {
        points: calibrationProduction(row),
        role: detectAppearanceRole(row, poolAwayMines),
      })
    }
  }

  return {
    matches: rows,
    currentTiers: new Map(roster.map((p) => [p.name, p.tier_value])),
    lastTierChangeAt: lastTierChangeByName(roster, (tierChanges ?? []) as TierChangeRow[]),
    idByName: new Map(roster.map((p) => [p.name, p.id])),
    production,
  }
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

    const inputs = await fetchCalibrationInputs(service, enabledAt)
    const moves = computeTierMoves(
      inputs.matches,
      inputs.currentTiers,
      matchPlayers,
      inputs.lastTierChangeAt,
      inputs.production,
    )

    for (const move of moves) {
      const id = inputs.idByName.get(move.name)
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
