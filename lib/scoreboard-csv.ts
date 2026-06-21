// Pure, framework-agnostic parsing of JK2 end-of-match scoreboard CSVs.
//
// Extracted from components/match-stats-csv-modal.tsx so the same column
// definitions, row-merging, stat mapping and summary logic can be reused by the
// bot-facing upload endpoint and the pending-match approval flow without pulling
// in React. Nothing here touches the DOM or component state.

import Papa from "papaparse"
import type { MatchStatInsert } from "@/lib/types"

// Required CSV column headers. Parsing is aborted if any are missing.
export const REQUIRED_COLUMNS = [
  "LAST-NONSPEC-TEAM",
  "NAME-CLEAN",
  "SCORE-SUM",
  "CAPTURES-SUM",
  "RETURNS-SUM",
  "BC-SUM",
  "ASSISTS-SUM",
  "FLAGGRABS-SUM",
  "FLAGHOLD-SUM",
  "KILLS",
  "DEATHS",
  "RED-KILLS",
  "YEL-KILLS",
  "BLU-KILLS",
  "DFA-KILLS",
  "YDFA-KILLS",
  "BS-KILLS",
  "DBS-KILLS",
  "BLUBS-KILLS",
  "UPCUT-KILLS",
  "RED-RETURNS",
  "YEL-RETURNS",
  "BLU-RETURNS",
  "DFA-RETURNS",
  "YDFA-RETURNS",
  "BS-RETURNS",
  "DBS-RETURNS",
  "BLUBS-RETURNS",
  "UPCUT-RETURNS",
  "MINE-KILLS",
  "MINE-RETURNS",
  "DOOM-KILLS",
  "TUR-KILLS",
  "IDLE-KILLS",
  "MINEGRABS-REDBASE",
  "MINEGRABS-BLUEBASE",
  "TIME-SUM",
] as const

// Numeric counter columns summed when merging reconnect rows — every required
// column except the two identity columns (team + name).
export const SUMMABLE_COLUMNS = REQUIRED_COLUMNS.filter(
  (col) => col !== "LAST-NONSPEC-TEAM" && col !== "NAME-CLEAN",
)

export type CsvRow = Record<string, string>
export type TeamClass = "Red" | "Blue" | "Other"

export interface ParseSummary {
  filename: string
  timestampIso: string | null
  rows: CsvRow[]
  redCount: number
  blueCount: number
  redScore: number
  blueScore: number
  warnings: string[]
}

// Outcome of summarising parsed rows: either a usable summary, or a failure that
// carries the missing columns and/or a human-readable error to surface.
export type ParseResult =
  | { ok: true; summary: ParseSummary }
  | { ok: false; missingColumns: string[]; error: string | null }

export function toInt(value: string | undefined): number {
  const n = parseInt((value ?? "").trim(), 10)
  return Number.isFinite(n) ? n : 0
}

export function classifyTeam(row: CsvRow): TeamClass {
  const team = (row["LAST-NONSPEC-TEAM"] ?? "").trim()
  if (team === "Red") return "Red"
  if (team === "Blue") return "Blue"
  return "Other"
}

// Combine several rows of the same player into one virtual row: sum the numeric
// counters, keep the first row's identity (name + team).
export function mergeRowData(rows: CsvRow[]): CsvRow {
  const merged: CsvRow = { ...rows[0] }
  for (const col of SUMMABLE_COLUMNS) {
    merged[col] = String(rows.reduce((sum, r) => sum + toInt(r[col]), 0))
  }
  return merged
}

// Map a finished row to a match_stats insert payload. CSV counter columns map
// 1:1 to DB fields; player_id, team and played_partial come from the review UI.
export function buildMatchStat(
  row: CsvRow,
  playerId: string,
  team: "Red" | "Blue",
  partial: boolean,
): MatchStatInsert {
  return {
    player_id: playerId,
    team,
    played_partial: partial,

    in_game_name: (row["NAME-CLEAN"] ?? "").trim() || null,

    score: toInt(row["SCORE-SUM"]),

    captures: toInt(row["CAPTURES-SUM"]),
    returns: toInt(row["RETURNS-SUM"]),
    base_cleaner: toInt(row["BC-SUM"]),
    assists: toInt(row["ASSISTS-SUM"]),
    flag_grabs: toInt(row["FLAGGRABS-SUM"]),
    flag_hold_ms: toInt(row["FLAGHOLD-SUM"]),

    kills: toInt(row["KILLS"]),
    deaths: toInt(row["DEATHS"]),

    red_kills: toInt(row["RED-KILLS"]),
    yellow_kills: toInt(row["YEL-KILLS"]),
    blue_kills: toInt(row["BLU-KILLS"]),
    dfa_kills: toInt(row["DFA-KILLS"]),
    ydfa_kills: toInt(row["YDFA-KILLS"]),
    bs_kills: toInt(row["BS-KILLS"]),
    dbs_kills: toInt(row["DBS-KILLS"]),
    blubs_kills: toInt(row["BLUBS-KILLS"]),
    upcut_kills: toInt(row["UPCUT-KILLS"]),

    red_returns: toInt(row["RED-RETURNS"]),
    yellow_returns: toInt(row["YEL-RETURNS"]),
    blue_returns: toInt(row["BLU-RETURNS"]),
    dfa_returns: toInt(row["DFA-RETURNS"]),
    ydfa_returns: toInt(row["YDFA-RETURNS"]),
    bs_returns: toInt(row["BS-RETURNS"]),
    dbs_returns: toInt(row["DBS-RETURNS"]),
    blubs_returns: toInt(row["BLUBS-RETURNS"]),
    upcut_returns: toInt(row["UPCUT-RETURNS"]),

    mine_kills: toInt(row["MINE-KILLS"]),
    mine_returns: toInt(row["MINE-RETURNS"]),
    doom_kills: toInt(row["DOOM-KILLS"]),
    turret_kills: toInt(row["TUR-KILLS"]),
    idle_kills: toInt(row["IDLE-KILLS"]),

    mine_grabs_red: toInt(row["MINEGRABS-REDBASE"]),
    mine_grabs_blue: toInt(row["MINEGRABS-BLUEBASE"]),

    time_played: toInt(row["TIME-SUM"]),
  }
}

// The scoreboard host (German-based) writes filenames in local Berlin time, so
// the parsed wall-clock is interpreted in this zone (CET/CEST, DST-aware) before
// converting to a UTC instant for storage.
const SCOREBOARD_TIMEZONE = "Europe/Berlin"

// Convert a wall-clock time in `timeZone` to the equivalent UTC Date. Uses the
// standard offset round-trip via Intl, so DST is handled automatically.
function wallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string,
): Date {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, second)
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  })
  const parts: Record<string, number> = {}
  for (const p of dtf.formatToParts(new Date(utcGuess))) {
    if (p.type !== "literal") parts[p.type] = Number(p.value)
  }
  // How far the zone is ahead of UTC at this instant (hour can be "24" at midnight).
  const asZone = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour % 24, parts.minute, parts.second)
  return new Date(utcGuess - (asZone - utcGuess))
}

// Filename starts with YYYY-MM-DD<sep>HH_MM_SS, where <sep> is "_" or " ". The time
// is the host's local Berlin wall clock; returns the equivalent ISO 8601 UTC string.
export function parseTimestampFromFilename(filename: string): string | null {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})[_ ](\d{2})_(\d{2})_(\d{2})/)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map(Number) as unknown as number[]
  // Validate the wall-clock components are a real date/time (catches rollover such
  // as month 13 that Date.UTC would silently accept).
  const check = new Date(Date.UTC(year, month - 1, day, hour, minute, second))
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== month - 1 ||
    check.getUTCDate() !== day ||
    check.getUTCHours() !== hour ||
    check.getUTCMinutes() !== minute ||
    check.getUTCSeconds() !== second
  ) {
    return null
  }
  return wallClockToUtc(year, month, day, hour, minute, second, SCOREBOARD_TIMEZONE).toISOString()
}

// Turn raw parsed CSV rows (plus the header field list and filename) into a
// ParseSummary, or a failure describing missing columns / why it was rejected.
// This is the validation + summarising step shared by the upload modal and the
// server-side bot endpoint; the caller is responsible for the actual CSV parse
// (PapaParse on a File in the browser, on a string on the server).
export function summarizeParsedRows(
  data: CsvRow[],
  fields: string[],
  filename: string,
): ParseResult {
  // Validate required columns.
  const missingColumns = REQUIRED_COLUMNS.filter((col) => !fields.includes(col))
  if (missingColumns.length > 0) {
    return { ok: false, missingColumns, error: null }
  }

  const allRows = data.filter((row) => row && Object.keys(row).length > 0)
  if (allRows.length === 0) {
    return { ok: false, missingColumns: [], error: "The CSV has no data rows. Try another file." }
  }

  const warnings: string[] = []

  // Filter out spectator rows. Rows with a blank in-game name are kept: a blank is
  // a legal JK2 name, so the player is real and must stay mappable by an admin.
  const nonSpec = allRows.filter(
    (row) => (row["LAST-NONSPEC-TEAM"] ?? "").trim() !== "Spectator",
  )

  // Surface any unexpected team values (not Red/Blue/Spectator).
  const unexpected = new Map<string, number>()
  for (const row of nonSpec) {
    const team = (row["LAST-NONSPEC-TEAM"] ?? "").trim()
    if (team !== "Red" && team !== "Blue") {
      const label = team === "" ? "(empty)" : team
      unexpected.set(label, (unexpected.get(label) ?? 0) + 1)
    }
  }
  if (unexpected.size > 0) {
    const parts = Array.from(unexpected.entries())
      .map(([value, count]) => `"${value}" (${count} row${count === 1 ? "" : "s"})`)
      .join(", ")
    warnings.push(`Unexpected team value(s) found: ${parts}. Continuing anyway.`)
  }

  // Timestamp from filename.
  const timestampIso = parseTimestampFromFilename(filename)
  if (!timestampIso) {
    warnings.push("Could not parse timestamp from filename")
  }

  // Final score = sum of CAPTURES-SUM per team.
  let redCount = 0
  let blueCount = 0
  let redScore = 0
  let blueScore = 0
  for (const row of nonSpec) {
    const team = (row["LAST-NONSPEC-TEAM"] ?? "").trim()
    const captures = toInt(row["CAPTURES-SUM"])
    if (team === "Red") {
      redCount += 1
      redScore += captures
    } else if (team === "Blue") {
      blueCount += 1
      blueScore += captures
    }
  }

  // Low-row-count warning.
  if (nonSpec.length < 12) {
    warnings.push(
      `Only ${nonSpec.length} non-spectator rows found — expected at least 12. Continuing anyway.`,
    )
  }

  return {
    ok: true,
    summary: {
      filename,
      timestampIso,
      rows: nonSpec,
      redCount,
      blueCount,
      redScore,
      blueScore,
      warnings,
    },
  }
}

// Server-side entry point: parse raw CSV text (PapaParse on a string) and run it
// through the same validation/summary as the browser. The browser modal parses a
// File directly; this is for the bot ingest endpoint, which receives CSV text.
export function parseScoreboardCsvText(text: string, filename: string): ParseResult {
  const results = Papa.parse<CsvRow>(text, { header: true, skipEmptyLines: true })
  return summarizeParsedRows(results.data, results.meta.fields ?? [], filename)
}

// Distinct in-game players in a parsed summary, for the "minimum 12 players" gate.
// Named players collapse by case-folded name (so reconnect rows of the same player
// count once). Blank-named rows can't be deduped by name, so each is counted as its
// own player — a real 12-player game with one nameless player still clears the gate,
// and over-counting only risks logging a borderline game an admin then reviews.
export function countDistinctPlayers(rows: CsvRow[]): number {
  const names = rows.map((r) => (r["NAME-CLEAN"] ?? "").trim().toLowerCase())
  const distinctNamed = new Set(names.filter((n) => n !== "")).size
  const blankRows = names.filter((n) => n === "").length
  return distinctNamed + blankRows
}
