"use client"

import { useState, useTransition } from "react"
import { Check } from "lucide-react"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { cn } from "@/lib/utils"
import { castPlayerVote } from "../../award-actions"

interface RosterPlayer {
  id: string
  name: string
}

export function PlayerVoteForm({
  category,
  players,
  initialSelectedId,
  initialComment,
}: {
  category: string
  players: RosterPlayer[]
  initialSelectedId: string | null
  initialComment: string
}) {
  const [selected, setSelected] = useState<RosterPlayer | null>(
    players.find((p) => p.id === initialSelectedId) ?? null,
  )
  const [comment, setComment] = useState(initialComment)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(!!initialSelectedId)
  const [isPending, startTransition] = useTransition()

  function handleSubmit() {
    if (!selected) return
    setError(null)
    startTransition(async () => {
      const result = await castPlayerVote(category, selected.id, comment)
      if (result.success) {
        setSaved(true)
      } else {
        setError(result.error)
      }
    })
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-[#3d4855] bg-[#1f2833]/40 overflow-hidden">
        <Command className="bg-transparent" style={{ background: "transparent" }}>
          <CommandInput placeholder="Search players…" className="text-sm text-[#c5c6c7]" />
          <CommandList className="max-h-72">
            <CommandEmpty className="text-[#8892a0]">No players found.</CommandEmpty>
            <CommandGroup>
              {players.map((player) => (
                <CommandItem
                  key={player.id}
                  value={player.name}
                  onSelect={() => {
                    setSelected(player)
                    setSaved(false)
                    setError(null)
                  }}
                  className="text-[#c5c6c7] data-[selected=true]:bg-[#66fcf1]/10 data-[selected=true]:text-white"
                >
                  <Check
                    className={cn(
                      "mr-2 h-3.5 w-3.5 text-[#66fcf1]",
                      selected?.id === player.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {player.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>

      {selected && (
        <p className="text-sm text-[#8892a0]">
          Voting for <span className="font-semibold text-white">{selected.name}</span>
        </p>
      )}

      <div>
        <label htmlFor="vote-comment" className="block text-xs font-bold uppercase tracking-[0.12em] text-[#8892a0] mb-2">
          Comment (optional)
        </label>
        <textarea
          id="vote-comment"
          value={comment}
          onChange={(e) => {
            setComment(e.target.value)
            setSaved(false)
          }}
          rows={4}
          placeholder="Why them? (optional)"
          className="w-full rounded-lg border border-[#3d4855] bg-[#1f2833]/40 p-3 text-sm text-[#c5c6c7] placeholder:text-[#8892a0]/60 focus:outline-none focus:border-[#66fcf1] resize-none"
        />
      </div>

      {error && <p className="text-sm text-[#ff4757] text-center">{error}</p>}

      <button
        type="button"
        disabled={!selected || isPending}
        onClick={handleSubmit}
        className="w-full rounded-lg bg-[#66fcf1] py-3 font-bold text-[#0b0c10] shadow-[0_0_18px_rgba(102,252,241,0.25)] transition hover:brightness-110 disabled:opacity-30 disabled:cursor-not-allowed disabled:shadow-none"
      >
        {isPending ? "Saving…" : saved ? "Vote recorded — change anytime before voting closes" : "Submit vote"}
      </button>
    </div>
  )
}
