"use client"

import type { Player } from "@/lib/types"
import { isPlayerInactive } from "@/lib/fetch-players-db"
import { Mic, ChevronDown } from "lucide-react"
import { useMemo, useState } from "react"

interface TierListViewProps {
  players: Player[]
  searchQuery?: string
  roleFilter?: string | null
  micFilter?: boolean
  eliteFilter?: boolean
  currentTheme: string
  selectedPlayers: string[]
  onTogglePlayer: (playerName: string) => void
}

const tierNames: Record<number, string> = {
  10: "The Chosen One",
  9: "Jedi Grandmaster",
  8: "Jedi Master",
  7: "Jedi Sentinel",
  6: "Jedi Guardian",
  5: "Jedi Knight",
  4: "Jedi",
  3: "Padawan",
  2: "Initiate",
  1: "Youngling",
}

export function TierListView({
  players,
  searchQuery = "",
  roleFilter = null,
  micFilter = false,
  eliteFilter = false,
  currentTheme,
  selectedPlayers,
  onTogglePlayer,
}: TierListViewProps) {
  const filteredPlayers = useMemo(() => {
    return players.filter((player) => {
      if (searchQuery && !player.name.toLowerCase().includes(searchQuery.toLowerCase())) {
        return false
      }

      if (roleFilter && player.roles[roleFilter as keyof typeof player.roles] < 4) {
        return false
      }

      if (micFilter && !player.mic) {
        return false
      }

      if (eliteFilter) {
        const hasEliteRole = Object.values(player.roles).some((rating) => rating >= 8)
        if (!hasEliteRole) {
          return false
        }
      }

      return true
    })
  }, [players, searchQuery, roleFilter, micFilter, eliteFilter])

  const [inactiveExpanded, setInactiveExpanded] = useState(false)

  const { activeTiers, inactiveTiers, inactiveCount } = useMemo(() => {
    const active: Record<number, Player[]> = {}
    const inactive: Record<number, Player[]> = {}
    let count = 0

    for (let i = 10; i >= 1; i--) {
      active[i] = []
      inactive[i] = []
    }

    filteredPlayers.forEach((player) => {
      if (isPlayerInactive(player)) {
        inactive[player.tierValue].push(player)
        count++
      } else {
        active[player.tierValue].push(player)
      }
    })

    // Sort alphabetically within each tier
    Object.keys(active).forEach((tier) => {
      active[Number(tier)].sort((a, b) => a.name.localeCompare(b.name))
    })
    Object.keys(inactive).forEach((tier) => {
      inactive[Number(tier)].sort((a, b) => a.name.localeCompare(b.name))
    })

    return { activeTiers: active, inactiveTiers: inactive, inactiveCount: count }
  }, [filteredPlayers])

  const renderPlayerCard = (player: Player, isInactive = false) => {
    const selectionIndex = selectedPlayers.indexOf(player.name)
    const isSelected = selectionIndex !== -1

    return (
      <div
        key={player.name}
        onClick={() => onTogglePlayer(player.name)}
        className="backdrop-blur-md border rounded-lg p-3 transition-all cursor-pointer hover:scale-105"
        style={{
          backgroundColor: isSelected ? "var(--color-primary)" : "var(--color-surface)",
          borderColor: isSelected ? "var(--color-primary)" : "var(--color-border)",
          boxShadow: isSelected ? "0 0 15px var(--color-primary-glow)" : "none",
          opacity: isInactive && !isSelected ? 0.5 : 1,
        }}
      >
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            {isSelected && (
              <span
                className="text-xs font-bold w-5 h-5 rounded-full flex items-center justify-center"
                style={{
                  backgroundColor: "var(--color-background)",
                  color: "var(--color-primary)",
                }}
              >
                {selectionIndex + 1}
              </span>
            )}
            <span
              className="font-bold text-sm"
              style={{
                color: isSelected ? "var(--color-background)" : "var(--color-text-bright)",
              }}
            >
              {player.name}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {player.mic && (
              <Mic
                className="w-3.5 h-3.5"
                style={{
                  color: isSelected ? "var(--color-background)" : "var(--color-primary)",
                }}
              />
            )}
            <span
              className="text-xs font-bold px-2 py-0.5 rounded"
              style={{
                backgroundColor: isSelected ? "var(--color-background)" : "var(--color-primary)",
                color: isSelected ? "var(--color-primary)" : "var(--color-background)",
              }}
            >
              {player.tierValue}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-5 gap-1.5 text-xs">
          {Object.entries(player.roles).map(([role, rating]) => (
            <div
              key={role}
              className="flex flex-col items-center p-1.5 rounded"
              style={{
                backgroundColor: isSelected ? "rgba(0,0,0,0.2)" : "var(--color-surface-elevated)",
              }}
            >
              <span
                className="font-bold mb-0.5"
                style={{
                  color: isSelected
                    ? "var(--color-background)"
                    : rating >= 8
                      ? "var(--color-accent-green)"
                      : rating >= 6
                        ? "var(--color-primary)"
                        : rating >= 4
                          ? "var(--color-accent-yellow)"
                          : "var(--color-text-dim)",
                }}
              >
                {rating}
              </span>
              <span
                className="text-[9px] uppercase"
                style={{
                  color: isSelected ? "var(--color-background)" : "var(--color-text-dim)",
                }}
              >
                {role === "Cleaner" ? "BC" : role.slice(0, 3)}
              </span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Active Players by Tier */}
      {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((tier) => {
        const tierPlayers = activeTiers[tier]
        if (tierPlayers.length === 0) return null

        return (
          <div key={tier} className="space-y-2">
            <div className="flex items-center gap-3">
              <div
                className="px-4 py-1 rounded-md font-bold text-sm"
                style={{
                  backgroundColor: "var(--color-primary)",
                  color: "var(--color-background)",
                }}
              >
                {tierNames[tier]}
              </div>
              <div className="h-px flex-1" style={{ backgroundColor: "var(--color-border)" }} />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {tierPlayers.map((player) => renderPlayerCard(player, false))}
            </div>
          </div>
        )
      })}

      {/* Inactive Players Section */}
      {inactiveCount > 0 && (
        <div className="mt-6 border rounded-lg" style={{ borderColor: "var(--color-border)" }}>
          <button
            onClick={() => setInactiveExpanded(!inactiveExpanded)}
            className="w-full flex items-center justify-between px-4 py-3 transition-colors"
            style={{
              backgroundColor: "var(--color-surface)",
              color: "var(--color-text-dim)",
            }}
          >
            <span className="font-medium">Inactive Players ({inactiveCount})</span>
            <ChevronDown
              className={`w-5 h-5 transition-transform ${inactiveExpanded ? "rotate-180" : ""}`}
              style={{ color: "var(--color-text-dim)" }}
            />
          </button>

          {inactiveExpanded && (
            <div className="p-4 space-y-4" style={{ backgroundColor: "var(--color-surface)" }}>
              {[10, 9, 8, 7, 6, 5, 4, 3, 2, 1].map((tier) => {
                const tierPlayers = inactiveTiers[tier]
                if (tierPlayers.length === 0) return null

                return (
                  <div key={`inactive-${tier}`} className="space-y-2">
                    <div className="flex items-center gap-3">
                      <div
                        className="px-3 py-0.5 rounded text-xs font-medium"
                        style={{
                          backgroundColor: "var(--color-surface-elevated)",
                          color: "var(--color-text-dim)",
                        }}
                      >
                        {tierNames[tier]}
                      </div>
                      <div className="h-px flex-1" style={{ backgroundColor: "var(--color-border)" }} />
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {tierPlayers.map((player) => renderPlayerCard(player, true))}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
