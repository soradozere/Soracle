import { NextResponse } from "next/server"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

/**
 * Batched tier lookup for a whole pickup queue: the same `tier` value that
 * /api/bot/player/by-discord/[discordId] returns for one player, keyed by Discord
 * ID for many at once, alongside each linked player's `name`. Discord IDs that
 * aren't linked to a Soracle player are silently omitted from the response
 * rather than erroring the whole call.
 */
export async function POST(request: Request) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  let body: unknown
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 })
  }

  const discordIds = (body as { discordIds?: unknown } | null)?.discordIds
  if (!Array.isArray(discordIds) || !discordIds.every((id): id is string => typeof id === "string")) {
    return NextResponse.json({ error: "discordIds must be an array of strings" }, { status: 400 })
  }

  let allPlayers
  try {
    allPlayers = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }

  const tiers: Record<string, number> = {}
  const names: Record<string, string> = {}
  for (const discordId of discordIds) {
    const player = allPlayers.find((p) => p.discord_ids?.includes(discordId))
    if (player) {
      tiers[discordId] = player.tierValue
      names[discordId] = player.name
    }
  }

  return NextResponse.json({ tiers, names })
}
