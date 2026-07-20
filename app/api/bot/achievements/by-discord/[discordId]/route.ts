import { NextResponse } from "next/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"
import { computeAllPlayerAchievements } from "@/lib/achievements-server"
import { resolveEquippedTitle } from "@/lib/titles-server"
import { createAnonClient } from "@/lib/supabase/anon"
import { displayName, imageUrl, profileUrl } from "@/lib/achievement-format"

// A player's achievements, resolved by Discord ID — powers the bot's
// =achievements command. Returns the top few earned (rarest first, the order
// computeAchievements already sorts) plus the earned/total counts.
export async function GET(request: Request, { params }: { params: Promise<{ discordId: string }> }) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  const { discordId } = await params

  let allPlayers
  try {
    allPlayers = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }

  const player = allPlayers.find((p) => p.discord_ids?.includes(discordId))
  if (!player) {
    return NextResponse.json({ error: "unlinked" }, { status: 404 })
  }

  let byPlayer
  try {
    byPlayer = await computeAllPlayerAchievements()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to compute achievements" }, { status: 500 })
  }

  const views = byPlayer.get(player.id)?.views ?? []
  const earned = views.filter((v) => v.earned)

  // Equipped title (name + rarity + source), same shape the =tier endpoint uses.
  const title = await resolveEquippedTitle(createAnonClient(), player.id, player.title ?? null)

  return NextResponse.json({
    player: player.name,
    profileUrl: profileUrl(player.name),
    title,
    earnedCount: earned.length,
    total: views.length,
    top: earned.slice(0, 5).map((v) => ({
      id: v.id,
      name: displayName(v),
      rarity: v.rarity,
      tiered: v.tiered,
      rank: v.rank,
      condition: v.condition,
      // The current rank's threshold ("100+") for tiered crests — the number the
      // condition text alone doesn't carry. Null for untiered, whose condition
      // already spells it out ("Score 1500+ in a single match").
      requirement: v.earnedRequirement,
      earnedDate: v.earnedDate,
      image: imageUrl(v),
    })),
  })
}
