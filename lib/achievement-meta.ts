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

export type Rarity = "common" | "rare" | "epic" | "legendary" | "mythic" | "oneofone"
export type AchievementCategory = "match" | "career" | "streak"

// Mythic sits above legendary — the very rarest feats. Its crest is a fire-lit
// near-white iridescent (styled in components/achievements-strip.tsx), so the
// colour here is a pale silver-white the tint/glow/tag all derive from.
//
// "One of One" sits above everything and is not a tier you climb: exactly one
// player holds each, forever. Fuchsia because no other tier is anywhere near it
// on the wheel, and its crest is an octagon rather than a hexagon — a crest that
// nobody else can ever earn should not be the same shape as the ones they can.
export const RARITY_META: Record<Rarity, { label: string; color: string; order: number }> = {
  common: { label: "Common", color: "#3ddc84", order: 1 },
  rare: { label: "Rare", color: "#2f81f7", order: 2 },
  epic: { label: "Epic", color: "#a855f7", order: 3 },
  legendary: { label: "Legendary", color: "#f5c542", order: 4 },
  mythic: { label: "Mythic", color: "#eaeeff", order: 5 },
  oneofone: { label: "One of One", color: "#ff2fb9", order: 6 },
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
  flag_grabs: number
  dbs_returns: number
  red_returns: number
  yellow_returns: number
  dfa_returns: number
  yellow_kills: number
  turret_kills: number
  mine_returns: number
  mine_kills: number
  blue_returns: number
  blubs_returns: number
  blubs_kills: number
  upcut_kills: number
  bs_kills: number
  dbs_kills: number
  red_kills: number
  blue_kills: number
  ydfa_kills: number
  doom_kills: number
  tele_kills: number
  mine_grabs_red: number
  mine_grabs_blue: number
  dfa_kills: number
  dfa_attempts: number
  blocks_enemy: number
  time_played: number | null
  ping_mean: number | null
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
  // `who` names the team-mate/opponent whose entry moved the value — surfaced in
  // the tooltip ("with bizzle" / "against arhont") for the pair crests.
  | {
      type: "seqDerived"
      best?: boolean
      compute: (seq: AchMatch[]) => { v: number; date: string; matchId: string; who?: string }[]
    }

export interface Rank {
  threshold: number
  rarity: Rarity
  title?: string // overrides the family title once this rank is reached
  // Overrides the displayed requirement for computed-tier metrics (Triple
  // Threat, Cap God, Nah, You're Hacking): their threshold is an internal tier
  // number (1/2/3…), not a real stat, so "2+" means nothing to a visitor. Set
  // this to the actual combo the rank demands instead.
  requirementLabel?: string
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
  unit?: "hours" | "percent" // display hint for value/threshold formatting
  exact?: boolean // threshold is a fixed count, not a minimum — drops the "+" suffix
  // For pair crests (seqDerived with a `who`): the preposition the tooltip uses
  // before the partner's name — "with" a team-mate, "against" an opponent.
  pairRelation?: "with" | "against"
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
// flag-hold floor for Efficient Capper's ratio gate — see that family below.
const TEN_MINUTES_MS = 600_000

// Enemy mines grabbed has always been two columns (red side / blue side) since
// nobody cares which colour, only that it was the other team's — every combo
// achievement below sums them the same way SWAT Support's careerSum does.
const mineGrabsOf = (s: AchStat) => s.mine_grabs_red + s.mine_grabs_blue

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
    // Absorbs the old untiered 7-cap "Cap God" into a full ladder: 4/5/6 fill in
    // the gap below it (93/37/8 matches on record respectively), and a 5th rank
    // adds a K/D gate on top of the same 7-cap ceiling for "Cap God Plus" — no
    // match has ever combined the two, so it stays a real reach even though the
    // raw capture count is already claimed. get() returns a tier number rather
    // than the raw capture count so the KD-gated top rank can sit above the
    // plain-capture one without a second, disconnected metric (same trick as
    // Nah, You're Hacking below).
    id: "cap-god",
    title: "Cap God",
    category: "match",
    icon: "galactic-empire",
    condition: "Captures in a single match",
    metric: {
      type: "matchMax",
      get: (s) => {
        if (s.captures >= 7 && s.kills >= 1.5 * s.deaths) return 5
        if (s.captures >= 7) return 4
        if (s.captures >= 6) return 3
        if (s.captures >= 5) return 2
        if (s.captures >= 4) return 1
        return 0
      },
    },
    ranks: [
      { threshold: 1, rarity: "common", title: "Cap Initiate", requirementLabel: "4+ caps" },
      { threshold: 2, rarity: "rare", title: "Cap Adept", requirementLabel: "5+ caps" },
      { threshold: 3, rarity: "epic", title: "Cap Veteran", requirementLabel: "6+ caps" },
      { threshold: 4, rarity: "legendary", title: "Cap God", requirementLabel: "7+ caps" },
      { threshold: 5, rarity: "mythic", title: "Cap Titan", requirementLabel: "7+ caps, 1.5+ K/D" },
    ],
  },
  {
    id: "berserker-capper",
    title: "Berserker Capper",
    category: "match",
    icon: "rebel-alliance-jedi-order",
    condition: "4+ caps with a 2:1 K/D in a 25+ min match",
    metric: {
      type: "matchPredicate",
      test: (s) => s.captures >= 4 && s.kills >= 2 * s.deaths && (s.time_played ?? 0) >= 25,
    },
    threshold: 1,
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
      { threshold: 150, rarity: "epic", title: "Terminator" },
      { threshold: 200, rarity: "legendary", title: "Killimanjaro" },
      { threshold: 250, rarity: "mythic", title: "Berserker" },
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
    // A deliberate challenge run: land a kill with a specific SET of styles in one
    // match. Legendary is the 10 "ordinary" styles (yellow, red, blue, mine, turret,
    // blue backstab, uppercut, DFA, DBS, backstab); Mythic adds the two hardest —
    // yellow DFA and doom — for the full 12. The value counts how many of the set
    // you've landed so the tile shows how close you got, but the extra two only
    // count once the base 10 are all in (see the get below), so 10 always means
    // "all ten Legendary styles", never nine-plus-a-doom. Excludes IDLE/UNKN kills:
    // those aren't a style you choose, just the scoreboard's catch-all for an
    // AFK/unattributable kill, so they'd cheapen a "landed every real style" flex.
    // `exact` because the number is a fixed set size, not a "10 or more" floor.
    id: "nah-youre-hacking",
    title: "Nah, You're Hacking",
    category: "match",
    icon: "lord-revan",
    condition: "Distinct kill styles landed in a single match",
    metric: {
      type: "matchMax",
      get: (s) => {
        const legendaryStyles = [
          s.yellow_kills,
          s.red_kills,
          s.blue_kills,
          s.mine_kills,
          s.turret_kills,
          s.blubs_kills, // blue backstab
          s.upcut_kills, // uppercut
          s.dfa_kills,
          s.dbs_kills,
          s.bs_kills, // backstab
        ]
        const base = legendaryStyles.filter((k) => k > 0).length
        // Below the full 10, report raw progress. The two Mythic-only styles
        // (yellow DFA + doom) only add once every Legendary style is present, so a
        // near-miss on the base set can never masquerade as a higher tier.
        if (base < 10) return base
        return 10 + (s.ydfa_kills > 0 ? 1 : 0) + (s.doom_kills > 0 ? 1 : 0)
      },
    },
    exact: true,
    ranks: [
      { threshold: 10, rarity: "legendary" },
      { threshold: 12, rarity: "mythic", title: "Nah, You're DEFINITELY Hacking" },
    ],
  },
  {
    id: "batcher",
    title: "Batcher",
    category: "match",
    icon: "mandalorian-protectors",
    condition: "Base cleans in a single match",
    metric: { type: "matchMax", get: (s) => s.base_cleaner },
    ranks: [
      { threshold: 50, rarity: "common", title: "Janitor" },
      { threshold: 80, rarity: "rare", title: "Base Protector" },
      { threshold: 100, rarity: "legendary", title: "Batcher" },
      { threshold: 140, rarity: "mythic", title: "Lord Batcher" },
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
      { threshold: 8, rarity: "legendary", title: "Batcher Sentry Expert" },
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
    rarity: "epic",
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
    // Mythic rank added 29 Jul 2026: nobody has ever hit 10+ DBS returns twice
    // over (the record is 11), so 15 stays a real reach rather than a gimme.
    id: "press-a-bind",
    title: "Press a Bind",
    category: "match",
    icon: "revanchist-sith",
    condition: "DBS returns in a single match",
    metric: { type: "matchMax", get: (s) => s.dbs_returns },
    ranks: [
      { threshold: 10, rarity: "legendary" },
      { threshold: 15, rarity: "mythic" },
    ],
  },
  {
    // Calibrated 29 Jul 2026 against the full match_stats history: 5+:256,
    // 10+:43, 15+:7, 20+:0 rows. The suggested 25 tier never happens, so the
    // ladder stops at 20 rather than carrying a permanently-unreachable Mythic.
    id: "red-rets",
    title: "Red Rets",
    category: "match",
    icon: "new-republic", // shares RET SERVICES!!'s crest — a returns feat
    condition: "Red-stance returns in a single match",
    metric: { type: "matchMax", get: (s) => s.red_returns },
    ranks: [
      { threshold: 5, rarity: "common" },
      { threshold: 10, rarity: "rare" },
      { threshold: 15, rarity: "epic" },
      { threshold: 20, rarity: "legendary" },
    ],
  },
  {
    // Yellow returns run far lower than red or DFA (nobody has ever broken 9),
    // so this ladder is deliberately tighter than the suggested 5/10/15/20/25 —
    // 5+:29, 7+:7, 12+/20+:0. 12 and 20 stay unclaimed for now, same as any
    // other aspirational top rank elsewhere in the file.
    id: "yellow-rets",
    title: "Yellow Rets",
    category: "match",
    icon: "black-sun", // shares Yellow Spammer's crest — same stance
    condition: "Yellow-stance returns in a single match",
    metric: { type: "matchMax", get: (s) => s.yellow_returns },
    ranks: [
      { threshold: 5, rarity: "common" },
      { threshold: 7, rarity: "rare" },
      { threshold: 12, rarity: "epic" },
      { threshold: 20, rarity: "legendary" },
    ],
  },
  {
    // Raised 29 Jul 2026: the original 5/10/15/20 spread let cheese clear
    // Legendary almost immediately — every one of their top runs (21, 18, 16,
    // 15, 15...) already sat past 15, so 20 was barely a reach. Re-pulled the
    // full history: 10+:47, 15+:5, 18+:2, 20+:1 (cheese's all-time record).
    // Legendary now sits at 25 — past the record — so it stays a genuine,
    // currently-unclaimed goal instead of a same-day gimme.
    id: "dfa-rets",
    title: "DFA Dabbler",
    category: "match",
    icon: "mandalorian-mysteries", // shares Cheese's Dream's crest — a DFA feat
    condition: "DFA returns in a single match",
    metric: { type: "matchMax", get: (s) => s.dfa_returns },
    ranks: [
      { threshold: 10, rarity: "common", title: "DFA Dabbler" },
      { threshold: 15, rarity: "rare", title: "DFA Adept" },
      { threshold: 18, rarity: "epic", title: "DFA Savant" },
      { threshold: 25, rarity: "legendary", title: "DFA Deity" },
    ],
  },
  {
    // Only one match on record has ever combined all four (arhont) — the crest
    // unlocks for them retroactively on deploy, which is fine here: unlike the
    // one-of-one/pair families, an ordinary multi-holder crest is always
    // evaluated over the full history, the same as Cap God or 2000 Club are.
    id: "jack-of-all-trades",
    title: "Jack of All Trades",
    category: "match",
    icon: "rebel-alliance", // no single stance owns this — a generalist's crest
    condition: "7+ red, 7+ yellow, 5+ DFA and 5+ DBS returns in one match",
    metric: {
      type: "matchPredicate",
      test: (s) => s.red_returns >= 7 && s.yellow_returns >= 7 && s.dfa_returns >= 5 && s.dbs_returns >= 5,
    },
    threshold: 1,
    rarity: "legendary",
  },
  {
    // 20+ rets alone has happened plenty (126 matches); paired with a 1.5+ K/D
    // it's never once co-occurred, which is what earns the Mythic tier.
    id: "ret-god",
    title: "Ret God",
    category: "match",
    icon: "sith-eternal", // shares Rambo's crest — an unstoppable-stats feat
    condition: "30+ returns with a 1.5+ K/D in a single match",
    metric: {
      type: "matchPredicate",
      test: (s) => s.returns >= 30 && s.kills >= 1.5 * s.deaths,
    },
    threshold: 1,
    rarity: "mythic",
  },
  {
    // The single hardest combo in the file by design — every individual gate
    // has been cleared before (8 sentry kills, 45 mine kills, 6 mine returns,
    // etc.) but never all six at once in the 1305 scoreboard rows on record.
    // Kept exactly as requested rather than loosened.
    id: "support-god",
    title: "Support God",
    category: "match",
    icon: "clone-trooper", // shares Apache Gunner's crest — support-role feat
    condition: "15+ rets, 20+ enemy mine grabs, 3+ sentry kills, 10+ mine kills, 3+ mine rets in one match",
    metric: {
      type: "matchPredicate",
      test: (s) =>
        s.score >= 1 &&
        s.returns >= 15 &&
        mineGrabsOf(s) >= 20 &&
        s.turret_kills >= 3 &&
        s.mine_kills >= 10 &&
        s.mine_returns >= 3,
    },
    threshold: 1,
    rarity: "mythic",
  },
  {
    // 5 matches on record land all four 20+ kill-style counts in one sitting.
    id: "versatile-killer",
    title: "Versatile Killer",
    category: "match",
    icon: "sith-order", // shares DBS Enjoyer's crest — a style-mastery feat
    condition: "20+ DFA, yellow, red and mine kills in one match",
    metric: {
      type: "matchPredicate",
      test: (s) => s.dfa_kills >= 20 && s.yellow_kills >= 20 && s.red_kills >= 20 && s.mine_kills >= 20,
    },
    threshold: 1,
    rarity: "epic",
  },
  {
    // Same computed-tier trick as Camp above: captures + returns + enemy mine
    // grabs all rise together, so get() reports the highest tier currently met.
    // The entry tier has happened 4 times; Legendary and Mythic are aspirational.
    id: "triple-threat",
    title: "Triple Threat",
    category: "match",
    icon: "galactic-republic", // shares Cap Enjoyer's crest — a captures feat
    condition: "Captures, returns and enemy mine grabs in a single match",
    metric: {
      type: "matchMax",
      get: (s) => {
        const grabs = mineGrabsOf(s)
        if (s.captures >= 5 && s.returns >= 15 && grabs >= 4) return 3
        if (s.captures >= 4 && s.returns >= 12 && grabs >= 3) return 2
        if (s.captures >= 3 && s.returns >= 10 && grabs >= 2) return 1
        return 0
      },
    },
    ranks: [
      { threshold: 1, rarity: "epic", title: "Triple Threat", requirementLabel: "3 caps, 10 rets, 2 mine grabs" },
      {
        threshold: 2,
        rarity: "legendary",
        title: "Complete Package",
        requirementLabel: "4 caps, 12 rets, 3 mine grabs",
      },
      { threshold: 3, rarity: "mythic", title: "One-Man Army", requirementLabel: "5 caps, 15 rets, 4 mine grabs" },
    ],
  },
  {
    // Capture efficiency: captures per flag grab, gated at 10+ grabs (so a lucky
    // single conversion can't read as 100%), 25+ minutes PLAYED, and 10+ minutes
    // of actual flag hold — belt and braces against two different ways a match
    // could inflate the ratio without real sustained capping: a short/stacked
    // stomp (caught by the 25-min played floor) or a long match where this
    // player barely touched the flag (caught by the 10-min hold floor).
    // Calibrated 30 Jul 2026 against the 379 matches clearing all three gates:
    // 15%+:21, 20%+:14, 25%+:12, 30%+:2, 40%+:0 — Prime Capper currently
    // unclaimed (Interlude's 46% match is 24 min played, just short of the
    // 25-min floor).
    // get() reports whole percentage points (not a 0-1 ratio) so thresholds are
    // plain integers like everywhere else in the file — see the "percent" unit.
    id: "efficient-capper",
    title: "Handy Capper",
    category: "match",
    icon: "rogue-one", // shares Pro Rusher's crest — another capture-efficiency feat
    condition: "Captures per flag grab, 10+ grabs, 25+ min played and 10+ min flag hold",
    unit: "percent",
    metric: {
      type: "matchMax",
      get: (s) =>
        s.flag_grabs >= 10 && (s.time_played ?? 0) >= 25 && s.flag_hold_ms >= TEN_MINUTES_MS
          ? Math.round((s.captures / s.flag_grabs) * 100)
          : 0,
    },
    ranks: [
      { threshold: 15, rarity: "common", title: "Handy Capper" },
      { threshold: 20, rarity: "rare", title: "Sharp Capper" },
      { threshold: 25, rarity: "epic", title: "Precision Capper" },
      { threshold: 30, rarity: "legendary", title: "Surgical Capper" },
      { threshold: 40, rarity: "mythic", title: "Prime Capper" },
    ],
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
      { threshold: 150, rarity: "rare", title: "Capper Main" },
      { threshold: 250, rarity: "epic", title: "Cap Hero" },
      { threshold: 500, rarity: "legendary", title: "Cap Legend" },
    ],
  },
  {
    // Top rank renamed 30 Jul 2026: "RET GOD" collided with the new match-feat
    // Ret God (30+ rets, 1.5+ K/D) — same words, unrelated achievement.
    id: "ret-services",
    title: "RET SERVICES!!",
    category: "career",
    icon: "new-republic",
    condition: "Career flag returns",
    metric: { type: "careerSum", get: (s) => s.returns },
    ranks: [
      { threshold: 500, rarity: "common" },
      { threshold: 1000, rarity: "epic" },
      { threshold: 2500, rarity: "legendary", title: "RET POWER!!" },
    ],
  },
  {
    id: "bser",
    title: "Tornado",
    category: "career",
    icon: "dark-lord-of-the-sith",
    condition: "Career backslash kills",
    metric: { type: "careerSum", get: (s) => s.bs_kills },
    ranks: [
      { threshold: 100, rarity: "common", title: "Tornado Enthusiast" },
      { threshold: 250, rarity: "rare", title: "Tornado Spammer" },
      { threshold: 500, rarity: "epic", title: "Tornado King" },
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
      { threshold: 2500, rarity: "epic", title: "Yellow Swordsman" },
      { threshold: 5000, rarity: "legendary", title: "Yellow Maestro" },
    ],
  },
  {
    // TELE-KILLS (migration 023) is unconfirmed against a real scoreboard build
    // yet, same caveat DFA-ATTEMPTS/BLOCKS-ENEMY carried at launch — it just
    // accrues 0 until a CSV that carries the header gets uploaded.
    id: "otherworldly",
    title: "Otherworldly",
    category: "career",
    icon: "confederancy-of-independent-system", // the network/portal crest
    condition: "Career teleport kills",
    metric: { type: "careerSum", get: (s) => s.tele_kills },
    ranks: [
      { threshold: 1, rarity: "rare" },
      { threshold: 5, rarity: "epic" },
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
      { threshold: 1000, rarity: "legendary", title: "Detonation Expert" },
      { threshold: 2500, rarity: "mythic", title: "Trip Mine Architect" },
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
    pairRelation: "with",
    metric: {
      type: "seqDerived",
      best: true,
      compute: (seq) => {
        const out: { v: number; date: string; matchId: string; who?: string }[] = []
        const games = new Map<string, number>()
        let best = 0
        for (const m of seq) {
          if (!countsForPair(m)) continue
          for (const mate of m.teammates) {
            const g = (games.get(mate) ?? 0) + 1
            games.set(mate, g)
            if (g > best) {
              best = g
              out.push({ v: best, date: m.date, matchId: m.matchId, who: mate })
            }
          }
        }
        return out
      },
    },
    ranks: [
      { threshold: 25, rarity: "common" },
      { threshold: 40, rarity: "rare", title: "Double Act" },
      { threshold: 60, rarity: "epic", title: "Two of a Kind" },
      { threshold: 100, rarity: "legendary", title: "Soulbound" },
    ],
  },
  {
    // Counted per opponent, not per match: if a whole enemy six has a 3+ run over
    // you and you finally beat them, that ends several streaks at once — and each
    // ended streak is worth its FULL length in points, not just one, so grinding
    // down a long-standing 8-match losing run is worth as much as it feels. A
    // running tally, so it's "12 / 15" style progress rather than a personal best.
    // Icon deliberately reused (no spare crest SVGs).
    id: "revenge",
    title: "Revenge",
    category: "streak",
    icon: "raziel-clan",
    condition: "End an opponent's 3+ win streak over you",
    pending: true, // forward-only, see PAIR_ACHIEVEMENTS_FROM
    pairRelation: "against",
    metric: {
      type: "seqDerived",
      compute: (seq) => {
        const out: { v: number; date: string; matchId: string; who?: string }[] = []
        const losingTo = new Map<string, number>()
        let n = 0
        for (const m of seq) {
          if (!countsForPair(m)) continue
          if (m.won) {
            for (const opp of m.opponents) {
              const streak = losingTo.get(opp) ?? 0
              if (streak >= 3) {
                n += streak
                out.push({ v: n, date: m.date, matchId: m.matchId, who: opp })
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
      { threshold: 20, rarity: "common" },
      { threshold: 50, rarity: "rare" },
      { threshold: 100, rarity: "epic" },
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
      { threshold: 250, rarity: "rare", title: "Wingman" },
      { threshold: 500, rarity: "epic", title: "Assist Machine" },
      { threshold: 1000, rarity: "legendary", title: "Altruist" },
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
      { threshold: 10, rarity: "epic" },
      { threshold: 25, rarity: "legendary" },
      { threshold: 100, rarity: "mythic", title: "MF DOOM" },
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
      { threshold: 100, rarity: "common" },
      { threshold: 1000, rarity: "epic", title: "Minewhore" },
      { threshold: 2500, rarity: "legendary", title: "Mine Dominatrix" },
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
      { threshold: 100, rarity: "common", title: "Community Stalwart" },
      { threshold: 500, rarity: "rare", title: "VIP Discord Member" },
      { threshold: 1000, rarity: "legendary", title: "Veteran" },
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
    // Re-calibrated 29 Jul 2026: at the old 500-threshold, 11 of 49 blockers
    // (22%) already held Brick Wall — far too common for a rare-tier crest.
    // Raised to sit past all but the two highest career totals on record
    // (Interlude 986, yuki 823); epic follows suit so it stays a real reach
    // rather than nearly-claimed at the old 1000.
    id: "blocked",
    title: "Blocked!",
    category: "career",
    icon: "mandalorian-neo-crusaders",
    condition: "Career enemy blocks",
    metric: { type: "careerSum", get: (s) => s.blocks_enemy },
    ranks: [
      { threshold: 250, rarity: "common" },
      { threshold: 750, rarity: "rare", title: "Brick Wall" },
      { threshold: 1250, rarity: "epic", title: "Immovable Object" },
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
      { threshold: 5000, rarity: "epic", title: "Headhunter" },
      { threshold: 10000, rarity: "legendary", title: "Mandalorian" },
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
      { threshold: 500, rarity: "epic", title: "Touch Grass" },
      { threshold: 1000, rarity: "legendary", title: "Terminally Online" },
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
    pairRelation: "with",
    metric: {
      type: "seqDerived",
      best: true,
      compute: (seq) => {
        const out: { v: number; date: string; matchId: string; who?: string }[] = []
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
                out.push({ v: best, date: m.date, matchId: m.matchId, who: mate })
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
      { threshold: 8, rarity: "epic", title: "Dynamic Duo" },
      { threshold: 12, rarity: "legendary", title: "Unbreakable Bond" },
      { threshold: 15, rarity: "mythic", title: "Til Death" },
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
    pairRelation: "against",
    metric: {
      type: "seqDerived",
      best: true,
      compute: (seq) => {
        const out: { v: number; date: string; matchId: string; who?: string }[] = []
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
                out.push({ v: best, date: m.date, matchId: m.matchId, who: opp })
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
      { threshold: 15, rarity: "mythic", title: "Giga Owneds" },
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
      { threshold: 5, rarity: "common" },
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

// ---------------------------------------------------------------------------
// Secret one-of-one achievements
// ---------------------------------------------------------------------------

// These are NOT in ACHIEVEMENTS, and deliberately so: every entry above answers
// "did THIS player do X?" from that player's own history. A one-of-one asks a
// global question — "was anyone earlier?" — which no per-player metric can see.
// The first player in the whole match history to satisfy `claim` holds the crest
// forever; nobody else can ever earn it. lib/achievements.ts resolves the holder
// (resolveSecretHolders) and only the holder is ever handed a view, so for every
// other player these do not exist: not on the profile, not in the bot's
// =achievements, not in any earned/total count.
//
// No forward-only cutoff (cf. PAIR_ACHIEVEMENTS_FROM): the whole history is fair
// game, because nobody has claimed one yet. See PACIFIST_MIN_MINUTES for why.

// A claim only needs the scoreboard line plus the match result, so this is a much
// narrower context than AchMatch — no team rosters, no streak history.
export interface ClaimContext {
  won: boolean
  lost: boolean
  myScore: number
  oppScore: number
}

export interface SecretDef {
  id: string
  title: string
  category: AchievementCategory
  icon: string // /achievements/<icon>.svg
  condition: string
  claim: (s: AchStat, m: ClaimContext) => boolean
  // Forward-only cutoff: matches before this ISO timestamp can never claim the
  // crest. Used when the back catalogue already contains a qualifying match that
  // should NOT silently take it on deploy (see protector-of-yavin below).
  from?: string
}

// Every secret crest is this rarity. There is no ladder to climb.
export const SECRET_RARITY: Rarity = "oneofone"

// Pacifist needs a participation floor. There is exactly one zero-kill line in the
// 811 scoreboard rows on record — three minutes played, zero score, one death — so
// without this a player who connects, does nothing and happens to be on the winning
// team would permanently claim the rarest crest in the game. No player with ten
// minutes on the clock has ever finished a match below two kills, so 20 minutes
// gates out the AFKs without putting a real pacifist run out of reach.
// time_played is stored in MINUTES (scoreboard TIME-SUM) and is nullable.
const PACIFIST_MIN_MINUTES = 20

// Thresholds below were calibrated against all 811 scoreboard rows on record
// (July 2026): each sits just past the all-time best, so every crest is
// unclaimed but not absurd. For reference — dbs_kills record 14, dfa_kills
// record 81, best flag hold under 30 deaths 36:00, doom_kills record 1 (yes,
// one: Mayhem 4 is meant to be the white whale), and 3+ caps with 20+ returns
// has never once co-occurred, never mind with 100 kills on top.
//
// Icons are all reused from ACHIEVEMENTS (no spare crest SVGs), picked for
// theme: the octagon chassis + fuchsia keeps them visually distinct anyway.
export const SECRET_ACHIEVEMENTS: SecretDef[] = [
  {
    id: "pacifist",
    title: "Pacifist",
    category: "match",
    icon: "new-jedi-order", // the Jedi crest — peace
    condition: "Win a match without a single kill",
    claim: (s, m) => m.won && s.kills === 0 && (s.time_played ?? 0) >= PACIFIST_MIN_MINUTES,
  },
  {
    id: "prime-vo",
    title: "HE'S SCRIPTING!!!!",
    category: "match",
    icon: "sith-order", // shares DBS Enjoyer's crest — it's a DBS feat
    condition: "20+ DBS kills in a single match",
    claim: (s) => s.dbs_kills >= 20,
  },
  {
    // 3-cap floor added 29 Jul 2026: without it, a pure turtle who never once
    // brought the flag home could still claim a crest named after a runner.
    id: "wesleys-prodigy",
    title: "Wesley's Prodigy",
    category: "match",
    icon: "rogue-one", // shares Pro Rusher's crest — the runner's crest
    condition: "Hold the flag 45+ minutes with 3+ caps and under 30 deaths",
    claim: (s) => s.flag_hold_ms >= 2_700_000 && s.captures >= 3 && s.deaths < 30,
  },
  {
    id: "cheese-is-hacking",
    title: "Embrace Cheese, reject masculinity",
    category: "match",
    icon: "mandalorian-mysteries", // shares Cheese's Dream's crest, naturally
    condition: "100+ DFA kills in a single match",
    claim: (s) => s.dfa_kills >= 100,
  },
  {
    // Interlude already did this on 8 Jun 2026 (2 caps, 20 returns, 119 kills) —
    // forward-only so it has to be re-earned live rather than handed out silently
    // on deploy.
    id: "protector-of-yavin",
    title: "Protector of Yavin",
    category: "match",
    icon: "rebel-alliance", // Yavin IV — the Rebel base
    condition: "2+ caps, 20+ returns and 100+ kills in one match",
    from: "2026-07-09T00:00:00.000Z",
    claim: (s) => s.captures >= 2 && s.returns >= 20 && s.kills >= 100,
  },
  {
    id: "mayhem-4",
    title: "Mayhem'd",
    category: "match",
    icon: "sith-era", // shares DOOM's crest — it's a doom feat
    condition: "3+ dooms, 15+ DBS kills and a cap in one match",
    claim: (s) => s.doom_kills >= 3 && s.dbs_kills >= 15 && s.captures >= 1,
  },
  {
    id: "queue-killer-3000",
    title: "Queue Killer 3000",
    category: "match",
    icon: "sith-eternal", // shares Rambo's crest — an unstoppable-kills feat
    condition: "Win a match with zero deaths (10+ min played)",
    claim: (s, m) => m.won && s.deaths === 0 && (s.time_played ?? 0) >= 10,
  },
  {
    // A team win is capped at 7 captures, so this is only reachable by personally
    // accounting for every single one of them, at a blistering pace. The scoreboard
    // has no per-capture timestamps, so "in 7 minutes" is approximated as the
    // player's whole match — captures and all — fitting inside a 7-minute stint.
    id: "im-blyating",
    title: "I'm Blyating",
    category: "match",
    icon: "rebel-fist", // shares Kimbo Slice's crest — pure speed
    condition: "Capture the flag 7 times in under 7 minutes",
    claim: (s) => s.captures >= 7 && s.time_played != null && s.time_played <= 7,
  },
]

// Both ACHIEVEMENTS and SECRET_ACHIEVEMENTS, by id. Anything that renders a crest
// from an id alone — the Discord embed thumbnail, the unlock ping's display name —
// must go through this, or a secret crest falls back to a grey "Achievement" card.
export function findAchievementDef(
  id: string,
): { id: string; title: string; ranks?: Rank[]; rarity?: Rarity } | undefined {
  const def = ACHIEVEMENTS.find((d) => d.id === id)
  if (def) return def
  const secret = SECRET_ACHIEVEMENTS.find((d) => d.id === id)
  return secret && { id: secret.id, title: secret.title, rarity: SECRET_RARITY }
}
