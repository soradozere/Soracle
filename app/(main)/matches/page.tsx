import type { Metadata } from "next"
import { MatchHistoryTab } from "@/components/match-history-tab"

export const metadata: Metadata = {
  title: "Match History — JK2 Capture the Flag",
  description: "Every recorded 6v6 CTF match: lineups, scores and per-player scoreboards.",
}

export default function MatchesPage() {
  return (
    <div className="container mx-auto px-4 py-8 relative z-10">
      <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-6">
        <MatchHistoryTab />
      </div>
    </div>
  )
}
