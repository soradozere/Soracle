"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { ArrowRight, X } from 'lucide-react'

interface TierChange {
  id: string
  player_name: string
  previous_tier: number
  new_tier: number
  changed_at: string
  hidden: boolean
}

interface TierChangelogProps {
  year: number
  month: number // 1-based (1 = January)
  isAdmin?: boolean
}

export function TierChangelog({ year, month, isAdmin = false }: TierChangelogProps) {
  const [changes, setChanges] = useState<TierChange[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const { toast } = useToast()
  const supabase = createClient()

  useEffect(() => {
    fetchChanges()
  }, [year, month, isAdmin])

  async function fetchChanges() {
    setIsLoading(true)

    const monthStart = new Date(year, month - 1, 1)
    const monthEnd = new Date(year, month, 0, 23, 59, 59)

    let query = supabase
      .from("tier_changes")
      .select("*")
      .gte("changed_at", monthStart.toISOString())
      .lte("changed_at", monthEnd.toISOString())
      .order("changed_at", { ascending: false })

    if (!isAdmin) {
      query = query.or("hidden.is.null,hidden.eq.false")
    }

    const { data, error } = await query

    if (error) {
      toast({
        title: "Error",
        description: "Failed to fetch tier changes",
        variant: "destructive",
      })
    } else {
      setChanges(data || [])
    }
    setIsLoading(false)
  }

  async function hideChange(id: string) {
    const { error } = await supabase
      .from("tier_changes")
      .update({ hidden: true })
      .eq("id", id)

    if (error) {
      toast({
        title: "Error",
        description: "Failed to hide entry",
        variant: "destructive",
      })
    } else {
      setChanges((prev) => prev.filter((c) => c.id !== id))
    }
  }

  const formatDate = (dateString: string) => {
    const date = new Date(dateString)
    return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  }

  if (isLoading) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-6 bg-[var(--color-surface)]">
        <h2 className="text-lg font-semibold mb-4 text-[var(--color-text)]">Tier Changelog</h2>
        <div className="text-center text-[var(--color-text-dim)] py-8">Loading...</div>
      </div>
    )
  }

  if (!changes || changes.length === 0) {
    return (
      <div className="rounded-lg border border-[var(--color-border)] p-6 bg-[var(--color-surface)]">
        <h2 className="text-lg font-semibold mb-4 text-[var(--color-text)]">Tier Changelog</h2>
        <div className="text-center text-[var(--color-text-dim)] py-8">
          No tier changes in {new Date(year, month - 1).toLocaleString("en-US", { month: "long", year: "numeric" })}
        </div>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-[var(--color-border)] p-6 bg-[var(--color-surface)]">
      <h2 className="text-lg font-semibold mb-4 text-[var(--color-text)]">Tier Changelog</h2>
      <div className="space-y-3">
        {changes.filter((c) => isAdmin || !c.hidden).map((change) => (
          <div
            key={change.id}
            className="relative flex items-center justify-between p-3 rounded-md bg-[var(--color-background)] border border-[var(--color-border)]/50 hover:bg-[var(--color-background)]/80 transition-colors"
          >
            {isAdmin && (
              <button
                onClick={() => hideChange(change.id)}
                className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-full text-[var(--color-text-dim)] hover:text-[#ff4757] hover:bg-[#ff4757]/10 transition-colors"
                title="Hide from clients"
              >
                <X className="w-3 h-3" />
              </button>
            )}
            <div className="flex items-center gap-4 flex-1">
              <span className="font-medium text-[var(--color-text)] min-w-fit">
                {change.player_name}
              </span>
              <div className="flex items-center gap-2">
                <span className="px-2 py-1 rounded text-sm font-semibold bg-[var(--color-text-dim)]/15 text-[var(--color-text-dim)]">
                  Tier {change.previous_tier}
                </span>
                <ArrowRight className="w-4 h-4 text-[var(--color-text-dim)]" />
                <span className="px-2 py-1 rounded text-sm font-semibold bg-green-500/20 text-green-600">
                  Tier {change.new_tier}
                </span>
              </div>
            </div>
            <span className={`text-sm text-[var(--color-text-dim)] whitespace-nowrap ${isAdmin ? "pr-5" : ""}`}>
              {formatDate(change.changed_at)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}
