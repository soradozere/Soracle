import { createClient } from "@/lib/supabase/client"

// Monthly ELO map for the team balancer's admin-only "Balance by ELO" mode.
//
// The rating maths mirror components/elo-leaderboard.tsx, but the SEED differs on
// purpose. The leaderboard's monthly view is flat-seeded (everyone at 1500) so it shows
// pure this-month form. For BALANCING that's a poor signal — a flat seed is divorced
// from skill, so it routinely produces tier-stacked teams. Here we seed each player from
// their TIER (like the leaderboard's all-time view) and then replay only this month's
// matches. The result reads as "tier, corrected by this month's results": anchored to
// skill so it can't stack, but still moved by current-season form.
const BASE_ELO = 1000
const TIER_STEP = 100
const K_FACTOR = 24
const ELO_SCALE = 400
const MARGIN_WEIGHT = 0.6

// Per-player seed from tier (tier 8 → 1800). Unknown tier falls back to mid (5).
// Exported for the player profile's all-time rating replay (same seed as the
// leaderboard's all-time view).
export const seedFromTier = (tier: number | null | undefined) => BASE_ELO + (tier ?? 5) * TIER_STEP

// Fallback for any name that turns up in a match but isn't on the current roster.
const NEUTRAL_SEED = BASE_ELO + 5 * TIER_STEP

// Exported so the balancer can fall back to it for players with no rating.
export const DEFAULT_ELO = NEUTRAL_SEED

interface Match {
  id: string
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
  created_at: string
}

// Apply one match's ELO update in place. Identical to the leaderboard's applyMatchElo.
// Exported so the player profile can replay matches without a third copy of the maths.
export function applyMatchElo(map: Map<string, number>, match: Omit<Match, "id" | "created_at">) {
  const get = (name: string) => {
    if (!map.has(name)) map.set(name, NEUTRAL_SEED)
    return map.get(name)!
  }
  const redAvg = match.red_team.reduce((s, n) => s + get(n), 0) / match.red_team.length
  const blueAvg = match.blue_team.reduce((s, n) => s + get(n), 0) / match.blue_team.length
  const expectedRed = 1 / (1 + Math.pow(10, (blueAvg - redAvg) / ELO_SCALE))
  const expectedBlue = 1 - expectedRed
  const redScore = match.red_score > match.blue_score ? 1 : match.red_score < match.blue_score ? 0 : 0.5
  const blueScore = 1 - redScore

  const margin = Math.abs(match.red_score - match.blue_score)
  let marginMult = 1
  if (margin > 1) {
    const winnerAvg = redScore === 1 ? redAvg : blueAvg
    const loserAvg = redScore === 1 ? blueAvg : redAvg
    const autocorr = 2.2 / ((winnerAvg - loserAvg) * 0.001 + 2.2)
    marginMult = (1 + Math.log(margin) * MARGIN_WEIGHT) * autocorr
  }
  const swing = K_FACTOR * marginMult

  for (const name of match.red_team) map.set(name, get(name) + swing * (redScore - expectedRed))
  for (const name of match.blue_team) map.set(name, get(name) + swing * (blueScore - expectedBlue))
}

/**
 * Compute the tier-seeded, month-only ELO for each current-roster player. Every player
 * starts at their tier seed (1000 + tier×100) and is then moved by the given month's
 * matches only. Returns a name -> ELO map (every roster player is present, sitting at
 * their tier seed if they didn't play this month). Throws on a Supabase error.
 */
export async function computeMonthlyEloMap(year: number, month: number): Promise<Map<string, number>> {
  const supabase = createClient()

  const { data: matches, error: matchesError } = await supabase
    .from("matches")
    .select("id, red_team, blue_team, red_score, blue_score, created_at")
    .order("created_at", { ascending: true })
  if (matchesError) throw new Error(matchesError.message)

  const { data: players, error: playersError } = await supabase.from("players").select("name, tier_value")
  if (playersError) throw new Error(playersError.message)

  const elo = new Map<string, number>()
  for (const p of players || []) elo.set(p.name, seedFromTier(p.tier_value))

  for (const match of (matches || []) as Match[]) {
    if (!match.red_team?.length || !match.blue_team?.length) continue
    // UTC month bucketing — must match monthKey in player-profile.ts, or two
    // viewers in different timezones see different monthly boards.
    const d = new Date(match.created_at)
    if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1) continue
    applyMatchElo(elo, match)
  }

  return elo
}
