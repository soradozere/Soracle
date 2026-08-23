import {
  parseScoreboardCsvText,
  summarizeParsedRows,
  type CsvRow,
  type ParseResult,
} from "@/lib/scoreboard-csv"

// Parsing for TomArrow's JSON scoreboard, the successor to the CSV export.
//
// The heavy lifting is unchanged: every player entry carries a `csvData` object
// whose keys are the same column names the CSV used, so once those are pulled
// out the existing summarise/validate/review pipeline works untouched. This file
// only handles the wrapper, plus the two things the JSON can do that the CSV
// could not:
//
//  * TELE kills. There is no TELE-KILLS column and there never was — TELE is a
//    key inside the per-player `killTypes` dict, which is why the column added
//    by migration 023 has only ever written 0. Injected here as if it were a
//    column so the Otherworldly crest can finally accrue.
//  * A trustworthy timestamp. The CSV path has to parse the match time out of
//    the FILENAME and assume Berlin wall-clock, because the filename carries no
//    offset. The JSON states `finishTime` with an explicit offset.

// The fields we read off the wrapper. Everything else in the file (killed/
// killedBy matrices, GUIDs, glicko ratings, blocks breakdowns) is deliberately
// ignored for now — storing those needs schema changes.
interface JsonKillEdge {
  name?: string
  guid?: string
  kills?: number
  rets?: number
  killTypes?: Record<string, number>
  retTypes?: Record<string, number>
}

interface JsonPlayerEntry {
  csvData?: Record<string, string>
  killTypes?: Record<string, number>
  guid?: string
  killed?: JsonKillEdge[]
}

interface JsonScoreboard {
  playerData?: JsonPlayerEntry[]
  finishTime?: string
  startTime?: string
  millisecondsDurationReal?: number
  mapName?: string
  serverName?: string
}

/** True for a filename we should route through the JSON parser. */
export const isJsonScoreboard = (filename: string) => /\.json$/i.test(filename.trim())

/**
 * Match metadata the JSON carries and the CSV never did. Not yet persisted —
 * `matches` has no columns for it — but parsed here so the review screen can
 * show it and Phase 2b has one place to wire up.
 */
export interface JsonMatchMeta {
  startTime: string | null
  finishTime: string | null
  durationMs: number | null
  mapName: string | null
  serverName: string | null
}

export interface JsonParseExtras {
  meta: JsonMatchMeta
}

/**
 * Parse a JSON scoreboard into the same ParseResult the CSV path produces, so
 * every caller downstream is format-agnostic.
 *
 * Timestamps in this file are NOT all in one timezone — each carries its own
 * offset (`...+02:00` next to `...Z`), and two that look two hours apart can be
 * a fraction of a second apart. Always Date.parse(); never compare or slice the
 * strings.
 */
export function parseScoreboardJsonText(
  text: string,
  filename: string,
): ParseResult & Partial<JsonParseExtras> {
  let parsed: JsonScoreboard
  try {
    parsed = JSON.parse(text) as JsonScoreboard
  } catch {
    return { ok: false, missingColumns: [], error: "That file isn't valid JSON." }
  }

  const entries = parsed.playerData
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      ok: false,
      missingColumns: [],
      error: "This JSON has no playerData — it may not be a scoreboard export.",
    }
  }

  const rows: CsvRow[] = []
  for (const entry of entries) {
    // An entry with an EMPTY csvData object ({}) is truthy, so `!entry?.csvData`
    // alone lets it through — happened for real, 22 Aug 2026, four ghost
    // playerData entries with no fields at all, presumably an unused session
    // slot. They aren't a real participant, blank name or otherwise (a genuine
    // blank-named player still carries every other column), so they must not
    // reach the review screen as a mappable "empty player".
    if (!entry?.csvData || Object.keys(entry.csvData).length === 0) continue
    const row: CsvRow = { ...entry.csvData }
    // See the note above: TELE only ever appears as a killTypes key.
    row["TELE-KILLS"] = String(entry.killTypes?.TELE ?? 0)
    rows.push(row)
  }
  if (rows.length === 0) {
    return {
      ok: false,
      missingColumns: [],
      error: "This JSON has playerData but no csvData on any entry.",
    }
  }

  // Every row carries the same keys, so the first is a fine header list. Union
  // them anyway — a future build could add a field only some players have, and
  // a missing key here reads as a missing required column.
  const fields = Array.from(new Set(rows.flatMap((r) => Object.keys(r))))

  const result = summarizeParsedRows(rows, fields, filename)
  if (!result.ok) return result

  const meta: JsonMatchMeta = {
    // CAREFUL: unlike finishTime, startTime has come through with NO offset
    // ("2026-08-08T00:41:21"), which Date.parse reads as the PARSER's local
    // time — so this can land an hour or two out. Use durationMs for match
    // length and finishTime for when it ended; treat startTime as indicative.
    startTime: isoOrNull(parsed.startTime),
    finishTime: isoOrNull(parsed.finishTime),
    durationMs: typeof parsed.millisecondsDurationReal === "number" ? parsed.millisecondsDurationReal : null,
    mapName: parsed.mapName?.trim() || null,
    serverName: parsed.serverName?.trim() || null,
  }

  // Prefer the file's own finishTime over the filename guess: it states its
  // offset, so it needs no assumption about where the server lives.
  const timestampIso = meta.finishTime ?? result.summary.timestampIso
  const warnings = result.summary.warnings.filter(
    (w) => !(meta.finishTime && w === "Could not parse timestamp from filename"),
  )

  return { ...result, summary: { ...result.summary, timestampIso, warnings }, meta }
}

// Normalise a datetime that may carry any offset (or none) to a UTC ISO string.
// Returns null rather than "Invalid Date" so callers can fall back cleanly.
function isoOrNull(value: string | undefined): string | null {
  if (!value) return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** Parse either format, chosen by extension. */
export function parseScoreboardFile(
  text: string,
  filename: string,
): ParseResult & Partial<JsonParseExtras> {
  if (isJsonScoreboard(filename)) return parseScoreboardJsonText(text, filename)
  return parseScoreboardCsvText(text, filename)
}

// ---------------------------------------------------------------------------
// Kill matrix
// ---------------------------------------------------------------------------

/** One killer → victim pair in a match, identified by session guid. */
export interface KillEdge {
  killerGuid: string
  victimGuid: string
  kills: number
  rets: number
  killTypes: Record<string, number>
  retTypes: Record<string, number>
}

export interface KillMatrix {
  /** Session guid → that player's NAME-CLEAN, for resolving edges to players. */
  nameByGuid: Record<string, string>
  edges: KillEdge[]
}

/**
 * Pull the per-opponent kill/return matrix out of a JSON scoreboard.
 *
 * Read from `killed[]` only. `killedBy[]` is the same data mirrored, so taking
 * both would double every pair — times-returned for a player is the sum of
 * `rets` across edges where they are the VICTIM.
 *
 * Edges are keyed by session guid rather than name, because `killed[].name` is
 * the RAW name with colour codes ("^1^1|^7DefiancE^1| ^7Canon") while csvData
 * carries NAME-CLEAN. The guid is exact and needs no un-colouring. It is only
 * a session id — useless as a player identity — but within one match it is a
 * reliable join key, which is all this needs.
 *
 * Returns null for a CSV or anything unparseable: the matrix is a JSON-only
 * feature and its absence is normal, not an error.
 */
export function extractKillMatrix(text: string, filename: string): KillMatrix | null {
  if (!isJsonScoreboard(filename)) return null
  let parsed: JsonScoreboard
  try {
    parsed = JSON.parse(text) as JsonScoreboard
  } catch {
    return null
  }
  const entries = parsed.playerData
  if (!Array.isArray(entries)) return null

  const nameByGuid: Record<string, string> = {}
  for (const e of entries) {
    const guid = e?.guid
    const name = e?.csvData?.["NAME-CLEAN"]
    if (guid && typeof name === "string") nameByGuid[guid] = name.trim()
  }

  const edges: KillEdge[] = []
  for (const e of entries) {
    const killerGuid = e?.guid
    if (!killerGuid || !Array.isArray(e.killed)) continue
    for (const k of e.killed) {
      const victimGuid = k?.guid
      if (!victimGuid || victimGuid === killerGuid) continue
      const kills = k.kills ?? 0
      const rets = k.rets ?? 0
      // A pair with neither is noise; the scoreboard lists some empty entries.
      if (kills === 0 && rets === 0) continue
      edges.push({
        killerGuid,
        victimGuid,
        kills,
        rets,
        killTypes: k.killTypes ?? {},
        retTypes: k.retTypes ?? {},
      })
    }
  }
  return { nameByGuid, edges }
}
