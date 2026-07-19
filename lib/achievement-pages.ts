import {
  ACHIEVEMENTS,
  RARITY_META,
  SECRET_ACHIEVEMENTS,
  findAchievementDef,
  type AchievementCategory,
  type AchievementDef,
  type Rank,
  type Rarity,
} from "@/lib/achievement-meta"
import type { AchievementView } from "@/lib/achievements"
import type { AchievementLedger, LedgerEntry } from "@/lib/achievements-server"

// Shaping for the public /achievements pages. The profile strip describes a crest
// from ONE player's perspective ("you're on III, 121/140 toward IV"); these pages
// describe the crest itself — what it is, who holds it, who got there first — so
// the same AchievementView is filled in from the community's high-water mark
// instead of a visitor's progress.

export const rankListFor = (def: AchievementDef): Rank[] =>
  def.ranks?.length ? def.ranks : [{ threshold: def.threshold ?? 1, rarity: def.rarity ?? "common" }]

const fmtVal = (v: number, def: AchievementDef) => (def.unit === "hours" ? `${Math.round(v)}h` : `${Math.round(v)}`)

export const requirementFor = (def: AchievementDef, r: Rank) => `${fmtVal(r.threshold, def)}${def.exact ? "" : "+"}`

// A crest drawn at the highest rank ANY player has reached — so the grid shows
// each family at its current community peak, and stays locked until someone
// actually claims it. Progress fields are null: there is no single player whose
// progress this could describe.
function showcaseView(def: AchievementDef, entries: LedgerEntry[]): AchievementView {
  const ranks = rankListFor(def)
  const tiered = !!(def.ranks && def.ranks.length)
  const top = entries.reduce<LedgerEntry | null>((m, e) => (!m || e.rank > m.rank ? e : m), null)
  const cur = top ? ranks[top.rank - 1] : ranks[0]

  return {
    id: def.id,
    title: (top ? cur.title : undefined) ?? def.title,
    category: def.category,
    rarity: cur.rarity,
    icon: def.icon,
    condition: def.condition,
    pending: !!def.pending,
    tiered,
    rank: top?.rank ?? 0,
    totalRanks: ranks.length,
    earned: !!top,
    earnedDate: top?.date ?? null,
    earnedMatchId: top?.matchId ?? null,
    earnedRequirement: top ? requirementFor(def, cur) : null,
    earnedWith: null,
    progressPct: null,
    progressLabel: null,
    value: 0,
  }
}

// Deliberately NOT the AchievementDef: a def holds its metric's `get`/`test`
// closures, and a server component cannot hand a function to a client one. Only
// the plain fields the grid actually renders cross that boundary.
export interface AchievementSummary {
  id: string
  category: AchievementCategory
  view: AchievementView
  holderCount: number // distinct players holding the crest at any rank
  unlockCount: number // total rank crossings
}

// Every visible achievement, with its crest and holder counts. One-of-ones are
// deliberately excluded — see sealedSecretCount.
export function summariesFor(ledger: AchievementLedger): AchievementSummary[] {
  return ACHIEVEMENTS.map((def) => {
    const entries = ledger.byAchievement.get(def.id) ?? []
    return {
      id: def.id,
      category: def.category,
      view: showcaseView(def, entries),
      holderCount: new Set(entries.map((e) => e.playerId)).size,
      unlockCount: entries.length,
    }
  })
}

// How many one-of-ones nobody has claimed. The page publishes this number and
// nothing else about them: a secret crest's condition stays unpublished until it
// is claimed, which is the entire point of the format. Claimed ones become
// ordinary, fully-described achievements with exactly one holder.
export const sealedSecretCount = (ledger: AchievementLedger) =>
  SECRET_ACHIEVEMENTS.length - ledger.claimedSecrets.length

// Resolve a URL id to something renderable. Unclaimed secrets return null so the
// route 404s rather than confirming the id exists.
export function pageDefFor(id: string, ledger: AchievementLedger): AchievementDef | null {
  const def = ACHIEVEMENTS.find((d) => d.id === id)
  if (def) return def
  const claimed = ledger.claimedSecrets.some((e) => e.achId === id)
  if (!claimed) return null
  const secret = SECRET_ACHIEVEMENTS.find((d) => d.id === id)
  return secret ? { ...secret, metric: { type: "matchCount" }, threshold: 1, rarity: "oneofone" as Rarity } : null
}

// "3rd player to reach this rank" — distinct players at or above `rank` up to and
// including `entry`. The ledger is already in a stable total order, so this
// doesn't reshuffle between renders.
export function ordinalAt(entries: LedgerEntry[], entry: LedgerEntry): number {
  const seen = new Set<string>()
  for (const e of entries) {
    if (e.rank >= entry.rank) seen.add(e.playerId)
    if (e === entry) break
  }
  return seen.size
}

// Families with a per-rank title override use that title alone (Unstoppable, Cap
// Legend); otherwise append the roman numeral for tiered ranks above I.
export function displayTitle(view: AchievementView, roman: (n: number) => string): string {
  const base = findAchievementDef(view.id)?.title
  if (view.tiered && view.rank > 1 && view.title === base) return `${view.title} ${roman(view.rank)}`
  return view.title
}

export const rarityLabel = (r: Rarity) => RARITY_META[r].label
export const rarityColor = (r: Rarity) => RARITY_META[r].color
