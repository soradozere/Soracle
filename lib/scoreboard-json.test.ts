import { describe, expect, it } from "vitest"
import { parseScoreboardJsonText } from "./scoreboard-json"
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
