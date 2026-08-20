"use client"

import { Fragment, useEffect, useMemo, useState } from "react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { Check, ChevronsUpDown, Loader2, Maximize2, RotateCcw } from "lucide-react"
import { cn } from "@/lib/utils"
import { fetchAliasesFromDB, fetchPlayersFromDB } from "@/lib/fetch-players-db"
import {
  buildMatchStat,
  classifyTeam,
  mergeRowData,
  toInt,
  type CsvRow,
  type ParseSummary,
  type TeamClass,
} from "@/lib/scoreboard-csv"
import { createNameResolver, type PlayerAlias } from "@/lib/name-match"
import type { CsvMatchData, MatchStatInsert, Player } from "@/lib/types"

// The scoreboard review UI — team assignment, in-game-name → player mapping,
// reconnect/substitution resolution, and (optionally) hand-editing of stat
// values before the match is written.
//
// Extracted from match-stats-csv-modal.tsx so the modal and the full-page
// /admin/review/[id] screen render the SAME logic. This is the highest-stakes
// admin path in the app — approving here writes rows that feed every
// leaderboard, rating and achievement — so the two surfaces must not drift.
// The parent owns parsing and supplies `summary`; this owns everything after.

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

// A display row's stable identity for row flags, player mapping and stat edits.
// A merged row is keyed by its first constituent, whose index no longer renders
// on its own — which is also the key rowToPlayerId already uses for merged rows.
const flagKeyOf = (d: DisplayRow) => (d.kind === "merged" ? d.originalRowIndices[0] : d.rowIndex)

// The parsed-CSV rows a display row stands for (a merged row stands for several).
const indicesOf = (d: DisplayRow) => (d.kind === "merged" ? d.originalRowIndices : [d.rowIndex])

// The columns shown inline in the review table, mirroring the match-history
// scoreboard. Sora's call: kills and base cleans are the two most frequently
// wrong, and both are already in this set.
const INLINE_COLUMNS: { label: string; col: string }[] = [
  { label: "Score", col: "SCORE-SUM" },
  { label: "Caps", col: "CAPTURES-SUM" },
  { label: "Ret", col: "RETURNS-SUM" },
  { label: "BC", col: "BC-SUM" },
  { label: "DBS", col: "DBS-KILLS" },
  { label: "K", col: "KILLS" },
  { label: "D", col: "DEATHS" },
  { label: "DFA", col: "DFA-KILLS" },
]

// Everything else worth hand-editing, revealed by the per-row expander. Kept out
// of the inline set purely to keep the table scannable.
const EXTRA_COLUMNS: { label: string; col: string }[] = [
  { label: "Assists", col: "ASSISTS-SUM" },
  { label: "Flag grabs", col: "FLAGGRABS-SUM" },
  { label: "Flag hold (ms)", col: "FLAGHOLD-SUM" },
  { label: "Time (min)", col: "TIME-SUM" },
  { label: "Red kills", col: "RED-KILLS" },
  { label: "Yellow kills", col: "YEL-KILLS" },
  { label: "Blue kills", col: "BLU-KILLS" },
  { label: "YDFA kills", col: "YDFA-KILLS" },
  { label: "BS kills", col: "BS-KILLS" },
  { label: "BLUBS kills", col: "BLUBS-KILLS" },
  { label: "Upcut kills", col: "UPCUT-KILLS" },
  { label: "Mine kills", col: "MINE-KILLS" },
  { label: "Doom kills", col: "DOOM-KILLS" },
  { label: "Turret kills", col: "TUR-KILLS" },
  { label: "Red rets", col: "RED-RETURNS" },
  { label: "Yellow rets", col: "YEL-RETURNS" },
  { label: "Blue rets", col: "BLU-RETURNS" },
  { label: "DFA rets", col: "DFA-RETURNS" },
  { label: "DBS rets", col: "DBS-RETURNS" },
  { label: "BLUBS rets", col: "BLUBS-RETURNS" },
  { label: "Mine rets", col: "MINE-RETURNS" },
  { label: "Mines (red base)", col: "MINEGRABS-REDBASE" },
  { label: "Mines (blue base)", col: "MINEGRABS-BLUEBASE" },
  { label: "DFA attempts", col: "DFA-ATTEMPTS" },
  { label: "Blocks (enemy)", col: "BLOCKS-ENEMY" },
]

// rowKey -> { CSV column -> new value }. Kept SEPARATE from the parsed rows so
// the original is always recoverable, the UI can show what changed, and a
// re-parse can't silently discard an edit.
type StatOverrides = Record<number, Record<string, string>>

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
      <PopoverContent align="start" className="w-56 p-0 bg-[var(--color-surface)] border-[#66fcf1]/30">
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
                  <Check className={cn("mr-2 h-3 w-3", value === p.id ? "opacity-100" : "opacity-0")} />
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

// One editable stat cell. Shows the original value as a tooltip + amber tint
// once edited, so a hand-corrected number never silently passes for scoreboard
// truth. Empty input is treated as 0 rather than NaN.
function StatCell({
  value,
  original,
  editable,
  onChange,
  className,
}: {
  value: string
  original: string
  editable: boolean
  onChange: (next: string) => void
  className?: string
}) {
  const edited = value !== original
  if (!editable) {
    return <td className={cn("px-3 py-1.5 text-right tabular-nums", className)}>{value}</td>
  }
  return (
    <td className={cn("px-1 py-1", className)}>
      <Tooltip>
        <TooltipTrigger asChild>
          <input
            type="number"
            inputMode="numeric"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className={cn(
              "w-16 rounded border bg-transparent px-1.5 py-0.5 text-right text-xs tabular-nums outline-none",
              "focus:border-[#66fcf1] focus:ring-1 focus:ring-[#66fcf1]/40",
              edited
                ? "border-amber-500/70 bg-amber-500/10 font-bold text-amber-200"
                : "border-transparent text-white hover:border-[var(--color-border)]",
            )}
          />
        </TooltipTrigger>
        {edited && (
          <TooltipContent className="bg-[var(--color-surface)] text-[var(--color-text-bright)]">
            Edited — scoreboard said {original || "0"}
          </TooltipContent>
        )}
      </Tooltip>
    </td>
  )
}

// Render an in-game name, with a clear placeholder for the legal-but-blank JK2
// name so the row is obviously present (and still needs mapping).
function inGameNameNode(raw: string | undefined) {
  const name = (raw ?? "").trim()
  return name !== "" ? name : <span className="italic text-[#6b7280]">(no name)</span>
}

export interface ScoreboardReviewProps {
  summary: ParseSummary | null
  csvFile: File | null
  /** Shows the Manual/Algorithm toggle and includes matchType in the payload. */
  showMatchType?: boolean
  /** Allow hand-editing the inline stat columns before the match is written. */
  editable?: boolean
  /**
   * Also expose the per-row expander with every remaining counter. Off in the
   * dialog, which has no room for it — that's what the full-page screen is for.
   */
  showAllCounters?: boolean
  confirmLabel: string
  onConfirm: (data: CsvMatchData) => void | Promise<void>
  onCancel: () => void
  cancelLabel?: string
  /**
   * "Something looks off" escape hatch: escalate to the full-page review. Only
   * rendered when supplied, so the full-page screen doesn't offer to open
   * itself.
   */
  onEscalate?: () => void
  escalating?: boolean
  /** Rendered above the table — the file picker in the modal's upload flow. */
  children?: React.ReactNode
  busy?: boolean
  /** Parent-level parse failures, rendered in the same place as our own. */
  error?: string | null
  missingColumns?: string[]
  loadingMessage?: string
}

export function ScoreboardReview({
  summary,
  csvFile,
  showMatchType = false,
  editable = false,
  showAllCounters = false,
  confirmLabel,
  onConfirm,
  onCancel,
  cancelLabel = "Cancel",
  onEscalate,
  escalating = false,
  children,
  busy = false,
  error = null,
  missingColumns = [],
  loadingMessage,
}: ScoreboardReviewProps) {
  const [matchType, setMatchType] = useState<"manual" | "algorithm">("manual")

  // Soracle players + known aliases, fetched once per mount.
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
  const [mergedRows, setMergedRows] = useState<
    Array<{ originalRowIndices: number[]; mergedData: CsvRow }>
  >([])
  const [mergeError, setMergeError] = useState<string | null>(null)
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
  const [overrides, setOverrides] = useState<StatOverrides>({})
  const [expandedRow, setExpandedRow] = useState<number | null>(null)

  useEffect(() => {
    if (playersLoaded || playersLoading) return
    setPlayersLoading(true)
    Promise.all([fetchPlayersFromDB(), fetchAliasesFromDB()])
      .then(([p, a]) => {
        setPlayers(p)
        setAliases(a)
        setPlayersLoaded(true)
      })
      .finally(() => setPlayersLoading(false))
  }, [playersLoaded, playersLoading])

  const sortedPlayers = useMemo(
    () => [...players].sort((a, b) => a.name.localeCompare(b.name)),
    [players],
  )

  // Single alias-aware name resolver, rebuilt only when the roster/aliases change.
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

  // Auto-match once per (summary, players). Deps are stable, so this never
  // clobbers manual edits.
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
    const dropped = new Set<number>()
    const partialKeys = new Set<number>()
    const keptToResolution = new Map<number, number>()
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

  // The row's data with any hand-edits applied. Everything downstream (score
  // totals, buildMatchStat) reads through this, so an edit flows everywhere at
  // once instead of needing to be applied per call site.
  const effectiveData = (d: DisplayRow): CsvRow => {
    const o = overrides[flagKeyOf(d)]
    return o ? { ...d.data, ...o } : d.data
  }

  const setOverride = (d: DisplayRow, col: string, next: string) => {
    const key = flagKeyOf(d)
    const original = d.data[col] ?? "0"
    setOverrides((prev) => {
      const row = { ...(prev[key] ?? {}) }
      // Editing back to the scoreboard's own value clears the override rather
      // than storing a no-op, so "edited" always means genuinely different.
      if (next === original) delete row[col]
      else row[col] = next
      const out = { ...prev }
      if (Object.keys(row).length === 0) delete out[key]
      else out[key] = row
      return out
    })
  }

  const clearRowOverrides = (d: DisplayRow) => {
    const key = flagKeyOf(d)
    setOverrides((prev) => {
      const out = { ...prev }
      delete out[key]
      return out
    })
  }

  const editedCount = Object.values(overrides).reduce((n, row) => n + Object.keys(row).length, 0)

  function handleMerge() {
    const flagged = displayRows.filter(
      (d): d is Extract<DisplayRow, { kind: "single" }> =>
        d.kind === "single" && rowFlags[d.rowIndex] === "merge",
    )
    if (flagged.length < 2) return

    const unmapped = flagged.filter((d) => !rowToPlayerId[d.rowIndex])
    if (unmapped.length > 0) {
      const positions = unmapped.map((d) => displayRows.indexOf(d) + 1).sort((a, b) => a - b)
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
    // Merge the EFFECTIVE rows so edits made before merging survive it.
    const mergedData = mergeRowData(flagged.map((d) => effectiveData(d)))
    setMergedRows((prev) => [...prev, { originalRowIndices: indices, mergedData }])
    setRowFlags((prev) => {
      const next = { ...prev }
      indices.forEach((idx) => {
        next[idx] = null
      })
      return next
    })
    // The constituents' overrides are now baked into mergedData; drop them so
    // they can't be double-applied to the merged row (which shares key[0]).
    setOverrides((prev) => {
      const out = { ...prev }
      indices.forEach((idx) => delete out[idx])
      return out
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
    setOverrides((prev) => {
      const out = { ...prev }
      target?.originalRowIndices.forEach((idx) => delete out[idx])
      return out
    })
    setMergeError(null)
  }

  function handleApplySubstitution(
    group: { team: TeamClass; rows: DisplayRow[] },
    resolution: SubResolution,
  ) {
    const { team, rows } = group
    if (rows.length < 2) return

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

    let effective = resolution
    if (effective !== "keep-both" && rows.length !== 2) effective = "keep-both"

    let droppedRows: DisplayRow[] = []
    if (effective === "keep-starter" || effective === "keep-finisher") {
      const [a, b] = rows
      const ta = toInt(effectiveData(a)["TIME-SUM"])
      const tb = toInt(effectiveData(b)["TIME-SUM"])
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

  function scoreLine(s: ParseSummary): string {
    const winner = s.redScore > s.blueScore ? "Red wins" : s.blueScore > s.redScore ? "Blue wins" : "Tie"
    return `Red ${s.redScore} - Blue ${s.blueScore}, ${winner}`
  }

  const totalRows = displayRows.length
  const mappedCount = displayRows.reduce((acc, d) => acc + (rowToPlayerId[flagKeyOf(d)] ? 1 : 0), 0)
  const allMapped = totalRows > 0 && mappedCount === totalRows

  const mergeCount = displayRows.reduce(
    (acc, d) => acc + (d.kind === "single" && rowFlags[d.rowIndex] === "merge" ? 1 : 0),
    0,
  )
  const subCount = displayRows.reduce((acc, d) => acc + (rowFlags[flagKeyOf(d)] === "sub" ? 1 : 0), 0)

  const hasOtherTeam = displayRows.some((d) => d.team === "Other")
  const hasPendingFlags = mergeCount > 0 || subCount > 0
  const canConfirm =
    csvFile !== null && summary !== null && allMapped && !hasOtherTeam && !hasPendingFlags && !busy

  // Assemble the handoff payload from the final display rows (post merge/sub/edit).
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
      const data = effectiveData(d)
      const captures = toInt(data["CAPTURES-SUM"])
      if (d.team === "Red") {
        redTeamNames.push(playerName(playerId))
        redScore += captures
      } else {
        blueTeamNames.push(playerName(playerId))
        blueScore += captures
      }
      matchStats.push(buildMatchStat(data, playerId, d.team, d.partial))
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
    void onConfirm(data)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 min-h-0 space-y-3 overflow-y-auto pr-1">
        {children}

        {playersLoading && (
          <p className="flex items-center gap-2 text-xs text-[#8892a0]">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading players…
          </p>
        )}

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

        {error && (
          <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
            {error}
          </div>
        )}

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

            <div className="rounded-lg border border-[#66fcf1]/20 bg-black/30 p-4">
              <h3
                className="mb-3 font-mono text-sm font-bold uppercase tracking-wide"
                style={{ color: "var(--color-primary)" }}
              >
                Match Summary
              </h3>
              <dl className="space-y-1.5 text-sm">
                <div className="flex items-baseline justify-between gap-4">
                  <dt className="shrink-0 text-[#8892a0]">Filename</dt>
                  <dd className="min-w-0 break-all text-right font-mono text-xs">{summary.filename}</dd>
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

            {mergeError && (
              <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
                {mergeError}
              </div>
            )}

            {showSubPanel && pendingSubGroups.length > 0 && (
              <div className="space-y-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3">
                <div className="flex items-center justify-between">
                  <h4 className="text-sm font-bold text-amber-200">Configure substitution</h4>
                  <button
                    type="button"
                    onClick={() => setShowSubPanel(false)}
                    className="text-xs text-[#8892a0] hover:text-white"
                  >
                    Close
                  </button>
                </div>
                {pendingSubGroups.map((group) => {
                  const team = group.team
                  const choice = subChoices[team] ?? "keep-both"
                  const tooFew = group.rows.length < 2
                  const tooMany = group.rows.length > 2
                  const options: { value: SubResolution; label: string }[] = [
                    { value: "keep-both", label: "Keep both — each played part of the match" },
                    { value: "keep-starter", label: "Keep starter only (more time played)" },
                    { value: "keep-finisher", label: "Keep finisher only (less time played)" },
                  ]
                  return (
                    <div key={team} className="space-y-2 rounded border border-[var(--color-border)] p-2">
                      <p className="text-xs font-medium text-white">
                        {team} team — {group.rows.length} flagged row{group.rows.length === 1 ? "" : "s"}
                      </p>
                      <ul className="space-y-0.5 text-xs text-[#8892a0]">
                        {group.rows.map((d) => {
                          const pid = rowToPlayerId[flagKeyOf(d)]
                          return (
                            <li key={flagKeyOf(d)}>
                              {inGameNameNode(effectiveData(d)["NAME-CLEAN"])} →{" "}
                              {pid ? playerName(pid) : <span className="text-amber-300">unmapped</span>}{" "}
                              ({toInt(effectiveData(d)["TIME-SUM"])} min)
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
                                    onChange={() => setSubChoices((p) => ({ ...p, [team]: opt.value }))}
                                    className="accent-[#66fcf1]"
                                  />
                                  {opt.label}
                                </label>
                              )
                            })}
                          </div>
                          {tooMany && (
                            <p className="mt-1 text-[11px] text-amber-200/70">
                              Starter/finisher only apply to a 2-row substitution; this group has{" "}
                              {group.rows.length}. Resolve two rows at a time.
                            </p>
                          )}
                          {subErrors[team] && (
                            <p className="text-[11px] text-red-300">{subErrors[team]}</p>
                          )}
                          <Button
                            type="button"
                            size="sm"
                            onClick={() => handleApplySubstitution(group, choice)}
                            className="h-7 bg-amber-500/80 px-3 text-xs font-medium text-black hover:bg-amber-500"
                          >
                            Apply
                          </Button>
                        </>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {editedCount > 0 && (
              <div className="flex items-center justify-between gap-3 rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs">
                <span className="text-amber-200">
                  <strong>{editedCount}</strong> stat value{editedCount === 1 ? "" : "s"} hand-edited.
                  The original scoreboard file is stored unchanged.
                </span>
                <button
                  type="button"
                  onClick={() => setOverrides({})}
                  className="shrink-0 font-medium text-[#8892a0] underline-offset-2 hover:text-white hover:underline"
                >
                  Reset all
                </button>
              </div>
            )}

            <div className="overflow-x-auto rounded-lg border border-[var(--color-border)]">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-dim)]">
                    <th className="px-3 py-2 text-left font-medium">In-game name</th>
                    <th className="px-3 py-2 text-left font-medium">Team</th>
                    <th className="px-3 py-2 text-left font-medium">Soracle player</th>
                    <th className="px-2 py-2 text-center font-medium">Flags</th>
                    {INLINE_COLUMNS.map((c) => (
                      <th key={c.col} className="px-3 py-2 text-right font-medium tabular-nums">
                        {c.label}
                      </th>
                    ))}
                    {showAllCounters && <th className="px-2 py-2 text-center font-medium">More</th>}
                  </tr>
                </thead>
                <tbody>
                  {displayRows.map((d, i) => {
                    const team = d.team
                    const prev = i > 0 ? displayRows[i - 1].team : null
                    const teamChanged = prev !== null && prev !== team
                    const row = effectiveData(d)
                    const key = flagKeyOf(d)
                    const muted = team === "Other"
                    const isMerged = d.kind === "merged"
                    const isPendingSub = rowFlags[key] === "sub"
                    const isPartial = d.partial
                    const playerValue = rowToPlayerId[key] ?? null
                    const isAutoMatched =
                      d.kind === "single" &&
                      autoMatched[d.rowIndex] !== undefined &&
                      rowToPlayerId[d.rowIndex] === autoMatched[d.rowIndex]
                    const rowEdits = overrides[key]
                    const isExpanded = expandedRow === key
                    return (
                      <Fragment key={d.kind === "merged" ? `m-${d.mergeIndex}` : `s-${d.rowIndex}`}>
                        <tr
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
                              {rowEdits && (
                                <Badge
                                  variant="outline"
                                  className="shrink-0 border-amber-500/50 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-300"
                                >
                                  Edited
                                </Badge>
                              )}
                            </div>
                          </td>
                          <td className="px-3 py-1.5">
                            {team === "Red" && (
                              <Badge variant="outline" className="border-red-500/40 bg-red-500/15 text-red-300">
                                Red
                              </Badge>
                            )}
                            {team === "Blue" && (
                              <Badge variant="outline" className="border-blue-500/40 bg-blue-500/15 text-blue-300">
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
                              <div className="flex items-center justify-center gap-2">
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <label className="flex cursor-pointer items-center gap-1 text-[11px] font-medium text-[#8892a0]">
                                      <Checkbox
                                        checked={rowFlags[key] === "sub"}
                                        onCheckedChange={(c) =>
                                          setRowFlags((prev) => ({ ...prev, [key]: c ? "sub" : null }))
                                        }
                                        className="size-3.5 border-[#66fcf1]/40 data-[state=checked]:border-[#66fcf1] data-[state=checked]:bg-[#66fcf1] data-[state=checked]:text-black"
                                      />
                                      S
                                    </label>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-[220px] bg-[var(--color-surface)] text-[var(--color-text-bright)]">
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
                                  <TooltipContent className="max-w-[220px] bg-[var(--color-surface)] text-[var(--color-text-bright)]">
                                    Flag this row as a reconnect of another row (Merge with another row
                                    of the same player)
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
                                  <TooltipContent className="max-w-[220px] bg-[var(--color-surface)] text-[var(--color-text-bright)]">
                                    Flag this row as part of a substitution (Sub in or out)
                                  </TooltipContent>
                                </Tooltip>
                              </div>
                            )}
                          </td>
                          {INLINE_COLUMNS.map((c) => (
                            <StatCell
                              key={c.col}
                              value={row[c.col] ?? "0"}
                              original={d.data[c.col] ?? "0"}
                              editable={editable}
                              onChange={(next) => setOverride(d, c.col, next)}
                            />
                          ))}
                          {showAllCounters && (
                            <td className="px-2 py-1.5 text-center">
                              <button
                                type="button"
                                onClick={() => setExpandedRow(isExpanded ? null : key)}
                                className="text-[11px] font-medium text-[#8892a0] underline-offset-2 hover:text-[#66fcf1] hover:underline"
                              >
                                {isExpanded ? "Hide" : "Edit…"}
                              </button>
                            </td>
                          )}
                        </tr>
                        {showAllCounters && isExpanded && (
                          <tr className="border-t border-[var(--color-border)]/40 bg-black/30">
                            <td colSpan={4 + INLINE_COLUMNS.length + 1} className="px-3 py-3">
                              <div className="mb-2 flex items-center justify-between">
                                <span className="text-[11px] font-bold uppercase tracking-wide text-[#8892a0]">
                                  All counters — {inGameNameNode(row["NAME-CLEAN"])}
                                </span>
                                {rowEdits && (
                                  <button
                                    type="button"
                                    onClick={() => clearRowOverrides(d)}
                                    className="flex items-center gap-1 text-[11px] font-medium text-[#8892a0] hover:text-white"
                                  >
                                    <RotateCcw className="h-3 w-3" />
                                    Reset this row
                                  </button>
                                )}
                              </div>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-3 lg:grid-cols-4">
                                {EXTRA_COLUMNS.map((c) => {
                                  const v = row[c.col] ?? "0"
                                  const orig = d.data[c.col] ?? "0"
                                  return (
                                    <label key={c.col} className="flex items-center justify-between gap-2">
                                      <span className="truncate text-[11px] text-[#8892a0]">{c.label}</span>
                                      <input
                                        type="number"
                                        inputMode="numeric"
                                        value={v}
                                        onChange={(e) => setOverride(d, c.col, e.target.value)}
                                        className={cn(
                                          "w-20 shrink-0 rounded border bg-transparent px-1.5 py-0.5 text-right text-xs tabular-nums outline-none",
                                          "focus:border-[#66fcf1] focus:ring-1 focus:ring-[#66fcf1]/40",
                                          v !== orig
                                            ? "border-amber-500/70 bg-amber-500/10 font-bold text-amber-200"
                                            : "border-[var(--color-border)] text-white",
                                        )}
                                      />
                                    </label>
                                  )
                                })}
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <p className={cn("text-sm font-medium", allMapped ? "text-green-400" : "text-[#8892a0]")}>
              {mappedCount} of {totalRows} players mapped
            </p>
          </div>
        )}

        {!summary && missingColumns.length === 0 && !error && loadingMessage && (
          <p className="flex items-center gap-2 text-xs text-[#8892a0]">
            <Loader2 className="h-3 w-3 animate-spin" />
            {loadingMessage}
          </p>
        )}
      </div>

      <div className="mt-4 flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-[var(--color-border)] pt-4">
        <div className="flex items-center gap-3">
          <Button
            type="button"
            variant="outline"
            onClick={onCancel}
            className="border-[var(--color-border)] bg-transparent text-white hover:bg-[var(--color-border)]"
          >
            {cancelLabel}
          </Button>
          {onEscalate && summary && (
            <Button
              type="button"
              variant="outline"
              onClick={onEscalate}
              disabled={escalating}
              className="border-[#66fcf1]/50 bg-transparent text-[#66fcf1] hover:bg-[#66fcf1]/10"
            >
              {escalating ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Maximize2 className="mr-2 h-4 w-4" />
              )}
              Review in full
            </Button>
          )}
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
            {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {confirmLabel}
          </Button>
          {summary && !canConfirm && !busy && (
            <p className="text-[11px] text-[#8892a0]">
              {hasPendingFlags
                ? "Resolve all merge/sub flags first."
                : hasOtherTeam
                  ? "Remove or fix unexpected-team rows first."
                  : "Map every row to a Soracle player first."}
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
