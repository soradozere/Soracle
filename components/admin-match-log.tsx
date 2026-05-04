"use client"

import { useState, useEffect, useRef } from "react"
import { logMatch } from "@/app/admin/actions"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import { evaluateTeams } from "@/lib/balance-algorithm"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Check, X, Loader2, ChevronRight, ChevronLeft, Search, Calendar } from "lucide-react"
import type { Player } from "@/lib/types"

function getBalanceConfidence(score: number): number {
  const k = 0.004
  const floor = 30
  const raw = floor + (100 - floor) * Math.exp(-k * score)
  return Math.round(raw)
}

function getConfidenceColor(confidence: number): { bg: string; text: string } {
  if (confidence >= 80) {
    return { bg: "bg-[#27ae60]/20", text: "text-[#27ae60]" }
  } else if (confidence >= 60) {
    return { bg: "bg-[#f39c12]/20", text: "text-[#f39c12]" }
  } else {
    return { bg: "bg-[#ff4757]/20", text: "text-[#ff4757]" }
  }
}

export function AdminMatchLog() {
  const [players, setPlayers] = useState<Player[]>([])
  const [redTeam, setRedTeam] = useState<string[]>([])
  const [blueTeam, setBlueTeam] = useState<string[]>([])
  const [redScore, setRedScore] = useState<string>("")
  const [blueScore, setBlueScore] = useState<string>("")
  const [notes, setNotes] = useState("")
  const [matchType, setMatchType] = useState<"algorithm" | "manual">("manual")
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null)
  const [searchQuery, setSearchQuery] = useState("")
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [activeTeam, setActiveTeam] = useState<"red" | "blue">("red")
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [balanceScore, setBalanceScore] = useState<number | null>(null)
  const [matchDate, setMatchDate] = useState<string>(() => {
    const now = new Date()
    // Format as YYYY-MM-DDTHH:MM for datetime-local input
    const pad = (n: number) => String(n).padStart(2, "0")
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
  })

  useEffect(() => {
    fetchPlayersFromDB().then(setPlayers)
  }, [])

  const availablePlayers = players.filter(
    (p) => !redTeam.includes(p.name) && !blueTeam.includes(p.name)
  )

  const filteredPlayers = availablePlayers.filter((p) =>
    p.name.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // Reset highlighted index when search changes or filtered results change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [searchQuery])

  // Auto-focus search input on mount
  useEffect(() => {
    searchInputRef.current?.focus()
  }, [])

  // Auto-calculate balance score when both teams have 6 players
  useEffect(() => {
    if (redTeam.length === 6 && blueTeam.length === 6 && players.length > 0) {
      const result = evaluateTeams(redTeam, blueTeam, players)
      if (result) {
        setBalanceScore(result.score)
      } else {
        setBalanceScore(null)
      }
    } else {
      setBalanceScore(null)
    }
  }, [redTeam, blueTeam, players])

  const addToRed = (name: string) => {
    if (redTeam.length < 6) {
      setRedTeam([...redTeam, name])
      setSearchQuery("")
      searchInputRef.current?.focus()
    }
  }

  const addToBlue = (name: string) => {
    if (blueTeam.length < 6) {
      setBlueTeam([...blueTeam, name])
      setSearchQuery("")
      searchInputRef.current?.focus()
    }
  }

  const addToActiveTeam = (name: string) => {
    if (activeTeam === "red" && redTeam.length < 6) {
      addToRed(name)
      // Auto-switch to blue when red is full
      if (redTeam.length === 5) setActiveTeam("blue")
    } else if (activeTeam === "blue" && blueTeam.length < 6) {
      addToBlue(name)
    } else if (activeTeam === "red" && redTeam.length >= 6 && blueTeam.length < 6) {
      // Red full, auto-add to blue
      addToBlue(name)
    } else if (activeTeam === "blue" && blueTeam.length >= 6 && redTeam.length < 6) {
      // Blue full, auto-add to red
      addToRed(name)
    }
  }

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (filteredPlayers.length === 0) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredPlayers.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightedIndex((prev) => Math.max(prev - 1, 0))
        break
      case "ArrowLeft":
        e.preventDefault()
        if (redTeam.length < 6) {
          addToRed(filteredPlayers[highlightedIndex].name)
        }
        break
      case "ArrowRight":
        e.preventDefault()
        if (blueTeam.length < 6) {
          addToBlue(filteredPlayers[highlightedIndex].name)
        }
        break
      case "Enter":
        e.preventDefault()
        addToActiveTeam(filteredPlayers[highlightedIndex].name)
        break
    }
  }

  const removeFromRed = (name: string) => {
    setRedTeam(redTeam.filter((p) => p !== name))
  }

  const removeFromBlue = (name: string) => {
    setBlueTeam(blueTeam.filter((p) => p !== name))
  }

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

    if (redTeam.length !== 6 || blueTeam.length !== 6) {
      setMessage({ type: "error", text: "Both teams must have exactly 6 players" })
      setIsSubmitting(false)
      return
    }

    const result = await logMatch({
      red_team: redTeam,
      blue_team: blueTeam,
      red_score: red,
      blue_score: blue,
      match_type: matchType,
      balance_confidence: balanceScore !== null ? Math.round(balanceScore) : 0,
      notes: notes || undefined,
      played_at: matchDate ? new Date(matchDate).toISOString() : undefined,
    })

    if (result.success) {
      setMessage({ type: "success", text: "Match logged successfully!" })
      setRedTeam([])
      setBlueTeam([])
      setRedScore("")
      setBlueScore("")
      setNotes("")
    } else {
      setMessage({ type: "error", text: result.error || "Failed to log match" })
    }

    setIsSubmitting(false)
  }

  const clearAll = () => {
    setRedTeam([])
    setBlueTeam([])
    setRedScore("")
    setBlueScore("")
    setNotes("")
    setMessage(null)
    const now = new Date()
    const pad = (n: number) => String(n).padStart(2, "0")
    setMatchDate(`${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`)
  }

  return (
    <div className="border rounded-lg p-6 bg-card">
      <form onSubmit={handleSubmit} className="space-y-6">
        {/* Match Type Toggle */}
        <div className="flex gap-2">
          <Button
            type="button"
            variant={matchType === "manual" ? "default" : "outline"}
            onClick={() => setMatchType("manual")}
            size="sm"
          >
            Manual
          </Button>
          <Button
            type="button"
            variant={matchType === "algorithm" ? "default" : "outline"}
            onClick={() => setMatchType("algorithm")}
            size="sm"
          >
            Algorithm
          </Button>
        </div>

        {/* Team Selection */}
        <div className="grid grid-cols-3 gap-4">
          {/* Red Team */}
          <div className="border border-red-500/30 rounded-lg p-4 bg-red-500/5">
            <h3 className="font-bold text-red-500 mb-3">Red Team ({redTeam.length}/6)</h3>
            <div className="space-y-2 min-h-[200px]">
              {redTeam.map((name) => (
                <div
                  key={name}
                  className="flex items-center justify-between bg-red-500/10 px-3 py-2 rounded text-sm"
                >
                  <span>{name}</span>
                  <button
                    type="button"
                    onClick={() => removeFromRed(name)}
                    className="text-red-400 hover:text-red-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>

          {/* Available Players */}
          <div className="border rounded-lg p-4">
            {/* Active Team Toggle */}
            <div className="flex gap-1 mb-3">
              <button
                type="button"
                onClick={() => setActiveTeam("red")}
                className={`flex-1 py-1 px-2 rounded text-xs font-bold transition-all ${
                  activeTeam === "red"
                    ? "bg-red-500 text-white"
                    : "bg-red-500/10 text-red-400 hover:bg-red-500/20"
                }`}
              >
                Red
              </button>
              <button
                type="button"
                onClick={() => setActiveTeam("blue")}
                className={`flex-1 py-1 px-2 rounded text-xs font-bold transition-all ${
                  activeTeam === "blue"
                    ? "bg-blue-500 text-white"
                    : "bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                }`}
              >
                Blue
              </button>
            </div>

            {/* Search Input */}
            <div className="relative mb-3">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                type="text"
                placeholder="Search players..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
                className="pl-8 h-9"
              />
            </div>

            <h3 className="font-bold text-muted-foreground mb-2 text-sm">
              Available ({filteredPlayers.length}{searchQuery && ` / ${availablePlayers.length}`})
            </h3>
            <div className="space-y-1 max-h-[250px] overflow-y-auto">
              {filteredPlayers.map((player, index) => (
                <div
                  key={player.name}
                  className={`flex items-center justify-between px-2 py-1.5 rounded text-sm transition-colors ${
                    index === highlightedIndex
                      ? "bg-muted"
                      : "hover:bg-muted/50"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => addToRed(player.name)}
                    className="text-red-400 hover:text-red-300 disabled:opacity-30"
                    disabled={redTeam.length >= 6}
                  >
                    <ChevronLeft className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => addToActiveTeam(player.name)}
                    className={`flex-1 text-center hover:underline ${
                      index === highlightedIndex ? "font-medium" : ""
                    }`}
                    disabled={redTeam.length >= 6 && blueTeam.length >= 6}
                  >
                    {player.name}
                  </button>
                  <button
                    type="button"
                    onClick={() => addToBlue(player.name)}
                    className="text-blue-400 hover:text-blue-300 disabled:opacity-30"
                    disabled={blueTeam.length >= 6}
                  >
                    <ChevronRight className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {filteredPlayers.length === 0 && searchQuery && (
                <p className="text-center text-muted-foreground text-sm py-4">
                  No players found
                </p>
              )}
            </div>
          </div>

          {/* Blue Team */}
          <div className="border border-blue-500/30 rounded-lg p-4 bg-blue-500/5">
            <h3 className="font-bold text-blue-500 mb-3">Blue Team ({blueTeam.length}/6)</h3>
            <div className="space-y-2 min-h-[200px]">
              {blueTeam.map((name) => (
                <div
                  key={name}
                  className="flex items-center justify-between bg-blue-500/10 px-3 py-2 rounded text-sm"
                >
                  <span>{name}</span>
                  <button
                    type="button"
                    onClick={() => removeFromBlue(name)}
                    className="text-blue-400 hover:text-blue-300"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Balance Confidence Preview */}
        {balanceScore !== null && (
          <div className="flex items-center justify-center gap-3 py-3 px-4 rounded-lg bg-muted/30 border">
            <span className="text-sm text-muted-foreground">Balance:</span>
            {(() => {
              const confidence = getBalanceConfidence(balanceScore)
              const colors = getConfidenceColor(confidence)
              return (
                <span className={`font-mono font-bold px-3 py-1 rounded-full text-sm ${colors.bg} ${colors.text}`}>
                  {confidence}%
                </span>
              )
            })()}
            <span className="text-xs text-muted-foreground">
              (raw: {balanceScore.toFixed(1)})
            </span>
          </div>
        )}

        {/* Scores */}
        <div className="flex gap-4 items-end">
          <div className="flex-1">
            <label className="block text-sm font-medium text-red-500 mb-1">Red Score</label>
            <Input
              type="number"
              min="0"
              value={redScore}
              onChange={(e) => setRedScore(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex-1">
            <label className="block text-sm font-medium text-blue-500 mb-1">Blue Score</label>
            <Input
              type="number"
              min="0"
              value={blueScore}
              onChange={(e) => setBlueScore(e.target.value)}
              placeholder="0"
            />
          </div>
        </div>

        {/* Match Date/Time */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1 flex items-center gap-1.5">
            <Calendar className="w-4 h-4" />
            Match Date &amp; Time
          </label>
          <Input
            type="datetime-local"
            value={matchDate}
            onChange={(e) => setMatchDate(e.target.value)}
            max={(() => {
              const now = new Date()
              const pad = (n: number) => String(n).padStart(2, "0")
              return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}`
            })()}
            className="w-full"
          />
          <p className="text-xs text-muted-foreground mt-1">
            Defaults to now. Change this if you&apos;re logging a match that happened earlier.
          </p>
        </div>

        {/* Notes */}
        <div>
          <label className="block text-sm font-medium text-muted-foreground mb-1">
            Notes (optional)
          </label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Any notes about this match..."
            className="resize-none h-20"
          />
        </div>

        {message && (
          <div
            className={`flex items-center gap-2 text-sm ${
              message.type === "success" ? "text-green-500" : "text-red-500"
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

        <div className="flex gap-3">
          <Button
            type="submit"
            disabled={isSubmitting || redTeam.length !== 6 || blueTeam.length !== 6 || !redScore || !blueScore}
            className="flex-1"
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
          <Button type="button" variant="outline" onClick={clearAll}>
            Clear
          </Button>
        </div>
      </form>
    </div>
  )
}
