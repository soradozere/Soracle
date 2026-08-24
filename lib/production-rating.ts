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
 * WHY PER-MINUTE COUNTS, NOT Z-SCORES
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
 * Counting events per minute has no such floor: doing none of something scores zero,
 * not negative. Nothing cancels, the specialist keeps his strength, and a player who
 * split a match between two jobs lands in the same range instead of 1.3 sd below
 * both specialists -- one change fixing both failure modes.
 *
 * NO ROLE IS EVER DETECTED AT SCORING TIME. Role groups appear only in the offline
 * calibration that set PRICES below. Nobody is classified when they are ranked, so
 * swapping role mid-match costs nothing.
 *
 * WHERE THE PRICES COME FROM
 *
 * Sam ranked the stats by value, most to least: capture, return, BC kill, MINE GRAB,
 * assist, flag grab, mine kill/return, flag hold. That ordering is a judgement about
 * JK2 and is taken as given -- it cannot be derived here, because the only objective
 * arbiter (does it win games) has no signal in a league this balanced.
 *
 * Mine grabs were moved up from 6th to 4th deliberately, to close a support deficit:
 * a support player's whole measurable output is mine grabs and mine returns, so
 * pricing those near the bottom rated support mains near the bottom. Moving them
 * lifted support from 17% below the other groups to 12%. It does not fully close --
 * 3rd only reaches 10% -- because the scoreboard simply does not see much of what a
 * support player does.
 *
 * Kills were tried for the same purpose and REMOVED. They are a base cleaner stat
 * more than a support one (per minute vs pool: home +28%, support +9%, returns -8%,
 * attack -26%), so they lifted base cleaners hardest and barely moved support: 18%
 * -> 17%, and only 11% with kills priced as the largest item on the board, which
 * would contradict "K/D is not a viable stat to dictate leaderboard positions".
 *
 * What the data settles is the MAGNITUDES, because a ranking alone is ambiguous.
 * Read as price-per-event it buries captures at 3.8% of the board while BC kills
 * take 35.5%, purely because base cleans happen 16 times a game against a capture's
 * 0.87. Read as share-of-the-rating it puts captures at 22.8%, which is what the
 * ranking plainly means. The magnitudes are then tuned -- STRICTLY WITHIN Sam's
 * ordering, never reordering it -- until every role group's median player scores
 * the same:
 *
 *   mine grabs 6th, tuned ....... reliability 0.85, role gap 18%
 *   mine grabs 5th, tuned ....... reliability 0.84, role gap 16%
 *   mine grabs 4th, tuned ....... reliability 0.85, role gap 13%  (SHIPPED)
 *   mine grabs 3rd, tuned ....... reliability 0.84, role gap 11%
 *   Impact, for scale ........... reliability 0.56
 *
 * NOTE: an earlier version of this file claimed a 2% role gap. That figure was
 * measured against role labels that used SENTRY KILLS to identify support players --
 * a stat the board does not score. Measured against labels matching what is actually
 * scored, the honest number is the 13% above.
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
 * HONEST LIMIT: this is verified reliable -- it measures something real and stable --
 * but it is NOT verified to predict winning, because in this league nothing does. Do
 * not "improve" it by regressing it against match outcomes; that target is noise.
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
  /** The single job that contributed most, for display. Not used in scoring. */
  topJob: Job
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
 * Sam noticed a returner main sitting well below the cappers, and it was real. The
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
 * Sam's ordering still holds after the change: capture 24.6% of the board, return
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
 * The ORDER is Sam's ranking and must not be reshuffled. The magnitudes were tuned
 * within that order for role fairness — see the header. `mineGrabs` is one price
 * covering both own-base and enemy-base grabs (the same act, opposite ends of the
 * map); `mineKillRet` likewise covers mine kills and mine returns.
 */
const PRICES = {
  caps: 100,
  returns: 10.553,
  clears: 3.556,
  mineGrabs: 5.061,
  assists: 35.474,
  grabs: 2.576,
  mineKillRet: 4.045,
  hold: 1.959,
} as const

/**
 * How much of the spread in the final rating comes from W/L rather than production.
 *
 * Sam asked for it: a player can win without piling up numbers, and production alone
 * cannot see that. It is deliberately a minority share -- the Wins board is already
 * 100% W/L -- and it is applied to a player's win rate over the whole period, not
 * per match.
 *
 * It costs something, and the cost is real, because win rate here is statistically
 * indistinguishable from chance (see the header) -- so it adds spread without adding
 * signal. Measured:
 *
 *   0%  ... reliability 0.87, role gap 11%
 *   15% ... reliability 0.85, role gap 13%
 *   25% ... reliability 0.83, role gap 15%   (SHIPPED, Sam's call)
 *   30% ... reliability 0.81, role gap 16%
 *
 * Lowering this number improves both figures; raising it degrades both. It is the
 * single easiest dial to turn if the board ever looks too luck-driven.
 */
const WIN_SHARE = 0.25

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

/** Price per counter — the two mine prices are each shared across their pair. */
const PRICE_OF: Record<Counter, number> = {
  caps: PRICES.caps,
  grabs: PRICES.grabs,
  hold: PRICES.hold,
  clears: PRICES.clears,
  homeMines: PRICES.mineGrabs,
  mineKills: PRICES.mineKillRet,
  returns: PRICES.returns,
  assists: PRICES.assists,
  awayMines: PRICES.mineGrabs,
  mineReturns: PRICES.mineKillRet,
}

/** A match needs this many scoreboard rows before it counts as statted. */
const MIN_ROWS_FOR_STATTED_MATCH = 8

const T_MEAN = 50
const T_SPREAD = 12

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

  const scored = pool.map(([name, rs]) => {
    // Each match is one observation, averaged evenly: a 20-minute appearance and a
    // 60-minute one both describe a rate, so neither should outvote the other.
    const jobs: Record<Job, number> = { cap: 0, base: 0, returns: 0, support: 0 }
    for (const r of rs) {
      const counts = countsOf(r)
      const mins = minutesOf(r)
      for (const counter of COUNTERS) {
        jobs[JOB_OF[counter]] += (PRICE_OF[counter] * (counts[counter] / mins)) / rs.length
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
    topJob: s.topJob,
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
