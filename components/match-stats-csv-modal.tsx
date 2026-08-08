"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import Papa from "papaparse"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { ScoreboardReview } from "@/components/scoreboard-review"
import { createPendingFromUpload } from "@/app/admin/actions"
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
  // Offer "Review in full", which parks the upload in pending_matches and opens
  // /admin/review/[id]. Only for flows that own the whole match (log mode) — the
  // prefill flow hands back to a form the review screen knows nothing about.
  allowEscalate?: boolean
  // Already a pending entry (the approval bin). Escalation navigates straight to
  // it instead of creating a second row for the same scoreboard.
  pendingId?: string
}

export function MatchStatsCsvModal({
  open,
  onOpenChange,
  onCsvDataReady,
  pendingCsvText,
  pendingCsvFilename,
  logMode = false,
  allowEscalate = false,
  pendingId,
}: MatchStatsCsvModalProps) {
  const router = useRouter()
  const isPendingMode = pendingCsvText !== undefined
  // Both pending review and log mode record the Manual/Algorithm pick and "log on
  // confirm"; only pending hides the file picker.
  const showMatchType = isPendingMode || logMode

  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [missingColumns, setMissingColumns] = useState<string[]>([])
  const [escalating, setEscalating] = useState(false)

  // Hand this scoreboard off to the full-page review. For a bot entry that row
  // already exists, so we just navigate. For a manual upload the row is created
  // HERE rather than at upload time, so the ordinary "upload, glance, publish"
  // path never writes one — only an escalation does.
  async function handleEscalate() {
    if (pendingId) {
      setEscalating(true)
      router.push(`/admin/review/${pendingId}`)
      return
    }
    if (!csvFile) return
    setEscalating(true)
    const formData = new FormData()
    formData.append("file", csvFile)
    const result = await createPendingFromUpload(formData)
    if (result.success && result.pendingId) {
      router.push(`/admin/review/${result.pendingId}`)
    } else {
      setEscalating(false)
      setError(result.error || "Could not open the full review for this scoreboard.")
    }
  }

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
          // Read-only on purpose. This screen is the fast lane — glance at the
          // numbers, sort out any subs/merges, publish. Changing a stat is a
          // deliberate act and belongs on the full-page review, where there's
          // room to see what you're changing and the rest of the counters are
          // reachable. Editing in a cramped dialog invites the wrong kind of
          // accident on the highest-stakes write in the app.
          onEscalate={allowEscalate ? handleEscalate : undefined}
          escalating={escalating}
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
