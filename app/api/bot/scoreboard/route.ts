import { NextResponse } from "next/server"
import { fetchAliasesForBot, fetchPlayersForBot, requireBotAuth } from "@/lib/bot-api"
import { createServiceClient } from "@/lib/supabase/admin"
import {
  classifyTeam,
  countDistinctPlayers,
  parseScoreboardCsvText,
  type CsvRow,
} from "@/lib/scoreboard-csv"
import { createNameResolver } from "@/lib/name-match"

// Minimum distinct players for a game to be worth logging. Below this it's a
// casual/pub game (e.g. 4v4) and is skipped, not stored.
const MIN_DISTINCT_PLAYERS = 12
const BUCKET = "pending-scoreboards"

// Strip path separators / control chars from a filename before using it in a
// storage key.
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120)
}

function str(value: FormDataEntryValue | null): string | null {
  return typeof value === "string" && value.trim() !== "" ? value.trim() : null
}

/**
 * Bot ingest: the Discord bot POSTs an end-of-match scoreboard CSV here. We parse
 * it, gate on the 12-distinct-player minimum, resolve in-game names to players,
 * and park the result in pending_matches for admin approval. Writes go through the
 * service-role client (the bot is not a Supabase auth user).
 *
 * Multipart form fields: `file` (the CSV) plus optional Discord provenance —
 * `guild_id`, `channel_id`, `message_id`, `user_id`, `username`.
 */
export async function POST(request: Request) {
  const unauthorized = requireBotAuth(request)
  if (unauthorized) return unauthorized

  let form: FormData
  try {
    form = await request.formData()
  } catch {
    return NextResponse.json({ error: "expected multipart/form-data" }, { status: 400 })
  }

  const file = form.get("file")
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "missing csv file" }, { status: 400 })
  }
  const filename = str(form.get("filename")) ?? file.name ?? "scoreboard.csv"
  const text = await file.text()

  // Parse + validate (drops spectators and nameless rows, summarises score/teams).
  const parsed = parseScoreboardCsvText(text, filename)
  if (!parsed.ok) {
    return NextResponse.json(
      {
        error: "unparseable",
        missingColumns: parsed.missingColumns,
        detail: parsed.error,
      },
      { status: 422 },
    )
  }
  const summary = parsed.summary

  // Gate: skip casual games. Not an error — the bot forwards everything and lets
  // Soracle decide.
  const distinct = countDistinctPlayers(summary.rows)
  if (distinct < MIN_DISTINCT_PLAYERS) {
    return NextResponse.json(
      { skipped: true, reason: "too_few_players", distinct },
      { status: 200 },
    )
  }

  const messageId = str(form.get("message_id"))
  const guildId = str(form.get("guild_id"))
  const supabase = createServiceClient()

  // Idempotency: a retry of the same Discord message is a no-op.
  if (messageId) {
    const { data: existing } = await supabase
      .from("pending_matches")
      .select("id")
      .eq("message_id", messageId)
      .maybeSingle()
    if (existing) {
      return NextResponse.json({ duplicate: true, pending_id: existing.id, distinct }, { status: 200 })
    }
  }

  // Resolve every in-game name to a suggested player (alias-aware).
  let players, aliases
  try {
    players = await fetchPlayersForBot()
    aliases = await fetchAliasesForBot()
  } catch (error) {
    console.error(error)
    return NextResponse.json({ error: "failed to load roster" }, { status: 500 })
  }
  const resolver = createNameResolver(players, aliases)
  const rows = summary.rows.map((row: CsvRow) => {
    const ign = (row["NAME-CLEAN"] ?? "").trim()
    const match = resolver.resolve(ign)
    return {
      in_game_name: ign,
      team: classifyTeam(row),
      suggested_player_id: match?.playerId ?? null,
      match_method: match?.method ?? null,
      data: row,
    }
  })
  const matched = rows.filter((r) => r.suggested_player_id).length

  // Store the raw CSV (canonical) in the private bucket.
  const csvPath = `${guildId ?? "unknown"}/${messageId ?? crypto.randomUUID()}-${safeName(filename)}`
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(csvPath, new Blob([text], { type: "text/csv" }), {
      contentType: "text/csv",
      upsert: false,
    })
  if (uploadError) {
    console.error(uploadError)
    return NextResponse.json({ error: `csv upload failed: ${uploadError.message}` }, { status: 500 })
  }

  const { data: inserted, error: insertError } = await supabase
    .from("pending_matches")
    .insert({
      source: "discord_bot",
      guild_id: guildId,
      channel_id: str(form.get("channel_id")),
      message_id: messageId,
      uploader_id: str(form.get("user_id")),
      uploader_name: str(form.get("username")),
      csv_path: csvPath,
      csv_filename: filename,
      match_played_at: summary.timestampIso,
      distinct_players: distinct,
      red_score: summary.redScore,
      blue_score: summary.blueScore,
      parsed: { rows, warnings: summary.warnings, redCount: summary.redCount, blueCount: summary.blueCount },
      status: "pending",
    })
    .select("id")
    .single()

  if (insertError || !inserted) {
    // Roll back the orphaned CSV (best effort).
    await supabase.storage.from(BUCKET).remove([csvPath])
    console.error(insertError)
    return NextResponse.json(
      { error: insertError?.message ?? "failed to create pending match" },
      { status: 500 },
    )
  }

  return NextResponse.json({
    pending_id: inserted.id,
    distinct,
    matched,
    unmatched: rows.length - matched,
  })
}
