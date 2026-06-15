"use server"

import { createClient } from "@/lib/supabase/server"

export async function uploadCSV(formData: FormData) {
  const file = formData.get("file") as File

  if (!file) {
    return { success: false, error: "No file provided" }
  }

  try {
    const text = await file.text()
    const lines = text.split("\n").filter((line) => line.trim())

    if (lines.length < 2) {
      return { success: false, error: "CSV file is empty or invalid" }
    }

    // Parse CSV header
    const header = lines[0].split(",").map((h) => h.trim())

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
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(",").map((v) => v.trim())
      if (values.length < header.length) continue

      const player: any = {}
      for (let j = 0; j < header.length; j++) {
        const dbField = columnMap[header[j]]
        if (!dbField) continue

        const value = values[j]

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

    // Insert into database
    const supabase = await createClient()

    // Clear existing players
    await supabase.from("players").delete().neq("id", "00000000-0000-0000-0000-000000000000")

    // Insert new players
    const { error } = await supabase.from("players").insert(players)

    if (error) {
      return { success: false, error: error.message }
    }

    return { success: true, count: players.length }
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

// Logs a match that has an associated stats CSV. Orders the work so the DB stays
// consistent on any failure: upload CSV → insert match → insert stats → move CSV.
// The client passes the raw file plus a JSON `payload` field via FormData.
export async function logMatchWithStats(formData: FormData) {
  const file = formData.get("file") as File | null
  const payloadRaw = formData.get("payload")

  if (!file) return { success: false, error: "No CSV file provided" }
  if (typeof payloadRaw !== "string") return { success: false, error: "Missing match payload" }

  let payload: {
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
  try {
    payload = JSON.parse(payloadRaw)
  } catch {
    return { success: false, error: "Malformed match payload" }
  }

  const BUCKET = "match-csvs"
  const pendingPath = `pending/${payload.uuid}.csv`

  try {
    const supabase = await createClient()

    // 1. Upload the raw CSV to a UUID-named pending path (no match_id yet).
    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(pendingPath, file, { contentType: "text/csv", upsert: false })
    if (uploadError) {
      return { success: false, error: `CSV upload failed: ${uploadError.message}` }
    }

    // Helper: best-effort removal of the pending CSV during rollback. A missing
    // DELETE policy should not mask the real error — just warn and move on.
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

    // 4. Bulk-insert match_stats, all tied to the new match_id (atomic).
    const statsRows = payload.match_stats.map((s) => ({ ...s, match_id: matchId }))
    const { error: statsError } = await supabase.from("match_stats").insert(statsRows)
    if (statsError) {
      // Rollback: cascade clears any stats, then drop the pending CSV.
      await supabase.from("matches").delete().eq("id", matchId)
      await removePending()
      return { success: false, error: `Failed to save stats: ${statsError.message}` }
    }

    // 5. Move the CSV from pending/ to its final match_id-named path. A failure
    //    here leaves data correct but the file stuck in pending/ — warn, succeed.
    const { error: moveError } = await supabase.storage
      .from(BUCKET)
      .move(pendingPath, `${matchId}.csv`)
    if (moveError) {
      console.warn(
        `Match ${matchId} saved, but CSV move failed (left at ${pendingPath}): ${moveError.message}`,
      )
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : "Failed to log match with stats",
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
  try {
    const supabase = await createClient()

    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: "Unauthorized - admin authentication required" }
    }

    const { error } = await supabase
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
  try {
    const supabase = await createClient()

    // Verify admin authentication
    const { data: { user }, error: authError } = await supabase.auth.getUser()
    if (authError || !user) {
      return { success: false, error: "Unauthorized - admin authentication required" }
    }

    const { error } = await supabase
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
