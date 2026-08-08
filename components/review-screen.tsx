"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { ArrowLeft, CheckCircle2, Inbox, Loader2, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScoreboardReview } from "@/components/scoreboard-review"
import {
  approvePendingMatch,
  getPendingCsv,
  getPendingMatch,
  rejectPendingMatch,
} from "@/app/admin/actions"
import { parseScoreboardCsvText, type ParseSummary } from "@/lib/scoreboard-csv"
import type { CsvMatchData } from "@/lib/types"

// The full-page match review. Loads a pending entry + its raw CSV, hands both to
// the shared <ScoreboardReview>, and owns approve/reject.
//
// Stat editing is enabled here and NOT in the modal: this screen has the room to
// show the numbers being changed, and the raw CSV stays archived in the private
// bucket either way, so an edit never destroys the original.

interface PendingMatch {
  id: string
  status: string
  match_played_at: string | null
  distinct_players: number
  red_score: number
  blue_score: number
  csv_filename: string | null
  uploader_name: string | null
  source: string | null
  created_at: string
}

function formatDate(iso: string | null): string {
  if (!iso) return "Unknown date"
  return new Date(iso).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
}

export function ReviewScreen({ pendingId }: { pendingId: string }) {
  const router = useRouter()
  const [pending, setPending] = useState<PendingMatch | null>(null)
  const [summary, setSummary] = useState<ParseSummary | null>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [missingColumns, setMissingColumns] = useState<string[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)
  const [parseError, setParseError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<"approved" | "rejected" | null>(null)
  const [confirmReject, setConfirmReject] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const [meta, csv] = await Promise.all([getPendingMatch(pendingId), getPendingCsv(pendingId)])
      if (cancelled) return
      if (!meta.success) {
        setLoadError(meta.error || "Could not load this match.")
        setLoading(false)
        return
      }
      setPending(meta.data as PendingMatch)
      if (!csv.success || csv.text === undefined) {
        setLoadError(csv.error || "Could not load the scoreboard file.")
        setLoading(false)
        return
      }
      const filename = csv.filename || "scoreboard.csv"
      setCsvFile(new File([csv.text], filename, { type: "text/csv" }))
      try {
        const result = parseScoreboardCsvText(csv.text, filename)
        if (!result.ok) {
          if (result.missingColumns.length > 0) setMissingColumns(result.missingColumns)
          setParseError(result.error || "The scoreboard file could not be parsed.")
        } else {
          setSummary(result.summary)
        }
      } catch {
        setParseError("Something went wrong while reading the scoreboard file.")
      }
      setLoading(false)
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [pendingId])

  async function handleApprove(data: CsvMatchData) {
    if (!pending) return
    setBusy(true)
    setLoadError(null)
    const formData = new FormData()
    formData.append("file", data.csvFile)
    formData.append("pending_id", pending.id)
    formData.append(
      "payload",
      JSON.stringify({
        uuid: crypto.randomUUID(),
        red_team: data.redTeamNames,
        blue_team: data.blueTeamNames,
        red_score: data.redScore,
        blue_score: data.blueScore,
        match_type: data.matchType ?? "manual",
        balance_confidence: 0,
        played_at: data.matchPlayedAtIso,
        match_stats: data.matchStats,
      }),
    )
    const result = await approvePendingMatch(formData)
    setBusy(false)
    if (result.success) setDone("approved")
    else setLoadError(result.error || "Failed to approve the match.")
  }

  async function handleReject() {
    setBusy(true)
    const result = await rejectPendingMatch(pendingId)
    setBusy(false)
    setConfirmReject(false)
    if (result.success) setDone("rejected")
    else setLoadError(result.error || "Failed to reject the match.")
  }

  const backLink = (
    <Link
      href="/admin"
      className="inline-flex items-center gap-1.5 text-sm text-[#8892a0] transition-colors hover:text-white"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to admin
    </Link>
  )

  if (done) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="rounded-lg border border-green-500/40 bg-green-500/5 p-6 text-center">
          <CheckCircle2 className="mx-auto mb-3 h-8 w-8 text-green-400" />
          <h1 className="text-lg font-bold text-white">
            Match {done === "approved" ? "approved and logged" : "rejected"}
          </h1>
          <p className="mt-1 text-sm text-[#8892a0]">
            {done === "approved"
              ? "Stats, ratings and achievements have been updated."
              : "This entry has been discarded and will not count toward anything."}
          </p>
          <Button
            type="button"
            onClick={() => router.push("/admin")}
            className="mt-4 bg-[#66fcf1] px-4 font-medium text-black hover:bg-[#66fcf1]/80"
          >
            Back to admin
          </Button>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="space-y-4">
        {backLink}
        <p className="flex items-center gap-2 text-sm text-[#8892a0]">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading match…
        </p>
      </div>
    )
  }

  if (loadError && !summary) {
    return (
      <div className="space-y-4">
        {backLink}
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          {loadError}
        </div>
      </div>
    )
  }

  const alreadyHandled = pending && pending.status !== "pending"

  return (
    <div className="space-y-4">
      {backLink}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-white" style={{ fontFamily: "var(--font-orbitron)" }}>
            Review match
          </h1>
          {pending && (
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[#8892a0]">
              <Inbox className="h-3.5 w-3.5" />
              <span>{formatDate(pending.match_played_at)}</span>
              <span>·</span>
              <span className="tabular-nums">
                Red {pending.red_score} – Blue {pending.blue_score}
              </span>
              <span>·</span>
              <span>{pending.distinct_players} players</span>
              {pending.uploader_name && (
                <>
                  <span>·</span>
                  <span>via {pending.uploader_name}</span>
                </>
              )}
            </p>
          )}
        </div>

        {!alreadyHandled &&
          (confirmReject ? (
            <div className="flex items-center gap-2">
              <span className="text-xs text-[#8892a0]">Reject this match?</span>
              <Button
                type="button"
                size="sm"
                onClick={handleReject}
                disabled={busy}
                className="h-8 bg-red-500/80 px-3 text-xs font-medium text-white hover:bg-red-500"
              >
                {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, reject"}
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => setConfirmReject(false)}
                className="h-8 border-[var(--color-border)] bg-transparent px-3 text-xs text-white hover:bg-[var(--color-border)]"
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() => setConfirmReject(true)}
              disabled={busy}
              className="h-8 border-[var(--color-border)] bg-transparent px-3 text-xs text-[var(--color-text-dim)] hover:bg-[var(--color-border)] hover:text-white"
            >
              <X className="mr-1 h-3 w-3" />
              Reject
            </Button>
          ))}
      </div>

      {alreadyHandled && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm text-amber-200">
          This entry has already been <strong>{pending?.status}</strong>. Nothing here will be
          re-recorded.
        </div>
      )}

      {loadError && (
        <div className="rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {loadError}
        </div>
      )}

      <ScoreboardReview
        summary={summary}
        csvFile={csvFile}
        showMatchType
        editable={!alreadyHandled}
        showAllCounters={!alreadyHandled}
        busy={busy}
        error={parseError}
        missingColumns={missingColumns}
        confirmLabel="Approve & Log Match"
        onConfirm={handleApprove}
        onCancel={() => router.push("/admin")}
        cancelLabel="Back"
      />
    </div>
  )
}
