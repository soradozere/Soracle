import type React from "react"
import type { Metadata } from "next"
import { Inter, Oxanium, Orbitron } from "next/font/google"
import localFont from "next/font/local"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"
import { SITE_URL } from "@/lib/site-url"

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
})

// Display font for headings + stat numbers (replaces Orbitron). Legible sci-fi
// numerals — wired to --font-mono in globals.css, so it applies everywhere at once.
const oxanium = Oxanium({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700", "800"],
  variable: "--font-oxanium",
})

// Orbitron kept for the masthead title plus player-card and profile names — the
// classic square look preserved on those pages only (rest of the app is Oxanium).
const orbitron = Orbitron({
  subsets: ["latin"],
  weight: ["700", "800"],
  variable: "--font-orbitron",
})

// Masthead-title hover effect, Orbitron -> AurekBesh (see MastheadTitle in
// components/site-header.tsx). A fan font (Boba Fonts, freeware/personal-use)
// supplied by Sam from his Downloads folder — worth a licence check.
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
