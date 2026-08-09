import type { Metadata } from "next"
import { ReportsTab } from "@/components/reports-tab"

export const metadata: Metadata = {
  title: "Stats — JK2 Capture the Flag",
  description: "Monthly leaderboards, Star Player of the Month, stat highlights and records.",
}

export default function StatsPage() {
  // No outer panel any more: every section below is its own glass panel, and
  // wrapping them in one more produced boxes inside a box.
  return (
    <div className="container mx-auto px-4 py-6 relative z-10">
      <ReportsTab />
    </div>
  )
}
