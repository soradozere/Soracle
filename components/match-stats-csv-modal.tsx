"use client"

import { useEffect, useMemo, useState } from "react"
import Papa from "papaparse"
import Fuse from "fuse.js"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import type { Player } from "@/lib/types"

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

// Numeric counter columns summed when merging reconnect rows — every required
// column except the two identity columns (team + name).
const SUMMABLE_COLUMNS = REQUIRED_COLUMNS.filter(
  (col) => col !== "LAST-NONSPEC-TEAM" && col !== "NAME-CLEAN",
)

// Fuzzy-matching tuning. Lower fuse score = better match.
// THRESHOLD controls which matches fuse returns at all; CONFIDENCE_THRESHOLD
// controls which of those are good enough to auto-prefill the dropdown.
const FUZZY_THRESHOLD = 0.4
const FUZZY_CONFIDENCE_THRESHOLD = 0.3

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

// A row as rendered in the review table: either an original parsed row or a
// virtual row produced by merging several reconnect rows of the same player.
type DisplayRow =
  | { kind: "single"; rowIndex: number; data: CsvRow; team: TeamClass }
  | {
      kind: "merged"
      mergeIndex: number
      originalRowIndices: number[]
      data: CsvRow
      team: TeamClass
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

// Combine several rows of the same player into one virtual row: sum the numeric
// counters, keep the first row's identity (name + team).
function mergeRowData(rows: CsvRow[]): CsvRow {
  const merged: CsvRow = { ...rows[0] }
  for (const col of SUMMABLE_COLUMNS) {
    merged[col] = String(rows.reduce((sum, r) => sum + toInt(r[col]), 0))
  }
  return merged
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

// Searchable player dropdown (Popover + Command combobox). Manages its own
// open state so each row's dropdown is independent.
function PlayerCombobox({
  players,
  value,
  onChange,
}: {
  players: Player[]
  value: string | null
  onChange: (id: string | null) => void
}) {
  const [open, setOpen] = useState(false)
  const selected = players.find((p) => p.id === value) ?? null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className={cn(
            "flex w-full items-center justify-between gap-1 rounded-md border border-[var(--color-border)] bg-transparent px-2 py-1 text-left text-xs hover:border-[#66fcf1]/40",
            selected ? "text-white" : "text-[#6b7280]",
          )}
        >
          <span className="truncate">{selected ? selected.name : "Select…"}</span>
          <ChevronsUpDown className="h-3 w-3 shrink-0 opacity-50" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-56 p-0 bg-[var(--color-surface)] border-[#66fcf1]/30"
      >
        <Command className="bg-transparent">
          <CommandInput placeholder="Search players…" className="text-sm" />
          <CommandList>
            <CommandEmpty>No players found.</CommandEmpty>
            <CommandGroup>
              {value && (
                <CommandItem
                  value="__clear__"
                  onSelect={() => {
                    onChange(null)
                    setOpen(false)
                  }}
                  className="text-[#8892a0]"
                >
                  <span className="mr-2 inline-block h-3 w-3" />
                  Clear selection
                </CommandItem>
              )}
              {players.map((p) => (
                <CommandItem
                  key={p.id}
                  value={p.name}
                  onSelect={() => {
                    onChange(p.id)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn("mr-2 h-3 w-3", value === p.id ? "opacity-100" : "opacity-0")}
                  />
                  {p.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function MatchStatsCsvModal({ open, onOpenChange }: MatchStatsCsvModalProps) {
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missingColumns, setMissingColumns] = useState<string[]>([])

  // Soracle players, fetched once and cached for the session.
  const [players, setPlayers] = useState<Player[]>([])
  const [playersLoading, setPlayersLoading] = useState(false)
  const [playersLoaded, setPlayersLoaded] = useState(false)

  // Mapping state: sorted-row index -> selected player id (or null if unmapped).
  const [rowToPlayerId, setRowToPlayerId] = useState<Record<number, string | null>>({})
  // Sorted-row index -> player id that was auto-prefilled with high confidence.
  const [autoMatched, setAutoMatched] = useState<Record<number, string>>({})
  // Sorted-row index -> merge/sub flag (null if unflagged). Same key as rowToPlayerId.
  const [rowFlags, setRowFlags] = useState<Record<number, "merge" | "sub" | null>>({})
  // Completed merges: each combines its constituent sorted-row indices into one
  // summed virtual row. Resets with the rest of the parse state.
  const [mergedRows, setMergedRows] = useState<
    Array<{ originalRowIndices: number[]; mergedData: CsvRow }>
  >([])
  const [mergeError, setMergeError] = useState<string | null>(null)

  // Fetch players the first time the modal opens; cache for the session.
  useEffect(() => {
    if (!open || playersLoaded || playersLoading) return
    setPlayersLoading(true)
    fetchPlayersFromDB()
      .then((p) => {
        setPlayers(p)
        setPlayersLoaded(true)
      })
      .finally(() => setPlayersLoading(false))
  }, [open, playersLoaded, playersLoading])

  // Players sorted alphabetically for the dropdown list.
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  )

  // Single fuse instance, rebuilt only when the player list changes.
  const fuse = useMemo(
    () =>
      new Fuse(players, {
        keys: ["name"],
        threshold: FUZZY_THRESHOLD,
        includeScore: true,
        shouldSort: true,
        minMatchCharLength: 2,
      }),
    [players],
  )

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

  // Run fuzzy matching once per file selection (and once when players first load).
  // Deps are stable per (summary, players), so this never clobbers manual edits.
  useEffect(() => {
    if (!summary || players.length === 0) return
    const mapping: Record<number, string | null> = {}
    const auto: Record<number, string> = {}
    sortedRows.forEach(({ row }, i) => {
      const name = (row["NAME-CLEAN"] ?? "").trim()
      const best = name ? fuse.search(name)[0] : undefined
      if (best && best.score !== undefined && best.score <= FUZZY_CONFIDENCE_THRESHOLD) {
        mapping[i] = best.item.id
        auto[i] = best.item.id
      } else {
        mapping[i] = null
      }
    })
    setRowToPlayerId(mapping)
    setAutoMatched(auto)
  }, [summary, players, fuse, sortedRows])

  // Rows as shown in the table: merged rows replace their constituents in place,
  // everything else passes through in sorted order.
  const displayRows = useMemo<DisplayRow[]>(() => {
    const constituentToMerge = new Map<number, number>()
    mergedRows.forEach((m, mi) => {
      m.originalRowIndices.forEach((idx) => constituentToMerge.set(idx, mi))
    })
    const out: DisplayRow[] = []
    const placed = new Set<number>()
    sortedRows.forEach(({ row, team }, i) => {
      const mi = constituentToMerge.get(i)
      if (mi === undefined) {
        out.push({ kind: "single", rowIndex: i, data: row, team })
      } else if (!placed.has(mi)) {
        placed.add(mi)
        const m = mergedRows[mi]
        out.push({
          kind: "merged",
          mergeIndex: mi,
          originalRowIndices: m.originalRowIndices,
          data: m.mergedData,
          team: classifyTeam(m.mergedData),
        })
      }
    })
    return out
  }, [sortedRows, mergedRows])

  function handleMerge() {
    const flagged = displayRows.filter(
      (d): d is Extract<DisplayRow, { kind: "single" }> =>
        d.kind === "single" && rowFlags[d.rowIndex] === "merge",
    )
    if (flagged.length < 2) return

    const unmapped = flagged.filter((d) => !rowToPlayerId[d.rowIndex])
    if (unmapped.length > 0) {
      const positions = unmapped
        .map((d) => displayRows.indexOf(d) + 1)
        .sort((a, b) => a - b)
      setMergeError(
        `Merge requires all selected rows to be mapped to the same Soracle player. Please map row(s) [${positions.join(", ")}] first.`,
      )
      return
    }

    if (new Set(flagged.map((d) => rowToPlayerId[d.rowIndex])).size > 1) {
      setMergeError("Merge requires all selected rows to be mapped to the same Soracle player.")
      return
    }

    if (new Set(flagged.map((d) => d.team)).size > 1) {
      setMergeError("Merge requires all selected rows to be on the same team.")
      return
    }

    const indices = flagged.map((d) => d.rowIndex)
    const mergedData = mergeRowData(flagged.map((d) => d.data))
    setMergedRows((prev) => [...prev, { originalRowIndices: indices, mergedData }])
    setRowFlags((prev) => {
      const next = { ...prev }
      indices.forEach((idx) => {
        next[idx] = null
      })
      return next
    })
    setMergeError(null)
  }

  function handleUnmerge(mergeIndex: number) {
    const target = mergedRows[mergeIndex]
    setMergedRows((prev) => prev.filter((_, i) => i !== mergeIndex))
    setRowFlags((prev) => {
      const next = { ...prev }
      target?.originalRowIndices.forEach((idx) => {
        next[idx] = null
      })
      return next
    })
    setMergeError(null)
  }

  function reset() {
    setSummary(null)
    setError(null)
    setMissingColumns([])
    setRowToPlayerId({})
    setAutoMatched({})
    setRowFlags({})
    setMergedRows([])
    setMergeError(null)
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

  const totalRows = displayRows.length
  const mappedCount = displayRows.reduce((acc, d) => {
    const id =
      d.kind === "merged"
        ? rowToPlayerId[d.originalRowIndices[0]]
        : rowToPlayerId[d.rowIndex]
    return acc + (id ? 1 : 0)
  }, 0)
  const allMapped = totalRows > 0 && mappedCount === totalRows

  const mergeCount = displayRows.reduce(
    (acc, d) => acc + (d.kind === "single" && rowFlags[d.rowIndex] === "merge" ? 1 : 0),
    0,
  )
  const subCount = displayRows.reduce(
    (acc, d) => acc + (d.kind === "single" && rowFlags[d.rowIndex] === "sub" ? 1 : 0),
    0,
  )

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[var(--color-surface)]/95 backdrop-blur-md border-[#66fcf1]/30 text-white max-w-5xl max-h-[85vh] flex flex-col">
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

          {playersLoading && (
            <p className="flex items-center gap-2 text-xs text-[#8892a0]">
              <Loader2 className="h-3 w-3 animate-spin" />
              Loading players…
            </p>
          )}

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

              {/* Flag action bar — only when at least one row is flagged */}
              {(mergeCount > 0 || subCount > 0) && (
                <div className="flex flex-wrap items-center gap-2 rounded-md border border-[#66fcf1]/40 bg-[#66fcf1]/5 px-3 py-2">
                  {mergeCount > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={mergeCount < 2}
                      onClick={handleMerge}
                      className="h-7 border-[#66fcf1]/50 bg-transparent px-3 text-xs font-medium text-[#66fcf1] hover:bg-[#66fcf1]/10 disabled:opacity-40"
                    >
                      Merge Selected ({mergeCount})
                    </Button>
                  )}
                  {subCount > 0 && (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={subCount < 2}
                      onClick={() => console.log("sub clicked")}
                      className="h-7 border-[#66fcf1]/50 bg-transparent px-3 text-xs font-medium text-[#66fcf1] hover:bg-[#66fcf1]/10 disabled:opacity-40"
                    >
                      Configure Substitution ({subCount})
                    </Button>
                  )}
                </div>
              )}

              {/* Merge validation error */}
              {mergeError && (
                <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                  {mergeError}
                </div>
              )}

              {/* Review table */}
              <div className="rounded-lg border border-[var(--color-border)] overflow-hidden">
                <table className="w-full border-collapse text-left text-sm">
                  <thead className="sticky top-0 z-10 bg-[var(--color-surface)] text-xs text-[#8892a0]">
                    <tr className="border-b border-[var(--color-border)]">
                      <th className="px-3 py-2 font-medium">In-game Name</th>
                      <th className="px-3 py-2 font-medium">Team</th>
                      <th className="px-3 py-2 font-medium">Soracle Player</th>
                      <th className="px-2 py-2 text-center font-medium">Merge / Sub</th>
                      <th className="px-3 py-2 text-right font-medium">Caps</th>
                      <th className="px-3 py-2 text-right font-medium">Returns</th>
                      <th className="px-3 py-2 text-right font-medium">Kills</th>
                      <th className="px-3 py-2 text-right font-medium">Deaths</th>
                    </tr>
                  </thead>
                  <tbody>
                    {displayRows.map((d, idx) => {
                      const prev = idx > 0 ? displayRows[idx - 1] : null
                      const teamChanged = prev !== null && prev.team !== d.team
                      const team = d.team
                      const row = d.data
                      const muted = team === "Other"
                      const isMerged = d.kind === "merged"
                      const playerValue =
                        d.kind === "merged"
                          ? rowToPlayerId[d.originalRowIndices[0]] ?? null
                          : rowToPlayerId[d.rowIndex] ?? null
                      // Green indicator: un-merged single row still showing its auto-match.
                      const isAutoMatched =
                        d.kind === "single" &&
                        autoMatched[d.rowIndex] !== undefined &&
                        rowToPlayerId[d.rowIndex] === autoMatched[d.rowIndex]
                      return (
                        <tr
                          key={d.kind === "merged" ? `m-${d.mergeIndex}` : `s-${d.rowIndex}`}
                          className={cn(
                            "border-t border-[var(--color-border)]/40",
                            teamChanged && "border-t-2 border-t-[#66fcf1]/25",
                            muted && "text-[#6b7280]",
                            isAutoMatched && "border-l-2 border-l-green-500/70 bg-green-500/5",
                            isMerged && "border-l-2 border-l-[#66fcf1] bg-[#66fcf1]/5",
                          )}
                        >
                          <td className="px-3 py-1.5 font-medium">
                            <div className="flex items-center gap-2">
                              <span>{row["NAME-CLEAN"]}</span>
                              {d.kind === "merged" && (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-[#66fcf1]/50 bg-[#66fcf1]/10 px-1.5 py-0 text-[10px] text-[#66fcf1]"
                                >
                                  Merged ({d.originalRowIndices.length})
                                </Badge>
                              )}
                            </div>
                          </td>
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
                          <td className="px-3 py-1.5">
                            <PlayerCombobox
                              players={sortedPlayers}
                              value={playerValue}
                              onChange={(id) =>
                                setRowToPlayerId((prev) => {
                                  if (d.kind === "merged") {
                                    const next = { ...prev }
                                    d.originalRowIndices.forEach((oi) => {
                                      next[oi] = id
                                    })
                                    return next
                                  }
                                  return { ...prev, [d.rowIndex]: id }
                                })
                              }
                            />
                          </td>
                          <td className="px-2 py-1.5">
                            {d.kind === "merged" ? (
                              <div className="flex items-center justify-center">
                                <button
                                  type="button"
                                  onClick={() => handleUnmerge(d.mergeIndex)}
                                  className="text-[11px] font-medium text-[#8892a0] underline-offset-2 hover:text-[#66fcf1] hover:underline"
                                >
                                  Unmerge
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center justify-center gap-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <label className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#8892a0]">
                                      <Checkbox
                                        checked={rowFlags[d.rowIndex] === "merge"}
                                        onCheckedChange={(c) =>
                                          setRowFlags((prev) => ({
                                            ...prev,
                                            [d.rowIndex]: c ? "merge" : null,
                                          }))
                                        }
                                        className="size-3.5 border-[#66fcf1]/40 data-[state=checked]:border-[#66fcf1] data-[state=checked]:bg-[#66fcf1] data-[state=checked]:text-black"
                                      />
                                      M
                                    </label>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[220px] bg-[var(--color-surface)] text-white">
                                    Flag this row as a reconnect of another row (Merge with another
                                    row of the same player)
                                  </TooltipContent>
                                </Tooltip>
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <label className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#8892a0]">
                                      <Checkbox
                                        checked={rowFlags[d.rowIndex] === "sub"}
                                        onCheckedChange={(c) =>
                                          setRowFlags((prev) => ({
                                            ...prev,
                                            [d.rowIndex]: c ? "sub" : null,
                                          }))
                                        }
                                        className="size-3.5 border-[#66fcf1]/40 data-[state=checked]:border-[#66fcf1] data-[state=checked]:bg-[#66fcf1] data-[state=checked]:text-black"
                                      />
                                      S
                                    </label>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[220px] bg-[var(--color-surface)] text-white">
                                    Flag this row as part of a substitution (Sub in or out)
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            )}
                          </td>
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

              {/* Mapping progress */}
              <p
                className={cn(
                  "text-sm font-medium",
                  allMapped ? "text-green-400" : "text-[#8892a0]",
                )}
              >
                {mappedCount} of {totalRows} players mapped
              </p>
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
