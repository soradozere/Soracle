import type { Metadata } from "next"
import { PlayersIndex, type BoardRow } from "@/components/players-index"
import { computePlayersDirectory } from "@/lib/achievements-server"

export const metadata: Metadata = {
  title: "Players — JK2 Capture the Flag",
  description: "Every player on record, ranked by Achievement Score, with current form and tier.",
}

// Same reasoning as /achievements: shares the cached ledger (HISTORY_TAG), and
// a landed match revalidates it on demand -- this window is the safety net.
export const revalidate = 3600

export default async function PlayersPage() {
  const rows = await computePlayersDirectory()

  // PlayerRow is already plain data, but narrow it explicitly so the client
  // component's contract doesn't silently widen if the server type grows.
  const board: BoardRow[] = rows.map((r) => ({
    id: r.id,
    name: r.name,
    tierValue: r.tierValue,
    avatarUrl: r.avatarUrl,
    score: r.score,
    unlocks: r.unlocks,
    best: r.best,
    title: r.title,
    rarityCounts: r.rarityCounts,
    form: r.form,
    formWins: r.formWins,
    formLosses: r.formLosses,
    matches: r.matches,
    inactive: r.inactive,
  }))

  return (
    <div className="container mx-auto px-4 py-8">
      <PlayersIndex rows={board} />
    </div>
  )
}
