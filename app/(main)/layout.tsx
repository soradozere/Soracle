import type React from "react"
import { BackgroundParticles } from "@/components/background-particles"
import { SiteHeader } from "@/components/site-header"
import { SiteFooter } from "@/components/site-footer"

// Shared chrome for the main site pages (balancer, matches, stats, how-it-works):
// particle backdrop + masthead/nav, acknowledgements footer. Player profiles
// and admin keep their own layouts outside this group.
export default function MainLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen pb-20 relative flex flex-col">
      <BackgroundParticles />
      <SiteHeader />
      <div className="flex-1">{children}</div>
      <SiteFooter />
    </div>
  )
}
