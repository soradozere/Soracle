import { NextResponse } from "next/server"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import { resolvePlayerSlug, loadPlayerProfile } from "@/lib/player-profile"

export const revalidate = 3600

// JSON twin of /player/[slug]'s Overview tab, for the JK2 Launcher's embedded
// stats panel - same public data (no auth gate, see that page's own comment),
// just trimmed to the numbers a small native UI can render as plain tiles
// rather than the full profile (friends/nemeses/badges/matches/series aren't
// included; add them here if a consumer ever needs them).
export async function GET(request: Request) {
  const slug = new URL(request.url).searchParams.get("slug")
  if (!slug) return NextResponse.json({ error: "Missing slug" }, { status: 400 })

  const players = await fetchPlayersFromDB()
  const player = resolvePlayerSlug(slug, players)
  if (!player) return NextResponse.json({ error: "Player not found" }, { status: 404 })

  const profile = await loadPlayerProfile(player, players)
  return NextResponse.json({
    name: player.name,
    currentMonth: profile.currentMonth,
    totals: profile.totals,
    careerHigh: profile.careerHigh,
  })
}
