import type { Metadata } from "next"
import { ReviewScreen } from "@/components/review-screen"

export const metadata: Metadata = {
  title: "Review match — Soracle admin",
}

// Approving a match writes rows that feed every leaderboard, rating and
// achievement, so this is deliberately its own full-width screen rather than a
// modal — there is room to actually read the scoreboard before committing it.
// Authorization lives in the server actions the client component calls
// (requireMatchManager), same as the approval bin it replaces.
export default async function ReviewMatchPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return (
    <div className="container mx-auto max-w-7xl px-4 py-6">
      <ReviewScreen pendingId={id} />
    </div>
  )
}
