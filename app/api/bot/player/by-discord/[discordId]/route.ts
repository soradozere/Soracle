import { NextResponse } from "next/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

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

  return NextResponse.json({ name: player.name, tier: player.tierValue, roles: player.roles })
}
