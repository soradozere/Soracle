// Achievement definitions — the single source of truth for what exists, how
// it's earned, and how it looks. lib/achievements.ts turns these + a player's
// match history into earned/locked state; components/achievements-strip.tsx
// renders them. Kept presentation-light: only an icon id + rarity live here, the
// crest styling is derived from rarity in the component.
//
// A "family" is one crest. Tiered families (ranks I/II/III…) render as a single
// crest that levels up — the rank's rarity and optional title override apply as
// the player climbs. Untiered families are a single threshold.
//
// `icon` is a single-colour Star Wars faction crest at /achievements/<icon>.svg,
// mask-tinted to the rarity colour (same technique as badges). The mapping is
// thematic/decorative — the crests are emblems, not literal action icons.

export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic"
export type AchievementCategory = "match" | "career" | "streak"

// Mythic sits above legendary — the very rarest feats. Its crest is a wispy,
// near-white iridescent (styled in components/achievements-strip.tsx), so the
// colour here is a pale silver-white the tint/glow/tag all derive from.
export const RARITY_META: Record<Rarity, { label: string; color: string; order: number }> = {
  common: { label: "Common", color: "#3ddc84", order: 1 },
  rare: { label: "Rare", color: "#2f81f7", order: 2 },
  epic: { label: "Epic", color: "#a855f7", order: 3 },
  legendary: { label: "Legendary", color: "#f5c542", order: 4 },
  mythic: { label: "Mythic", color: "#eaeeff", order: 5 },
}

// The per-match scoreboard fields achievements read. A subset of match_stats,
// mirrored by the expanded fetch in lib/player-profile.ts.
export interface AchStat {
  score: number
  captures: number
  returns: number
  base_cleaner: number
  assists: number
  kills: number
  deaths: number
  flag_hold_ms: number
  dbs_returns: number
  yellow_kills: number
  turret_kills: number
  mine_returns: number
  mine_kills: number
  blue_returns: number
  blubs_returns: number
  upcut_kills: number
  bs_kills: number
  dbs_kills: number
  red_kills: number
  blue_kills: number
  ydfa_kills: number
  doom_kills: number
  mine_grabs_red: number
  mine_grabs_blue: number
  dfa_kills: number
  dfa_attempts: number
  blocks_enemy: number
  time_played: number | null
}

// One match from the player's perspective, chronological. `stat` is their
// scoreboard line when the match has a CSV, else null.
export interface AchMatch {
  matchId: string
  date: string
  played: boolean
  won: boolean
  lost: boolean
  myScore: number
  oppScore: number
  // The other players in this match, from this player's perspective. Both are
  // de-duplicated and exclude the player themselves — a reconnect can list a name
  // twice on one team, which would otherwise double-count games together.
  teammates: string[]
  opponents: string[]
  stat: AchStat | null
}

// How a family's progress is measured. All are computed by walking the player's
// matches once (see lib/achievements.ts).
export type Metric =
  | { type: "matchMax"; get: (s: AchStat) => number } // best value in any single match
  | { type: "careerSum"; get: (s: AchStat) => number } // cumulative across all matches
  | { type: "matchPredicate"; test: (s: AchStat, m: AchMatch) => boolean } // one-off feat
  | { type: "matchCount" } // matches played
  | { type: "winCount" } // matches won
  | { type: "winStreak" } // longest consecutive-win run
  | { type: "shutoutWins" } // wins where the enemy scored 0
  | { type: "oneCapWins" } // wins by a single capture
  // Escape hatch for metrics the linear passes above can't express — anything that
  // groups by teammate/opponent rather than accumulating over the sequence.
  // `compute` walks the player's chronological matches and returns one entry each
  // time the tracked value improves (same contract as the built-in passes: the
  // earliest crossing of a threshold T is the first entry with v >= T).
  // `best` marks the value as a personal best ("best 9 / 12") rather than a total.
  | {
      type: "seqDerived"
      best?: boolean
      compute: (seq: AchMatch[]) => { v: number; date: string; matchId: string }[]
    }

export interface Rank {
  threshold: number
  rarity: Rarity
  title?: string // overrides the family title once this rank is reached
}

export interface AchievementDef {
  id: string
  title: string
  category: AchievementCategory
  icon: string // /achievements/<icon>.svg
  condition: string // short human description for the tooltip
  metric: Metric
  // Tiered → ranks (ascending thresholds). Untiered → threshold + rarity.
  ranks?: Rank[]
  threshold?: number
  rarity?: Rarity
  pending?: boolean // forward-only: needs a column populated only by new uploads
  unit?: "hours" // display hint for value/threshold formatting
}

// Team-mate / opponent achievements are FORWARD-ONLY. The match history is full
// of long-standing streaks (bizzle had beaten arhont 15 times running), so
// counting it would hand out ranks — including a Mythic — the moment they ship.
// Everyone starts from zero here instead, and the crests read "tracking from now"
// until earned. Matches are compared on parsed timestamps because created_at
// spellings vary (+00:00 vs Z), which a string compare would get wrong.
export const PAIR_ACHIEVEMENTS_FROM = "2026-07-08T00:00:00.000Z"
const PAIR_FROM_MS = Date.parse(PAIR_ACHIEVEMENTS_FROM)
const countsForPair = (m: AchMatch) => m.played && Date.parse(m.date) >= PAIR_FROM_MS

// avg flag-hold per capture, ms → the 2:00 gate for Pro Rusher.
const TWO_MINUTES_MS = 120_000
// total flag-hold in one match, ms → the 40:00 gate for Marathon Runner.
const FORTY_MINUTES_MS = 2_400_000

export const ACHIEVEMENTS: AchievementDef[] = [
  // ---------------------------------------------------------------- Match feats
  {
    id: "2000-club",
    title: "2000 Club",
    category: "match",
    icon: "death-star-training-academy",
    condition: "Score 2000+ in a single match",
    metric: { type: "matchMax", get: (s) => s.score },
    threshold: 2000,
    rarity: "mythic",
  },
  {
    id: "1500-club",
    title: "1500 Club",
    category: "match",
    icon: "galactic-senate",
    condition: "Score 1500+ in a single match",
    metric: { type: "matchMax", get: (s) => s.score },
    threshold: 1500,
    rarity: "epic",
  },
  {
    id: "cap-god",
    title: "Cap God",
    category: "match",
    icon: "galactic-empire",
    condition: "7+ captures in a single match",
    metric: { type: "matchMax", get: (s) => s.captures },
    threshold: 7,
    rarity: "legendary",
  },
  {
    id: "pro-rusher",
    title: "Pro Rusher",
    category: "match",
    icon: "rogue-one",
    condition: "3+ caps averaging under 2:00 flag-hold each",
    metric: {
      type: "matchPredicate",
      test: (s) => s.captures >= 3 && s.flag_hold_ms / s.captures <= TWO_MINUTES_MS,
    },
    threshold: 1,
    rarity: "epic",
  },
  {
    // Replaces the old untiered "The Wall" (25) + "40 Bomb" (40) pair: one crest
    // that levels up, with the rank's title carrying the number.
    id: "bomb",
    title: "30 Bomb",
    category: "match",
    icon: "mandalorian-guard",
    condition: "Returns in a single match",
    metric: { type: "matchMax", get: (s) => s.returns },
    ranks: [
      { threshold: 30, rarity: "epic" },
      { threshold: 40, rarity: "legendary", title: "40 Bomb" },
      { threshold: 50, rarity: "mythic", title: "50 Bomb" },
    ],
  },
  {
    id: "rambo",
    title: "Rambo",
    category: "match",
    icon: "sith-eternal",
    condition: "Kills in a single match",
    metric: { type: "matchMax", get: (s) => s.kills },
    ranks: [
      { threshold: 100, rarity: "rare" },
      { threshold: 150, rarity: "epic" },
      { threshold: 200, rarity: "legendary" },
      { threshold: 250, rarity: "mythic" },
    ],
  },
  {
    id: "marathon-runner",
    title: "Marathon Runner",
    category: "match",
    icon: "new-jedi-order",
    condition: "40+ minutes of flag hold in a match with 3+ caps",
    metric: {
      type: "matchPredicate",
      test: (s) => s.flag_hold_ms >= FORTY_MINUTES_MS && s.captures >= 3,
    },
    threshold: 1,
    rarity: "epic",
  },
  {
    // A deliberate challenge run: land a kill with every saber/weapon style in one
    // match. YDFA and blue-stance kills are the rare ones — you have to go for it.
    id: "nah-youre-hacking",
    title: "Nah, You're Hacking",
    category: "match",
    icon: "lord-revan",
    condition: "One match, a kill with all 10 styles",
    metric: {
      type: "matchPredicate",
      test: (s) =>
        s.dfa_kills > 0 &&
        s.ydfa_kills > 0 &&
        s.dbs_kills > 0 &&
        s.bs_kills > 0 &&
        s.red_kills > 0 &&
        s.yellow_kills > 0 &&
        s.blue_kills > 0 &&
        s.mine_kills > 0 &&
        s.turret_kills > 0 &&
        s.upcut_kills > 0,
    },
    threshold: 1,
    rarity: "mythic",
  },
  {
    id: "batcher",
    title: "Batcher",
    category: "match",
    icon: "mandalorian-protectors",
    condition: "Base cleans in a single match",
    metric: { type: "matchMax", get: (s) => s.base_cleaner },
    ranks: [
      { threshold: 50, rarity: "epic" },
      { threshold: 80, rarity: "epic" },
      { threshold: 100, rarity: "legendary" },
      { threshold: 140, rarity: "mythic" },
    ],
  },
  {
    id: "untouchable",
    title: "Untouchable",
    category: "match",
    icon: "general-grevious",
    condition: "K/D of 5:1 or better (min 30 kills) in a match",
    metric: {
      type: "matchPredicate",
      test: (s) => s.kills >= 30 && s.kills >= 5 * s.deaths,
    },
    threshold: 1,
    rarity: "mythic",
  },
  {
    id: "suvix-special",
    title: "Suvix Special",
    category: "match",
    icon: "raziel-clan",
    condition: "Win with a 1:5 K/D or worse and 3+ caps",
    metric: {
      type: "matchPredicate",
      test: (s, m) => m.won && s.captures >= 3 && s.deaths >= 5 && s.deaths >= 5 * s.kills,
    },
    threshold: 1,
    rarity: "epic",
  },
  {
    id: "apache-gunner",
    title: "Apache Gunner",
    category: "match",
    icon: "clone-trooper",
    condition: "Sentry kills in a single match",
    metric: { type: "matchMax", get: (s) => s.turret_kills },
    ranks: [
      { threshold: 5, rarity: "epic" },
      { threshold: 8, rarity: "legendary" },
    ],
  },
  {
    id: "demoman",
    title: "Demoman",
    category: "match",
    icon: "confederancy-of-independent-system",
    condition: "Mine returns in a single match",
    metric: { type: "matchMax", get: (s) => s.mine_returns },
    ranks: [
      { threshold: 5, rarity: "rare" },
      { threshold: 8, rarity: "epic" },
      { threshold: 10, rarity: "legendary" },
    ],
  },
  {
    id: "eiffel-65",
    title: "Eiffel 65",
    category: "match",
    icon: "cold-order",
    condition: "3+ blue-stance returns in a single match",
    metric: { type: "matchMax", get: (s) => s.blue_returns },
    threshold: 3,
    rarity: "rare",
  },
  {
    id: "kimbo-slice",
    title: "Kimbo Slice",
    category: "match",
    icon: "rebel-fist",
    condition: "5+ upcut kills in a single match",
    metric: { type: "matchMax", get: (s) => s.upcut_kills },
    threshold: 5,
    rarity: "epic",
  },
  {
    id: "press-a-bind",
    title: "Press a Bind",
    category: "match",
    icon: "revanchist-sith",
    condition: "10+ DBS returns in a single match",
    metric: { type: "matchMax", get: (s) => s.dbs_returns },
    threshold: 10,
    rarity: "epic",
  },
  {
    // The scoreboard has no DOOM-RETURNS column, only DOOM-KILLS — so this counts
    // doom kills. Nobody has ever managed two in one match (33 doom kills exist in
    // the whole database), which is what makes it Mythic.
    // Icon deliberately reused (shares DOOM's crest, no spare SVGs).
    id: "bonebreaker",
    title: "Bonebreaker",
    category: "match",
    icon: "sith-era",
    condition: "3+ doom kills in a single match",
    metric: { type: "matchMax", get: (s) => s.doom_kills },
    threshold: 3,
    rarity: "mythic",
  },
  {
    // blubs_returns = returns landed with a blue-stance backstab. Non-zero in only
    // 3 of 811 scoreboard rows, and never above 1 — three in one match is a feat.
    // Icon deliberately reused (shares BSer's crest, no spare SVGs).
    id: "zorro",
    title: "Zorro",
    category: "match",
    icon: "dark-lord-of-the-sith",
    condition: "3+ blue-backstab returns in a single match",
    metric: { type: "matchMax", get: (s) => s.blubs_returns },
    threshold: 3,
    rarity: "legendary",
  },
  {
    id: "cheeses-dream",
    title: "Cheese's Dream",
    category: "match",
    icon: "mandalorian-mysteries",
    condition: "40%+ DFA accuracy in a match (min 10 attempts)",
    metric: {
      type: "matchPredicate",
      test: (s) => s.dfa_attempts >= 10 && s.dfa_kills >= 0.4 * s.dfa_attempts,
    },
    threshold: 1,
    rarity: "rare",
    pending: true,
  },
  // -------------------------------------------------------------- Career totals
  {
    id: "cap-enjoyer",
    title: "Cap Enjoyer",
    category: "career",
    icon: "galactic-republic",
    condition: "Career flag captures",
    metric: { type: "careerSum", get: (s) => s.captures },
    ranks: [
      { threshold: 50, rarity: "common" },
      { threshold: 150, rarity: "rare" },
      { threshold: 250, rarity: "epic" },
      { threshold: 500, rarity: "legendary", title: "Cap Legend" },
    ],
  },
  {
    id: "ret-services",
    title: "RET SERVICES!!",
    category: "career",
    icon: "new-republic",
    condition: "Career flag returns",
    metric: { type: "careerSum", get: (s) => s.returns },
    ranks: [
      { threshold: 500, rarity: "common" },
      { threshold: 1000, rarity: "epic" },
      { threshold: 2500, rarity: "legendary" },
    ],
  },
  {
    id: "bser",
    title: "BSer",
    category: "career",
    icon: "dark-lord-of-the-sith",
    condition: "Career backslash kills",
    metric: { type: "careerSum", get: (s) => s.bs_kills },
    ranks: [
      { threshold: 100, rarity: "common" },
      { threshold: 250, rarity: "rare" },
      { threshold: 500, rarity: "epic" },
    ],
  },
  {
    id: "yellow-spammer",
    title: "Yellow Spammer",
    category: "career",
    icon: "black-sun",
    condition: "Career yellow-stance kills",
    metric: { type: "careerSum", get: (s) => s.yellow_kills },
    ranks: [
      { threshold: 1000, rarity: "rare" },
      { threshold: 2500, rarity: "epic" },
      { threshold: 5000, rarity: "legendary" },
    ],
  },
  {
    // Mine KILLS — the offensive counterpart to Demoman, which counts mine returns.
    id: "sapper",
    title: "Sapper",
    category: "career",
    icon: "separatists",
    condition: "Career mine kills",
    metric: { type: "careerSum", get: (s) => s.mine_kills },
    ranks: [
      { threshold: 500, rarity: "epic" },
      { threshold: 1000, rarity: "legendary" },
      { threshold: 2500, rarity: "mythic" },
    ],
  },
  {
    // Most matches played alongside any one team-mate (draws included — it counts
    // games together, not results). Deliberately has no Mythic: a career counter
    // that only ever grows makes a top rank a waiting game rather than a feat.
    // Icon deliberately reused (no spare crest SVGs).
    id: "inseparable",
    title: "Inseparable",
    category: "career",
    icon: "old-galactic-republic",
    condition: "Career matches played alongside one team-mate",
    pending: true, // forward-only, see PAIR_ACHIEVEMENTS_FROM
    metric: {
      type: "seqDerived",
      best: true,
      compute: (seq) => {
        const out: { v: number; date: string; matchId: string }[] = []
        const games = new Map<string, number>()
        let best = 0
        for (const m of seq) {
          if (!countsForPair(m)) continue
          for (const mate of m.teammates) {
            const g = (games.get(mate) ?? 0) + 1
            games.set(mate, g)
            if (g > best) {
              best = g
              out.push({ v: best, date: m.date, matchId: m.matchId })
            }
          }
        }
        return out
      },
    },
    ranks: [
      { threshold: 25, rarity: "common" },
      { threshold: 40, rarity: "rare" },
      { threshold: 60, rarity: "epic" },
      { threshold: 100, rarity: "legendary" },
    ],
  },
  {
    // Counted per opponent, not per match: if a whole enemy six has a 3+ run over
    // you and you finally beat them, that ends several streaks at once. A running
    // tally, so it's "best 4 / 6" style progress rather than a personal best.
    // Icon deliberately reused (no spare crest SVGs).
    id: "revenge",
    title: "Revenge",
    category: "streak",
    icon: "raziel-clan",
    condition: "End an opponent's 3+ win streak over you",
    pending: true, // forward-only, see PAIR_ACHIEVEMENTS_FROM
    metric: {
      type: "seqDerived",
      compute: (seq) => {
        const out: { v: number; date: string; matchId: string }[] = []
        const losingTo = new Map<string, number>()
        let n = 0
        for (const m of seq) {
          if (!countsForPair(m)) continue
          if (m.won) {
            for (const opp of m.opponents) {
              if ((losingTo.get(opp) ?? 0) >= 3) {
                n++
                out.push({ v: n, date: m.date, matchId: m.matchId })
              }
              losingTo.set(opp, 0)
            }
          } else if (m.lost) {
            for (const opp of m.opponents) losingTo.set(opp, (losingTo.get(opp) ?? 0) + 1)
          }
        }
        return out
      },
    },
    ranks: [
      { threshold: 3, rarity: "common" },
      { threshold: 6, rarity: "rare" },
      { threshold: 10, rarity: "epic" },
    ],
  },
  {
    id: "giga-teammate",
    title: "Giga Teammate",
    category: "career",
    icon: "rebel-alliance-jedi-order",
    condition: "Career assists",
    metric: { type: "careerSum", get: (s) => s.assists },
    ranks: [
      { threshold: 100, rarity: "common" },
      { threshold: 250, rarity: "rare" },
      { threshold: 500, rarity: "epic" },
      { threshold: 1000, rarity: "legendary" },
    ],
  },
  {
    id: "dbs-enjoyer",
    title: "DBS Enjoyer",
    category: "career",
    icon: "sith-order",
    condition: "Career DBS returns",
    metric: { type: "careerSum", get: (s) => s.dbs_returns },
    ranks: [
      { threshold: 50, rarity: "common" },
      { threshold: 200, rarity: "rare", title: "DBS Machine" },
      { threshold: 500, rarity: "legendary", title: "DBS Protocol Activated" },
    ],
  },
  {
    id: "doom",
    title: "DOOM",
    category: "career",
    icon: "sith-era",
    condition: "Career doom throws",
    metric: { type: "careerSum", get: (s) => s.doom_kills },
    ranks: [
      { threshold: 10, rarity: "rare" },
      { threshold: 25, rarity: "epic" },
      { threshold: 100, rarity: "legendary", title: "MF DOOM" },
    ],
  },
  {
    id: "swat-support",
    title: "SWAT Support",
    category: "career",
    icon: "mandalorian-mercs",
    condition: "Career enemy mines grabbed",
    metric: { type: "careerSum", get: (s) => s.mine_grabs_red + s.mine_grabs_blue },
    ranks: [
      { threshold: 100, rarity: "rare" },
      { threshold: 1000, rarity: "epic" },
      { threshold: 2500, rarity: "legendary" },
    ],
  },
  {
    id: "veteran",
    title: "Veteran",
    category: "career",
    icon: "old-galactic-republic",
    condition: "Matches played",
    metric: { type: "matchCount" },
    ranks: [
      { threshold: 100, rarity: "common" },
      { threshold: 500, rarity: "rare" },
      { threshold: 1000, rarity: "legendary" },
    ],
  },
  {
    id: "centurion",
    title: "Centurion",
    category: "career",
    icon: "first-order",
    condition: "Win 100 matches",
    metric: { type: "winCount" },
    threshold: 100,
    rarity: "rare",
  },
  {
    id: "blocked",
    title: "Blocked!",
    category: "career",
    icon: "mandalorian-neo-crusaders",
    condition: "Career enemy blocks",
    metric: { type: "careerSum", get: (s) => s.blocks_enemy },
    ranks: [
      { threshold: 250, rarity: "rare" },
      { threshold: 500, rarity: "epic" },
      { threshold: 1000, rarity: "legendary" },
    ],
    pending: true,
  },
  {
    id: "bounty-hunter",
    title: "Bounty Hunter",
    category: "career",
    icon: "mandalorian-crest",
    condition: "Career kills",
    metric: { type: "careerSum", get: (s) => s.kills },
    ranks: [
      { threshold: 1000, rarity: "common" },
      { threshold: 5000, rarity: "epic" },
      { threshold: 10000, rarity: "legendary" },
    ],
  },
  {
    id: "no-life",
    title: "No Life",
    category: "career",
    icon: "republic-credits",
    condition: "Hours played",
    // time_played is stored in MINUTES (scoreboard TIME-SUM) → convert to hours.
    metric: { type: "careerSum", get: (s) => (s.time_played ?? 0) / 60 },
    unit: "hours",
    ranks: [
      { threshold: 100, rarity: "common" },
      { threshold: 500, rarity: "epic" },
      { threshold: 1000, rarity: "legendary" },
    ],
  },
  // -------------------------------------------------------------------- Streaks
  {
    // Team outcomes, not duels: a "win with" is a match your side won while they
    // were on it. Streaks only advance on matches you actually shared, and only
    // reset when you lose one together (a draw leaves them untouched).
    // Icon deliberately reused (no spare crest SVGs).
    id: "ride-or-die",
    title: "Ride or Die",
    category: "streak",
    icon: "rebel-alliance",
    condition: "Consecutive wins alongside the same team-mate",
    pending: true, // forward-only, see PAIR_ACHIEVEMENTS_FROM
    metric: {
      type: "seqDerived",
      best: true,
      compute: (seq) => {
        const out: { v: number; date: string; matchId: string }[] = []
        const streak = new Map<string, number>()
        let best = 0
        for (const m of seq) {
          if (!countsForPair(m)) continue
          if (m.won) {
            for (const mate of m.teammates) {
              const s = (streak.get(mate) ?? 0) + 1
              streak.set(mate, s)
              if (s > best) {
                best = s
                out.push({ v: best, date: m.date, matchId: m.matchId })
              }
            }
          } else if (m.lost) {
            for (const mate of m.teammates) streak.set(mate, 0)
          }
        }
        return out
      },
    },
    ranks: [
      { threshold: 5, rarity: "rare" },
      { threshold: 8, rarity: "epic" },
      { threshold: 12, rarity: "legendary" },
      { threshold: 15, rarity: "mythic" },
    ],
  },
  {
    // Same shape, mirrored onto the other side of the server: consecutive matches
    // in which your team beat a team containing this player.
    // Icon deliberately reused (no spare crest SVGs).
    id: "owneds",
    title: "Owneds",
    category: "streak",
    icon: "general-grevious",
    condition: "Consecutive wins against the same opponent",
    pending: true, // forward-only, see PAIR_ACHIEVEMENTS_FROM
    metric: {
      type: "seqDerived",
      best: true,
      compute: (seq) => {
        const out: { v: number; date: string; matchId: string }[] = []
        const streak = new Map<string, number>()
        let best = 0
        for (const m of seq) {
          if (!countsForPair(m)) continue
          if (m.won) {
            for (const opp of m.opponents) {
              const s = (streak.get(opp) ?? 0) + 1
              streak.set(opp, s)
              if (s > best) {
                best = s
                out.push({ v: best, date: m.date, matchId: m.matchId })
              }
            }
          } else if (m.lost) {
            for (const opp of m.opponents) streak.set(opp, 0)
          }
        }
        return out
      },
    },
    ranks: [
      { threshold: 5, rarity: "rare" },
      { threshold: 8, rarity: "epic" },
      { threshold: 12, rarity: "legendary" },
      { threshold: 15, rarity: "mythic" },
    ],
  },
  {
    id: "on-fire",
    title: "On Fire",
    category: "streak",
    icon: "onderon-rebellion",
    condition: "Consecutive wins in a row",
    metric: { type: "winStreak" },
    ranks: [
      { threshold: 5, rarity: "epic" },
      { threshold: 8, rarity: "legendary", title: "Unstoppable" },
      { threshold: 12, rarity: "legendary", title: "Titan" },
    ],
  },
  {
    id: "shutout-specialist",
    title: "Shutout Specialist",
    category: "streak",
    icon: "mandalorian-clan",
    condition: "Win matches to nil",
    metric: { type: "shutoutWins" },
    ranks: [
      { threshold: 10, rarity: "epic" },
      { threshold: 20, rarity: "legendary" },
    ],
  },
  {
    id: "heartbreaker",
    title: "Heartbreaker",
    category: "streak",
    icon: "rebel-alliance",
    condition: "Win matches by a single capture",
    metric: { type: "oneCapWins" },
    ranks: [
      { threshold: 10, rarity: "rare" },
      { threshold: 25, rarity: "epic" },
      { threshold: 50, rarity: "legendary" },
    ],
  },
]
