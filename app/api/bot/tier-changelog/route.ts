import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { fetchPlayersForBot, parseSinceParam, requireBotAuth, toIsoUtc } from "@/lib/bot-api"

// Tier moves since a timestamp, for the bot's tier-change ping. Same rows the
// website's Tier Changelog renders (components/tier-changelog.tsx), exposed as
// JSON with the Discord ID joined in — the UI only ever needed a name, but a
// ping needs someone to ping.
//
// Two deliberate differences from the UI's query:
//
//   - Ordered OLDEST FIRST. The UI is a reverse-chronological feed for a human;
//     this is a queue for a poller that announces each entry and advances its
//     cursor, so it has to hand them over in the order they happened. It also
//     makes the row cap below truncate the NEWEST rows rather than the oldest,
//     which is the safe direction: the bot catches up on the next poll instead
//     of skipping a change forever.
//   - `since` is EXCLUSIVE. The bot sends back the `at` of the last change it
//     announced, so an inclusive bound would re-announce that one every tick.
//
// Hidden rows stay hidden: an admin hiding a changelog entry is saying "don't
// show this to people", and a Discord ping is emphatically showing it to people.
// (Note this is NOT how lib/calibration.ts reads the same table — hiding a row
// doesn't un-happen the tier move, so the calibrator ignores the flag. Both are
// right; they're asking different questions.)

// PostgREST caps an unpaged select at 1000 rows, and a first-run poll sends no
// `since` at all. Bounded well under the cap so the truncation is ours and
// predictable rather than PostgREST's and silent.
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
  const playerByName = new Map(allPlayers.map((p) => [p.name, p]))

  const supabase = await createClient()
  let query = supabase
    .from("tier_changes")
    .select("id, player_id, player_name, previous_tier, new_tier, changed_at, source")
    .or("hidden.is.null,hidden.eq.false")
    .order("changed_at", { ascending: true })
    .limit(MAX_ROWS)
  if (parsed.since) query = query.gt("changed_at", parsed.since)

  const { data, error } = await query
  if (error) {
    console.error(error)
    return NextResponse.json({ error: "Failed to fetch tier changes" }, { status: 500 })
  }

  const changes = (data ?? []).map((row) => {
    // player_id is the reliable link, but tier_changes predates the numbered
    // migrations and older rows may carry only a name. Falling back keeps those
    // announceable; scripts/009's rename helper rewrites player_name in step
    // with players.name, so the fallback doesn't rot on a rename.
    const player = (row.player_id ? playerById.get(row.player_id) : undefined) ?? playerByName.get(row.player_name)
    return {
      // Null for a player with no linked Discord account — the change still
      // happened and is still worth announcing by name, so it ships as a row
      // the bot can post without an @mention rather than being filtered away.
      discordId: player?.discord_ids?.[0] ?? null,
      name: player?.name ?? row.player_name,
      oldTier: row.previous_tier,
      newTier: row.new_tier,
      at: toIsoUtc(row.changed_at),
      // The column stores 'auto'; the bot's contract asks for 'calibrator'.
      // Translated here, at the boundary, rather than renaming a column three
      // write paths and the changelog UI already depend on.
      source: row.source === "auto" ? "calibrator" : "admin",
    }
  })

  return NextResponse.json({ changes })
}
