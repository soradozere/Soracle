// TrueSkill rating maths — the closed-form two-team update.
//
// TrueSkill (Herbrich, Minka & Graepel, 2006) models each player's skill as a Gaussian
// N(μ, σ²): μ is the estimated skill, σ the uncertainty about it. A match is a comparison
// of the two teams' summed skills plus per-player performance noise (β). For a game with
// exactly two teams and a single win/draw/loss outcome the full factor-graph reduces to a
// one-pass closed form (no iterative message passing needed), which is all we use here —
// the same "replay every match fresh on each load, persist nothing" model as the ELO board.
//
// Leaderboards rank on the CONSERVATIVE estimate μ − 3σ (see `conservativeRating`): a
// player you've seen lose-to-the-mean a hundred times outranks a flashy newcomer with the
// same μ but a fat σ. That's the number Xbox Live displayed as "your TrueSkill".

export interface Rating {
  mu: number
  sigma: number
}

// Standard TrueSkill defaults (scaled around μ = 25). β is the performance noise per
// player (how much a single game's showing can deviate from true skill); τ is the per-match
// dynamics factor that re-inflates σ a touch each game so ratings can still drift over time.
export const TS = {
  MU: 25,
  SIGMA: 25 / 3, // ≈ 8.333
  BETA: 25 / 6, // ≈ 4.167  (σ0 / 2)
  TAU: 25 / 300, // ≈ 0.0833 (σ0 / 100)
  DRAW_PROB: 0.1, // assumed base rate of draws, used to derive the draw margin
}

// Conservative skill estimate — what the board sorts and displays. Three σ below the mean
// means we're ~99.7% sure the player's true skill is at least this high.
export function conservativeRating(r: Rating): number {
  return r.mu - 3 * r.sigma
}

// Standard-normal pdf.
function pdf(x: number): number {
  return Math.exp((-x * x) / 2) / Math.sqrt(2 * Math.PI)
}

// erf via Abramowitz & Stegun 7.1.26 (max abs error ~1.5e-7) → standard-normal cdf.
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

function cdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2))
}

// Inverse standard-normal cdf (Acklam's rational approximation). Only used to turn the
// assumed draw probability into a draw margin.
function ppf(p: number): number {
  const a = [
    -3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2,
    -3.066479806614716e1, 2.506628277459239e0,
  ]
  const b = [
    -5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1,
    -1.328068155288572e1,
  ]
  const c = [
    -7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838e0, -2.549732539343734e0,
    4.374664141464968e0, 2.938163982698783e0,
  ]
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996e0, 3.754408661907416e0]
  const plow = 0.02425
  const phigh = 1 - plow
  if (p < plow) {
    const q = Math.sqrt(-2 * Math.log(p))
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
  }
  if (p <= phigh) {
    const q = p - 0.5
    const r = q * q
    return (((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1)
  }
  const q = Math.sqrt(-2 * Math.log(1 - p))
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1)
}

const SMALL = 1e-10

// Mean/variance multipliers for a WIN (the winning team's perf exceeded the loser's by
// more than the draw margin). t is the standardised skill gap (winner − loser), e the
// standardised draw margin.
function vWin(t: number, e: number): number {
  const denom = cdf(t - e)
  // Limit of pdf/cdf as the argument → −∞ (a huge upset): v → e − t. Guards a 0/0.
  if (denom < SMALL) return e - t
  return pdf(t - e) / denom
}
function wWin(t: number, e: number): number {
  const denom = cdf(t - e)
  if (denom < SMALL) return 1
  const v = pdf(t - e) / denom
  return v * (v + (t - e))
}

// Mean/variance multipliers for a DRAW (both performances landed within the draw margin).
// Uses |t| with the sign reapplied so the two teams are pulled toward each other.
function vDraw(t: number, e: number): number {
  const tt = Math.abs(t)
  const denom = cdf(e - tt) - cdf(-e - tt)
  if (denom < SMALL) return t < 0 ? -e : e
  const num = pdf(-e - tt) - pdf(e - tt)
  return (num / denom) * (t < 0 ? -1 : 1)
}
function wDraw(t: number, e: number): number {
  const tt = Math.abs(t)
  const denom = cdf(e - tt) - cdf(-e - tt)
  if (denom < SMALL) return 1
  const v = (pdf(-e - tt) - pdf(e - tt)) / denom
  return v * v + ((e - tt) * pdf(e - tt) - (-e - tt) * pdf(-e - tt)) / denom
}

/**
 * Rate one two-team match and return updated ratings for both teams (in the same order
 * given). `score1` is from team1's perspective: 1 = team1 won, 0 = team1 lost, 0.5 = draw.
 * Inputs are untouched; new Rating objects are returned.
 */
export function rateMatch(
  team1: Rating[],
  team2: Rating[],
  score1: number,
): { team1: Rating[]; team2: Rating[] } {
  // Dynamics: nudge σ back up by τ before the game so skill can keep moving over time.
  const inflate = (r: Rating): Rating => ({ mu: r.mu, sigma: Math.sqrt(r.sigma * r.sigma + TS.TAU * TS.TAU) })
  const t1 = team1.map(inflate)
  const t2 = team2.map(inflate)

  const n = t1.length + t2.length
  const muA = t1.reduce((s, r) => s + r.mu, 0)
  const muB = t2.reduce((s, r) => s + r.mu, 0)
  const sigmaSqSum = [...t1, ...t2].reduce((s, r) => s + r.sigma * r.sigma, 0)
  const cSq = sigmaSqSum + n * TS.BETA * TS.BETA
  const c = Math.sqrt(cSq)

  const drawMargin = ppf((TS.DRAW_PROB + 1) / 2) * Math.sqrt(n) * TS.BETA
  const eps = drawMargin / c

  const draw = score1 === 0.5
  // dirA = +1 means team1 gains on the mean update, team2 loses (and vice-versa). For a
  // draw the signed v handles the direction, so dirA stays +1.
  let v: number
  let w: number
  let dirA: number
  if (draw) {
    const t = (muA - muB) / c
    v = vDraw(t, eps)
    w = wDraw(t, eps)
    dirA = 1
  } else if (score1 >= 1) {
    const t = (muA - muB) / c // team1 is the winner
    v = vWin(t, eps)
    w = wWin(t, eps)
    dirA = 1
  } else {
    const t = (muB - muA) / c // team2 is the winner
    v = vWin(t, eps)
    w = wWin(t, eps)
    dirA = -1
  }

  const update = (r: Rating, dir: number): Rating => {
    const sSq = r.sigma * r.sigma
    const mu = r.mu + dir * (sSq / c) * v
    const sigma = Math.sqrt(Math.max(sSq * (1 - (sSq / cSq) * w), SMALL))
    return { mu, sigma }
  }

  return {
    team1: t1.map((r) => update(r, dirA)),
    team2: t2.map((r) => update(r, -dirA)),
  }
}
