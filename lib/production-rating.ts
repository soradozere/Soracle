/**
 * Production rating — a leaderboard built from what players actually did.
 *
 * WHY THIS EXISTS
 *
 * The Impact board (lib/impact-rating.ts) rates a month on results (win rate, ELO,
 * TrueSkill collapsed into one vote) plus score per game. Measured on Jun-Aug 2026,
 * the results half of that carries almost no signal:
 *
 *   observed spread of player win rates ................ sd 7.6 pts
 *   spread expected from chance alone, if every player
 *   were identical ..................................... sd 7.7 pts
 *   real skill spread (bootstrap, 30 players) .......... sd 0.0 pts, 95% CI 0.0-4.6
 *
 * It is not that nobody is carried. Stacks are real and they decide games: measuring
 * team strength by the two sides' production (no tiers involved, so a wrong tier
 * cannot bend it), the stronger side wins 76% of the most lopsided matches, and the
 * team-quality gap correlates 0.30 with who won. But across a season the draw
 * averages out -- each player's mean team advantage has 3.5x less spread than a
 * single match's, and correlates 0.00 with their own win rate. So no one is
 * systematically carried, yet every result is swung hard by the draw, which is what
 * buries the signal in a season win rate.
 *
 * Production is the half the draw cannot equalise, so this board rates that alone.
 *
 * WHY NON-NEGATIVE COUNTS, NOT Z-SCORES
 *
 * The obvious build -- z-score each job and add them up -- is wrong in a way that
 * looks fine until you read the board. A z-score measures distance from average, so
 * NOT DOING a job scores negative. August's second-best capper scored:
 *
 *   attack +1.10   home -0.66   returning -0.77   support -0.05   =>  -0.38
 *
 * His one real strength cancelled by three penalties for jobs he was never doing. A
 * -0.66 on base-cleaning does not mean he cleans badly; it means he was in the enemy
 * base, capping, which is the job.
 *
 * Counting priced events has no such floor: doing none of something scores zero, not
 * negative. Nothing cancels, the specialist keeps his strength, and a player who
 * split a match between two jobs lands in the same range instead of 1.3 sd below
 * both specialists -- one change fixing both failure modes.
 *
 * TOTALS, NOT RATES. A match total, averaged over matches played. Impact means impact
 * on the match, so half a match of work is half the impact; and averaging over
 * matches means turning up more often earns nothing. See the note in `scored`.
 *
 * NO ROLE IS DETECTED WHEN THE COMBINED BOARD IS SCORED. Every player has all four
 * jobs priced additively, so nobody is classified where they are ranked and swapping
 * role mid-match costs nothing. Detection exists (detectRole, CLASSIFIER_PRICE_OF)
 * but feeds only the By-role tables and the roles-played bar. Changing it cannot move
 * the combined ordering -- verified, not assumed.
 *
 * WHERE THE PRICES COME FROM
 *
 * They are FITTED to Sora's own judgement of real games, not chosen. Ten scoreboards
 * were labelled player by player into four impact buckets, giving 121 rated rows and
 * 464 within-match "A had more impact than B" pairs; the prices are the ones that
 * best order those pairs. Full derivation, measurements and caveats are on PRICES.
 *
 * An earlier build instead took Sora's STAT RANKING as fixed and tuned magnitudes
 * inside it for role fairness. That is what put a 4th-best base cleaner above the
 * best returner in the league, and it is superseded. Two later attempts to correct
 * that downstream -- rating within role cohorts, and equalising the four job pots --
 * both failed on a real board and are recorded on PRICES so they are not retried.
 *
 * OMISSIONS
 *
 * Sentry kills are gone. They mark who picks up sentry guns rather than who played
 * well, and on an earlier build their rarity gave them absurd leverage -- one sentry
 * kill outweighed 24 base cleans -- floating one player's support column to 53%
 * sentry kills off 1.5 a game.
 *
 * Kills and K/D are gone, for the reason above.
 *
 * Win is NOT in the priced list, but W/L does enter separately at WIN_SHARE below.
 *
 * HONEST LIMIT: this board is verified to AGREE WITH SORA -- 0.924 on labelled games
 * the fit never saw -- and that is the only external check it has ever had. It is NOT
 * verified to predict winning, because in this league nothing does. Do not "improve"
 * it by regressing it against match outcomes; that target is noise. Nor lean on
 * split-half reliability, which rewards a board for being consistent rather than
 * right: both superseded designs above scored well on it while being visibly wrong.
 */

import { ALL_TIME_MIN_MATCHES, MONTHLY_MIN_FRACTION } from "@/lib/impact-rating"

export { ALL_TIME_MIN_MATCHES, MONTHLY_MIN_FRACTION }

/** One scoreboard row. Every counter is nullable: older uploads predate some columns. */
export interface ProductionStatRow {
  match_id: string
  player_id: string
  team: string | null
  captures: number | null
  flag_grabs: number | null
  flag_hold_ms: number | null
  returns: number | null
  assists: number | null
  base_cleaner: number | null
  mine_kills: number | null
  mine_grabs_red: number | null
  mine_grabs_blue: number | null
  mine_returns: number | null
  /** Stored in MINUTES (scoreboard TIME-SUM), not seconds. */
  time_played: number | null
}

export interface ProductionMatch {
  id: string
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
}

export interface ProductionPlayer {
  id: string
  name: string
  tier_value: number | null
}

/** The four jobs, used for the breakdown bars only — never to classify a player. */
export type Job = "cap" | "base" | "returns" | "support"

export interface ProductionRow {
  name: string
  tier: number | null
  /** Presentation scale: 50 is an average month, 12 per standard deviation. */
  rating: number
  /** The raw index — priced production per minute. */
  value: number
  /** How many index points each job contributed. Always >= 0; they sum to `value`. */
  jobs: Record<Job, number>
  /**
   * Each job on the SAME 50/12 scale as `rating` — 50 is an average month at that
   * job, 62 is a standard deviation above.
   *
   * Raw index points are not comparable between jobs: a capper's 8.3 and a base
   * cleaner's 7.8 look like a gap when they are both roughly the best in the month at
   * their own job. Standardising each column separately means "Base 88" reads exactly
   * like "Cap 88". Display only — scoring never uses these.
   */
  jobRatings: Record<Job, number>
  /**
   * Whether the player did enough of each job for its rating to mean anything.
   *
   * A player who never plays support still gets a Support NUMBER, because the column
   * is standardised — and a number below 50 reads as a mark against them even though
   * doing none of a job costs exactly nothing in the scoring. Sora misread it that way
   * within a day of the board going up, so the UI shows a dash instead when this is
   * false. Display only.
   */
  jobPlayed: Record<Job, boolean>
  /** The single job that contributed most, for display. Not used in scoring. */
  topJob: Job
  /**
   * The role this player was detected as playing MOST OFTEN, and how many of their
   * matches that was. Used only by the "By role" view.
   */
  mainRole: Job
  /** How many matches this player was detected in each role. */
  rolesPlayed: Record<Job, number>
  /**
   * Rating among players doing the SAME job, counting ONLY the matches where this
   * player was detected in that role. 50 is an average performance at that job.
   * Null where they have too few matches in it to say anything.
   *
   * This is the number that answers "who is the best BC this month" — the ordinary
   * `jobRatings.base` cannot, because it averages a player's base output across
   * every match INCLUDING the ones where they played something else. Interlude
   * base-cleaned in 4 of 34 August matches; dividing that by 34 ranks him 6th, when
   * among actual base-cleaning performances he is 1st.
   *
   * A player appears in EVERY role they played enough of, deliberately. Filing a
   * four-role player under one "main" role would hide exactly the versatility that
   * makes them hard to rate.
   */
  roleRatings: Record<Job, number | null>
  games: number
  minutes: number
  wins: number
  losses: number
  draws: number
  winPct: number
  /** Index points added (or removed) by W/L, so the split is visible. */
  winAdjustment: number
  captures: number
  grabs: number
  returns: number
  assists: number
  clears: number
  mineKills: number
  homeMines: number
  awayMines: number
  mineReturns: number
}

export interface ProductionBoard {
  rows: ProductionRow[]
  minGames: number
  stattedMatches: number
  totalMatches: number
}

/**
 * WHAT AN ASSIST IS (investigated 24 Aug 2026, because it looked like a bug)
 *
 * Assists correlate 0.95 with returns per minute across players, which looked like
 * the same act being priced twice. It is not. Measured:
 *
 *   my assists vs MY OWN captures ........... r = -0.21   (negative)
 *   my assists vs MY TEAMMATES' captures .... r = +0.46
 *   team assists vs team CAPTURES ........... r =  0.83, ~1.25 assists per capture
 *   team assists vs team RETURNS ............ r =  0.44
 *
 * So an assist is a CAPTURE assist -- you helped someone else score, which is why it
 * runs negative against your own captures. The count on a team is set by how many
 * caps that team made; who collects them is mostly the players also returning, which
 * is where the 0.95 came from. Co-occurrence, not duplication.
 *
 * They are also load-bearing. Removing them collapses the returner group and takes
 * the role gap from 19% to 33%. Moving them from the Return job to the Cap job
 * changes no rankings at all -- only which column displays them -- so they are left
 * with the returners who actually earn them.
 */

/**
 * RETURNS WERE UNDER-PRICED (corrected 24 Aug 2026)
 *
 * Sora noticed a returner main sitting well below the cappers, and it was real. The
 * returner group's median was 14% below cap and base — the constrained tuner could
 * not lift it further without breaking his stat ordering, so it stopped short.
 *
 * Multiplying the Return job (returns and assists) by 1.3 costs nothing measurable
 * and fixes it:
 *
 *   current ......... reliability 0.83, role gap 15%, returner median 14% low
 *   x1.3 ............ reliability 0.83, role gap 15%, returner median  4% low
 *   x1.6 ............ reliability 0.83, role gap 22%  (overshoots — returners
 *                     then out-earn cappers, 9.2 against 8.5)
 *
 * Sora's ordering still holds after the change: capture 24.6% of the board, return
 * 21.8%, BC kill 14.5%, mine grab 13.9%, assist 10.6%, flag grab 6.5%.
 *
 * WHAT THIS DOES NOT FIX, and cannot: the best returner is only 22% better than the
 * second-best, while the best capper is 77% better than his nearest rival and the
 * best base cleaner 57%. Everyone returns about 8 times a game, so returning is a
 * compressed skill — there is less room at the top of it. That is a property of the
 * game, not of the pricing, and no weighting changes it. A pure returner is never
 * PENALISED (doing none of a job scores zero, never negative), but a player who
 * returns and also caps does genuinely earn from two jobs.
 */

/**
 * What one of each event is worth, with a capture set to 100.
 *
 * FITTED TO SORA'S OWN JUDGEMENT, not chosen. Ten scoreboards were labelled player
 * by player into four impact buckets — carried it, big game, did the job, quiet —
 * giving 121 rated rows and 464 "A had more impact than B" pairs within a match.
 * These prices are the ones that order those pairs best, fitted by non-negative
 * logistic regression on the pairwise loss.
 *
 * Measured by leave-one-board-out, fitting on nine boards and testing on the tenth:
 *
 *   these prices ................ 0.924 agreement with Sora
 *   the previous prices ......... 0.828
 *   in-game SCORE column ........ 0.935  (see below)
 *   coin flip ................... 0.500
 *
 * The gain sits where it matters: on pairs one bucket apart — the close calls —
 * agreement goes 0.778 -> 0.900, and on pairs involving a base cleaner, 0.727 ->
 * 0.906. Match length is not doing the work; minutes played alone scores 0.527.
 *
 * WHAT CHANGED, AND WHY IT MATTERED
 *
 * Against a capture at 100, a base clean was 3.56 and is now 7.04, while a return
 * went 10.55 -> 21.11. Both roughly doubled, so what actually moved is everything
 * measured AGAINST them: base cleaning is far and away the most common event on the
 * board, so doubling the rarer stats around it halves its effective weight. That
 * single change is what had a 4th-best base cleaner out-ranking the best returner
 * in the league, and repricing fixed at source what two earlier designs
 * tried to patch downstream: rating within role groups (specialists then dominated)
 * and equalising the job pots (support inflated 4x and the best returner fell to
 * 13th). Neither survived contact with a real board. This does.
 *
 * THIS BREAKS SORA'S STAT RANKING, DELIBERATELY AND WITH HIS SIGN-OFF. The ranking
 * was capture > return > BC kill > mine grab > assist > flag grab > mine kill/return
 * > flag hold. The fit puts assists second and flag hold above flag grabs. It is his
 * own judgement either way -- a stated ordering against a hundred concrete calls on
 * real games -- and the concrete calls won.
 *
 * The mine prices are no longer shared across their pairs, because the fit
 * separates them cleanly: a mine grabbed in the ENEMY base is worth 5.2 and one
 * grabbed at home is worth nothing measurable (0.003 +/- 0.009 across folds). Same
 * act, opposite ends of the map, and only one of them is support work.
 *
 * A CAVEAT WORTH KEEPING. The game's own SCORE column scores 0.935 on these
 * buckets by itself, beating this fit, and score is ~92% reconstructible as a price
 * set of its own. Some of that lead is likely circular -- the score column is
 * visible on the screenshots that were being labelled -- and blending the two beats
 * either alone (0.938). It is not used here, but it is the obvious next thing to try.
 */
const PRICES = {
  caps: 100,
  assists: 63.02,
  returns: 21.11,
  mineReturns: 12.49,
  hold: 7.66,
  clears: 7.04,
  awayMines: 5.21,
  mineKills: 3.79,
  grabs: 0.54,
  homeMines: 0,
} as const

/**
 * How much of the spread in the final rating comes from W/L rather than production.
 *
 * Sora asked for it: a player can win without piling up numbers, and production alone
 * cannot see that. It is deliberately a minority share -- the Wins board is already
 * 100% W/L -- and it is applied to a player's win rate over the whole period, not
 * per match.
 *
 * WINNING IS REAL EVIDENCE OF IMPACT, which earlier versions of this comment got
 * wrong. On the ten labelled boards, players on the winning side average a much
 * better impact bucket than the losers (2.50 against 3.18, Cohen's d 0.77): 17% of
 * winners were rated as having carried the game against 2% of losers, and 8% of
 * winners were rated quiet against 38% of losers. The "win rate is indistinguishable
 * from chance" finding in the header is about a player's SEASON win rate, and does
 * not transfer to a single match.
 *
 * The season dial is a different question, though, and the labels put it lower than
 * this: fitting a per-match win bonus to them lands around 10%. Winning says a lot
 * about one match, but season win rates compress -- across August they spread over
 * 11 points against production's 124 -- so the same evidence stretched over a month
 * has far less to grip on.
 *
 * Re-measured under the fitted prices, on totals:
 *
 *   0%  ... reliability 0.82, role gap  9%
 *   10% ... reliability 0.81, role gap  9%    (what the labels imply)
 *   15% ... reliability 0.79, role gap 13%
 *   25% ... reliability 0.77, role gap 21%
 *   30% ... reliability 0.75, role gap 24%    (SHIPPED, Sora's call)
 *   40% ... reliability 0.71, role gap 28%
 *
 * Raising it degrades both figures, and it buys very little movement: 25% -> 30%
 * swaps two adjacent pairs and leaves the top nine untouched. Sora set it here
 * knowing that, because a board that ignores winning reads wrong to the people on
 * it. Do not "fix" it downward without asking him.
 *
 * NOTE when measuring this: a split-half test must compute each half's win rate
 * from that half's OWN matches. Sharing one season figure across both halves puts
 * an identical number in each, which inflates agreement rather than testing it --
 * and inflates it more the higher the share, so the metric ends up endorsing
 * exactly what it cannot check. That mistake reverses the table above.
 */
export const WIN_SHARE = 0.3

/**
 * Which stats roll up into which job, for the breakdown display only.
 *
 * Mine grabs are the one stat that needs the team to read: picking mines up in your
 * OWN base is base-cleaning, picking them up in the ENEMY base is support. Same
 * column, same price, opposite jobs — so it is split by which side the player was on.
 */
const JOB_OF = {
  caps: "cap",
  grabs: "cap",
  hold: "cap",
  clears: "base",
  homeMines: "base",
  mineKills: "base",
  returns: "returns",
  assists: "returns",
  awayMines: "support",
  mineReturns: "support",
} as const satisfies Record<string, Job>

type Counter = keyof typeof JOB_OF

/**
 * A SEPARATE price table used only to work out which job someone was doing.
 *
 * Scoring and classifying are different questions -- "what is this act worth"
 * against "what was this player busy doing" -- and the fitted scoring prices are
 * measurably worse at the second. They price a home mine grab at zero and a flag
 * grab at 0.5, which is right for value and useless for detection: those are two
 * of the clearest signals that somebody was holding base or running the flag.
 *
 * Measured against the same ten labelled boards, on the 114 rows whose labelled
 * role maps onto one of the four jobs:
 *
 *   scoring prices as classifier ....... 0.895
 *   these prices as classifier ......... 0.939   (cap 0.82 -> 0.90, base 0.94 -> 1.00)
 *
 * A grid search over the two support thresholds found nothing better than 0.939,
 * so they are left where they are rather than tuned to this small a sample.
 *
 * These are the board's own previous scoring prices, kept because they classify
 * well, NOT because they were ever right about value. Do not read them as prices.
 */
const CLASSIFIER_PRICE_OF: Record<Counter, number> = {
  caps: 100,
  grabs: 2.576,
  hold: 1.959,
  clears: 3.556,
  homeMines: 5.061,
  mineKills: 4.045,
  returns: 10.553,
  assists: 35.474,
  awayMines: 5.061,
  mineReturns: 4.045,
}

/** Price per counter. One price per counter now — see PRICES on the mine split. */
const PRICE_OF: Record<Counter, number> = {
  caps: PRICES.caps,
  grabs: PRICES.grabs,
  hold: PRICES.hold,
  clears: PRICES.clears,
  homeMines: PRICES.homeMines,
  mineKills: PRICES.mineKills,
  returns: PRICES.returns,
  assists: PRICES.assists,
  awayMines: PRICES.awayMines,
  mineReturns: PRICES.mineReturns,
}

/**
 * How much production moves per point of opponent strength.
 *
 * Measured within players (each player's own average removed, so it is not just
 * "good players meet good players") over Jun-Aug 2026: -1.021 production points per
 * point of opponent strength, estimated across a per-match opponent-strength range
 * of sd 0.507, so it is identified over a real spread rather than extrapolated.
 *
 * Sora raised this: a player whose lobbies are consistently weaker is flattered by
 * the raw numbers. That is true and measurable -- ben faces the weakest opposition
 * of all 32 players (7.65 against a pool average of 8.11), worth about 5% of his
 * production.
 *
 * It is applied at 1x the measured slope, not more. Reliability is flat at every
 * strength tested (0.826 unadjusted, 0.827 at 1x, 0.824 at 2x, 0.827 at 3x), so
 * there is no evidence for a bigger correction, and a bigger one would be inventing
 * a number. Note the slope cannot speak to lobbies far outside the observed range --
 * whether a player would be truly decimated in an elite lobby is beyond what this
 * data can say.
 *
 * Season-long it changes little, because schedule luck largely averages out: the
 * spread of players' average opponent strength is sd 0.137 against sd 1.614 for
 * production itself, about a ninth. On August it moved nobody more than one place.
 * It is here because it is correct and free, not because it reorders the board.
 */
const OPPONENT_SLOPE = -1.021

/** A match needs this many scoreboard rows before it counts as statted. */
const MIN_ROWS_FOR_STATTED_MATCH = 8

const T_MEAN = 50
const T_SPREAD = 12

/**
 * Below this share of the pool average for a job, the player is treated as not
 * having played it and the column shows a dash rather than a number.
 */
const JOB_PLAYED_FRACTION = 0.3

const n = (v: number | null | undefined) => v ?? 0
const minutesOf = (r: ProductionStatRow) => Math.max(n(r.time_played), 1)

const homeMinesOf = (r: ProductionStatRow) =>
  (r.team ?? "").toLowerCase() === "red" ? n(r.mine_grabs_red) : n(r.mine_grabs_blue)
const awayMinesOf = (r: ProductionStatRow) =>
  (r.team ?? "").toLowerCase() === "red" ? n(r.mine_grabs_blue) : n(r.mine_grabs_red)

/** Raw counts for one scoreboard row, before any pricing. */
function countsOf(r: ProductionStatRow): Record<Counter, number> {
  return {
    caps: n(r.captures),
    grabs: n(r.flag_grabs),
    hold: n(r.flag_hold_ms) / 60000,
    clears: n(r.base_cleaner),
    homeMines: homeMinesOf(r),
    mineKills: n(r.mine_kills),
    returns: n(r.returns),
    assists: n(r.assists),
    awayMines: awayMinesOf(r),
    mineReturns: n(r.mine_returns),
  }
}

const COUNTERS = Object.keys(JOB_OF) as Counter[]

/** The four jobs, in display order. */
const JOBS: Job[] = ["cap", "base", "returns", "support"]

const sumOf = (rows: ProductionStatRow[], fn: (r: ProductionStatRow) => number) =>
  rows.reduce((a, r) => a + fn(r), 0)

/**
 * Build the board.
 *
 * Unlike Impact, match ORDER does not matter — there is no running rating to replay,
 * only production to average. Matches without a scoreboard cannot contribute anything
 * and are ignored rather than counted as a blank game.
 */
/**
 * How evenly a match's production is spread across the four jobs, 0 to 1.
 *
 * Normalised entropy: 1.0 is perfectly even across all four, 0 is everything in one.
 * This is the support signal. Measured against 119 hand-labelled player-matches,
 * support is the ONLY role that plays broadly -- median breadth 0.885 and meaningful
 * output in all four jobs, against 0.30-0.58 and one or two jobs for every other
 * role. Every other role concentrates; support does not, which is what makes it
 * findable at all.
 */
function breadthOf(jobs: Record<Job, number>): number {
  const total = JOBS.reduce((t, j) => t + jobs[j], 0)
  if (total <= 0) return 0
  let h = 0
  for (const j of JOBS) {
    const p = jobs[j] / total
    if (p > 0) h -= p * Math.log(p)
  }
  return h / Math.log(4)
}

/**
 * Matches in a role before that role gets a rating.
 *
 * Deliberately low, because the interesting cases are versatile players with a
 * handful of matches in a second role — and excluding them is exactly the dilution
 * problem this view exists to fix. The UI shows the game count next to every rating
 * so a 4-game number can be read with appropriate suspicion.
 */
const MIN_ROLE_GAMES = 3

/** Breadth at or above this, plus the enemy-mine test, marks a support game. */
const SUPPORT_BREADTH = 0.7
/** Enemy-base mine grabs this many times the pool average, for a support game. */
const SUPPORT_AWAY_MINES = 1.5

/**
 * Which job a player was actually doing in one match.
 *
 * Support is checked FIRST and separately, because it cannot be found by "which job
 * scored highest" -- a support player's biggest single bucket is usually base, not
 * support, so the obvious test misfiles them. Everyone else is simply their top job,
 * which hand-labelled data gets exactly right: 39/39 cappers, 18/18 base cleaners
 * and 38/38 chase+camp were identified correctly by top job alone.
 *
 * The support rule comes from Interlude, who put it better than the data did:
 * supporters almost never pick up their OWN mines but pick up a lot of the enemy's.
 * That is measurably true -- own-base mines are 0.885/min for a base cleaner against
 * 0.013 for support, and enemy-base mines are 0.246/min for support against 0.000
 * for a base cleaner. It is the cleanest separator in the scoreboard.
 */
function detectRole(jobs: Record<Job, number>, awayMinesPerMin: number, poolAwayMines: number): Job {
  if (breadthOf(jobs) >= SUPPORT_BREADTH && awayMinesPerMin >= SUPPORT_AWAY_MINES * poolAwayMines) {
    return "support"
  }
  return JOBS.reduce((a, b) => (jobs[b] > jobs[a] ? b : a))
}

export function computeProductionBoard(
  matches: ProductionMatch[],
  statRows: ProductionStatRow[],
  players: ProductionPlayer[],
  options: { minGames: number } | { minGamesFraction: number },
): ProductionBoard {
  const nameById = new Map(players.map((p) => [p.id, p.name]))
  const tierByName = new Map(players.map((p) => [p.name, p.tier_value]))
  const matchIds = new Set(matches.map((m) => m.id))

  const rowsByMatch = new Map<string, ProductionStatRow[]>()
  for (const r of statRows) {
    if (!matchIds.has(r.match_id)) continue
    const list = rowsByMatch.get(r.match_id)
    if (list) list.push(r)
    else rowsByMatch.set(r.match_id, [r])
  }
  const stattedIds = new Set(
    [...rowsByMatch.entries()]
      .filter(([, rs]) => rs.length >= MIN_ROWS_FOR_STATTED_MATCH)
      .map(([id]) => id),
  )

  const minGames =
    "minGames" in options ? options.minGames : Math.ceil(stattedIds.size * options.minGamesFraction)

  const rowsByPlayer = new Map<string, ProductionStatRow[]>()
  for (const id of stattedIds) {
    for (const r of rowsByMatch.get(id) ?? []) {
      const name = nameById.get(r.player_id)
      if (!name) continue
      const list = rowsByPlayer.get(name)
      if (list) list.push(r)
      else rowsByPlayer.set(name, [r])
    }
  }

  // W/L record across every match in scope, statted or not — a win is a win.
  interface WinRecord { wins: number; losses: number; draws: number; played: number }
  const record = new Map<string, WinRecord>()
  for (const m of matches) {
    const redWon = m.red_score > m.blue_score
    const blueWon = m.blue_score > m.red_score
    for (const [team, won, lost] of [
      [m.red_team, redWon, blueWon],
      [m.blue_team, blueWon, redWon],
    ] as const) {
      for (const name of team ?? []) {
        let rec = record.get(name)
        if (!rec) {
          rec = { wins: 0, losses: 0, draws: 0, played: 0 }
          record.set(name, rec)
        }
        rec.played++
        if (won) rec.wins++
        else if (lost) rec.losses++
        else rec.draws++
      }
    }
  }

  const pool = [...rowsByPlayer.entries()].filter(([, rs]) => rs.length >= minGames)
  const empty: ProductionBoard = {
    rows: [],
    minGames,
    stattedMatches: stattedIds.size,
    totalMatches: matches.length,
  }
  if (pool.length === 0) return empty

  // Pass 1: raw production per scoreboard row, and each player's average, so the
  // strength of a side can be measured from what its players usually produce.
  const rawOf = (r: ProductionStatRow) => {
    const counts = countsOf(r)
    const mins = minutesOf(r)
    return COUNTERS.reduce((sum, c) => sum + PRICE_OF[c] * (counts[c] / mins), 0)
  }
  const career = new Map<string, { n: number; sum: number }>()
  for (const rs of rowsByPlayer.values()) {
    for (const r of rs) {
      const key = r.player_id
      const e = career.get(key) ?? { n: 0, sum: 0 }
      e.n++
      e.sum += rawOf(r)
      career.set(key, e)
    }
  }
  /**
   * A player's usual production EXCLUDING the match being judged, so a strong
   * performance cannot inflate the very opposition rating it is measured against.
   */
  const usualOf = (r: ProductionStatRow) => {
    const e = career.get(r.player_id)
    if (!e || e.n < 2) return null
    return (e.sum - rawOf(r)) / (e.n - 1)
  }

  // Pass 2: opponent strength per row — the mean usual production of the other side.
  const oppOf = new Map<string, number>()
  for (const id of stattedIds) {
    const side = rowsByMatch.get(id) ?? []
    for (const r of side) {
      const others = side.filter((x) => (x.team ?? "") !== (r.team ?? ""))
      const usual = others.map(usualOf).filter((v): v is number => v != null)
      if (usual.length > 0) {
        oppOf.set(`${r.match_id}|${r.player_id}`, usual.reduce((a, b) => a + b, 0) / usual.length)
      }
    }
  }
  const allOpp = [...oppOf.values()]
  const poolOpp = allOpp.length > 0 ? allOpp.reduce((a, b) => a + b, 0) / allOpp.length : 0

  // Pass 3: what job was each player actually doing in each match, and how good was
  // that performance compared to OTHERS DOING THE SAME JOB.
  //
  // This exists because averaging a player's base output over every match answers
  // the wrong question. Interlude base-cleaned in 4 of 34 August matches; the plain
  // Base column divides his real base work by 34 and ranks him 6th, when among
  // actual base-cleaning performances he is 1st. Same for anyone who switches.
  const poolAwayMines = (() => {
    let sum = 0
    let n = 0
    for (const rs of rowsByPlayer.values()) {
      for (const r of rs) {
        sum += awayMinesOf(r) / minutesOf(r)
        n++
      }
    }
    return n > 0 ? sum / n : 0
  })()

  /** One scored match: what was played, and how much was produced doing it. */
  interface RoleGame {
    role: Job
    produced: number
  }
  const roleGamesOf = new Map<string, RoleGame[]>()
  for (const [name, rs] of rowsByPlayer) {
    const games: RoleGame[] = []
    for (const r of rs) {
      const counts = countsOf(r)
      const mins = minutesOf(r)
      // WHICH job, from the classifier prices; HOW MUCH of it, from the real ones.
      const shape: Record<Job, number> = { cap: 0, base: 0, returns: 0, support: 0 }
      const jobs: Record<Job, number> = { cap: 0, base: 0, returns: 0, support: 0 }
      for (const c of COUNTERS) {
        shape[JOB_OF[c]] += CLASSIFIER_PRICE_OF[c] * (counts[c] / mins)
        jobs[JOB_OF[c]] += PRICE_OF[c] * (counts[c] / mins)
      }
      const role = detectRole(shape, awayMinesOf(r) / mins, poolAwayMines)
      games.push({ role, produced: jobs[role] })
    }
    roleGamesOf.set(name, games)
  }

  // Cohort baselines: mean and spread of production BY PLAYERS DOING THAT JOB.
  const cohort = {} as Record<Job, { mean: number; sd: number }>
  for (const job of JOBS) {
    const vals: number[] = []
    for (const games of roleGamesOf.values()) {
      for (const g of games) if (g.role === job) vals.push(g.produced)
    }
    const m = vals.length > 0 ? vals.reduce((a, b) => a + b, 0) / vals.length : 0
    const sd = vals.length > 1 ? Math.sqrt(vals.reduce((a, v) => a + (v - m) ** 2, 0) / vals.length) : 1
    cohort[job] = { mean: m, sd: sd || 1 }
  }

  const scored = pool.map(([name, rs]) => {
    /**
     * MATCH TOTALS, NOT PER-MINUTE RATES.
     *
     * Sora's call, and the labelled boards back it: impact means impact on the
     * match, so half a match of work is half the impact, not the same impact at
     * the same rate. Held-out agreement with his buckets is 0.924 on totals
     * against 0.913 on rates.
     *
     * Each match is still ONE observation, averaged over matches played — a
     * player who turns up more often is not thereby more impactful, so this is a
     * mean of per-match totals and never a season total.
     */
    const jobs: Record<Job, number> = { cap: 0, base: 0, returns: 0, support: 0 }
    for (const r of rs) {
      const counts = countsOf(r)
      const raw = rawOf(r)

      // Strength of schedule. Facing a stronger side suppresses production, so what
      // was produced against one is worth more. Spread across the jobs in proportion
      // to where the production came from, which keeps the jobs summing to the value
      // and keeps every one of them non-negative.
      //
      // `raw`, `opp` and OPPONENT_SLOPE all stay in the per-minute units the slope
      // was measured in; what comes out is a dimensionless RATIO, so it applies to
      // match totals unchanged and needed no recalibration when the board moved off
      // rates. Deriving the shift from totals instead would silently neuter it,
      // since a shift of ~1 against a total of ~600 rounds to no adjustment at all.
      const opp = oppOf.get(`${r.match_id}|${r.player_id}`)
      const shift = opp == null ? 0 : -OPPONENT_SLOPE * (opp - poolOpp)
      // Clamped so a single lopsided lobby cannot swing a match by more than half,
      // and can never drive a row's production below zero.
      const factor = raw > 0 ? Math.min(1.5, Math.max(0.5, (raw + shift) / raw)) : 1

      for (const counter of COUNTERS) {
        jobs[JOB_OF[counter]] += (factor * PRICE_OF[counter] * counts[counter]) / rs.length
      }
    }
    const value = jobs.cap + jobs.base + jobs.returns + jobs.support
    const topJob = (Object.keys(jobs) as Job[]).reduce((a, b) => (jobs[b] > jobs[a] ? b : a))
    return { name, rs, jobs, value, topJob }
  })

  // Blend in W/L. The multiplier is derived from the pool rather than fixed, so that
  // W/L accounts for WIN_SHARE of the spread whatever scale production happens to be
  // on this month — a fixed constant would drift as production values moved.
  const spread = (xs: number[]) => {
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    return Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / xs.length)
  }
  const winRateOf = (name: string) => {
    const rec = record.get(name)
    return rec && rec.played > 0 ? rec.wins / rec.played : 0.5
  }
  const prodSpread = spread(scored.map((s) => s.value)) || 1
  const winSpread = spread(scored.map((s) => winRateOf(s.name))) || 1e-9
  const alpha = (WIN_SHARE / (1 - WIN_SHARE)) * (prodSpread / winSpread)

  const withWin = scored.map((s) => {
    const winAdjustment = alpha * (winRateOf(s.name) - 0.5)
    return { ...s, winAdjustment, total: s.value + winAdjustment }
  })

  // The rating only presents the total: where a player sits against the rest of the
  // qualifying pool this month.
  const values = withWin.map((s) => s.total)
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sd = Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) || 1

  // Each job standardised across the pool, for display. A low number here means
  // "did little of this job", never a penalty — the scoring above is non-negative.
  const jobScale = {} as Record<Job, { mean: number; sd: number }>
  for (const job of JOBS) {
    const xs = scored.map((s) => s.jobs[job])
    const m = xs.reduce((a, b) => a + b, 0) / xs.length
    jobScale[job] = {
      mean: m,
      sd: Math.sqrt(xs.reduce((a, v) => a + (v - m) ** 2, 0) / xs.length) || 1,
    }
  }

  const jobMean = Object.fromEntries(
    JOBS.map((job) => [job, scored.reduce((t, s) => t + s.jobs[job], 0) / scored.length]),
  ) as Record<Job, number>

  const rows: ProductionRow[] = withWin.map((s) => {
    const rec = record.get(s.name)
    return {
    name: s.name,
    tier: tierByName.get(s.name) ?? null,
    rating: Math.round(T_MEAN + (T_SPREAD * (s.total - mean)) / sd),
    value: s.value,
    jobs: s.jobs,
    jobRatings: Object.fromEntries(
      JOBS.map((job) => [
        job,
        Math.round(T_MEAN + (T_SPREAD * (s.jobs[job] - jobScale[job].mean)) / jobScale[job].sd),
      ]),
    ) as Record<Job, number>,
    jobPlayed: Object.fromEntries(
      JOBS.map((job) => [job, s.jobs[job] >= jobMean[job] * JOB_PLAYED_FRACTION]),
    ) as Record<Job, boolean>,
    topJob: s.topJob,
    ...(() => {
      const games = roleGamesOf.get(s.name) ?? []
      const counts: Record<Job, number> = { cap: 0, base: 0, returns: 0, support: 0 }
      for (const g of games) counts[g.role]++
      const mainRole = JOBS.reduce((a, b) => (counts[b] > counts[a] ? b : a))
      const ratings = Object.fromEntries(
        JOBS.map((job) => {
          const inRole = games.filter((g) => g.role === job)
          if (inRole.length < MIN_ROLE_GAMES) return [job, null]
          const avg = inRole.reduce((t, g) => t + g.produced, 0) / inRole.length
          const { mean: cm, sd: csd } = cohort[job]
          // Same 50/12 presentation as everything else, but the comparison group
          // is players doing this job, not the whole pool.
          return [job, Math.round(T_MEAN + (T_SPREAD * (avg - cm)) / csd)]
        }),
      ) as Record<Job, number | null>
      return { mainRole, rolesPlayed: counts, roleRatings: ratings }
    })(),
    games: s.rs.length,
    minutes: Math.round(sumOf(s.rs, minutesOf)),
    wins: rec?.wins ?? 0,
    losses: rec?.losses ?? 0,
    draws: rec?.draws ?? 0,
    winPct: rec && rec.played > 0 ? (rec.wins / rec.played) * 100 : 0,
    winAdjustment: s.winAdjustment,
    captures: sumOf(s.rs, (r) => n(r.captures)),
    grabs: sumOf(s.rs, (r) => n(r.flag_grabs)),
    returns: sumOf(s.rs, (r) => n(r.returns)),
    assists: sumOf(s.rs, (r) => n(r.assists)),
    clears: sumOf(s.rs, (r) => n(r.base_cleaner)),
    mineKills: sumOf(s.rs, (r) => n(r.mine_kills)),
    homeMines: sumOf(s.rs, homeMinesOf),
    awayMines: sumOf(s.rs, awayMinesOf),
    mineReturns: sumOf(s.rs, (r) => n(r.mine_returns)),
    }
  })

  // Sorted on production PLUS the W/L adjustment, which is what `rating` shows.
  rows.sort(
    (a, b) =>
      b.value + b.winAdjustment - (a.value + a.winAdjustment) ||
      b.games - a.games ||
      a.name.localeCompare(b.name),
  )
  return { rows, minGames, stattedMatches: stattedIds.size, totalMatches: matches.length }
}
