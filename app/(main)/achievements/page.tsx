import type { Metadata } from "next"
import { AchievementsIndex, type FeedItem } from "@/components/achievements-index"
import { computeAchievementLedger } from "@/lib/achievements-server"
import { ordinalAt, sealedSecretCount, summariesFor } from "@/lib/achievement-pages"
import { ACHIEVEMENTS, SECRET_ACHIEVEMENTS } from "@/lib/achievement-meta"

export const metadata: Metadata = {
  title: "Achievements — JK2 Capture the Flag",
  description: "Every crest in the game, who holds it, and who got there first.",
}

// The ledger walks the entire match history, so it is far too expensive to redo
// per visitor. Matches only arrive when an admin approves one, so a few minutes
// of staleness costs nothing.
export const revalidate = 300

// Deep enough to read as a running history rather than a snapshot; the list
// scrolls in its own pane so it can't push the crest grid off the page.
const FEED_SIZE = 30

export default async function AchievementsPage() {
  const ledger = await computeAchievementLedger()
  const summaries = summariesFor(ledger)

  const feed: FeedItem[] = ledger.recent.slice(0, FEED_SIZE).map((e) => {
    // A claimed one-of-one appears in the feed like anything else, but its def
    // lives in the secret list, not ACHIEVEMENTS.
    const def =
      ACHIEVEMENTS.find((d) => d.id === e.achId) ?? SECRET_ACHIEVEMENTS.find((d) => d.id === e.achId)
    const entries = ledger.byAchievement.get(e.achId) ?? []
    return {
      achId: e.achId,
      title: e.title,
      tiered: e.totalRanks > 1,
      rank: e.rank,
      rarity: e.rarity,
      icon: def?.icon ?? "galactic-republic",
      condition: def?.condition ?? "",
      playerName: e.playerName,
      date: e.date,
      ordinal: ordinalAt(entries, e),
    }
  })

  const totalUnlocks = summaries.reduce((n, s) => n + s.unlockCount, 0) + ledger.claimedSecrets.length

  return (
    <div className="container mx-auto px-4 py-8">
      <AchievementsIndex
        summaries={summaries}
        feed={feed}
        sealedSecrets={sealedSecretCount(ledger)}
        playerCount={ledger.playerCount}
        totalUnlocks={totalUnlocks}
      />
    </div>
  )
}
