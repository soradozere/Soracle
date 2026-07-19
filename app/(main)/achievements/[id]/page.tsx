import type { Metadata } from "next"
import { notFound } from "next/navigation"
import { AchievementDetail, type RankBlock } from "@/components/achievement-detail"
import { computeAchievementLedger, type LedgerEntry } from "@/lib/achievements-server"
import { pageDefFor, rankListFor, requirementFor } from "@/lib/achievement-pages"
import { ACHIEVEMENTS, RARITY_META } from "@/lib/achievement-meta"
import type { AchievementView } from "@/lib/achievements"

export const revalidate = 300

// Only the visible crests are pre-rendered. A one-of-one gets a page the moment
// it is claimed, but listing its id here would leak the unclaimed ones.
export function generateStaticParams() {
  return ACHIEVEMENTS.map((d) => ({ id: d.id }))
}

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id } = await params
  const def = ACHIEVEMENTS.find((d) => d.id === id)
  if (!def) return { title: "Achievement — JK2 Capture the Flag" }
  return {
    title: `${def.title} — JK2 Capture the Flag`,
    description: `${def.condition}. See who holds this crest and who got there first.`,
  }
}

export default async function AchievementPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const ledger = await computeAchievementLedger()
  const def = pageDefFor(id, ledger)
  if (!def) notFound()

  const entries = ledger.byAchievement.get(def.id) ?? []
  const ranks = rankListFor(def)
  const tiered = !!(def.ranks && def.ranks.length)

  const byRank = new Map<number, LedgerEntry[]>()
  for (const e of entries) {
    const list = byRank.get(e.rank)
    if (list) list.push(e)
    else byRank.set(e.rank, [e])
  }

  const blocks: RankBlock[] = ranks.map((r, i) => ({
    rank: i + 1,
    title: r.title ?? def.title,
    rarity: r.rarity,
    requirement: requirementFor(def, r),
    holders: (byRank.get(i + 1) ?? []).map((e) => ({
      playerName: e.playerName,
      date: e.date,
      matchId: e.matchId,
    })),
  }))

  // The crest is drawn at the highest rank anyone has reached, matching the grid.
  const top = entries.reduce<LedgerEntry | null>((m, e) => (!m || e.rank > m.rank ? e : m), null)
  const cur = top ? ranks[top.rank - 1] : ranks[0]
  const view: AchievementView = {
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

  return (
    <div className="container mx-auto px-4 py-8">
      <AchievementDetail
        view={view}
        category={def.category}
        tiered={tiered}
        blocks={blocks}
        holderCount={new Set(entries.map((e) => e.playerId)).size}
        unlockCount={entries.length}
      />
    </div>
  )
}
