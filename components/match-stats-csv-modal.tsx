"use client"

import { useEffect, useMemo, useState } from "react"
import Papa from "papaparse"
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
import { fetchAliasesFromDB, fetchPlayersFromDB } from "@/lib/fetch-players-db"
import {
  buildMatchStat,
  classifyTeam,
  mergeRowData,
  parseScoreboardCsvText,
  summarizeParsedRows,
  toInt,
  type CsvRow,
  type ParseSummary,
  type TeamClass,
} from "@/lib/scoreboard-csv"
import { createNameResolver, type PlayerAlias } from "@/lib/name-match"
import type { CsvMatchData, MatchStatInsert, Player } from "@/lib/types"

interface MatchStatsCsvModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCsvDataReady: (data: CsvMatchData) => void
  // Pending-review mode: when a CSV is supplied directly (from an approval-bin
  // entry), the file picker is hidden, the CSV is parsed on open, and the footer
  // gains a Manual/Algorithm toggle + an "Approve & Log" action. Absent for the
  // normal manual-upload flow.
  pendingCsvText?: string
  pendingCsvFilename?: string
  // Log mode: admin uploads a CSV (picker shown) and logs the match directly,
  // with the same Manual/Algorithm toggle. The consumer's onCsvDataReady should
  // call logMatchWithStats. Distinct from the default "prefill a form" flow.
  logMode?: boolean
}

type SubResolution = "keep-both" | "keep-starter" | "keep-finisher"

// A row as rendered in the review table: an original parsed row (optionally a
// kept member of a resolved substitution), or a virtual row produced by merging
// several reconnect rows of the same player.
type DisplayRow =
  | {
      kind: "single"
      rowIndex: number
      data: CsvRow
      team: TeamClass
      partial: boolean
      subResolutionIndex: number | null
    }
  | {
      kind: "merged"
      mergeIndex: number
      originalRowIndices: number[]
      data: CsvRow
      team: TeamClass
      // Merged rows can also be substituted — a player reconnects (merge), then
      // gets subbed out. So they carry the same substitution state as a single.
      partial: boolean
      subResolutionIndex: number | null
    }

// A display row's stable identity for row flags and player mapping. A merged row
// is keyed by its first constituent, whose index no longer renders on its own —
// which is also the key rowToPlayerId already uses for merged rows.
const flagKeyOf = (d: DisplayRow) => (d.kind === "merged" ? d.originalRowIndices[0] : d.rowIndex)

// The parsed-CSV rows a display row stands for (a merged row stands for several).
const indicesOf = (d: DisplayRow) => (d.kind === "merged" ? d.originalRowIndices : [d.rowIndex])

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

// Render an in-game name, with a clear placeholder for the legal-but-blank JK2
// name so the row is obviously present (and still needs mapping).
function inGameNameNode(raw: string | undefined) {
  const name = (raw ?? "").trim()
  return name !== "" ? name : <span className="italic text-[#6b7280]">(no name)</span>
}

export function MatchStatsCsvModal({
  open,
  onOpenChange,
  onCsvDataReady,
  pendingCsvText,
  pendingCsvFilename,
  logMode = false,
}: MatchStatsCsvModalProps) {
  const isPendingMode = pendingCsvText !== undefined
  // Both pending review and log mode record the Manual/Algorithm pick and "log on
  // confirm"; only pending hides the file picker.
  const showMatchType = isPendingMode || logMode

  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missingColumns, setMissingColumns] = useState<string[]>([])
  // Manual vs algorithm pick — only used (and shown) in pending-review mode.
  const [matchType, setMatchType] = useState<"manual" | "algorithm">("manual")

  // Soracle players + known aliases, fetched once and cached for the session.
  const [players, setPlayers] = useState<Player[]>([])
  const [aliases, setAliases] = useState<PlayerAlias[]>([])
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
  // Resolved substitutions: each records its group's display rows (by flag key),
  // the chosen resolution, which display rows were dropped, and the underlying
  // CSV rows those dropped entries cover (a dropped merged row takes all of its
  // stints with it). Resets with the parse state.
  const [substitutionResolutions, setSubstitutionResolutions] = useState<
    Array<{
      groupKeys: number[]
      resolution: SubResolution
      droppedKeys: number[]
      droppedRowIndices: number[]
    }>
  >([])
  const [showSubPanel, setShowSubPanel] = useState(false)
  const [subChoices, setSubChoices] = useState<Record<string, SubResolution>>({})
  const [subErrors, setSubErrors] = useState<Record<string, string | null>>({})

  // Fetch players + aliases the first time the modal opens; cache for the session.
  useEffect(() => {
    if (!open || playersLoaded || playersLoading) return
    setPlayersLoading(true)
    Promise.all([fetchPlayersFromDB(), fetchAliasesFromDB()])
      .then(([p, a]) => {
        setPlayers(p)
        setAliases(a)
        setPlayersLoaded(true)
      })
      .finally(() => setPlayersLoading(false))
  }, [open, playersLoaded, playersLoading])

  // Players sorted alphabetically for the dropdown list.
  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  )

  // Single alias-aware name resolver, rebuilt only when the roster/aliases change.
  // Both flows benefit: any learned aliases resolve here too, so re-reviewing a
  // pending game picks up names taught by earlier approvals.
  const resolver = useMemo(() => createNameResolver(players, aliases), [players, aliases])

  // Sort rows: Red first, then Blue, then unexpected teams — Caps descending within each group.
  const sortedRows = useMemo(() => {
    if (!summary) return []
    const rank: Record<TeamClass, number> = { Red: 0, Blue: 1, Other: 2 }
    return summary.rows
      .map((row) => ({ row, team: classifyTeam(row) }))
      .sort((a, b) => {
        const byTeam = rank[a.team] - rank[b.team]
        if (byTeam !== 0) return byTeam
        return toInt(b.row["CAPTURES-SUM"]) - toInt(a.row["CAPTURES-SUM"])
      })
  }, [summary])

  // Auto-match once per file selection (and once when players first load). Deps
  // are stable per (summary, players), so this never clobbers manual edits.
  useEffect(() => {
    if (!summary || players.length === 0) return
    const mapping: Record<number, string | null> = {}
    const auto: Record<number, string> = {}
    sortedRows.forEach(({ row }, i) => {
      const match = resolver.resolve(row["NAME-CLEAN"] ?? "")
      if (match) {
        mapping[i] = match.playerId
        auto[i] = match.playerId
      } else {
        mapping[i] = null
      }
    })
    setRowToPlayerId(mapping)
    setAutoMatched(auto)
  }, [summary, players, resolver, sortedRows])

  // Rows as shown in the table: merged rows replace their constituents in place,
  // substitution-dropped rows are removed, and kept "keep-both" rows are flagged
  // partial. Everything else passes through in sorted order.
  const displayRows = useMemo<DisplayRow[]>(() => {
    const constituentToMerge = new Map<number, number>()
    mergedRows.forEach((m, mi) => {
      m.originalRowIndices.forEach((idx) => constituentToMerge.set(idx, mi))
    })
    const dropped = new Set<number>() // underlying CSV row indices
    const partialKeys = new Set<number>() // flag keys kept as partial play
    const keptToResolution = new Map<number, number>() // flag key -> resolution index
    substitutionResolutions.forEach((r, ri) => {
      r.droppedRowIndices.forEach((idx) => dropped.add(idx))
      r.groupKeys.forEach((key) => {
        if (r.droppedKeys.includes(key)) return
        keptToResolution.set(key, ri)
        if (r.resolution === "keep-both") partialKeys.add(key)
      })
    })
    const out: DisplayRow[] = []
    const placed = new Set<number>()
    sortedRows.forEach(({ row, team }, i) => {
      const mi = constituentToMerge.get(i)
      if (mi !== undefined) {
        if (placed.has(mi)) return
        placed.add(mi)
        const m = mergedRows[mi]
        // A merged row dropped by a substitution takes all of its stints with it.
        if (m.originalRowIndices.some((idx) => dropped.has(idx))) return
        const key = m.originalRowIndices[0]
        out.push({
          kind: "merged",
          mergeIndex: mi,
          originalRowIndices: m.originalRowIndices,
          data: m.mergedData,
          team: classifyTeam(m.mergedData),
          partial: partialKeys.has(key),
          subResolutionIndex: keptToResolution.get(key) ?? null,
        })
        return
      }
      if (dropped.has(i)) return
      out.push({
        kind: "single",
        rowIndex: i,
        data: row,
        team,
        partial: partialKeys.has(i),
        subResolutionIndex: keptToResolution.get(i) ?? null,
      })
    })
    return out
  }, [sortedRows, mergedRows, substitutionResolutions])

  // Pending substitution groups: sub-flagged rows grouped by team. Merged rows are
  // eligible too — a player can reconnect (merge) and then be subbed out. Rows in
  // an already-resolved substitution are excluded. Derived live from rowFlags so
  // un-ticking an S re-groups immediately.
  const pendingSubGroups = useMemo(() => {
    const byTeam = new Map<TeamClass, DisplayRow[]>()
    displayRows.forEach((d) => {
      if (d.subResolutionIndex !== null) return
      if (rowFlags[flagKeyOf(d)] !== "sub") return
      const arr = byTeam.get(d.team) ?? []
      arr.push(d)
      byTeam.set(d.team, arr)
    })
    return Array.from(byTeam.entries()).map(([team, rows]) => ({ team, rows }))
  }, [displayRows, rowFlags])

  const playerName = (id: string) => players.find((p) => p.id === id)?.name ?? id

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

  function handleApplySubstitution(
    group: { team: TeamClass; rows: DisplayRow[] },
    resolution: SubResolution,
  ) {
    const { team, rows } = group

    if (rows.length < 2) return

    // A merged row is a valid group member (reconnect, then subbed out), so its
    // player mapping is read through its flag key like any other row.
    if (rows.some((d) => !rowToPlayerId[flagKeyOf(d)])) {
      setSubErrors((p) => ({
        ...p,
        [team]: "All rows in the group must be mapped to a Soracle player first.",
      }))
      return
    }

    if (new Set(rows.map((d) => rowToPlayerId[flagKeyOf(d)])).size !== rows.length) {
      setSubErrors((p) => ({
        ...p,
        [team]:
          "Substitution rows must map to different players. Use Merge for reconnects of the same player.",
      }))
      return
    }

    // Starter/finisher only make sense for exactly two rows; otherwise force keep-both.
    let effective = resolution
    if (effective !== "keep-both" && rows.length !== 2) effective = "keep-both"

    let droppedRows: DisplayRow[] = []
    if (effective === "keep-starter" || effective === "keep-finisher") {
      const [a, b] = rows
      // A merged row's TIME-SUM is already the sum of its stints (mergeRowData).
      const ta = toInt(a.data["TIME-SUM"])
      const tb = toInt(b.data["TIME-SUM"])
      // Starter = more time played; finisher = less time played.
      droppedRows = effective === "keep-starter" ? [ta >= tb ? b : a] : [ta >= tb ? a : b]
    }

    setSubstitutionResolutions((prev) => [
      ...prev,
      {
        groupKeys: rows.map(flagKeyOf),
        resolution: effective,
        droppedKeys: droppedRows.map(flagKeyOf),
        droppedRowIndices: droppedRows.flatMap(indicesOf),
      },
    ])
    setRowFlags((prev) => {
      const next = { ...prev }
      rows.forEach((d) => {
        next[flagKeyOf(d)] = null
      })
      return next
    })
    setSubErrors((p) => ({ ...p, [team]: null }))
  }

  function handleUndoSubstitution(resolutionIndex: number) {
    setSubstitutionResolutions((prev) => prev.filter((_, i) => i !== resolutionIndex))
    setSubErrors({})
  }

  function reset() {
    setSummary(null)
    setCsvFile(null)
    setError(null)
    setMissingColumns([])
    setMatchType("manual")
    setRowToPlayerId({})
    setAutoMatched({})
    setRowFlags({})
    setMergedRows([])
    setMergeError(null)
    setSubstitutionResolutions([])
    setShowSubPanel(false)
    setSubChoices({})
    setSubErrors({})
  }

  function handleClose(nextOpen: boolean) {
    if (!nextOpen) reset()
    onOpenChange(nextOpen)
  }

  // Pending-review mode: parse the supplied CSV text on open (no file picker).
  // Re-runs if a different pending entry is opened. The synthesized File rides
  // along in csvData so approval can store it exactly like a manual upload.
  useEffect(() => {
    if (!open || pendingCsvText === undefined) return
    reset()
    const filename = pendingCsvFilename || "scoreboard.csv"
    setCsvFile(new File([pendingCsvText], filename, { type: "text/csv" }))
    try {
      const result = parseScoreboardCsvText(pendingCsvText, filename)
      if (!result.ok) {
        if (result.missingColumns.length > 0) setMissingColumns(result.missingColumns)
        if (result.error) setError(result.error)
        return
      }
      setSummary(result.summary)
    } catch {
      setError("Something went wrong while reading the CSV.")
    }
    // reset is stable enough for this purpose; re-run only on open/text change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pendingCsvText, pendingCsvFilename])

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    reset()
    const file = event.target.files?.[0]
    if (!file) return
    setCsvFile(file)

    Papa.parse<CsvRow>(file, {
      header: true,
      skipEmptyLines: true,
      complete: (results) => {
        try {
          const result = summarizeParsedRows(
            results.data,
            results.meta.fields ?? [],
            file.name,
          )
          if (!result.ok) {
            if (result.missingColumns.length > 0) setMissingColumns(result.missingColumns)
            if (result.error) setError(result.error)
            return
          }
          setSummary(result.summary)
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
  const mappedCount = displayRows.reduce(
    (acc, d) => acc + (rowToPlayerId[flagKeyOf(d)] ? 1 : 0),
    0,
  )
  const allMapped = totalRows > 0 && mappedCount === totalRows

  // Only unmerged rows can be merged; any row (single or merged) can be subbed.
  const mergeCount = displayRows.reduce(
    (acc, d) => acc + (d.kind === "single" && rowFlags[d.rowIndex] === "merge" ? 1 : 0),
    0,
  )
  const subCount = displayRows.reduce(
    (acc, d) => acc + (rowFlags[flagKeyOf(d)] === "sub" ? 1 : 0),
    0,
  )

  // Any remaining "Other"-team row blocks confirm: match_stats.team is Red/Blue only.
  const hasOtherTeam = displayRows.some((d) => d.team === "Other")
  // Dangling merge/sub flags must be applied or cleared before handing off.
  const hasPendingFlags = mergeCount > 0 || subCount > 0
  const canConfirm =
    csvFile !== null && summary !== null && allMapped && !hasOtherTeam && !hasPendingFlags

  // Assemble the handoff payload from the final display rows (post merge/sub).
  // Scores and rosters are recomputed here so they reflect the resolved rows.
  function buildCsvData(): CsvMatchData | null {
    if (!summary || !csvFile) return null
    const redTeamNames: string[] = []
    const blueTeamNames: string[] = []
    let redScore = 0
    let blueScore = 0
    const matchStats: MatchStatInsert[] = []

    for (const d of displayRows) {
      if (d.team !== "Red" && d.team !== "Blue") return null
      const playerId = rowToPlayerId[flagKeyOf(d)]
      if (!playerId) return null
      // A merged row can also be a kept "partial play" half of a substitution.
      const partial = d.partial
      const captures = toInt(d.data["CAPTURES-SUM"])
      if (d.team === "Red") {
        redTeamNames.push(playerName(playerId))
        redScore += captures
      } else {
        blueTeamNames.push(playerName(playerId))
        blueScore += captures
      }
      matchStats.push(buildMatchStat(d.data, playerId, d.team, partial))
    }

    return {
      redTeamNames,
      blueTeamNames,
      redScore,
      blueScore,
      matchPlayedAtIso: summary.timestampIso,
      matchStats,
      csvFile,
      ...(showMatchType ? { matchType } : {}),
    }
  }

  function handleConfirm() {
    const data = buildCsvData()
    if (!data) return
    onCsvDataReady(data)
    handleClose(false)
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[var(--color-surface)]/95 backdrop-blur-md border-[#66fcf1]/30 text-white sm:max-w-6xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl" style={{ color: "var(--color-primary)" }}>
            {isPendingMode ? "Review Pending Match" : logMode ? "Log a Match" : "Upload Match Stats CSV"}
          </DialogTitle>
        </DialogHeader>

        {/* Scrollable content area — the modal frame itself never overflows the viewport. */}
        <div className="flex-1 min-h-0 overflow-y-auto space-y-3 pr-1">
          {!isPendingMode && (
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-[#c5c6c7] file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-[#66fcf1]/40 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-[#66fcf1] hover:file:bg-[#66fcf1]/10"
            />
          )}

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
                      onClick={() => {
                        setSubErrors({})
                        setShowSubPanel(true)
                      }}
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

              {/* Substitution configuration panel */}
              {showSubPanel && pendingSubGroups.length > 0 && (
                <div className="space-y-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-amber-200">Configure Substitutions</p>
                    <button
                      type="button"
                      onClick={() => setShowSubPanel(false)}
                      className="text-xs text-amber-200/70 hover:text-amber-100"
                    >
                      Close
                    </button>
                  </div>
                  {pendingSubGroups.map((group) => {
                    const team = group.team
                    const tooFew = group.rows.length < 2
                    const tooMany = group.rows.length > 2
                    const choice = tooMany ? "keep-both" : subChoices[team] ?? "keep-both"
                    const groupErr = subErrors[team]
                    const options: { value: SubResolution; label: string }[] = [
                      { value: "keep-both", label: "Keep both as partial play" },
                      { value: "keep-starter", label: "Keep starter only (more time played)" },
                      { value: "keep-finisher", label: "Keep finisher only (less time played)" },
                    ]
                    return (
                      <div
                        key={team}
                        className="rounded-md border border-amber-500/30 bg-black/20 p-3"
                      >
                        <p className="mb-2 font-medium text-amber-100">
                          {team} Substitution Group
                        </p>
                        <ul className="mb-2 space-y-1 text-xs text-[#c5c6c7]">
                          {group.rows.map((d) => {
                            const pid = rowToPlayerId[flagKeyOf(d)]
                            return (
                              <li
                                key={flagKeyOf(d)}
                                className="flex items-center justify-between gap-3"
                              >
                                <span className="min-w-0 truncate font-medium">
                                  {inGameNameNode(d.data["NAME-CLEAN"])}
                                  {d.kind === "merged" && (
                                    <span className="ml-1 text-[10px] text-[#66fcf1]">
                                      (merged {d.originalRowIndices.length})
                                    </span>
                                  )}
                                </span>
                                <span className="shrink-0 text-[#8892a0]">
                                  {pid ? (
                                    playerName(pid)
                                  ) : (
                                    <span className="text-red-300">Unmapped</span>
                                  )}
                                </span>
                                <span className="shrink-0 tabular-nums text-[#8892a0]">
                                  time: {d.data["TIME-SUM"]}
                                </span>
                              </li>
                            )
                          })}
                        </ul>
                        {tooFew ? (
                          <p className="text-xs text-amber-200/80">
                            A substitution group needs at least 2 rows on the same team.
                          </p>
                        ) : (
                          <>
                            <div className="space-y-1 text-xs">
                              {options.map((opt) => {
                                const disabled = tooMany && opt.value !== "keep-both"
                                return (
                                  <label
                                    key={opt.value}
                                    className={cn(
                                      "flex items-center gap-2",
                                      disabled ? "opacity-40" : "cursor-pointer",
                                    )}
                                  >
                                    <input
                                      type="radio"
                                      name={`sub-${team}`}
                                      checked={choice === opt.value}
                                      disabled={disabled}
                                      onChange={() =>
                                        setSubChoices((p) => ({ ...p, [team]: opt.value }))
                                      }
                                      className="accent-[#66fcf1]"
                                    />
                                    {opt.label}
                                  </label>
                                )
                              })}
                            </div>
                            {tooMany && (
                              <p className="mt-1 text-[11px] text-amber-200/70">
                                Starter/finisher only apply to a 2-row substitution; this group
                                has {group.rows.length}. Resolve two rows at a time.
                              </p>
                            )}
                            {groupErr && <p className="mt-1 text-xs text-red-300">{groupErr}</p>}
                            <div className="mt-2 flex gap-2">
                              <Button
                                type="button"
                                size="sm"
                                onClick={() => handleApplySubstitution(group, choice)}
                                className="h-6 bg-[#66fcf1] px-3 text-[11px] font-medium text-black hover:bg-[#66fcf1]/80"
                              >
                                Apply
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => setShowSubPanel(false)}
                                className="h-6 border-[#66fcf1]/40 bg-transparent px-3 text-[11px] text-[#66fcf1] hover:bg-[#66fcf1]/10"
                              >
                                Cancel
                              </Button>
                            </div>
                          </>
                        )}
                      </div>
                    )
                  })}
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
                      const isPendingSub = rowFlags[flagKeyOf(d)] === "sub"
                      const isPartial = d.partial
                      const playerValue = rowToPlayerId[flagKeyOf(d)] ?? null
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
                            (isPendingSub || isPartial) &&
                              "border-l-2 border-l-amber-500/70 bg-amber-500/5",
                          )}
                        >
                          <td className="px-3 py-1.5 font-medium">
                            <div className="flex items-center gap-2">
                              <span>{inGameNameNode(row["NAME-CLEAN"])}</span>
                              {d.kind === "merged" && (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-[#66fcf1]/50 bg-[#66fcf1]/10 px-1.5 py-0 text-[10px] text-[#66fcf1]"
                                >
                                  Merged ({d.originalRowIndices.length})
                                </Badge>
                              )}
                              {d.partial && (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-amber-500/50 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-300"
                                >
                                  Partial
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
                            {d.subResolutionIndex !== null ? (
                              // Resolved substitution: undo it first (a merged row in a
                              // substitution must leave the group before it can be unmerged).
                              <div className="flex items-center justify-center">
                                <button
                                  type="button"
                                  onClick={() => handleUndoSubstitution(d.subResolutionIndex!)}
                                  className="text-[11px] font-medium text-[#8892a0] underline-offset-2 hover:text-amber-300 hover:underline"
                                >
                                  Undo
                                </button>
                              </div>
                            ) : d.kind === "merged" ? (
                              // A merged player can still be subbed out (reconnect, then sub).
                              <div className="flex items-center justify-center gap-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <label className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#8892a0]">
                                      <Checkbox
                                        checked={rowFlags[flagKeyOf(d)] === "sub"}
                                        onCheckedChange={(c) =>
                                          setRowFlags((prev) => ({
                                            ...prev,
                                            [flagKeyOf(d)]: c ? "sub" : null,
                                          }))
                                        }
                                        className="size-3.5 border-[#66fcf1]/40 data-[state=checked]:border-[#66fcf1] data-[state=checked]:bg-[#66fcf1] data-[state=checked]:text-black"
                                      />
                                      S
                                    </label>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[220px] bg-[var(--color-surface)] text-white">
                                    Flag this merged player as part of a substitution (e.g. they
                                    reconnected, then were subbed out)
                                  </TooltipContent>
                                </Tooltip>
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
                            {row["CAPTURES-SUM"]}
                          </td>
                          <td className="px-3 py-1.5 text-right tabular-nums">
                            {row["RETURNS-SUM"]}
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
            <p className="flex items-center gap-2 text-xs text-[#8892a0]">
              {isPendingMode ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Loading match…
                </>
              ) : (
                "Select a stats CSV to parse, validate and map players."
              )}
            </p>
          )}
        </div>

        <DialogFooter className="shrink-0 sm:justify-between">
          <div className="flex items-center gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={() => handleClose(false)}
              className="border-[var(--color-border)] bg-transparent text-white hover:bg-[var(--color-border)]"
            >
              Cancel
            </Button>
            {/* Manual vs algorithm pick — recorded on the match (pending + log modes). */}
            {showMatchType && (
              <div className="flex items-center gap-1">
                {(["manual", "algorithm"] as const).map((t) => (
                  <Button
                    key={t}
                    type="button"
                    size="sm"
                    variant={matchType === t ? "default" : "outline"}
                    onClick={() => setMatchType(t)}
                    className={cn(
                      "h-8 px-3 text-xs font-medium capitalize",
                      matchType === t
                        ? "bg-[#66fcf1] text-black hover:bg-[#66fcf1]/80"
                        : "border-[var(--color-border)] bg-transparent text-[#c5c6c7] hover:bg-[var(--color-border)]",
                    )}
                  >
                    {t}
                  </Button>
                ))}
              </div>
            )}
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button
              type="button"
              disabled={!canConfirm}
              onClick={handleConfirm}
              className="bg-[#66fcf1] px-4 font-medium text-black hover:bg-[#66fcf1]/80 disabled:opacity-40"
            >
              {isPendingMode
                ? "Approve & Log Match"
                : logMode
                  ? "Log Match"
                  : "Confirm and Pre-fill Form"}
            </Button>
            {summary && !canConfirm && (
              <p className="text-[11px] text-[#8892a0]">
                {hasPendingFlags
                  ? "Resolve all merge/sub flags first."
                  : hasOtherTeam
                    ? "Remove or fix unexpected-team rows first."
                    : "Map every row to a Soracle player first."}
              </p>
            )}
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
