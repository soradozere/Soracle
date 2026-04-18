"use client"

import { useState } from "react"
import { logMatch } from "@/app/admin/actions"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Check, X, Loader2 } from "lucide-react"

interface MatchLogFormProps {
  redTeam: string[]
  blueTeam: string[]
  balanceConfidence: number
  matchType: "normal" | "competitive"
  onSuccess?: () => void
}

export function MatchLogForm({
  redTeam,
  blueTeam,
  balanceConfidence,
  matchType,
  onSuccess,
}: MatchLogFormProps) {
  const [redScore, setRedScore] = useState<string>("")
  const [blueScore, setBlueScore] = useState<string>("")
  const [notes, setNotes] = useState("")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSubmitting(true)
    setMessage(null)

    const red = parseInt(redScore)
    const blue = parseInt(blueScore)

    if (isNaN(red) || isNaN(blue) || red < 0 || blue < 0) {
      setMessage({ type: "error", text: "Please enter valid scores" })
      setIsSubmitting(false)
      return
    }

    const result = await logMatch({
      red_team: redTeam,
      blue_team: blueTeam,
      red_score: red,
      blue_score: blue,
      match_type: matchType,
      balance_confidence: balanceConfidence,
      notes: notes || undefined,
    })

    if (result.success) {
      setMessage({ type: "success", text: "Match logged successfully!" })
      setRedScore("")
      setBlueScore("")
      setNotes("")
      onSuccess?.()
    } else {
      setMessage({ type: "error", text: result.error || "Failed to log match" })
    }

    setIsSubmitting(false)
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="flex gap-4 items-end">
        <div className="flex-1">
          <label className="block text-sm font-medium text-[#ff4757] mb-1">
            Red Score
          </label>
          <Input
            type="number"
            min="0"
            value={redScore}
            onChange={(e) => setRedScore(e.target.value)}
            placeholder="0"
            className="bg-[#1a1a2e]/50 border-[#ff4757]/30 text-[#e0e0e0] placeholder:text-[#8892a0]"
          />
        </div>
        <div className="flex-1">
          <label className="block text-sm font-medium text-[#00d4ff] mb-1">
            Blue Score
          </label>
          <Input
            type="number"
            min="0"
            value={blueScore}
            onChange={(e) => setBlueScore(e.target.value)}
            placeholder="0"
            className="bg-[#1a1a2e]/50 border-[#00d4ff]/30 text-[#e0e0e0] placeholder:text-[#8892a0]"
          />
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium text-[#c5c6c7] mb-1">
          Notes (optional)
        </label>
        <Textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Any notes about this match..."
          className="bg-[#1a1a2e]/50 border-[#3a3a5a] text-[#e0e0e0] placeholder:text-[#8892a0] resize-none h-20"
        />
      </div>

      {message && (
        <div
          className={`flex items-center gap-2 text-sm ${
            message.type === "success" ? "text-[#27ae60]" : "text-[#ff4757]"
          }`}
        >
          {message.type === "success" ? (
            <Check className="w-4 h-4" />
          ) : (
            <X className="w-4 h-4" />
          )}
          {message.text}
        </div>
      )}

      <Button
        type="submit"
        disabled={isSubmitting || !redScore || !blueScore}
        className="w-full bg-gradient-to-r from-[#00d4ff] to-[#7b2cbf] hover:opacity-90 text-white font-semibold"
      >
        {isSubmitting ? (
          <>
            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
            Logging Match...
          </>
        ) : (
          "Log Match Result"
        )}
      </Button>
    </form>
  )
}
