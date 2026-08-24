"use client"

import { useState, useEffect } from "react"
import dynamic from "next/dynamic"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { ThemeSelector } from "@/components/theme-selector"
import { AccountMenu } from "@/components/account-menu"
import { SegmentedRail, type Segment } from "@/components/segmented-rail"
import { themes, applyTheme, type ThemeName } from "@/lib/themes"
import { useToast } from "@/hooks/use-toast"
import { History, BarChart3, Users, Film, Scale } from "lucide-react"

// Lazy, and load-bearing rather than tidiness. The logo pulls in three +
// @react-three/fiber + drei — ~950 KB raw, ~250 KB gzipped — and SiteHeader is
// rendered by app/(main)/layout.tsx, so a static import puts the whole 3D stack
// on the hydration-critical path of EVERY page in the group, text-only ones
// included. Measured by building it both ways: the homepage's eager JS goes
// 2,005,009 -> 1,033,678 bytes raw (567,226 -> 310,278 gzipped) on this one
// change. 45% of it was the 3D library sitting behind a 44px logo.
//
// The 3D viewer on profile pages has always been behind dynamic() for exactly
// this reason (components/profile-model-panel.tsx). The masthead is the one
// place that reintroduced the cost, a level up where it hits everything.
//
// ssr:false with a null fallback costs nothing: MastheadLogo3D already returns
// null until its signed URLs resolve, so the bordered box is empty at first
// paint either way, and the box is a fixed 44px — no layout shift, no new empty
// state. The only real change is that the emblem arrives slightly later on a
// cold cache, at idle priority instead of competing with the page's own JS.
const MastheadLogo3D = dynamic(
  () => import("@/components/masthead-logo-3d").then((m) => m.MastheadLogo3D),
  { ssr: false, loading: () => null },
)

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

// On hover, the title dissolves into AurekBesh — the game's own Latin title
// decoding into the in-universe alien alphabet.
// StarJedi as the default face was tried and dropped (it just looked bad);
// this keeps the site's normal Orbitron as the resting state and only brings
// in a custom font for the hover payoff.
//
// The trigger is group/title on the brand *link* (site-header's outer <Link>,
// not this component), not on the heading itself — hovering the 3D logo or
// the empty space beside the text decodes it too, matching the whole block's
// bounce-on-hover, so the two read as one "this is the home button" affordance
// rather than the title having its own separate, smaller hover target.
//
// Two identical strings, stacked in the same grid cell (col/row-start-1 on
// both), rather than one relabelled span: no font can be *animated* into
// another's glyph outlines, only crossfaded, so the illusion is two static
// layers trading opacity. Split into per-character spans so the crossfade
// sweeps left-to-right like a decode rather than flipping as one flat block —
// the AurekBesh layer staggers in reverse-index so its wave visually follows
// the Orbitron layer's wave the same direction rather than closing on it from
// the other end.
//
// AurekBesh runs a size smaller: its glyphs are heavier/wider than Orbitron's
// at the same font-size (different font, different metrics), so matching the
// declared size still read as oversized against the rest of the masthead.
//
// aria-hidden on both layers plus one aria-label on the heading: screen
// readers get the real string once, not the same text twice over.
const MASTHEAD_TITLE = "JK2 CAPTURE THE FLAG"
const MASTHEAD_TITLE_CHARS = Array.from(MASTHEAD_TITLE)
const DECODE_STAGGER_MS = 16

function MastheadTitle() {
  return (
    <h1
      aria-label={MASTHEAD_TITLE}
      className="relative grid text-[17px] font-bold glow-text tracking-[0.06em] leading-tight"
    >
      <span
        aria-hidden
        className="col-start-1 row-start-1 whitespace-nowrap"
        style={{ fontFamily: "var(--font-orbitron)" }}
      >
        {MASTHEAD_TITLE_CHARS.map((char, i) => (
          <span
            key={`ob-${i}`}
            className="inline-block opacity-100 blur-none transition duration-300 ease-out group-hover/title:opacity-0 group-hover/title:blur-[3px]"
            style={{ transitionDelay: `${i * DECODE_STAGGER_MS}ms` }}
          >
            {char === " " ? " " : char}
          </span>
        ))}
      </span>
      <span
        aria-hidden
        className="col-start-1 row-start-1 whitespace-nowrap text-[11px]"
        style={{ fontFamily: "var(--font-aurek-besh)" }}
      >
        {MASTHEAD_TITLE_CHARS.map((char, i) => (
          <span
            key={`ab-${i}`}
            className="inline-block opacity-0 blur-[3px] transition duration-300 ease-out group-hover/title:opacity-100 group-hover/title:blur-none"
            style={{ transitionDelay: `${(MASTHEAD_TITLE_CHARS.length - 1 - i) * DECODE_STAGGER_MS}ms` }}
          >
            {char === " " ? " " : char}
          </span>
        ))}
      </span>
    </h1>
  )
}

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
            className="group/title flex items-center gap-3 min-w-0 flex-1 basis-[420px] transition duration-300 hover:opacity-90 hover:-translate-y-0.5 hover:scale-[1.03]"
            // A back-out easing curve, not Tailwind's ease-out: this one's control
            // points push y briefly past 1 before settling, so the lift overshoots
            // and eases back — that overshoot IS the bounce, not a keyframe loop.
            // Reads as "this is a button" the way opacity alone didn't.
            style={{ transitionTimingFunction: "cubic-bezier(0.34, 1.56, 0.64, 1)" }}
          >
            <span
              className="w-11 h-11 rounded-xl grid place-items-center shrink-0 overflow-hidden"
              style={{
                border: "1px solid color-mix(in srgb, var(--color-primary) 38%, transparent)",
                background: `radial-gradient(120% 120% at 30% 10%, color-mix(in srgb, var(--color-primary) 26%, transparent), transparent 70%),
                  color-mix(in srgb, var(--color-surface-elevated) 60%, transparent)`,
                boxShadow:
                  "inset 0 1px 0 var(--glass-spec), 0 0 18px -6px color-mix(in srgb, var(--color-primary) 60%, transparent)",
              }}
            >
              {/* Matches the parent box exactly (44px), and three details here
                  are load-bearing:
                  - Must stay a definite size, never w-full/h-full. The parent
                    is a grid with place-items-center, so the item is
                    content-sized and a percentage height has no definite
                    containing block to resolve against — R3F's Canvas then
                    falls back to its 300x150 default and the icon vanishes.
                  - No drop-shadow filter. It shaped a glow around the old
                    small emblem, but now the blade reaches the edges, so the
                    filter traces that bright bar and smears it past the box.
                    The span's boxShadow already supplies the halo.
                  - The parent needs its own overflow-hidden: the span's 1px
                    border makes its content box 42px, so this 44px child
                    overhangs by 1px top and bottom, and the blade is bright
                    enough that the sliver reads as the saber escaping. */}
              <div className="w-[44px] h-[44px] rounded-xl overflow-hidden">
                <MastheadLogo3D />
              </div>
            </span>
            <div className="min-w-0">
              <MastheadTitle />
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
