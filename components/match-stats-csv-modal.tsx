"use client"

import { useEffect, useState } from "react"
import Papa from "papaparse"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScoreboardReview } from "@/components/scoreboard-review"
import { parseScoreboardCsvText, summarizeParsedRows, type CsvRow, type ParseSummary } from "@/lib/scoreboard-csv"
import type { CsvMatchData } from "@/lib/types"

// Thin Dialog wrapper around <ScoreboardReview>. Everything the review actually
// does — name mapping, reconnect/substitution resolution, stat editing, payload
// assembly — lives in that shared component, so this modal and the full-page
// /admin/review/[id] screen can't drift apart. This file owns only the dialog
// chrome, the file picker, and parsing.

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

  function reset() {
    setSummary(null)
    setCsvFile(null)
    setError(null)
    setMissingColumns([])
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
          const result = summarizeParsedRows(results.data, results.meta.fields ?? [], file.name)
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
        setError("Failed to parse the CSV file. It may be malformed or empty. Try another file.")
      },
    })
  }

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="bg-[var(--color-surface)]/95 backdrop-blur-md border-[#66fcf1]/30 text-white sm:max-w-6xl max-h-[85vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle className="text-xl" style={{ color: "var(--color-primary)" }}>
            {isPendingMode ? "Review Pending Match" : logMode ? "Log a Match" : "Upload Match Stats CSV"}
          </DialogTitle>
        </DialogHeader>

        {/* Remounts per pending entry so a second review starts clean — and picks
            up any aliases learned by approving the previous one. */}
        <ScoreboardReview
          key={pendingCsvFilename ?? "upload"}
          summary={summary}
          csvFile={csvFile}
          showMatchType={showMatchType}
          // Editing is on here too, not just the full-page screen: the failure
          // this exists for (a warmup player's kills bleeding into the final
          // scoreboard) can land through any upload path, so every path needs
          // the fix. The table scrolls horizontally in the dialog's width.
          editable
          error={error}
          missingColumns={missingColumns}
          loadingMessage={isPendingMode ? "Loading match…" : undefined}
          confirmLabel={
            isPendingMode ? "Approve & Log Match" : logMode ? "Log Match" : "Confirm and Pre-fill Form"
          }
          onConfirm={(data) => {
            onCsvDataReady(data)
            handleClose(false)
          }}
          onCancel={() => handleClose(false)}
        >
          {!isPendingMode && (
            <input
              type="file"
              accept=".csv"
              onChange={handleFileChange}
              className="block w-full text-sm text-[#c5c6c7] file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-[#66fcf1]/40 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-[#66fcf1] hover:file:bg-[#66fcf1]/10"
            />
          )}
          {!summary && missingColumns.length === 0 && !error && !isPendingMode && (
            <p className="text-xs text-[#8892a0]">
              Select a stats CSV to parse, validate and map players.
            </p>
          )}
        </ScoreboardReview>
      </DialogContent>
    </Dialog>
  )
}
