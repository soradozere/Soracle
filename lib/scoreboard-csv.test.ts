import { describe, expect, it } from "vitest"
import {
  buildMatchStat,
  repairBcOvercount,
  summarizeParsedRows,
  REQUIRED_COLUMNS,
  type CsvRow,
} from "./scoreboard-csv"

// A minimal-but-valid row: every required column present with a benign value, so
// summarizeParsedRows' column check passes.
function row(overrides: Record<string, string> = {}): CsvRow {
  const base: CsvRow = {}
  for (const col of REQUIRED_COLUMNS) base[col] = "0"
  return { ...base, "LAST-NONSPEC-TEAM": "Blue", "NAME-CLEAN": "player", ...overrides }
}

/*
 * The exporter's BC-SUM over-counts on rows where the player never reconnected.
 * Numbers below are the real ones from the 11 Sep 2026 ctf_yavin scoreboard
 * (Flawless: BC-SUM 121 against a BC-CURRENT of 94, 139 kills, 107 minutes on
 * both TIME columns) and from 2 Jul 2026 (devy, who genuinely reconnected:
 * BC-CURRENT 0 on a 0-minute current stint, BC-SUM 19 over 64 minutes).
 */
describe("repairBcOvercount", () => {
  it("clamps an inflated BC-SUM to BC-CURRENT when the row shows no earlier stint", () => {
    const result = repairBcOvercount(
      row({
        "NAME-CLEAN": "Flawless",
        "BC-CURRENT": "94",
        "BC-SUM": "121",
        "TIME-CURRENT": "107",
        "TIME-SUM": "107",
        KILLS: "139",
      }),
    )
    expect(result.row["BC-SUM"]).toBe("94")
    expect(result.warning).toContain("Flawless")
    expect(result.warning).toContain("121")
    expect(result.warning).toContain("94")
  })

  it("leaves BC-SUM alone when an earlier stint explains it", () => {
    const result = repairBcOvercount(
      row({ "NAME-CLEAN": "devy", "BC-CURRENT": "0", "BC-SUM": "19", "TIME-CURRENT": "0", "TIME-SUM": "64" }),
    )
    expect(result.row["BC-SUM"]).toBe("19")
    expect(result.warning).toBeNull()
  })

  it("leaves an agreeing row alone", () => {
    const result = repairBcOvercount(
      row({ "BC-CURRENT": "66", "BC-SUM": "66", "TIME-CURRENT": "107", "TIME-SUM": "107" }),
    )
    expect(result.row["BC-SUM"]).toBe("66")
    expect(result.warning).toBeNull()
  })

  it("leaves an old CSV-export row alone — it carries no BC-CURRENT to compare", () => {
    const result = repairBcOvercount(row({ "BC-SUM": "40", "TIME-SUM": "70" }))
    expect(result.row["BC-SUM"]).toBe("40")
    expect(result.warning).toBeNull()
  })
})

describe("summarizeParsedRows — BC repair reaches the rows everything else reads", () => {
  const inflated = row({
    "NAME-CLEAN": "Flawless",
    "BC-CURRENT": "94",
    "BC-SUM": "121",
    "TIME-CURRENT": "107",
    "TIME-SUM": "107",
    KILLS: "139",
  })
  const fields = [...REQUIRED_COLUMNS, "BC-CURRENT", "TIME-CURRENT"]

  it("returns the repaired row and warns about it", () => {
    const result = summarizeParsedRows([inflated], fields, "2026-09-11 00_33_41_ctf_yavin.json")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.rows[0]["BC-SUM"]).toBe("94")
    expect(result.summary.warnings.some((w) => w.includes("Flawless") && w.includes("94"))).toBe(true)
  })

  it("stores the repaired figure as base_cleaner", () => {
    const result = summarizeParsedRows([inflated], fields, "2026-09-11 00_33_41_ctf_yavin.json")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const stat = buildMatchStat(result.summary.rows[0], "player-id", "Blue", false)
    expect(stat.base_cleaner).toBe(94)
    expect(stat.kills).toBe(139)
  })

  it("does not touch a spectator-free scoreboard's other counters", () => {
    const result = summarizeParsedRows([inflated], fields, "2026-09-11 00_33_41_ctf_yavin.json")
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.summary.rows[0]["KILLS"]).toBe("139")
    expect(result.summary.rows[0]["BC-CURRENT"]).toBe("94")
  })
})
