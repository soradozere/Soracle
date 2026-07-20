import {
  ACHIEVEMENTS,
  RARITY_META,
  SECRET_ACHIEVEMENTS,
  SECRET_RARITY,
  type AchievementCategory,
  type AchievementDef,
  type AchMatch,
  type AchStat,
  type ClaimContext,
  type Rank,
  type Rarity,
} from "@/lib/achievement-meta"

// Turns a player's chronological match history into earned/locked state for
// every achievement. Pure and presentation-free — the crest styling is derived
// from `rarity` in the component. Called once per profile load from
// lib/player-profile.ts, which assembles the AchMatch[] sequence.

export interface AchievementView {
  id: string
  title: string // resolved to the current rank's title where it overrides
  // Whether that title came from the RANK rather than the family. Callers use
  // this to decide on the roman numeral, and it cannot be inferred by comparing
  // the two strings: a rank is allowed to be named the same as its family
  // (Batcher III is literally "Batcher"), and that must not read as unnamed.
  titled: boolean
  category: AchievementCategory
  rarity: Rarity // current rank's rarity when earned, else the entry rank's
  icon: string
  condition: string
  pending: boolean
  tiered: boolean
  rank: number // 0 = locked, else 1..totalRanks
  totalRanks: number
  earned: boolean
  earnedDate: string | null
  earnedMatchId: string | null // the match that crossed the current rank (for unlock pings)
  earnedRequirement: string | null // the threshold that defines the current rank (e.g. "80+"), for tiered crests
  // For pair crests: the partner note the tooltip shows ("with bizzle" / "against
  // arhont") — the team-mate/opponent whose run reached the current rank. Null otherwise.
  earnedWith: string | null
  progressPct: number | null // toward the next (earned) / first (locked) threshold
  progressLabel: string | null
  value: number // raw current metric value
}

const ROMAN = ["I", "II", "III", "IV", "V", "VI"]
const romanFor = (rank: number) => ROMAN[rank - 1] ?? String(rank)

// Walk the sequence once and record, after each contributing match, the running
// value of this family's metric. Because every metric here is effectively
// monotonic in its own progression, `value` = the max seen and the earliest
// crossing of a threshold T = the first entry whose value ≥ T.
function progressionFor(
  def: AchievementDef,
  seq: AchMatch[],
): { v: number; date: string; matchId: string; who?: string }[] {
  const out: { v: number; date: string; matchId: string; who?: string }[] = []
  const m = def.metric
  switch (m.type) {
    case "careerSum": {
      let total = 0
      for (const mt of seq) {
        if (!mt.played || !mt.stat) continue
        const c = m.get(mt.stat)
        if (c) {
          total += c
          out.push({ v: total, date: mt.date, matchId: mt.matchId })
        }
      }
      break
    }
    case "matchMax": {
      let best = 0
      for (const mt of seq) {
        if (!mt.played || !mt.stat) continue
        const val = m.get(mt.stat)
        if (val > best) {
          best = val
          out.push({ v: best, date: mt.date, matchId: mt.matchId })
        }
      }
      break
    }
    case "matchCount": {
      let n = 0
      for (const mt of seq) {
        if (!mt.played) continue
        n++
        out.push({ v: n, date: mt.date, matchId: mt.matchId })
      }
      break
    }
    case "winCount": {
      let n = 0
      for (const mt of seq) {
        if (!mt.played) continue
        if (mt.won) {
          n++
          out.push({ v: n, date: mt.date, matchId: mt.matchId })
        }
      }
      break
    }
    case "winStreak": {
      let s = 0
      for (const mt of seq) {
        if (!mt.played) continue
        if (mt.won) {
          s++
          out.push({ v: s, date: mt.date, matchId: mt.matchId })
        } else {
          s = 0
        }
      }
      break
    }
    case "shutoutWins": {
      let n = 0
      for (const mt of seq) {
        if (!mt.played) continue
        if (mt.won && mt.oppScore === 0) {
          n++
          out.push({ v: n, date: mt.date, matchId: mt.matchId })
        }
      }
      break
    }
    case "oneCapWins": {
      let n = 0
      for (const mt of seq) {
        if (!mt.played) continue
        if (mt.won && mt.myScore - mt.oppScore === 1) {
          n++
          out.push({ v: n, date: mt.date, matchId: mt.matchId })
        }
      }
      break
    }
    case "matchPredicate": {
      let n = 0
      for (const mt of seq) {
        if (!mt.played || !mt.stat) continue
        if (m.test(mt.stat, mt)) {
          n++
          out.push({ v: n, date: mt.date, matchId: mt.matchId })
        }
      }
      break
    }
    // Teammate/opponent-grouped metrics supply their own walk; the contract on the
    // returned entries is identical, so crossing detection below is unchanged.
    case "seqDerived":
      return m.compute(seq)
  }
  return out
}

const clampPct = (x: number) => Math.max(0, Math.min(1, x))
const fmtVal = (v: number, def: AchievementDef) => (def.unit === "hours" ? `${Math.round(v)}h` : `${Math.round(v)}`)

// One rank of one crest, crossed by one player, in one match.
export interface UnlockEvent {
  achId: string
  rank: number // 1..totalRanks
  totalRanks: number
  rarity: Rarity
  title: string // the rank's own title, e.g. "Unstoppable" for On Fire II
  titled: boolean // see AchievementView.titled
  date: string
  matchId: string
}

// Every rank this player has ever crossed, in chronological order — including the
// ones they've since climbed past. A view only carries the CURRENT rank's date,
// which is all a profile needs but loses the history the ledger is built from: if
// someone reached Batcher III today, the view can't say when they got I or II.
//
// A single match can cross several ranks at once (a 140-block game takes a player
// from nothing to Batcher IV), so each crossed rank gets its own event, all sharing
// that match's date. Ordering within such a group is by rank, ascending.
export function unlockEventsFor(def: AchievementDef, seq: AchMatch[]): UnlockEvent[] {
  const prog = progressionFor(def, seq)
  if (!prog.length) return []

  // Untiered families are a one-rank ladder, so both shapes walk the same loop.
  const ranks: Rank[] = def.ranks?.length ? def.ranks : [{ threshold: def.threshold ?? 1, rarity: def.rarity ?? "common" }]
  const out: UnlockEvent[] = []
  for (let i = 0; i < ranks.length; i++) {
    // progressionFor's contract: entries are pushed only when the tracked value
    // improves, so the FIRST entry at or above a threshold is the crossing.
    const crossing = prog.find((e) => e.v >= ranks[i].threshold)
    if (!crossing) break // thresholds ascend — nothing above this is reachable either
    out.push({
      achId: def.id,
      rank: i + 1,
      totalRanks: ranks.length,
      rarity: ranks[i].rarity,
      title: ranks[i].title ?? def.title,
      titled: !!ranks[i].title,
      date: crossing.date,
      matchId: crossing.matchId,
    })
  }
  return out
}

function viewFor(def: AchievementDef, seq: AchMatch[]): AchievementView {
  const prog = progressionFor(def, seq)
  const value = prog.reduce((mx, e) => Math.max(mx, e.v), 0)
  const crossingDate = (t: number) => prog.find((e) => e.v >= t)?.date ?? null
  const crossingMatchId = (t: number) => prog.find((e) => e.v >= t)?.matchId ?? null
  // The partner note for pair crests, e.g. "with bizzle" — the team-mate/opponent
  // whose run first reached threshold `t`. Only pair metrics carry a `who`.
  const crossingWith = (t: number): string | null => {
    if (!def.pairRelation) return null
    const who = prog.find((e) => e.v >= t)?.who
    return who ? `${def.pairRelation} ${who}` : null
  }
  const best =
    def.metric.type === "matchMax" ||
    def.metric.type === "matchPredicate" ||
    (def.metric.type === "seqDerived" && !!def.metric.best)

  // Progress label toward `t`; `next` = the roman numeral being worked toward.
  const label = (t: number, next: string | null) => {
    const bar = `${fmtVal(value, def)} / ${fmtVal(t, def)}`
    const arrow = next ? ` → ${next}` : ""
    return `${best ? "best " : ""}${bar}${arrow}`
  }

  if (def.ranks && def.ranks.length) {
    const ranks = def.ranks
    let unlocked = 0
    for (const r of ranks) if (value >= r.threshold) unlocked++
    const earned = unlocked > 0
    const cur = earned ? ranks[unlocked - 1] : ranks[0]
    const next = ranks[unlocked] // undefined once maxed
    let progressPct: number | null
    let progressLabel: string | null
    if (!earned) {
      const t = ranks[0].threshold
      progressPct = clampPct(value / t)
      progressLabel = label(t, romanFor(1))
    } else if (next) {
      progressPct = clampPct(value / next.threshold)
      progressLabel = label(next.threshold, romanFor(unlocked + 1))
    } else {
      // Top rank reached — no "next", so surface the achieved threshold instead
      // of a bare "MAXED" (which would hide the number the other states show).
      progressPct = 1
      progressLabel = `MAXED · ${fmtVal(cur.threshold, def)}${def.exact ? "" : "+"}`
    }
    return {
      id: def.id,
      title: cur.title ?? def.title,
      titled: !!cur.title,
      category: def.category,
      rarity: cur.rarity,
      icon: def.icon,
      condition: def.condition,
      pending: !!def.pending,
      tiered: true,
      rank: unlocked,
      totalRanks: ranks.length,
      earned,
      earnedDate: earned ? crossingDate(cur.threshold) : null,
      earnedMatchId: earned ? crossingMatchId(cur.threshold) : null,
      // The current rank's own threshold — the number the tile's next/MAXED label
      // doesn't show once you've climbed past a rank (e.g. Batcher II = 80+).
      earnedRequirement: earned ? `${fmtVal(cur.threshold, def)}${def.exact ? "" : "+"}` : null,
      earnedWith: earned ? crossingWith(cur.threshold) : null,
      progressPct,
      progressLabel,
      value,
    }
  }

  // Untiered.
  const threshold = def.threshold ?? 1
  const rarity = def.rarity ?? "common"
  const earned = value >= threshold
  const predicate = def.metric.type === "matchPredicate"
  return {
    id: def.id,
    title: def.title,
    titled: false, // untiered: the family name IS the name
    category: def.category,
    rarity,
    icon: def.icon,
    condition: def.condition,
    pending: !!def.pending,
    tiered: false,
    rank: earned ? 1 : 0,
    totalRanks: 1,
    earned,
    earnedDate: earned ? crossingDate(threshold) : null,
    earnedMatchId: earned ? crossingMatchId(threshold) : null,
    // Untiered conditions already spell out their number ("Score 2000+"), so
    // there's nothing extra to surface.
    earnedRequirement: null,
    earnedWith: earned ? crossingWith(threshold) : null,
    // Boolean feats have no meaningful partial progress; scalar ones do.
    progressPct: earned ? 1 : predicate ? null : clampPct(value / threshold),
    progressLabel: earned || predicate ? null : label(threshold, null),
    value,
  }
}

// Display order: earned crests first (rarest, then highest value), then locked
// ones by how close they are to unlocking, with data-pending crests last.
function compareViews(a: AchievementView, b: AchievementView): number {
  if (a.earned !== b.earned) return a.earned ? -1 : 1
  if (a.earned) {
    const r = RARITY_META[b.rarity].order - RARITY_META[a.rarity].order
    if (r) return r
    return b.value - a.value
  }
  if (a.pending !== b.pending) return a.pending ? 1 : -1
  return (b.progressPct ?? -1) - (a.progressPct ?? -1)
}

// ---------------------------------------------------------------------------
// Secret one-of-one achievements
// ---------------------------------------------------------------------------

// One player's scoreboard line in one match — the only thing a `claim` can read.
// Both callers already hold every match and every stat row, so building these
// costs no extra queries: lib/player-profile.ts for the browser,
// lib/achievements-server.ts for the Discord bot.
export interface SecretCandidate {
  playerId: string
  matchId: string
  date: string
  ctx: ClaimContext
  stat: AchStat
}

export interface SecretHolder {
  playerId: string
  matchId: string
  date: string
}

// Earliest claim wins. Two team-mates CAN both finish a won match on zero kills,
// so "earliest" alone is ambiguous — matchId then playerId break the tie. The rule
// only has to be total and stable: the browser and the bot each resolve this
// independently, and they must never name different holders for the same crest.
function claimedFirst(a: SecretCandidate, b: SecretHolder): boolean {
  const at = Date.parse(a.date)
  const bt = Date.parse(b.date)
  if (at !== bt) return at < bt
  if (a.matchId !== b.matchId) return a.matchId < b.matchId
  return a.playerId < b.playerId
}

// Who holds each secret crest. Absent from the map = nobody has claimed it yet,
// and it stays invisible to everyone.
export function resolveSecretHolders(candidates: SecretCandidate[]): Map<string, SecretHolder> {
  const holders = new Map<string, SecretHolder>()
  for (const def of SECRET_ACHIEVEMENTS) {
    // Forward-only crests ignore the back catalogue entirely (see SecretDef.from).
    // Parsed timestamps, not string compare — created_at spelling varies (+00:00 vs Z).
    const fromMs = def.from ? Date.parse(def.from) : null
    let best: SecretHolder | null = null
    for (const c of candidates) {
      if (fromMs !== null && Date.parse(c.date) < fromMs) continue
      if (!def.claim(c.stat, c.ctx)) continue
      if (!best || claimedFirst(c, best)) best = { playerId: c.playerId, matchId: c.matchId, date: c.date }
    }
    if (best) holders.set(def.id, best)
  }
  return holders
}

// The secret crests THIS player holds, as views. Everyone else gets an empty array,
// which is what keeps a secret secret — there is no locked state to leak.
export function secretViewsFor(playerId: string, holders: Map<string, SecretHolder>): AchievementView[] {
  const views: AchievementView[] = []
  for (const def of SECRET_ACHIEVEMENTS) {
    const holder = holders.get(def.id)
    if (holder?.playerId !== playerId) continue
    views.push({
      id: def.id,
      title: def.title,
      titled: false,
      category: def.category,
      rarity: SECRET_RARITY,
      icon: def.icon,
      condition: def.condition,
      pending: false,
      tiered: false,
      rank: 1,
      totalRanks: 1,
      earned: true,
      earnedDate: holder.date,
      earnedMatchId: holder.matchId,
      earnedRequirement: null,
      earnedWith: null,
      progressPct: 1,
      progressLabel: null,
      value: 1,
    })
  }
  return views
}

// `secrets` comes from secretViewsFor — empty for all but the single holder. They
// sort to the front for free: RARITY_META.oneofone has the highest order.
export function computeAchievements(seq: AchMatch[], secrets: AchievementView[] = []): AchievementView[] {
  return [...ACHIEVEMENTS.map((def) => viewFor(def, seq)), ...secrets].sort(compareViews)
}
