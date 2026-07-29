import type { Metadata } from "next"
import { ModelLab } from "@/components/model-lab"

// Unlisted workbench for the 3D model viewer (Brief A). Deliberately not linked
// from the nav — it's a test harness, not a site page — so it's marked noindex
// to keep it out of search results while staying shareable by URL.
export const metadata: Metadata = {
  title: "Model Lab — JK2 Capture the Flag",
  description: "Test harness for the animated 3D player model viewer.",
  robots: { index: false, follow: false },
}

export default function ModelLabPage() {
  return (
    <div className="container mx-auto px-4 py-8 relative z-10">
      <ModelLab />
    </div>
  )
}
