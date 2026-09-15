import type { Metadata } from "next"
import { BalanceLab } from "@/components/balance-lab"

// Unlisted workbench for the experimental snake-draft balancer. Deliberately not linked
// from the nav — like /lab/model it's a test harness, not a site page — so it's marked
// noindex to stay out of search results while remaining shareable by URL.
export const metadata: Metadata = {
  title: "Balance Lab — JK2 Capture the Flag",
  description: "Test harness for the experimental snake-draft team balancer.",
  robots: { index: false, follow: false },
}

export default function BalanceLabPage() {
  return (
    <div className="container mx-auto px-4 py-8 relative z-10">
      <BalanceLab />
    </div>
  )
}
