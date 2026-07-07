"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { ThemeSelector } from "@/components/theme-selector"
import { AdminNavButton } from "@/components/admin-nav-button"
import { TutorialDialog } from "@/components/tutorial-dialog"
import { themes, applyTheme, type ThemeName } from "@/lib/themes"
import { useToast } from "@/hooks/use-toast"
import { History, BarChart3, HelpCircle } from "lucide-react"

// Shared masthead + nav for the main site pages. Each former tab is now its own
// route, so nav items are plain links and the active state comes from the URL —
// the Stats page (and its recharts bundle) only loads when visited.
const NAV = [
  { href: "/", label: "Team Balancer", icon: null },
  { href: "/matches", label: "Match History", icon: History },
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/how-it-works", label: "How It Works", icon: null },
] as const

export function SiteHeader() {
  const pathname = usePathname()
  const [currentTheme, setCurrentTheme] = useState<ThemeName>("jedi")
  const [showTutorial, setShowTutorial] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    const savedTheme = localStorage.getItem("jk2-theme") as ThemeName
    if (savedTheme && themes[savedTheme]) {
      setCurrentTheme(savedTheme)
      applyTheme(themes[savedTheme])
    } else {
      applyTheme(themes.jedi)
    }
  }, [])

  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem("hasSeenTutorial")
    if (!hasSeenTutorial) {
      setShowTutorial(true)
      localStorage.setItem("hasSeenTutorial", "true")
    }
  }, [])

  const handleThemeChange = (theme: ThemeName) => {
    setCurrentTheme(theme)
    applyTheme(themes[theme])
    localStorage.setItem("jk2-theme", theme)

    toast({
      title: `${themes[theme].displayName} Theme Activated`,
      description: "The Force is strong with this one.",
      duration: 3000,
    })
  }

  return (
    <>
      <header
        className="border-b backdrop-blur-xl sticky top-0 z-50"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface)",
        }}
      >
        <div className="container mx-auto px-4 py-4 md:py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              <Image
                src="/logo.png"
                alt="JK2 Logo"
                width={50}
                height={50}
                className="drop-shadow-[0_0_10px_rgba(102,252,241,0.5)] md:w-[60px] md:h-[60px]"
              />
              <div>
                <h1
                  className="text-xl md:text-2xl lg:text-3xl font-bold glow-text mb-1"
                  style={{ fontFamily: "var(--font-orbitron)" }}
                >
                  JK2 CAPTURE THE FLAG
                </h1>
                <p className="text-xs md:text-sm" style={{ color: "var(--color-text-dim)" }}>
                  Jedi Knight 2: Jedi Outcast • 6v6 Competitive • Also known as Soracle • With thanks to TomArrow
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <ThemeSelector currentTheme={currentTheme} onThemeChange={handleThemeChange} />
              {NAV.map(({ href, label, icon: Icon }) => {
                const active = pathname === href
                return (
                  <Link
                    key={href}
                    href={href}
                    className={`flex-1 md:flex-none px-3 md:px-4 py-2 rounded-md transition-all font-medium text-sm flex items-center justify-center gap-1.5 ${
                      active ? "font-bold" : "hover:bg-[#3d4855] border"
                    }`}
                    style={
                      active
                        ? {
                            backgroundColor: "var(--color-primary)",
                            color: "var(--color-background)",
                            boxShadow: "0 0 15px var(--color-primary-glow)",
                          }
                        : {
                            backgroundColor: "var(--color-surface-elevated)",
                            color: "var(--color-text)",
                            borderColor: "var(--color-border)",
                          }
                    }
                  >
                    {Icon && <Icon className="w-4 h-4" />}
                    {label}
                  </Link>
                )
              })}
              <button
                onClick={() => setShowTutorial(!showTutorial)}
                className="px-3 py-1.5 rounded-md text-sm transition-all font-medium flex items-center gap-1.5 bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855]"
                title="Show Tutorial"
              >
                <HelpCircle className="w-4 h-4" />
                Help
              </button>
              <AdminNavButton />
            </div>
          </div>
        </div>
      </header>

      <TutorialDialog open={showTutorial} onOpenChange={setShowTutorial} />
    </>
  )
}
