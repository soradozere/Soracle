/**
 * Impact Rating — four standings, summed.
 *
 * A player's Impact is the sum of where they stand on four measures of the month:
 *
 *     win rate  +  ELO  +  TrueSkill  +  average score per game
 *
 * Each is standardised across the qualified pool (a z-score: how many standard
 * deviations above or below the pool average) so that four quantities in four
 * different units can be added at all. The sum is shown on the same 50-centred
 * scale the other boards use.
 *
 * WHAT THIS DELIBERATELY IS NOT
 * -----------------------------
 * It is not weighted by role, and it does not read the roster at all. An earlier
 * version weighted two production pillars by each player's role ratings, which
 * meant every rating depended on a hand-set roster field, and a player rostered
 * for one job while playing another was scored on the wrong one. That is gone.
 * Nothing here needs maintaining except the match uploads.
 *
 * WHAT IT COSTS, MEASURED
 * -----------------------
 * Split the month's matches in half at random, rebuild the board on each half and
 * correlate the two across the qualified players (Spearman-Brown corrected). A
 * measure that is telling you something about a player agrees with itself:
 *
 *     this board (four standings summed) ......  0.25
 *     score per minute, on its own ............  0.87
 *     the role-weighted board this replaced ...  0.83
 *     win rate on its own .....................  0.13
 *
 * The reason the sum lands so low is that three of its four ingredients are very
 * nearly the same measurement. Over August 2026's qualified pool:
 *
 *     win rate vs ELO ............  0.969
 *     win rate vs TrueSkill ......  0.932
 *     ELO vs TrueSkill ...........  0.932
 *     win rate vs score per game .  0.247
 *
 * ELO and TrueSkill are both derived from nothing but who won, so over a single
 * month they are win rate with extra arithmetic. Summing all three weights that
 * one signal three times over against the one genuinely independent measure. And
 * win rate itself is close to noise inside a month, because in a balanced 6v6 the
 * other eleven players decide most of it.
 *
 * Kept because Sora asked to see it built rather than argued about. If it is to
 * stay, the cheapest single improvement is to drop ELO and TrueSkill from the sum:
 * they contribute almost nothing that win rate has not already contributed, and
 * every point of weight they take is weight off score per game.
 */

/** One match_stats row, narrowed to the columns this board reads. */
export interface ImpactStatRow {
  match_id: string
  player_id: string
  team: string | null
  score: number | null
  captures: number | null
  returns: number | null
  base_cleaner: number | null
  assists: number | null
  flag_grabs: number | null
  kills: number | null
  deaths: number | null
  time_played: number | null
}

/** One match, in the order it was played. */
export interface ImpactMatch {
  id: string
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
}

/** A roster entry. Only the name and tier are read, and the tier only for display. */
export interface ImpactPlayer {
  id: string
  name: string
  tier_value: number | null
}

export interface ImpactRow {
  name: string
  tier: number | null
  /** The summed standing, rendered on the 50-centred scale. What the board sorts on. */
  rating: number
  /** Sum of the four z-scores, before scaling. */
  value: number
  /** The four parts, so a reader can see which one moved them. */
  winRateZ: number
  eloZ: number
  trueSkillZ: number
  scoreZ: number
  games: number
  minutes: number
  wins: number
  losses: number
  draws: number
  winPct: number
  /** Last five results, oldest -> newest. */
  form: ("W" | "L" | "D")[]
  /** Monthly ELO, flat-seeded — every player starts the month level. */
  elo: number
  /** Monthly TrueSkill, the conservative mu - 3*sigma the TrueSkill board displays. */
  trueSkill: number
  scorePerGame: number
  scorePerMin: number
  captures: number
  returns: number
  clears: number
  assists: number
  grabs: number
  kills: number
  deaths: number
}

export interface ImpactBoard {
  rows: ImpactRow[]
  minGames: number
  stattedMatches: number
  totalMatches: number
}

// ---------------------------------------------------------------------------

/**
 * ELO constants, matching components/elo-leaderboard.tsx so the ELO column here
 * reads the same as the ELO board does.
 *
 * The seed is FLAT: every player starts the month on 1500, which is what makes
 * this a measure of the month rather than a restatement of their tier. The ELO
 * board's all-time view seeds from tier instead; seeding from tier here would mean
 * 88% of the column's spread was the tier it started from.
 */
const ELO_START = 1500
const ELO_K = 24
const ELO_SCALE = 400
const ELO_MARGIN_WEIGHT = 0.6

/** TrueSkill defaults, matching lib/trueskill.ts. */
const TS_MU = 25
const TS_SIGMA = 25 / 3
const TS_BETA = 25 / 6
const TS_TAU = 25 / 300
const TS_DRAW_PROB = 0.1

/** Share of the month's statted matches a player must appear in to be ranked. */
export const MONTHLY_MIN_FRACTION = 0.3

/** All-time bar. The 30% rule does not carry over — 30% of every match is nobody. */
export const ALL_TIME_MIN_MATCHES = 20

/** Fewest scoreboard rows for a match to count as statted (a 6v6 short a few). */
const MIN_ROWS_FOR_STATTED_MATCH = 8

/** Display scale. 50 is a pool-average month; 12 points is one standard deviation. */
const T_MEAN = 50
const T_SPREAD = 12

// ---------------------------------------------------------------------------

const n = (v: number | null | undefined) => v ?? 0
const minutesOf = (r: ImpactStatRow) => Math.max(r.time_played ?? 1, 1)
const sumOf = (rows: ImpactStatRow[], fn: (r: ImpactStatRow) => number) =>
  rows.reduce((a, r) => a + fn(r), 0)

/** Standardise, guarding a single-player pool and a pool where everyone is level. */
function zScores(values: number[]): number[] {
  if (values.length === 0) return []
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  const sd = Math.sqrt(values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length)
  if (!(sd > 0)) return values.map(() => 0)
  return values.map((v) => (v - mean) / sd)
}

/**
 * Replay ELO over a list of matches, oldest first.
 *
 * Same maths as the ELO board: expected result from the two team averages, then a
 * margin multiplier so a 7-0 moves the needle further than a 7-6, damped when the
 * favourite was already far ahead.
 */
function replayElo(matches: ImpactMatch[]): Map<string, number> {
  const elo = new Map<string, number>()
  const get = (name: string) => {
    if (!elo.has(name)) elo.set(name, ELO_START)
    return elo.get(name)!
  }
  for (const m of matches) {
    if (!m.red_team?.length || !m.blue_team?.length) continue
    const redAvg = m.red_team.reduce((s, x) => s + get(x), 0) / m.red_team.length
    const blueAvg = m.blue_team.reduce((s, x) => s + get(x), 0) / m.blue_team.length
    const expectedRed = 1 / (1 + Math.pow(10, (blueAvg - redAvg) / ELO_SCALE))
    const expectedBlue = 1 - expectedRed
    const redScore = m.red_score > m.blue_score ? 1 : m.red_score < m.blue_score ? 0 : 0.5
    const blueScore = 1 - redScore

    const margin = Math.abs(m.red_score - m.blue_score)
    let marginMult = 1
    if (margin > 1) {
      const winnerAvg = redScore === 1 ? redAvg : blueAvg
      const loserAvg = redScore === 1 ? blueAvg : redAvg
      const autocorr = 2.2 / ((winnerAvg - loserAvg) * 0.001 + 2.2)
      marginMult = (1 + Math.log(margin) * ELO_MARGIN_WEIGHT) * autocorr
    }
    const swing = ELO_K * marginMult
    for (const name of m.red_team) elo.set(name, get(name) + swing * (redScore - expectedRed))
    for (const name of m.blue_team) elo.set(name, get(name) + swing * (blueScore - expectedBlue))
  }
  return elo
}

// --- TrueSkill: the closed-form two-team update, as in lib/trueskill.ts ---------

const pdf = (x: number) => Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1
  const ax = Math.abs(x)
  const t = 1 / (1 + 0.3275911 * ax)
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) *
      t *
      Math.exp(-ax * ax)
  return sign * y
}
const cdf = (x: number) => 0.5 * (1 + erf(x / Math.SQRT2))

/** Inverse standard-normal cdf (Acklam), used only to turn the draw rate into a margin. */
function ppf(p: number): number {
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239]
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1]
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416]
  const plow = 0.02425
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p <= 1 - plow) {
    const q = p - 0.5
    const r = q * q
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  }
  const q = Math.sqrt(-2 * Math.log(1 - p))
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
}

const SMALL = 1e-10
const vWin = (t: number, e: number) => {
  const denom = cdf(t - e)
  return denom < SMALL ? e - t : pdf(t - e) / denom
}
const wWin = (t: number, e: number) => {
  const denom = cdf(t - e)
  if (denom < SMALL) return 1
  const v = pdf(t - e) / denom
  return v * (v + (t - e))
}
const vDraw = (t: number, e: number) => {
  const tt = Math.abs(t)
  const denom = cdf(e - tt) - cdf(-e - tt)
  if (denom < SMALL) return t < 0 ? -e : e
  return ((pdf(-e - tt) - pdf(e - tt)) / denom) * (t < 0 ? -1 : 1)
}
const wDraw = (t: number, e: number) => {
  const tt = Math.abs(t)
  const denom = cdf(e - tt) - cdf(-e - tt)
  if (denom < SMALL) return 1
  const v = (pdf(-e - tt) - pdf(e - tt)) / denom
  return v * v + ((e - tt) * pdf(e - tt) - (-e - tt) * pdf(-e - tt)) / denom
}

interface Rating {
  mu: number
  sigma: number
}

/** Replay TrueSkill over a list of matches, oldest first. Flat-seeded, like the ELO. */
function replayTrueSkill(matches: ImpactMatch[]): Map<string, Rating> {
  const ratings = new Map<string, Rating>()
  const get = (name: string) => {
    if (!ratings.has(name)) ratings.set(name, { mu: TS_MU, sigma: TS_SIGMA })
    return ratings.get(name)!
  }
  for (const m of matches) {
    if (!m.red_team?.length || !m.blue_team?.length) continue
    const inflate = (r: Rating): Rating => ({ mu: r.mu, sigma: Math.sqrt(r.sigma ** 2 + TS_TAU ** 2) })
    const red = m.red_team.map((x) => inflate(get(x)))
    const blue = m.blue_team.map((x) => inflate(get(x)))

    const total = red.length + blue.length
    const muRed = red.reduce((s, r) => s + r.mu, 0)
    const muBlue = blue.reduce((s, r) => s + r.mu, 0)
    const sigmaSq = [...red, ...blue].reduce((s, r) => s + r.sigma ** 2, 0)
    const cSq = sigmaSq + total * TS_BETA ** 2
    const c = Math.sqrt(cSq)
    const eps = (ppf((TS_DRAW_PROB + 1) / 2) * Math.sqrt(total) * TS_BETA) / c

    const redResult = m.red_score > m.blue_score ? 1 : m.red_score < m.blue_score ? 0 : 0.5
    let v: number
    let w: number
    let dir: number
    if (redResult === 0.5) {
      const t = (muRed - muBlue) / c
      v = vDraw(t, eps)
      w = wDraw(t, eps)
      dir = 1
    } else if (redResult === 1) {
      const t = (muRed - muBlue) / c
      v = vWin(t, eps)
      w = wWin(t, eps)
      dir = 1
    } else {
      const t = (muBlue - muRed) / c
      v = vWin(t, eps)
      w = wWin(t, eps)
      dir = -1
    }
    const update = (r: Rating, d: number): Rating => {
      const sSq = r.sigma ** 2
      return {
        mu: r.mu + d * (sSq / c) * v,
        sigma: Math.sqrt(Math.max(sSq * (1 - (sSq / cSq) * w), SMALL)),
      }
    }
    m.red_team.forEach((name, i) => ratings.set(name, update(red[i], dir)))
    m.blue_team.forEach((name, i) => ratings.set(name, update(blue[i], -dir)))
  }
  return ratings
}

/** The conservative estimate the TrueSkill board displays: three sigma below the mean. */
const conservative = (r: Rating) => r.mu - 3 * r.sigma

// ---------------------------------------------------------------------------

/**
 * Build the board.
 *
 * `matches` must arrive OLDEST FIRST — ELO and TrueSkill are running ratings, so
 * the order they are replayed in is the answer. Matches without a scoreboard still
 * count toward win rate, ELO, TrueSkill and the qualifying bar, because they were
 * really played; they simply cannot contribute a score per game.
 */
export function computeImpactBoard(
  matches: ImpactMatch[],
  statRows: ImpactStatRow[],
  players: ImpactPlayer[],
  options: { minGames: number } | { minGamesFraction: number },
): ImpactBoard {
  const nameById = new Map(players.map((p) => [p.id, p.name]))
  const tierByName = new Map(players.map((p) => [p.name, p.tier_value]))
  const matchIds = new Set(matches.map((m) => m.id))

  const rowsByMatch = new Map<string, ImpactStatRow[]>()
  for (const r of statRows) {
    if (!matchIds.has(r.match_id)) continue
    const list = rowsByMatch.get(r.match_id)
    if (list) list.push(r)
    else rowsByMatch.set(r.match_id, [r])
  }
  const stattedIds = new Set(
    [...rowsByMatch.entries()].filter(([, rs]) => rs.length >= MIN_ROWS_FOR_STATTED_MATCH).map(([id]) => id),
  )

  const minGames =
    "minGames" in options ? options.minGames : Math.ceil(stattedIds.size * options.minGamesFraction)

  // Per-player scoreboard rows, in match order so `form` reads chronologically.
  const rowsByPlayer = new Map<string, ImpactStatRow[]>()
  for (const m of matches) {
    if (!stattedIds.has(m.id)) continue
    for (const r of rowsByMatch.get(m.id) ?? []) {
      const name = nameById.get(r.player_id)
      if (!name) continue
      const list = rowsByPlayer.get(name)
      if (list) list.push(r)
      else rowsByPlayer.set(name, [r])
    }
  }

  interface Record { wins: number; losses: number; draws: number; played: number; form: ("W" | "L" | "D")[] }
  const record = new Map<string, Record>()
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
          rec = { wins: 0, losses: 0, draws: 0, played: 0, form: [] }
          record.set(name, rec)
        }
        rec.played++
        if (won) {
          rec.wins++
          rec.form.push("W")
        } else if (lost) {
          rec.losses++
          rec.form.push("L")
        } else {
          rec.draws++
          rec.form.push("D")
        }
      }
    }
  }

  const pool = [...rowsByPlayer.entries()].filter(([, rs]) => rs.length >= minGames)
  const empty: ImpactBoard = { rows: [], minGames, stattedMatches: stattedIds.size, totalMatches: matches.length }
  if (pool.length === 0) return empty

  const eloMap = replayElo(matches)
  const tsMap = replayTrueSkill(matches)

  const winRates = pool.map(([name]) => {
    const rec = record.get(name)
    return rec && rec.played > 0 ? rec.wins / rec.played : 0
  })
  const elos = pool.map(([name]) => eloMap.get(name) ?? ELO_START)
  const trueSkills = pool.map(([name]) => {
    const r = tsMap.get(name)
    return r ? conservative(r) : conservative({ mu: TS_MU, sigma: TS_SIGMA })
  })
  const scoresPerGame = pool.map(([, rs]) => (rs.length > 0 ? sumOf(rs, (r) => n(r.score)) / rs.length : 0))

  const zWin = zScores(winRates)
  const zElo = zScores(elos)
  const zTs = zScores(trueSkills)
  const zScore = zScores(scoresPerGame)

  const rows: ImpactRow[] = pool.map(([name, rs], i) => {
    // The whole rating, in one line: four standings, added together.
    const value = zWin[i] + zElo[i] + zTs[i] + zScore[i]
    const rec = record.get(name)
    return {
      name,
      tier: tierByName.get(name) ?? null,
      // Divided by four so the scale still reads as "standard deviations from an
      // average month" rather than four times that, and the numbers stay in the
      // same range as the other boards.
      rating: Math.round(T_MEAN + (T_SPREAD * value) / 4),
      value,
      winRateZ: zWin[i],
      eloZ: zElo[i],
      trueSkillZ: zTs[i],
      scoreZ: zScore[i],
      games: rs.length,
      minutes: Math.round(rs.reduce((a, r) => a + minutesOf(r), 0)),
      wins: rec?.wins ?? 0,
      losses: rec?.losses ?? 0,
      draws: rec?.draws ?? 0,
      winPct: rec && rec.played > 0 ? (rec.wins / rec.played) * 100 : 0,
      form: (rec?.form ?? []).slice(-5),
      elo: elos[i],
      trueSkill: trueSkills[i],
      scorePerGame: scoresPerGame[i],
      scorePerMin: sumOf(rs, (r) => n(r.score)) / Math.max(rs.reduce((a, r) => a + minutesOf(r), 0), 1),
      captures: sumOf(rs, (r) => n(r.captures)),
      returns: sumOf(rs, (r) => n(r.returns)),
      clears: sumOf(rs, (r) => n(r.base_cleaner)),
      assists: sumOf(rs, (r) => n(r.assists)),
      grabs: sumOf(rs, (r) => n(r.flag_grabs)),
      kills: sumOf(rs, (r) => n(r.kills)),
      deaths: sumOf(rs, (r) => n(r.deaths)),
    }
  })

  rows.sort((a, b) => b.value - a.value || b.games - a.games || a.name.localeCompare(b.name))
  return { rows, minGames, stattedMatches: stattedIds.size, totalMatches: matches.length }
}
