"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { ThemeSelector } from "@/components/theme-selector"
import { AdminNavButton } from "@/components/admin-nav-button"
import { PlayerNavButton } from "@/components/player-nav-button"
import { themes, applyTheme, type ThemeName } from "@/lib/themes"
import { useToast } from "@/hooks/use-toast"
import { History, BarChart3, Users } from "lucide-react"

// Shared masthead + nav for the main site pages. Each former tab is now its own
// route, so nav items are plain links and the active state comes from the URL —
// the Stats page (and its recharts bundle) only loads when visited.
//
// "How It Works" lives in the Team Balancer panel now, not here — it's
// specifically about the balancer, so it makes more sense docked to that panel
// than sitting in the global nav.
const NAV = [
  { href: "/balancer", label: "Team Balancer", icon: null },
  { href: "/matches", label: "Match History", icon: History },
  { href: "/players", label: "Players", icon: Users },
  { href: "/stats", label: "Stats", icon: BarChart3 },
] as const

export function SiteHeader() {
  const pathname = usePathname()
  const [currentTheme, setCurrentTheme] = useState<ThemeName>("jedi")
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
          {/* No breakpoint here on purpose. The masthead claims a 420px basis —
              enough for the title to stay on one line — and the nav refuses to
              shrink, so the nav drops to its own row exactly when the two stop
              fitting together, at whatever width that happens to be. A fixed
              breakpoint would have to be re-guessed every time a nav item is
              added. */}
          <div className="flex flex-wrap items-center justify-between gap-4">
            <Link
              href="/"
              className="flex items-center gap-3 md:gap-4 min-w-0 flex-1 basis-[420px] hover:opacity-90 transition-opacity"
            >
              <Image
                src="/logo.png"
                alt="JK2 Logo"
                width={50}
                height={50}
                className="drop-shadow-[0_0_10px_rgba(102,252,241,0.5)] md:w-[60px] md:h-[60px] shrink-0"
              />
              <div className="min-w-0">
                <h1
                  className="text-xl md:text-2xl lg:text-3xl font-bold glow-text mb-1"
                  style={{ fontFamily: "var(--font-orbitron)" }}
                >
                  JK2 CAPTURE THE FLAG
                </h1>
                {/* Truncates rather than wraps: this line is the widest thing in
                    the masthead, and letting it demand its full width is what
                    starves the nav. */}
                <p className="text-xs md:text-sm truncate" style={{ color: "var(--color-text-dim)" }}>
                  Jedi Knight 2: Jedi Outcast • 6v6 Competitive • Also known as Soracle • With thanks to TomArrow
                </p>
              </div>
            </Link>
            {/* wrap + shrink-0: the masthead beside this is wide, so at mid
                widths the nav has to fall to a second row rather than push the
                page into a horizontal scroll. */}
            {/* Shrinkable on purpose: `shrink-0` would pin this to the width of
                all five buttons in a row, which is wider than a phone, and its
                own flex-wrap would then never fire. Allowed to shrink, it wraps
                its buttons internally once it has dropped to its own line. */}
            <div className="flex flex-wrap gap-2 justify-end">
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
              <PlayerNavButton />
              <AdminNavButton />
            </div>
          </div>
        </div>
      </header>

    </>
  )
}
