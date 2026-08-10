import type { Metadata } from "next"
import { Suspense } from "react"
import { ReportsTab } from "@/components/reports-tab"

export const metadata: Metadata = {
  title: "Stats — JK2 Capture the Flag",
  description: "Monthly leaderboards, Star Player of the Month, stat highlights and records.",
}

export default function StatsPage() {
  // No outer panel any more: every section below is its own glass panel, and
  // wrapping them in one more produced boxes inside a box.
  //
  // Suspense is required here, not optional: ReportsTab reads useSearchParams
  // (to make the month/view/Wrapped-player selection a real link), and Next.js
  // needs a boundary around that or this static page fails to build.
  return (
    <div className="container mx-auto px-4 py-6 relative z-10">
      <Suspense fallback={null}>
        <ReportsTab />
      </Suspense>
    </div>
  )
}
