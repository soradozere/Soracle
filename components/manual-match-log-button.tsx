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
        balance_confidence: 0,
        played_at: data.matchPlayedAtIso,
        match_stats: data.matchStats,
      }),
    )
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
      <MatchStatsCsvModal open={open} onOpenChange={setOpen} onCsvDataReady={handleLog} logMode />
    </>
  )
}
