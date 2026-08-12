"use client"

import { useState, useTransition } from "react"
import { DEMO_REACTIONS, type ReactionCounts, type ReactionId } from "@/lib/demo-reactions"
import { reactToDemo } from "@/app/(main)/demos/actions"
import { cn } from "@/lib/utils"

/**
 * Read-only tally, for the library cards. Shows only the reactions a demo has
 * actually drawn, so an unreacted demo doesn't render six greyed-out zeroes on
 * every card in the grid.
 */
export function ReactionSummary({ counts, total }: { counts: ReactionCounts; total: number }) {
  if (total === 0) return <span className="text-xs text-muted-foreground">No reactions yet</span>
  const present = DEMO_REACTIONS.filter((r) => counts[r.id] > 0)
  return (
    <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
      {present.map((r) => (
        <span key={r.id} className="flex items-center gap-0.5" title={`${counts[r.id]} × ${r.label}`}>
          <span aria-hidden>{r.emoji}</span>
          <span className="tabular-nums">{counts[r.id]}</span>
        </span>
      ))}
    </span>
  )
}

/**
 * The interactive picker on a demo page.
 *
 * One reaction per player: choosing a second replaces the first, and pressing
 * your own again clears it. The chosen one glows and the rest dim, so what you
 * picked is legible without reading the counts.
 *
 * Counts are updated locally on click rather than waiting for a refetch. The
 * server is the authority, but a reaction that visibly does nothing for a
 * round-trip reads as broken, and the arithmetic here is only ever +1/-1 on
 * numbers this component already has.
 */
export function ReactionPicker({
  demoId,
  counts,
  mine,
  canReact,
}: {
  demoId: string
  counts: ReactionCounts
  mine: ReactionId | null
  canReact: boolean
}) {
  const [selected, setSelected] = useState<ReactionId | null>(mine)
  const [tally, setTally] = useState<ReactionCounts>(counts)
  const [pending, startTransition] = useTransition()
  const [error, setError] = useState<string | null>(null)

  function choose(id: ReactionId) {
    if (!canReact || pending) return
    // Pressing the selected one again clears it.
    const next = selected === id ? null : id
    const previous = selected

    setSelected(next)
    setTally((t) => {
      const updated = { ...t }
      if (previous) updated[previous] = Math.max(0, updated[previous] - 1)
      if (next) updated[next] = updated[next] + 1
      return updated
    })
    setError(null)

    startTransition(async () => {
      const result = await reactToDemo(demoId, next)
      if (!result.success) {
        // Put it back exactly as it was rather than leaving the UI claiming
        // something the database never accepted.
        setSelected(previous)
        setTally(counts)
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        {DEMO_REACTIONS.map((r) => {
          const isMine = selected === r.id
          const count = tally[r.id]
          return (
            <button
              key={r.id}
              type="button"
              onClick={() => choose(r.id)}
              disabled={!canReact || pending}
              aria-pressed={isMine}
              aria-label={r.label}
              title={canReact ? r.label : "Log in as a player to react"}
              className={cn(
                "flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm transition-all",
                canReact && "hover:border-foreground/40 hover:opacity-100",
                isMine
                  ? "border-primary/70 bg-primary/10 opacity-100 shadow-[0_0_12px_-2px_var(--color-primary-glow)]"
                  : "border-border bg-transparent",
                // Everything that isn't the pick recedes, but only once
                // something has been picked -- dimming all six by default would
                // just make the whole row look disabled.
                selected && !isMine ? "opacity-45" : "opacity-90",
                !canReact && "cursor-default",
              )}
            >
              <span aria-hidden>{r.emoji}</span>
              {count > 0 && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
            </button>
          )
        })}
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {!canReact && <p className="text-xs text-muted-foreground">Log in as a player to react.</p>}
    </div>
  )
}
