import type { Metadata } from "next"
import { ReportsTab } from "@/components/reports-tab"

export const metadata: Metadata = {
  title: "Stats — JK2 Capture the Flag",
  description: "Monthly leaderboards, Star Player of the Month, stat highlights and records.",
}

export default function StatsPage() {
  return (
    <div className="container mx-auto px-4 py-8 relative z-10">
      <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-6">
        <ReportsTab />
      </div>
    </div>
  )
}
