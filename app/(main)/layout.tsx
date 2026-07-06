import type React from "react"
import { BackgroundParticles } from "@/components/background-particles"
import { SiteHeader } from "@/components/site-header"

// Shared chrome for the main site pages (balancer, matches, stats, how-it-works):
// particle backdrop + masthead/nav. Player profiles and admin keep their own
// layouts outside this group.
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-20 relative">
      <BackgroundParticles />
      <SiteHeader />
      {children}
    </div>
  )
}
