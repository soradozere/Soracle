import { describe, expect, it } from "vitest"
import { extractNwhIds, parseScoreboardJsonText } from "./scoreboard-json"
import { REQUIRED_COLUMNS } from "./scoreboard-csv"

// A minimal-but-valid csvData object: every required column present with a
// benign value, so summarizeParsedRows' column check passes.
function csvData(overrides: Record<string, string> = {}): Record<string, string> {
  const base: Record<string, string> = {}
  for (const col of REQUIRED_COLUMNS) base[col] = "0"
  return { ...base, ...overrides }
}

function scoreboard(playerData: Array<Record<string, unknown>>) {
  return JSON.stringify({
    playerData,
    finishTime: "2026-08-22T21:33:41.589+00:00",
    startTime: "2026-08-22T19:10:13",
    millisecondsDurationReal: 5008589,
    mapName: "ctf_yavin_no_outside",
    serverName: "test",
  })
}

const realPlayer = (name: string, team: "Red" | "Blue") => ({
  csvData: csvData({ "LAST-NONSPEC-TEAM": team, "NAME-CLEAN": name, "SCORE-SUM": "100" }),
  killTypes: {},
})

describe("parseScoreboardJsonText — empty playerData entries", () => {
  it("drops an entry whose csvData is an empty object", () => {
    const text = scoreboard([
      realPlayer("alice", "Red"),
      realPlayer("bob", "Blue"),
      { csvData: {}, killTypes: {}, guid: "ghost-guid" },
    ])
    const result = parseScoreboardJsonText(text, "test.json")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.rows).toHaveLength(2)
    expect(result.summary.rows.map((r) => r["NAME-CLEAN"])).toEqual(["alice", "bob"])
  })

  it("still drops an entry with no csvData at all", () => {
    const text = scoreboard([realPlayer("alice", "Red"), realPlayer("bob", "Blue"), { guid: "no-csvdata" }])
    const result = parseScoreboardJsonText(text, "test.json")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.rows).toHaveLength(2)
  })

  it("still keeps a genuine blank-named player (non-empty csvData, blank NAME-CLEAN)", () => {
    const text = scoreboard([
      realPlayer("alice", "Red"),
      { csvData: csvData({ "LAST-NONSPEC-TEAM": "Blue", "NAME-CLEAN": "", "SCORE-SUM": "50" }), killTypes: {} },
    ])
    const result = parseScoreboardJsonText(text, "test.json")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.rows).toHaveLength(2)
  })
})

/*
 * nwhId is TomArrow's persistent per-player identity — present per real
 * exports as `nwhIdInfo: { nwhId, likelyPlayer } | null` on each playerData
 * entry, null for spectators and bot slots. Injected as a pseudo-column
 * (mirrors TELE-KILLS) so name-match's resolver can read it through the same
 * CsvRow[] every caller already handles.
 */
describe("parseScoreboardJsonText — NWH-ID pseudo-column", () => {
  it("injects nwhId as a pseudo-column when present", () => {
    const text = scoreboard([
      { ...realPlayer("original", "Red"), nwhIdInfo: { nwhId: "69a9f70e", likelyPlayer: "original" } },
    ])
    const result = parseScoreboardJsonText(text, "test.json")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.rows[0]["NWH-ID"]).toBe("69a9f70e")
  })

  it("falls back to an empty string when nwhIdInfo is null", () => {
    const text = scoreboard([{ ...realPlayer("Padawan", "Blue"), nwhIdInfo: null }])
    const result = parseScoreboardJsonText(text, "test.json")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.rows[0]["NWH-ID"]).toBe("")
  })
})

describe("extractNwhIds", () => {
  it("keys nwhId by NAME-CLEAN, skipping null entries", () => {
    const text = scoreboard([
      { ...realPlayer("original", "Red"), nwhIdInfo: { nwhId: "69a9f70e", likelyPlayer: "original" } },
      { ...realPlayer("R32", "Blue"), nwhIdInfo: { nwhId: "69aa28d6", likelyPlayer: "vee" } },
      { ...realPlayer("Padawan", "Blue"), nwhIdInfo: null },
    ])
    expect(extractNwhIds(text, "test.json")).toEqual({
      original: "69a9f70e",
      R32: "69aa28d6",
    })
  })

  it("returns null for a CSV filename — a JSON-only feature", () => {
    expect(extractNwhIds("irrelevant", "test.csv")).toBeNull()
  })

  it("returns null for unparseable JSON", () => {
    expect(extractNwhIds("not json", "test.json")).toBeNull()
  })
})
