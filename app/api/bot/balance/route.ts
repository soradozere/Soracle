import { NextResponse } from "next/server"
import { balanceTeamsWithOptions } from "@/lib/balance-algorithm"
import { fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"

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
  if (
    !Array.isArray(discordIds) ||
    discordIds.length !== 12 ||
    !discordIds.every((id): id is string => typeof id === "string")
  ) {
    return NextResponse.json({ error: "discordIds must be an array of exactly 12 strings" }, { status: 400 })
  }
  if (new Set(discordIds).size !== discordIds.length) {
    return NextResponse.json({ error: "discordIds must not contain duplicates" }, { status: 400 })
  }

  let allPlayers
  try {
    allPlayers = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }

  // Resolve every Discord ID to a player. Distinct IDs can be linked to the same
  // player (players hold multiple discord_ids), which would leave the balancer
  // with fewer than 12 names — report that as a client error rather than a 500.
  const unlinkedIds: string[] = []
  const names: string[] = []
  const claimedBy = new Map<string, string>()
  let duplicatePlayerError: string | null = null

  for (const discordId of discordIds) {
    const player = allPlayers.find((p) => p.discord_ids?.includes(discordId))
    if (!player) {
      unlinkedIds.push(discordId)
      continue
    }
    const existing = claimedBy.get(player.id)
    if (existing) {
      duplicatePlayerError ??= `Discord IDs ${existing} and ${discordId} are both linked to ${player.name}`
      continue
    }
    claimedBy.set(player.id, discordId)
    names.push(player.name)
  }

  if (unlinkedIds.length > 0) {
    return NextResponse.json({ error: "unlinked", unlinkedIds }, { status: 422 })
  }
  if (duplicatePlayerError) {
    return NextResponse.json({ error: duplicatePlayerError }, { status: 400 })
  }

  const options = balanceTeamsWithOptions(names, allPlayers)

  // The bot needs to map team members back to Discord users, so attach the
  // Discord IDs (as resolved for this request) alongside the name arrays.
  const discordIdByName = new Map<string, string>()
  for (const player of allPlayers) {
    const claimed = claimedBy.get(player.id)
    if (claimed) discordIdByName.set(player.name, claimed)
  }
  const enriched = options.map((option) => ({
    ...option,
    teamRedDiscordIds: option.result.teamRed.map((name) => discordIdByName.get(name) ?? null),
    teamBlueDiscordIds: option.result.teamBlue.map((name) => discordIdByName.get(name) ?? null),
  }))

  return NextResponse.json({ options: enriched })
}
