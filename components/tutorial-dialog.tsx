"use client"

import { useState } from "react"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Users, Zap, Grid3x3, UserX, Search, ChevronRight, ChevronLeft, Shuffle, Settings } from "lucide-react"

interface TutorialDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

const tutorialSteps = [
  {
    title: "Welcome to the Team Balancer",
    description: "This tool helps you create balanced teams for competitive matches. Let's walk through how to use it.",
    icon: Zap,
  },
  {
    title: "Selecting Players",
    description:
      "Click on player cards to select them for balancing. You need 12 players for standard mode, or 12-18 for competitive mode. The progress bar shows how many players you've selected.",
    icon: Users,
  },
  {
    title: "Player Views",
    description:
      "Switch between 'Select Players' view to pick your team, or 'Tier List' view to see all players organized by their overall skill tier with Star Wars-themed ranks.",
    icon: Grid3x3,
  },
  {
    title: "Search & Filters",
    description:
      "Use the search bar to find players by name. You can also filter by role, mic status, or elite tier to narrow down your selection.",
    icon: Search,
  },
  {
    title: "Off-Role Feature",
    description:
      "Use the global 'Off-Role' toggle to balance teams using only overall ranks instead of role-specific ratings. You can also disable specific roles per player by clicking the edit icon on their card.",
    icon: UserX,
  },
  {
    title: "Balancing Teams",
    description:
      "Once you've selected enough players, click 'Balance Teams' to generate multiple balanced team options. The algorithm considers role coverage, skill balance, and team synergy.",
    icon: Shuffle,
  },
  {
    title: "Balance Options",
    description:
      "After balancing, you'll see multiple team configurations ranked by quality. Each option shows the skill difference between teams and role coverage. Pick the one that works best!",
    icon: Settings,
  },
]

export function TutorialDialog({ open, onOpenChange }: TutorialDialogProps) {
  const [currentStep, setCurrentStep] = useState(0)

  const handleNext = () => {
    if (currentStep < tutorialSteps.length - 1) {
      setCurrentStep(currentStep + 1)
    } else {
      onOpenChange(false)
      setCurrentStep(0)
    }
  }

  const handlePrev = () => {
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1)
    }
  }

  const handleSkip = () => {
    onOpenChange(false)
    setCurrentStep(0)
  }

  const step = tutorialSteps[currentStep]
  const Icon = step.icon

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="bg-[var(--color-surface)]/95 backdrop-blur-md border-[#66fcf1]/30 text-white max-w-md"
        showCloseButton={false}
      >
        <DialogHeader>
          <div className="flex items-center justify-center mb-4">
            <div
              className="w-16 h-16 rounded-full flex items-center justify-center"
              style={{ backgroundColor: "var(--color-primary)", opacity: 0.2 }}
            >
              <Icon className="w-8 h-8" style={{ color: "var(--color-primary)" }} />
            </div>
          </div>
          <DialogTitle className="text-xl text-center" style={{ color: "var(--color-primary)" }}>
            {step.title}
          </DialogTitle>
          <DialogDescription className="text-center text-[var(--color-text)] mt-2 leading-relaxed">
            {step.description}
          </DialogDescription>
        </DialogHeader>

        {/* Progress dots */}
        <div className="flex justify-center gap-2 my-4">
          {tutorialSteps.map((_, index) => (
            <button
              key={index}
              onClick={() => setCurrentStep(index)}
              className={`w-2 h-2 rounded-full transition-all ${
                index === currentStep ? "w-6" : "opacity-40 hover:opacity-70"
              }`}
              style={{
                backgroundColor: index === currentStep ? "var(--color-primary)" : "var(--color-text)",
              }}
            />
          ))}
        </div>

        <DialogFooter className="flex flex-row justify-between sm:justify-between gap-2">
          <Button variant="ghost" onClick={handleSkip} className="text-[var(--color-text)] hover:text-white hover:bg-[var(--color-border)]">
            Skip
          </Button>
          <div className="flex gap-2">
            {currentStep > 0 && (
              <Button
                variant="outline"
                onClick={handlePrev}
                className="border-[var(--color-border)] bg-transparent hover:bg-[var(--color-border)] text-white"
              >
                <ChevronLeft className="w-4 h-4 mr-1" />
                Back
              </Button>
            )}
            <Button
              onClick={handleNext}
              style={{
                backgroundColor: "var(--color-primary)",
                color: "var(--color-background)",
              }}
              className="hover:opacity-90"
            >
              {currentStep === tutorialSteps.length - 1 ? "Get Started" : "Next"}
              {currentStep < tutorialSteps.length - 1 && <ChevronRight className="w-4 h-4 ml-1" />}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
