import type React from "react"
import type { Metadata } from "next"
import { Inter, Oxanium, Orbitron } from "next/font/google"
import { Analytics } from "@vercel/analytics/next"
import "./globals.css"
import { Toaster } from "@/components/ui/toaster"

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
  weight: ["700", "800", "900"],
  variable: "--font-orbitron",
})

const SITE_DESCRIPTION = "6v6 Capture the Flag team balancer for Star Wars Jedi Knight 2: Jedi Outcast"

export const metadata: Metadata = {
  metadataBase: new URL("https://soracle.vercel.app"),
  title: "JK2 Capture the Flag",
  description: SITE_DESCRIPTION,
  // og:image / twitter:image are wired automatically from app/opengraph-image.tsx.
  openGraph: {
    title: "JK2 Capture the Flag",
    description: SITE_DESCRIPTION,
    siteName: "Soracle",
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
    <html lang="en" className={`${inter.variable} ${oxanium.variable} ${orbitron.variable}`}>
      <body>
        {children}
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
