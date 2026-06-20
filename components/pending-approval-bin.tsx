"use client"

import { useEffect, useState } from "react"
import { approvePendingMatch, getPendingCsv, getPendingMatches, rejectPendingMatch } from "@/app/admin/actions"
import { MatchStatsCsvModal } from "@/components/match-stats-csv-modal"
import { Button } from "@/components/ui/button"
import { Inbox, Loader2, Pencil, X } from "lucide-react"
import type { CsvMatchData } from "@/lib/types"

interface PendingParsedRow {
  in_game_name: string
  team: string
  suggested_player_id: string | null
  match_method: string | null
}

interface PendingMatch {
  id: string
  match_played_at: string | null
  distinct_players: number
  red_score: number
  blue_score: number
  csv_filename: string | null
  uploader_name: string | null
  created_at: string
  parsed: { rows?: PendingParsedRow[] } | null
}

function matchedCounts(p: PendingMatch): { matched: number; total: number } {
  const rows = p.parsed?.rows ?? []
  return { matched: rows.filter((r) => r.suggested_player_id).length, total: rows.length }
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

// Admin-only "Approval needed" queue at the top of Match History. Lists games the
// Discord bot uploaded; Review opens the same CSV modal (pending mode) for name
// editing + approval, Reject discards duplicates/junk. Renders nothing for
// non-admins or when the queue is empty.
export function PendingApprovalBin({
  isAdmin,
  onApproved,
}: {
  isAdmin: boolean
  onApproved: () => void
}) {
  const [pending, setPending] = useState<PendingMatch[]>([])
  const [loading, setLoading] = useState(true)
  const [reviewing, setReviewing] = useState<PendingMatch | null>(null)
  const [csvText, setCsvText] = useState<string | undefined>(undefined)
  const [csvFilename, setCsvFilename] = useState<string | undefined>(undefined)
  const [loadingCsvId, setLoadingCsvId] = useState<string | null>(null)
  const [rejectConfirmId, setRejectConfirmId] = useState<string | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isAdmin) {
      setLoading(false)
      return
    }
    getPendingMatches().then((result) => {
      if (result.success) setPending(result.data as PendingMatch[])
      setLoading(false)
    })
  }, [isAdmin])

  if (!isAdmin || loading || pending.length === 0) return null

  const startReview = async (p: PendingMatch) => {
    setError(null)
    setLoadingCsvId(p.id)
    const result = await getPendingCsv(p.id)
    setLoadingCsvId(null)
    if (!result.success || result.text === undefined) {
      setError(result.error || "Failed to load the scoreboard CSV.")
      return
    }
    setCsvText(result.text)
    setCsvFilename(result.filename)
    setReviewing(p)
  }

  const closeReview = () => {
    setReviewing(null)
    setCsvText(undefined)
    setCsvFilename(undefined)
  }

  const handleApprove = async (data: CsvMatchData) => {
    if (!reviewing) return
    const formData = new FormData()
    formData.append("file", data.csvFile)
    formData.append("pending_id", reviewing.id)
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
    if (result.success) {
      setPending((prev) => prev.filter((p) => p.id !== reviewing.id))
      onApproved()
    } else {
      setError(result.error || "Failed to approve the match.")
    }
  }

  const handleReject = async (id: string) => {
    setBusyId(id)
    const result = await rejectPendingMatch(id)
    setBusyId(null)
    setRejectConfirmId(null)
    if (result.success) {
      setPending((prev) => prev.filter((p) => p.id !== id))
    } else {
      setError(result.error || "Failed to reject the match.")
    }
  }

  return (
    <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4">
      <div className="mb-3 flex items-center gap-2">
        <Inbox className="h-5 w-5 text-amber-300" />
        <h3 className="text-base font-bold text-amber-200">Approval needed</h3>
        <span className="rounded-full bg-amber-500/20 px-2 py-0.5 text-xs font-medium text-amber-200">
          {pending.length}
        </span>
      </div>

      {error && (
        <div className="mb-3 rounded-md border border-red-500/40 bg-red-500/10 p-2 text-xs text-red-200">
          {error}
        </div>
      )}

      <div className="space-y-2">
        {pending.map((p) => {
          const { matched, total } = matchedCounts(p)
          const confirming = rejectConfirmId === p.id
          return (
            <div
              key={p.id}
              className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-[var(--color-border)] bg-black/20 px-3 py-2"
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-medium text-white">
                  <span>{formatDate(p.match_played_at)}</span>
                  <span className="text-[var(--color-text-dim)]">·</span>
                  <span className="tabular-nums">
                    Red {p.red_score} – Blue {p.blue_score}
                  </span>
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-[var(--color-text-dim)]">
                  <span>{p.distinct_players} players</span>
                  <span>·</span>
                  <span className={matched === total ? "text-green-400" : "text-amber-300"}>
                    {matched}/{total} matched
                  </span>
                  {p.uploader_name && (
                    <>
                      <span>·</span>
                      <span>via {p.uploader_name}</span>
                    </>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {confirming ? (
                  <>
                    <span className="text-xs text-[var(--color-text-dim)]">Reject?</span>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => handleReject(p.id)}
                      disabled={busyId === p.id}
                      className="h-8 bg-red-500/80 px-3 text-xs font-medium text-white hover:bg-red-500"
                    >
                      {busyId === p.id ? <Loader2 className="h-3 w-3 animate-spin" /> : "Yes, reject"}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectConfirmId(null)}
                      className="h-8 border-[var(--color-border)] bg-transparent px-3 text-xs text-white hover:bg-[var(--color-border)]"
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      type="button"
                      size="sm"
                      onClick={() => startReview(p)}
                      disabled={loadingCsvId === p.id}
                      className="h-8 bg-[#66fcf1] px-3 text-xs font-medium text-black hover:bg-[#66fcf1]/80"
                    >
                      {loadingCsvId === p.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <>
                          <Pencil className="mr-1 h-3 w-3" />
                          Review
                        </>
                      )}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={() => setRejectConfirmId(p.id)}
                      className="h-8 border-[var(--color-border)] bg-transparent px-3 text-xs text-[var(--color-text-dim)] hover:bg-[var(--color-border)] hover:text-white"
                    >
                      <X className="mr-1 h-3 w-3" />
                      Reject
                    </Button>
                  </>
                )}
              </div>
            </div>
          )
        })}
      </div>

      {/* Keyed by the entry under review so each review remounts fresh — picking
          up any aliases learned from approving a previous game this session. */}
      <MatchStatsCsvModal
        key={reviewing?.id ?? "none"}
        open={reviewing !== null && csvText !== undefined}
        onOpenChange={(o) => {
          if (!o) closeReview()
        }}
        onCsvDataReady={handleApprove}
        pendingCsvText={csvText}
        pendingCsvFilename={csvFilename}
      />
    </div>
  )
}
