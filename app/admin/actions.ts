"use server"

import Papa from "papaparse"
import type { SupabaseClient } from "@supabase/supabase-js"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { normalizeName } from "@/lib/name-match"

const PENDING_BUCKET = "pending-scoreboards"

// Authorize a match-management action: the caller must be a full admin OR a match
// admin (can_log_matches()). On success the writes are performed with the
// service-role client, so match admins never need direct table grants — they can
// do exactly what these actions allow and nothing more. Returns the user id.
async function requireMatchManager(): Promise<
  { ok: true; userId: string } | { ok: false; error: string }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Unauthorized - please sign in" }

  const { data: allowed, error } = await supabase.rpc("can_log_matches")
  if (!error) {
    return allowed === true
      ? { ok: true, userId: user.id }
      : { ok: false, error: "Not authorized to manage matches" }
  }

  // Fallback if can_log_matches() isn't present yet (migration 013 not applied):
  // keep full admins working so a deploy can't outrun the migration.
  const { data: isAdmin } = await supabase.rpc("is_admin")
  return isAdmin === true
    ? { ok: true, userId: user.id }
    : { ok: false, error: "Not authorized to manage matches" }
}

export async function uploadCSV(formData: FormData) {
  const file = formData.get("file") as File

  if (!file) {
    return { success: false, error: "No file provided" }
  }

  try {
    const text = await file.text()

    // Use a real CSV parser: Player/Tooltip are free text and can contain commas,
    // which spreadsheets export as quoted fields. Naive comma-splitting would
    // mis-align the row and shift the Discord IDs column onto a tooltip fragment,
    // causing spurious "Invalid Discord ID" errors. PapaParse handles quoted
    // fields, embedded commas, and CRLF line endings.
    const parsed = Papa.parse<Record<string, string>>(text, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim(),
    })

    if (!parsed.data || parsed.data.length === 0) {
      return { success: false, error: "CSV file is empty or invalid" }
    }

    // Map CSV columns to database fields
    const columnMap: Record<string, string> = {
      Player: "name",
      "Tier rank": "tier_value",
      Mic: "mic",
      "Capper skill": "capper_rating",
      "Chase skill": "chase_rating",
      "Camp skill": "camp_rating",
      "Cleaner skill": "cleaner_rating",
      "Support skill": "support_rating",
      Tooltip: "tooltip",
      "Discord IDs": "discord_ids",
    }

    // Discord snowflake IDs are 17-19 digit numbers; allow a little slack.
    const DISCORD_ID_PATTERN = /^\d{15,21}$/

    // Parse players
    const players = []
    for (const row of parsed.data) {
      const player: any = {}
      for (const [csvCol, dbField] of Object.entries(columnMap)) {
        if (!(csvCol in row)) continue

        const value = (row[csvCol] ?? "").trim()

        if (dbField === "name" || dbField === "tooltip") {
          player[dbField] = value || null
        } else if (dbField === "mic") {
          player[dbField] = value.toLowerCase() === "yes"
        } else if (dbField === "discord_ids") {
          // Semicolon-separated within the cell; dedupe and drop blanks.
          const ids: string[] = []
          for (const id of value.split(";").map((s) => s.trim()).filter(Boolean)) {
            if (!ids.includes(id)) ids.push(id)
          }
          player[dbField] = ids
        } else {
          player[dbField] = Number.parseInt(value) || 0
        }
      }

      if (player.name) {
        players.push(player)
      }
    }

    if (players.length === 0) {
      return { success: false, error: "No valid players found in CSV" }
    }

    // Validate Discord ID format and enforce uniqueness across all players in the file.
    const seenDiscordIds = new Map<string, string>()
    for (const player of players) {
      for (const id of (player.discord_ids || []) as string[]) {
        if (!DISCORD_ID_PATTERN.test(id)) {
          return { success: false, error: `Invalid Discord ID "${id}" for player ${player.name}` }
        }
        const existing = seenDiscordIds.get(id)
        if (existing && existing !== player.name) {
          return {
            success: false,
            error: `Discord ID ${id} is assigned to multiple players (${existing} and ${player.name})`,
          }
        }
        seenDiscordIds.set(id, player.name)
      }
    }

    const supabase = await createClient()

    // Snapshot current players (by name) BEFORE writing, so we can (a) diff old ->
    // new tiers for the changelog and (b) reuse each existing player's real id.
    // Deliberately NOT a full delete + reinsert: ids are preserved so match_stats /
    // tier_changes stay linked, and players absent from the CSV are left untouched.
    const { data: existing, error: existingError } = await supabase
      .from("players")
      .select("id, name, tier_value")
    if (existingError) {
      return { success: false, error: existingError.message }
    }
    const existingByName = new Map<string, { id: string; tier_value: number }>(
      (existing || []).map((p) => [p.name, { id: p.id, tier_value: p.tier_value }]),
    )

    // Split into updates (name already exists) and inserts (genuinely new). This
    // matters because of the discord_ids uniqueness trigger: it rejects any row
    // whose id differs from an existing owner of the same Discord ID. Upserting on
    // "name" fires the BEFORE INSERT trigger with a fresh random id, which the
    // trigger reads as a *different* player stealing the ID. By carrying the real
    // id and conflicting on "id", the trigger correctly sees the row as itself.
    const toUpdate = []
    const toInsert = []
    for (const player of players) {
      const match = existingByName.get(player.name)
      if (match) {
        toUpdate.push({ id: match.id, ...player })
      } else {
        toInsert.push(player)
      }
    }

    if (toUpdate.length > 0) {
      const { error: updateError } = await supabase
        .from("players")
        .upsert(toUpdate, { onConflict: "id" })
      if (updateError) {
        return { success: false, error: updateError.message }
      }
    }

    if (toInsert.length > 0) {
      const { error: insertError } = await supabase.from("players").insert(toInsert)
      if (insertError) {
        return { success: false, error: insertError.message }
      }
    }

    // Record tier changes for the changelog: only players who already existed and
    // whose tier actually moved. New players don't produce a changelog entry.
    const tierChangeRows = players
      .filter((p) => {
        const prev = existingByName.get(p.name)
        return prev && prev.tier_value !== p.tier_value
      })
      .map((p) => ({
        player_id: existingByName.get(p.name)!.id,
        player_name: p.name,
        previous_tier: existingByName.get(p.name)!.tier_value,
        new_tier: p.tier_value as number,
      }))

    if (tierChangeRows.length > 0) {
      const { error: changeError } = await supabase.from("tier_changes").insert(tierChangeRows)
      // A changelog failure shouldn't fail the whole import; surface it as a warning.
      if (changeError) {
        return {
          success: true,
          count: players.length,
          warning: `Roster updated, but the tier changelog could not be recorded: ${changeError.message}`,
        }
      }
    }

    return { success: true, count: players.length, tierChanges: tierChangeRows.length }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to process CSV",
    }
  }
}

export async function logMatch(data: {
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
  match_type: "normal" | "competitive"
  balance_confidence: number
  notes?: string
  played_at?: string
}) {
  try {
    const supabase = await createClient()

    // Look up tier values for all players
    const allPlayers = [...data.red_team, ...data.blue_team]
    const { data: playerData, error: playerError } = await supabase
      .from("players")
      .select("name, tier_value")
      .in("name", allPlayers)

    if (playerError) {
      return { success: false, error: playerError.message }
    }

    // Create a map of player name to tier value
    const tierMap = new Map<string, number>()
    for (const player of playerData || []) {
      tierMap.set(player.name, player.tier_value)
    }

    // Build tier arrays in the same order as team arrays
    // Default to 5 if player not found (shouldn't happen, but safe fallback)
    const red_tiers = data.red_team.map(name => tierMap.get(name) ?? 5)
    const blue_tiers = data.blue_team.map(name => tierMap.get(name) ?? 5)

    const { error } = await supabase.from("matches").insert({
      red_team: data.red_team,
      blue_team: data.blue_team,
      red_tiers,
      blue_tiers,
      red_score: data.red_score,
      blue_score: data.blue_score,
      match_type: data.match_type,
      balance_confidence: data.balance_confidence,
      notes: data.notes || null,
      ...(data.played_at ? { created_at: data.played_at } : {}),
    })

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to log match",
    }
  }
}

type MatchWithStatsPayload = {
  uuid: string
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
  match_type: string
  balance_confidence: number
  notes?: string
  played_at: string | null
  match_stats: Array<Record<string, unknown>>
}

// Shared core for logging a match that carries a stats CSV. Orders the work so the
// DB stays consistent on any failure: upload CSV → insert match → insert stats →
// move CSV. Returns the new match id. Used by both the manual log flow and the
// pending-match approval flow, so the two paths can never drift apart.
async function persistMatchWithStats(
  supabase: SupabaseClient,
  payload: MatchWithStatsPayload,
  file: File,
): Promise<{ success: true; matchId: string } | { success: false; error: string }> {
  const BUCKET = "match-csvs"
  const pendingPath = `pending/${payload.uuid}.csv`

  // 1. Upload the raw CSV to a UUID-named pending path (no match_id yet).
  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(pendingPath, file, { contentType: "text/csv", upsert: false })
  if (uploadError) {
    return { success: false, error: `CSV upload failed: ${uploadError.message}` }
  }

  // Best-effort removal of the pending CSV during rollback. A missing DELETE
  // policy should not mask the real error — just warn and move on.
  const removePending = async () => {
    const { error } = await supabase.storage.from(BUCKET).remove([pendingPath])
    if (error) {
      console.warn(`Failed to remove pending CSV ${pendingPath}: ${error.message}`)
    }
  }

  // 2. Insert the matches row (same tier-lookup logic as logMatch), tagged with
  //    stats_csv_uploaded_at = now() and match_played_at = parsed timestamp.
  const allPlayers = [...payload.red_team, ...payload.blue_team]
  const { data: playerData, error: playerError } = await supabase
    .from("players")
    .select("name, tier_value")
    .in("name", allPlayers)
  if (playerError) {
    await removePending()
    return { success: false, error: playerError.message }
  }

  const tierMap = new Map<string, number>()
  for (const p of playerData || []) tierMap.set(p.name, p.tier_value)
  const red_tiers = payload.red_team.map((n) => tierMap.get(n) ?? 5)
  const blue_tiers = payload.blue_team.map((n) => tierMap.get(n) ?? 5)

  const { data: inserted, error: matchError } = await supabase
    .from("matches")
    .insert({
      red_team: payload.red_team,
      blue_team: payload.blue_team,
      red_tiers,
      blue_tiers,
      red_score: payload.red_score,
      blue_score: payload.blue_score,
      match_type: payload.match_type,
      balance_confidence: payload.balance_confidence,
      notes: payload.notes || null,
      stats_csv_uploaded_at: new Date().toISOString(),
      ...(payload.played_at
        ? { match_played_at: payload.played_at, created_at: payload.played_at }
        : {}),
    })
    .select("id")
    .single()
  if (matchError || !inserted) {
    await removePending()
    return { success: false, error: matchError?.message || "Failed to create match" }
  }

  const matchId = inserted.id as string

  // 3. Bulk-insert match_stats, all tied to the new match_id (atomic).
  const statsRows = payload.match_stats.map((s) => ({ ...s, match_id: matchId }))
  const { error: statsError } = await supabase.from("match_stats").insert(statsRows)
  if (statsError) {
    // Rollback: cascade clears any stats, then drop the pending CSV.
    await supabase.from("matches").delete().eq("id", matchId)
    await removePending()
    return { success: false, error: `Failed to save stats: ${statsError.message}` }
  }

  // 4. Move the CSV from pending/ to its final match_id-named path. A failure
  //    here leaves data correct but the file stuck in pending/ — warn, succeed.
  const { error: moveError } = await supabase.storage
    .from(BUCKET)
    .move(pendingPath, `${matchId}.csv`)
  if (moveError) {
    console.warn(
      `Match ${matchId} saved, but CSV move failed (left at ${pendingPath}): ${moveError.message}`,
    )
  }

  return { success: true, matchId }
}

// Logs a match that has an associated stats CSV. The client passes the raw file
// plus a JSON `payload` field via FormData.
export async function logMatchWithStats(formData: FormData) {
  const file = formData.get("file") as File | null
  const payloadRaw = formData.get("payload")

  if (!file) return { success: false, error: "No CSV file provided" }
  if (typeof payloadRaw !== "string") return { success: false, error: "Missing match payload" }

  let payload: MatchWithStatsPayload
  try {
    payload = JSON.parse(payloadRaw)
  } catch {
    return { success: false, error: "Malformed match payload" }
  }

  const authz = await requireMatchManager()
  if (!authz.ok) return { success: false, error: authz.error }

  try {
    const result = await persistMatchWithStats(createServiceClient(), payload, file)
    return result.success ? { success: true } : { success: false, error: result.error }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to log match with stats",
    }
  }
}

// ── Pending match approval (Discord-uploaded scoreboards) ────────────────────

// List the games awaiting approval. Restricted to admins + match admins; anyone
// else gets an empty list. Reads with the service role after the authz check
// (pending_matches RLS is admin-only, so match admins couldn't read it directly).
export async function getPendingMatches() {
  const authz = await requireMatchManager()
  if (!authz.ok) return { success: false, error: authz.error, data: [] }
  try {
    const { data, error } = await createServiceClient()
      .from("pending_matches")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
    if (error) return { success: false, error: error.message, data: [] }
    return { success: true, data: data || [] }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch pending matches",
      data: [],
    }
  }
}

// Fetch a pending match's raw CSV text for the review modal. Authorized to admins
// + match admins; the row and the private-bucket object are then read with the
// service role.
export async function getPendingCsv(pendingId: string) {
  const authz = await requireMatchManager()
  if (!authz.ok) return { success: false, error: authz.error }
  try {
    const admin = createServiceClient()
    const { data: pending, error } = await admin
      .from("pending_matches")
      .select("csv_path, csv_filename")
      .eq("id", pendingId)
      .maybeSingle()
    if (error) return { success: false, error: error.message }
    if (!pending) return { success: false, error: "Pending match not found" }

    const { data: blob, error: dlError } = await admin.storage
      .from(PENDING_BUCKET)
      .download(pending.csv_path)
    if (dlError || !blob) return { success: false, error: dlError?.message || "CSV not found" }

    const text = await blob.text()
    return { success: true, text, filename: pending.csv_filename || "scoreboard.csv" }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to load pending CSV",
    }
  }
}

// Save corrected name → player mappings as learned aliases. Non-fatal: the match
// is already logged by the time this runs, so failures only warn. Guards against
// learning a name that belongs to a real player (the namefake case) or that is
// redundant / already known.
async function learnAliasesFromApproval(
  supabase: SupabaseClient,
  matchStats: Array<Record<string, unknown>>,
) {
  const pairs = matchStats
    .map((s) => ({
      name: String(s.in_game_name ?? "").trim(),
      playerId: String(s.player_id ?? ""),
    }))
    .filter((p) => p.name !== "" && p.playerId !== "")
  if (pairs.length === 0) return

  const { data: players } = await supabase.from("players").select("id, name")
  if (!players) return
  const nameById = new Map(players.map((p) => [p.id, p.name as string]))
  // Every real player's normalized name — an alias must never collide with one.
  const realNames = new Set(players.map((p) => normalizeName(p.name as string)))

  const { data: existing } = await supabase.from("player_aliases").select("alias")
  const known = new Set((existing || []).map((a) => normalizeName(a.alias as string)))

  const toInsert: Array<{ player_id: string; alias: string; source: string }> = []
  const seen = new Set<string>()
  for (const { name, playerId } of pairs) {
    const norm = normalizeName(name)
    if (!norm) continue
    // Already normalizes to the chosen player's own name — nothing to learn.
    const chosen = nameById.get(playerId)
    if (chosen && normalizeName(chosen) === norm) continue
    // Namefake guard: the name is some real player's name — never alias it away.
    if (realNames.has(norm)) continue
    // Already a known alias, or a duplicate within this batch.
    if (known.has(norm) || seen.has(norm)) continue
    seen.add(norm)
    toInsert.push({ player_id: playerId, alias: name, source: "learned" })
  }
  if (toInsert.length === 0) return

  const { error } = await supabase.from("player_aliases").insert(toInsert)
  if (error) {
    // A batch conflict shouldn't drop the rest — retry row by row, ignoring dups.
    for (const row of toInsert) {
      const { error: rowError } = await supabase.from("player_aliases").insert(row)
      if (rowError) console.warn(`Skipped learning alias "${row.alias}": ${rowError.message}`)
    }
  }
}

// Approve a pending match: log it via the shared core, mark the row approved, learn
// aliases from any corrected mappings, and purge the pending CSV. FormData carries
// `pending_id`, the `file`, and the same JSON `payload` as logMatchWithStats.
export async function approvePendingMatch(formData: FormData) {
  const pendingId = formData.get("pending_id")
  const file = formData.get("file") as File | null
  const payloadRaw = formData.get("payload")

  if (typeof pendingId !== "string") return { success: false, error: "Missing pending id" }
  if (!file) return { success: false, error: "No CSV file provided" }
  if (typeof payloadRaw !== "string") return { success: false, error: "Missing match payload" }

  let payload: MatchWithStatsPayload
  try {
    payload = JSON.parse(payloadRaw)
  } catch {
    return { success: false, error: "Malformed match payload" }
  }

  const authz = await requireMatchManager()
  if (!authz.ok) return { success: false, error: authz.error }

  try {
    const admin = createServiceClient()
    const { data: pending } = await admin
      .from("pending_matches")
      .select("csv_path, status")
      .eq("id", pendingId)
      .maybeSingle()
    if (!pending) return { success: false, error: "Pending match not found" }
    if (pending.status !== "pending") {
      return { success: false, error: "This match has already been reviewed" }
    }

    // 1. Log the match (shared with the manual flow).
    const result = await persistMatchWithStats(admin, payload, file)
    if (!result.success) return { success: false, error: result.error }

    // 2. Mark the pending row approved (non-fatal: the match is already logged).
    const { error: updateError } = await admin
      .from("pending_matches")
      .update({
        status: "approved",
        match_id: result.matchId,
        reviewed_by: authz.userId,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", pendingId)
    if (updateError) {
      console.warn(
        `Match ${result.matchId} logged but pending ${pendingId} not marked approved: ${updateError.message}`,
      )
    }

    // 3. Learn aliases from corrected mappings (non-fatal).
    await learnAliasesFromApproval(admin, payload.match_stats)

    // 4. Purge the pending CSV — it now lives in match-csvs (best effort).
    try {
      await admin.storage.from(PENDING_BUCKET).remove([pending.csv_path])
    } catch (error) {
      console.warn(`Failed to purge pending CSV ${pending.csv_path}:`, error)
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to approve pending match",
    }
  }
}

// Reject a pending match (soft delete): mark it rejected for audit and purge its
// CSV. Mainly used to discard duplicate re-posts.
export async function rejectPendingMatch(pendingId: string) {
  const authz = await requireMatchManager()
  if (!authz.ok) return { success: false, error: authz.error }

  try {
    const admin = createServiceClient()
    const { data: pending } = await admin
      .from("pending_matches")
      .select("csv_path")
      .eq("id", pendingId)
      .maybeSingle()
    if (!pending) return { success: false, error: "Pending match not found" }

    const { error } = await admin
      .from("pending_matches")
      .update({ status: "rejected", reviewed_by: authz.userId, reviewed_at: new Date().toISOString() })
      .eq("id", pendingId)
    if (error) return { success: false, error: error.message }

    try {
      await admin.storage.from(PENDING_BUCKET).remove([pending.csv_path])
    } catch (purgeError) {
      console.warn(`Failed to purge rejected CSV ${pending.csv_path}:`, purgeError)
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to reject pending match",
    }
  }
}

export async function getMatches() {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("matches")
      .select("*")
      .order("created_at", { ascending: false })

    if (error) {
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch matches",
      data: [],
    }
  }
}

export async function updateMatchDate(matchId: string, newDate: string) {
  const authz = await requireMatchManager()
  if (!authz.ok) return { success: false, error: authz.error }
  try {
    const { error } = await createServiceClient()
      .from("matches")
      .update({ created_at: newDate })
      .eq("id", matchId)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to update match date",
    }
  }
}

export async function deleteMatch(matchId: string) {
  const authz = await requireMatchManager()
  if (!authz.ok) return { success: false, error: authz.error }
  try {
    const { error } = await createServiceClient()
      .from("matches")
      .delete()
      .eq("id", matchId)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to delete match",
    }
  }
}

export async function getMatchesByMonth(year: number, month: number) {
  try {
    const supabase = await createClient()

    // Create date range for the month
    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0, 23, 59, 59, 999)

    const { data, error } = await supabase
      .from("matches")
      .select("*")
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString())
      .order("created_at", { ascending: true })

    if (error) {
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch matches",
      data: [],
    }
  }
}

// Per-player match_stats for a month, scoped by the parent match's date (same
// window the Reports tab uses elsewhere). Returns raw rows; the client aggregates
// and maps player_id -> name via the already-loaded players list.
export async function getMatchStatsByMonth(year: number, month: number) {
  try {
    const supabase = await createClient()

    const startDate = new Date(year, month - 1, 1)
    const endDate = new Date(year, month, 0, 23, 59, 59, 999)

    // Which matches fall in this month.
    const { data: monthMatches, error: matchError } = await supabase
      .from("matches")
      .select("id")
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString())

    if (matchError) {
      return { success: false, error: matchError.message, data: [] }
    }

    const matchIds = (monthMatches || []).map((m) => m.id)
    if (matchIds.length === 0) {
      return { success: true, data: [] }
    }

    const { data, error } = await supabase
      .from("match_stats")
      .select("match_id, player_id, score, flag_hold_ms, dbs_kills, captures, returns, kills, deaths, time_played")
      .in("match_id", matchIds)

    if (error) {
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch match stats",
      data: [],
    }
  }
}

// All per-player stat rows for a single match, with player names joined, for the
// expandable scoreboard on the Match History tab.
export async function getMatchStats(matchId: string) {
  try {
    const supabase = await createClient()

    const { data, error } = await supabase
      .from("match_stats")
      .select(
        "player_id, team, played_partial, score, captures, returns, base_cleaner, dbs_kills, kills, deaths, dfa_kills, flag_hold_ms, time_played, players(name)",
      )
      .eq("match_id", matchId)

    if (error) {
      return { success: false, error: error.message, data: [] }
    }

    return { success: true, data: data || [] }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch match stats",
      data: [],
    }
  }
}

export async function getMonthlyPlayerStats() {
  try {
    const supabase = await createClient()

    const now = new Date()
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
    const endOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999)

    const { data: matches, error } = await supabase
      .from("matches")
      .select("red_team, blue_team, red_score, blue_score")
      .gte("created_at", startOfMonth.toISOString())
      .lte("created_at", endOfMonth.toISOString())

    if (error) {
      return { success: false, error: error.message, data: {} }
    }

    const stats = new Map<string, { wins: number; losses: number; draws: number }>()

    for (const match of matches || []) {
      const redWon = match.red_score > match.blue_score
      const blueWon = match.blue_score > match.red_score

      for (const player of match.red_team) {
        if (!stats.has(player)) stats.set(player, { wins: 0, losses: 0, draws: 0 })
        const s = stats.get(player)!
        if (redWon) s.wins++
        else if (blueWon) s.losses++
        else s.draws++
      }

      for (const player of match.blue_team) {
        if (!stats.has(player)) stats.set(player, { wins: 0, losses: 0, draws: 0 })
        const s = stats.get(player)!
        if (blueWon) s.wins++
        else if (redWon) s.losses++
        else s.draws++
      }
    }

    const statsObj: Record<string, { wins: number; losses: number; draws: number }> = {}
    stats.forEach((value, key) => { statsObj[key] = value })

    return { success: true, data: statsObj }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch monthly player stats",
      data: {},
    }
  }
}

export async function getPlayerStats() {
  try {
    const supabase = await createClient()

    const { data: matches, error } = await supabase
      .from("matches")
      .select("red_team, blue_team, red_score, blue_score")

    if (error) {
      return { success: false, error: error.message, data: new Map() }
    }

    // Calculate win rates for each player
    const stats = new Map<string, { wins: number; losses: number; draws: number }>()

    for (const match of matches || []) {
      const redWon = match.red_score > match.blue_score
      const blueWon = match.blue_score > match.red_score
      const draw = match.red_score === match.blue_score

      for (const player of match.red_team) {
        if (!stats.has(player)) {
          stats.set(player, { wins: 0, losses: 0, draws: 0 })
        }
        const s = stats.get(player)!
        if (redWon) s.wins++
        else if (blueWon) s.losses++
        else s.draws++
      }

      for (const player of match.blue_team) {
        if (!stats.has(player)) {
          stats.set(player, { wins: 0, losses: 0, draws: 0 })
        }
        const s = stats.get(player)!
        if (blueWon) s.wins++
        else if (redWon) s.losses++
        else s.draws++
      }
    }

    // Convert to serializable format
    const statsObj: Record<string, { wins: number; losses: number; draws: number }> = {}
    stats.forEach((value, key) => {
      statsObj[key] = value
    })

    return { success: true, data: statsObj }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to fetch player stats",
      data: {},
    }
  }
}
