import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, parseSinceParam, requireBotAuth, toIsoUtc } from "@/lib/bot-api"

// Equipped-title changes since a timestamp, for the bot's title ping. The
// title-side twin of /api/bot/tier-changelog, and it follows that route's
// conventions exactly: oldest first (a queue for a poller, not a feed for a
// human), `since` exclusive, and a null discordId for an unlinked player rather
// than dropping the row.
//
// Unlike tiers, this has no history before scripts/046 shipped — nothing
// recorded title changes previously and nothing can reconstruct them, so early
// polls returning an empty array are correct, not broken.
//
// Rows come out pre-resolved: title_changes snapshots the display strings at
// write time because seasonal titles lapse out of lib/titles.ts and stop
// resolving. Nothing here needs the catalogue.

// Matches tier-changelog's bound, for the same reason: a first-run poll sends
// no `since`, and PostgREST would otherwise cap the read at 1000 silently.
const MAX_ROWS = 500

export async function GET(request: Request) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  const parsed = parseSinceParam(request)
  if (parsed instanceof NextResponse) return parsed

  let allPlayers
  try {
    allPlayers = await fetchPlayersForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch players" }, { status: 500 })
  }
  const playerById = new Map(allPlayers.map((p) => [p.id, p]))

  const supabase = await createClient()
  let query = supabase
    .from("title_changes")
    .select("id, player_id, player_name, old_title, new_title, new_rarity, changed_at")
    .order("changed_at", { ascending: true })
    .limit(MAX_ROWS)
  if (parsed.since) query = query.gt("changed_at", parsed.since)

  const { data, error } = await query
  if (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch title changes" }, { status: 500 })
  }

  const changes = (data ?? []).map((row) => {
    // player_id is a non-null FK here (unlike tier_changes' older rows), so the
    // lookup only misses if the player was deleted -- and the cascade would have
    // taken the row with them. player_name is the belt-and-braces fallback.
    const player = playerById.get(row.player_id)
    return {
      discordId: player?.discord_ids?.[0] ?? null,
      name: player?.name ?? row.player_name,
      // Null on either side is real, not missing data: no title before (their
      // first) or no title after (they unequipped it). The bot decides how to
      // word those; it should not treat them as malformed.
      oldTitle: row.old_title,
      newTitle: row.new_title,
      rarity: row.new_rarity,
      at: toIsoUtc(row.changed_at),
    }
  })

  return NextResponse.json({ changes })
}
