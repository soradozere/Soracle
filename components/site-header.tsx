"use client"

import { useState, useEffect } from "react"
import Link from "next/link"
import Image from "next/image"
import { usePathname } from "next/navigation"
import { ThemeSelector } from "@/components/theme-selector"
import { AccountMenu } from "@/components/account-menu"
import { SegmentedRail, type Segment } from "@/components/segmented-rail"
import { themes, applyTheme, type ThemeName } from "@/lib/themes"
import { useToast } from "@/hooks/use-toast"
import { History, BarChart3, Users, Film, Scale } from "lucide-react"

// Shared masthead + nav for the main site pages. Each former tab is now its own
// route, so nav items are plain links and the active state comes from the URL —
// the Stats page (and its recharts bundle) only loads when visited.
//
// "How It Works" lives in the Team Balancer panel now, not here — it's
// specifically about the balancer, so it makes more sense docked to that panel
// than sitting in the global nav.
//
// There is no Home item: the brand block on the left is the home link, which is
// why the rail's thumb retracts on "/" rather than lighting something arbitrary.
const NAV: Segment[] = [
  { key: "/balancer", href: "/balancer", label: "Balancer", icon: Scale },
  { key: "/matches", href: "/matches", label: "Matches", icon: History },
  { key: "/players", href: "/players", label: "Players", icon: Users },
  { key: "/stats", href: "/stats", label: "Stats", icon: BarChart3 },
  { key: "/demos", href: "/demos", label: "Demos", icon: Film },
]

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

  // Sub-routes count as their section (/demos/123 keeps Demos lit), but "/" must
  // not match everything.
  const activeKey =
    NAV.find((item) => pathname === item.key || pathname.startsWith(`${item.key}/`))?.key ?? null

  return (
    <header
      className="border-b sticky top-0 z-50 relative"
      style={{
        borderColor: "var(--glass-hair)",
        // Deliberately thin. A masthead opaque enough to hide the starfield has
        // no glass to it at all — this lets the sky through and lets the sweep
        // below do the work.
        background: `linear-gradient(180deg,
          color-mix(in srgb, var(--color-surface-elevated) calc(var(--glass-mast-veil) * 100%), transparent),
          color-mix(in srgb, var(--color-surface) calc(var(--glass-mast-veil) * 74%), transparent))`,
        backdropFilter: "blur(26px) saturate(170%)",
        WebkitBackdropFilter: "blur(26px) saturate(170%)",
        boxShadow: "inset 0 1px 0 var(--glass-spec), 0 8px 24px -18px var(--glass-shade)",
      }}
    >
      {/* One specular sweep across the glass. This, not the fill, is what reads
          as sheen once the background is thin enough to see through. */}
      <span
        aria-hidden
        className="absolute inset-0 pointer-events-none"
        style={{
          background: `linear-gradient(104deg,
            transparent 8%,
            color-mix(in srgb, var(--color-text-bright) 9%, transparent) 34%,
            color-mix(in srgb, var(--color-text-bright) 3%, transparent) 47%,
            transparent 62%)`,
          mixBlendMode: "overlay",
        }}
      />

      <div className="container mx-auto px-4 py-3 relative">
        {/* No breakpoint here on purpose. The masthead claims a 420px basis —
            enough for the title to stay on one line — and the nav refuses to
            shrink, so the nav drops to its own row exactly when the two stop
            fitting together, at whatever width that happens to be. A fixed
            breakpoint would have to be re-guessed every time a nav item is
            added. */}
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link
            href="/"
            className="flex items-center gap-3 min-w-0 flex-1 basis-[420px] hover:opacity-90 transition-opacity"
          >
            <span
              className="w-11 h-11 rounded-xl grid place-items-center shrink-0"
              style={{
                border: "1px solid color-mix(in srgb, var(--color-primary) 38%, transparent)",
                background: `radial-gradient(120% 120% at 30% 10%, color-mix(in srgb, var(--color-primary) 26%, transparent), transparent 70%),
                  color-mix(in srgb, var(--color-surface-elevated) 60%, transparent)`,
                boxShadow:
                  "inset 0 1px 0 var(--glass-spec), 0 0 18px -6px color-mix(in srgb, var(--color-primary) 60%, transparent)",
              }}
            >
              <Image
                src="/logo.png"
                alt="JK2 Logo"
                width={30}
                height={30}
                className="w-[30px] h-[30px] object-contain"
                style={{ filter: "drop-shadow(0 0 6px color-mix(in srgb, var(--color-primary) 55%, transparent))" }}
              />
            </span>
            <div className="min-w-0">
              <h1
                className="text-[17px] font-bold glow-text tracking-[0.06em] leading-tight"
                style={{ fontFamily: "var(--font-orbitron)" }}
              >
                JK2 CAPTURE THE FLAG
              </h1>
              {/* Truncates rather than wraps: this line is the widest thing in
                  the masthead, and letting it demand its full width is what
                  starves the nav. */}
              <p className="text-[11px] truncate mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                Jedi Knight II: Jedi Outcast · 6v6 Competitive
              </p>
            </div>
          </Link>

          {/* Shrinkable on purpose: `shrink-0` would pin this to the width of
              the whole rail plus cluster, which is wider than a phone, and its
              own flex-wrap would then never fire. min-w-0 matters on phones:
              without it the auto minimum holds this at the rail's full width
              and drags the whole page wider than the viewport — with it, the
              rail's own overflow-x takes over and scrolls. */}
          <div className="flex flex-wrap items-center gap-3 justify-end min-w-0 max-w-full">
            <SegmentedRail segments={NAV} activeKey={activeKey} aria-label="Site sections" />
            <span className="w-px h-6 hidden sm:block" style={{ backgroundColor: "var(--glass-hair)" }} />
            <div className="flex items-center gap-2">
              <ThemeSelector currentTheme={currentTheme} onThemeChange={handleThemeChange} />
              <AccountMenu />
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
