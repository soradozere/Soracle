import type React from "react"
import type { Metadata } from "next"
import localFont from "next/font/local"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { SITE_URL } from "@/lib/site-url"

// Inter, Oxanium and Orbitron are vendored here (app/fonts/) rather than loaded
// via next/font/google: that fetches Google Fonts at build time, and Turbopack
// builds on Vercel have intermittently failed to resolve that fetch ("Module
// not found: Can't resolve '@vercel/turbopack-next/internal/font/google/font'"),
// taking production down for something that has nothing to do with the code
// that shipped. Each file below is the same latin-subset variable woff2 Google
// Fonts itself serves (fonts.gstatic.com) for the weight range this site uses,
// so rendering is identical -- it just no longer depends on a network fetch
// succeeding during every build.
const inter = localFont({
  src: "./fonts/inter-variable-latin.woff2",
  weight: "100 900",
  variable: "--font-inter",
  display: "swap",
})

// Display font for headings + stat numbers (replaces Orbitron). Legible sci-fi
// numerals — wired to --font-mono in globals.css, so it applies everywhere at once.
const oxanium = localFont({
  src: "./fonts/oxanium-variable-latin.woff2",
  weight: "200 800",
  variable: "--font-oxanium",
  display: "swap",
})

// Orbitron kept for the masthead title plus player-card and profile names — the
// classic square look preserved on those pages only (rest of the app is Oxanium).
const orbitron = localFont({
  src: "./fonts/orbitron-variable-latin.woff2",
  weight: "400 900",
  variable: "--font-orbitron",
  display: "swap",
})

// Masthead-title hover effect, Orbitron -> AurekBesh (see MastheadTitle in
// components/site-header.tsx). A fan font (Boba Fonts, freeware/personal-use)
// supplied by Sora — worth a licence check.
//
// Its pairing, StarJediHollow, was tried as the title's resting face and
// dropped for looking bad; Orbitron (above) stayed the default instead. Its
// font file, and the localFont() call that loaded it, were removed with it —
// no reason to ship a font nothing renders.
const aurekBesh = localFont({
  src: "./fonts/AurekBesh.ttf",
  variable: "--font-aurek-besh",
  display: "swap",
})

const SITE_DESCRIPTION = "6v6 Capture the Flag team balancer for Star Wars Jedi Knight 2: Jedi Outcast"

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: "JK2 Capture the Flag",
  description: SITE_DESCRIPTION,
  // og:image / twitter:image are wired automatically from app/opengraph-image.tsx.
  openGraph: {
    title: "JK2 Capture the Flag",
    description: SITE_DESCRIPTION,
    siteName: "JK2 Capture the Flag",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "JK2 Capture the Flag",
    description: SITE_DESCRIPTION,
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html
      lang="en"
      className={`${inter.variable} ${oxanium.variable} ${orbitron.variable} ${aurekBesh.variable}`}
    >
      <body>
        {children}
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
