"use client"

import { useState } from "react"
import { logMatchWithStats } from "@/app/admin/actions"
import { MatchStatsCsvModal } from "@/components/match-stats-csv-modal"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Plus } from "lucide-react"
import type { CsvMatchData } from "@/lib/types"

// Admin button on Match History that opens the CSV modal in log mode: upload a
// scoreboard, map names, pick Manual/Algorithm, and log the match directly (same
// path as the bot-approval flow, minus the pending step). For scoreboards that
// never came through the bot.
//
// Deliberately still a modal. The common case is "upload, glance, publish", and
// routing that through a page load made a two-second job feel like a process.
// When something DOES look off, the modal's "Review in full" button escalates to
// /admin/review/[id] — see the modal for how that hand-off works.
export function ManualMatchLogButton({ onLogged }: { onLogged: () => void }) {
  const [open, setOpen] = useState(false)
  const { toast } = useToast()

  const handleLog = async (data: CsvMatchData) => {
    const formData = new FormData()
    formData.append("file", data.csvFile)
    formData.append(
      "payload",
      JSON.stringify({
        uuid: crypto.randomUUID(),
        red_team: data.redTeamNames,
        blue_team: data.blueTeamNames,
        red_score: data.redScore,
        blue_score: data.blueScore,
        match_type: data.matchType ?? "manual",
        // Hand-logged: no balancer ran, so there is no score. Not 0 — that
        // is the value of a flawless split (see lib/balance-confidence.ts).
        balance_confidence: null,
        played_at: data.matchPlayedAtIso,
        match_stats: data.matchStats,
      }),
    )
    // The modal closes the instant this fires (see onConfirm in
    // MatchStatsCsvModal), so a thrown/rejected call here — a Server Action
    // request Next.js rejects outright (e.g. over the body size limit) never
    // reaches logMatchWithStats's own try/catch — must still be caught, or the
    // failure is invisible: no toast, dialog already gone, nothing logged.
    try {
      const result = await logMatchWithStats(formData)
      if (result.success) {
        toast({ title: "Match logged with stats." })
        onLogged()
      } else {
        toast({
          title: "Failed to log match",
          description: result.error,
          variant: "destructive",
        })
      }
    } catch (error) {
      toast({
        title: "Failed to log match",
        description: error instanceof Error ? error.message : "The request failed before reaching the server.",
        variant: "destructive",
      })
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => setOpen(true)}
        className="h-8 bg-[#66fcf1] px-3 text-xs font-medium text-black hover:bg-[#66fcf1]/80"
      >
        <Plus className="mr-1 h-3 w-3" />
        Log a Match
      </Button>
      <MatchStatsCsvModal
        open={open}
        onOpenChange={setOpen}
        onCsvDataReady={handleLog}
        logMode
        allowEscalate
      />
    </>
  )
}
