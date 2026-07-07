import {
  ACHIEVEMENTS,
  RARITY_META,
  type AchievementCategory,
  type AchievementDef,
  type AchMatch,
  type Rarity,
} from "@/lib/achievement-meta"

// Turns a player's chronological match history into earned/locked state for
// every achievement. Pure and presentation-free — the crest styling is derived
// from `rarity` in the component. Called once per profile load from
// lib/player-profile.ts, which assembles the AchMatch[] sequence.

export interface AchievementView {
  id: string
  title: string // resolved to the current rank's title where it overrides
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
function progressionFor(def: AchievementDef, seq: AchMatch[]): { v: number; date: string; matchId: string }[] {
  const out: { v: number; date: string; matchId: string }[] = []
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
  }
  return out
}

const clampPct = (x: number) => Math.max(0, Math.min(1, x))
const fmtVal = (v: number, def: AchievementDef) => (def.unit === "hours" ? `${Math.round(v)}h` : `${Math.round(v)}`)

function viewFor(def: AchievementDef, seq: AchMatch[]): AchievementView {
  const prog = progressionFor(def, seq)
  const value = prog.reduce((mx, e) => Math.max(mx, e.v), 0)
  const crossingDate = (t: number) => prog.find((e) => e.v >= t)?.date ?? null
  const crossingMatchId = (t: number) => prog.find((e) => e.v >= t)?.matchId ?? null
  const best = def.metric.type === "matchMax" || def.metric.type === "matchPredicate"

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
      progressLabel = `MAXED · ${fmtVal(cur.threshold, def)}+`
    }
    return {
      id: def.id,
      title: cur.title ?? def.title,
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

export function computeAchievements(seq: AchMatch[]): AchievementView[] {
  return ACHIEVEMENTS.map((def) => viewFor(def, seq)).sort(compareViews)
}
