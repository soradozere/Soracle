"use client"

import { useState, useEffect } from "react"
import { HelpCircle } from "lucide-react"
import { TutorialDialog } from "@/components/tutorial-dialog"

// The tutorial is about the balancer, so its entry point lives with the balancer
// rather than in the shared masthead: a floating button pinned bottom-left that
// stays reachable as the (long) player grid scrolls. This also owns the
// first-visit auto-open that used to sit in SiteHeader — same localStorage key,
// so anyone who has already dismissed it stays dismissed.
export function HelpFab() {
  const [showTutorial, setShowTutorial] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem("hasSeenTutorial")) {
      setShowTutorial(true)
      localStorage.setItem("hasSeenTutorial", "true")
    }
  }, [])

  return (
    <>
      <button
        onClick={() => setShowTutorial(true)}
        aria-label="Show tutorial"
        title="Show tutorial"
        className="fixed bottom-6 left-6 z-40 w-12 h-12 rounded-full flex items-center justify-center bg-[#1f2833]/80 backdrop-blur-md text-[#c5c6c7] border border-[#3d4855] shadow-lg transition-all hover:bg-[#3d4855] hover:text-[#66fcf1] hover:border-[#66fcf1]/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#66fcf1]"
      >
        <HelpCircle className="w-6 h-6" />
      </button>

      <TutorialDialog open={showTutorial} onOpenChange={setShowTutorial} />
    </>
  )
}
