"use client"

import { useMemo, useState } from "react"
import Papa from "papaparse"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

interface MatchStatsCsvModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

// Required CSV column headers. Parsing is aborted if any are missing.
const REQUIRED_COLUMNS = [
  "LAST-NONSPEC-TEAM",
  "NAME-CLEAN",
  "CAPTURES-CURRENT",
  "RETURNS-CURRENT",
  "BC-CURRENT",
  "ASSISTS-CURRENT",
  "FLAGGRABS-CURRENT",
  "FLAGHOLD-CURRENT",
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

type CsvRow = Record<string, string>
type TeamClass = "Red" | "Blue" | "Other"

interface ParseSummary {
  filename: string
  timestampIso: string | null
  rows: CsvRow[]
  redCount: number
  blueCount: number
  redScore: number
  blueScore: number
  warnings: string[]
}

function toInt(value: string | undefined): number {
  const n = parseInt((value ?? "").trim(), 10)
  return Number.isFinite(n) ? n : 0
}

function classifyTeam(row: CsvRow): TeamClass {
  const team = (row["LAST-NONSPEC-TEAM"] ?? "").trim()
  if (team === "Red") return "Red"
  if (team === "Blue") return "Blue"
  return "Other"
}

// Filename starts with YYYY-MM-DD<sep>HH_MM_SS, where <sep> is "_" or " " —
// convert to an ISO 8601 UTC string.
function parseTimestampFromFilename(filename: string): string | null {
  const match = filename.match(/^(\d{4})-(\d{2})-(\d{2})[_ ](\d{2})_(\d{2})_(\d{2})/)
  if (!match) return null
  const [, year, month, day, hour, minute, second] = match.map(Number) as unknown as number[]
  const ms = Date.UTC(year, month - 1, day, hour, minute, second)
  if (Number.isNaN(ms)) return null
  // Guard against rollover (e.g. month 13) that Date.UTC would silently accept.
  const d = new Date(ms)
  if (
    d.getUTCFullYear() !== year ||
    d.getUTCMonth() !== month - 1 ||
    d.getUTCDate() !== day ||
    d.getUTCHours() !== hour ||
    d.getUTCMinutes() !== minute ||
    d.getUTCSeconds() !== second
  ) {
    return null
  }
  return d.toISOString()
}

export function MatchStatsCsvModal({ open, onOpenChange }: MatchStatsCsvModalProps) {
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missingColumns, setMissingColumns] = useState<string[]>([])

  // Sort rows: Red first, then Blue, then unexpected teams — Caps descending within each group.
  const sortedRows = useMemo(() => {
    if (!summary) return []
    const rank: Record<TeamClass, number> = { Red: 0, Blue: 1, Other: 2 }
    return summary.rows
      .map((row) => ({ row, team: classifyTeam(row) }))
      .sort((a, b) => {
        const byTeam = rank[a.team] - rank[b.team]
        if (byTeam !== 0) return byTeam
        return toInt(b.row["CAPTURES-CURRENT"]) - toInt(a.row["CAPTURES-CURRENT"])
      })
  }, [summary])

  function reset() {
    setSummary(null)
    setError(null)
    setMissingColumns([])
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    reset()
    const file = event.target.files?.[0]
    if (!file) return

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const fields = results.meta.fields ?? []

          // B. Validate required columns.
          const missing = REQUIRED_COLUMNS.filter((col) => !fields.includes(col))
          if (missing.length > 0) {
            setMissingColumns(missing)
            return
          }

          const allRows = results.data.filter(
            (row) => row && Object.keys(row).length > 0,
          )
          if (allRows.length === 0) {
            setError("The CSV has no data rows. Try another file.")
            return
          }

          const warnings: string[] = []

          // C. Filter out spectator rows.
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

          // D. Timestamp from filename.
          const timestampIso = parseTimestampFromFilename(file.name)
          if (!timestampIso) {
            warnings.push("Could not parse timestamp from filename")
          }

          // E. Final score = sum of CAPTURES-CURRENT per team.
          let redCount = 0
          let blueCount = 0
          let redScore = 0
          let blueScore = 0
          for (const row of nonSpec) {
            const team = (row["LAST-NONSPEC-TEAM"] ?? "").trim()
            const captures = toInt(row["CAPTURES-CURRENT"])
            if (team === "Red") {
              redCount += 1
              redScore += captures
            } else if (team === "Blue") {
              blueCount += 1
              blueScore += captures
            }
          }

          // F. Low-row-count warning.
          if (nonSpec.length < 12) {
            warnings.push(
              `Only ${nonSpec.length} non-spectator rows found — expected at least 12. Continuing anyway.`,
            )
          }

          setSummary({
            filename: file.name,
            timestampIso,
            rows: nonSpec,
            redCount,
            blueCount,
            redScore,
            blueScore,
            warnings,
          })
        } catch {
          setError("Something went wrong while reading the CSV. Try another file.")
        }
      },
      error: () => {
        // G. Hard parse failure.
        setError("Failed to parse the CSV file. It may be malformed or empty. Try another file.")
      },
    })
  }

  function scoreLine(s: ParseSummary): string {
    const winner =
      s.redScore > s.blueScore
        ? "Red wins"
        : s.blueScore > s.redScore
          ? "Blue wins"
          : "Tie"
    return `Red ${s.redScore} - Blue ${s.blueScore}, ${winner}`
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[var(--color-surface)]/95 backdrop-blur-md border-[#66fcf1]/30 text-white max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl" style={{ color: "var(--color-primary)" }}>
            Upload Match Stats CSV
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable content area — the modal frame itself never overflows the viewport. */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          <input
            type="file"
            accept=".csv"
            onChange={handleFileChange}
            className="block w-full text-sm text-[#c5c6c7] file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-[#66fcf1]/40 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-[#66fcf1] hover:file:bg-[#66fcf1]/10"
          />

          {/* Missing required columns */}
          {missingColumns.length > 0 && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm">
              <p className="font-medium text-red-300">
                Missing required column{missingColumns.length === 1 ? "" : "s"}:
              </p>
              <ul className="mt-1 list-inside list-disc text-red-200">
                {missingColumns.map((col) => (
                  <li key={col} className="font-mono text-xs">
                    {col}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Hard parse error */}
          {error && (
            <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
              {error}
            </div>
          )}

          {/* Summary + review table */}
          {summary && (
            <div className="space-y-3">
              {summary.warnings.length > 0 && (
                <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
                  <ul className="list-inside list-disc space-y-1">
                    {summary.warnings.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Match summary panel */}
              <div className="rounded-lg border border-[#66fcf1]/20 bg-black/30 p-4">
                <h3
                  className="font-mono text-sm font-bold uppercase tracking-wide mb-3"
                  style={{ color: "var(--color-primary)" }}
                >
                  Match Summary
                </h3>
                <dl className="space-y-1.5 text-sm">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#8892a0]">Filename</dt>
                    <dd className="min-w-0 break-all text-right font-mono text-xs">
                      {summary.filename}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#8892a0]">Timestamp</dt>
                    <dd className="text-right font-mono text-xs">
                      {summary.timestampIso ?? "Could not parse"}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#8892a0]">Non-spec rows</dt>
                    <dd className="text-right">{summary.rows.length}</dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#8892a0]">Rows by team</dt>
                    <dd className="text-right">
                      Red: {summary.redCount}, Blue: {summary.blueCount}
                    </dd>
                  </div>
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="shrink-0 text-[#8892a0]">Final score</dt>
                    <dd className="text-right font-medium">{scoreLine(summary)}</dd>
                  </div>
                </dl>
              </div>

              {/* Review table */}
              <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-[var(--color-surface)] text-xs text-[#8892a0]">
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="px-3 py-2 font-medium">In-game Name</th>
                      <th className="px-3 py-2 font-medium">Team</th>
                      <th className="px-3 py-2 font-medium">Soracle Player</th>
                      <th className="px-3 py-2 text-right font-medium">Caps</th>
                      <th className="px-3 py-2 text-right font-medium">Returns</th>
                      <th className="px-3 py-2 text-right font-medium">Kills</th>
                      <th className="px-3 py-2 text-right font-medium">Deaths</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sortedRows.map(({ row, team }, i) => {
                      const teamChanged = i > 0 && sortedRows[i - 1].team !== team
                      const muted = team === "Other"
                      return (
                        <tr
                          key={i}
                          className={cn(
                            "border-t border-[var(--color-border)]/40",
                            teamChanged && "border-t-2 border-t-[#66fcf1]/25",
                            muted && "text-[#6b7280]",
                          )}
                        >
                          <td className="px-3 py-1.5 font-medium">{row["NAME-CLEAN"]}</td>
                          <td className="px-3 py-1.5">
                            {team === "Red" && (
                              <Badge
                                variant="outline"
                                className="border-red-500/40 bg-red-500/15 text-red-300"
                              >
                                Red
                              </Badge>
                            )}
                            {team === "Blue" && (
                              <Badge
                                variant="outline"
                                className="border-blue-500/40 bg-blue-500/15 text-blue-300"
                              >
                                Blue
                              </Badge>
                            )}
                            {team === "Other" && <span className="text-[#6b7280]">—</span>}
                          </td>
                          <td className="px-3 py-1.5 text-xs text-[#6b7280]">—</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {row["CAPTURES-CURRENT"]}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {row["RETURNS-CURRENT"]}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{row["KILLS"]}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{row["DEATHS"]}</td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {!summary && missingColumns.length === 0 && !error && (
            <p className="text-xs text-[#8892a0]">
              Select a stats CSV to parse and validate it. Saving and player mapping arrive in a
              later phase.
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0">
          <Button
            type="button"
            variant="outline"
            onClick={() => handleClose(false)}
            className="border-[var(--color-border)] bg-transparent text-white hover:bg-[var(--color-border)]"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
