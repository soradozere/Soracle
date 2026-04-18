"use client"

import { Search, X } from "lucide-react"
import { useRef, useState, useEffect, type KeyboardEvent } from "react"
import type { Player } from "@/lib/types"

interface FilterPanelProps {
  searchQuery: string
  setSearchQuery: (query: string) => void
  roleFilter: string | null
  setRoleFilter: (role: string | null) => void
  micFilter: boolean
  setMicFilter: (enabled: boolean) => void
  eliteFilter: boolean
  setEliteFilter: (enabled: boolean) => void
  players?: Player[]
  onSelectPlayer?: (playerName: string) => void
  showDropdown?: boolean
  setShowDropdown?: (show: boolean) => void
}

const ROLES = ["Capper", "Chase", "Camp", "Cleaner", "Support"]

export function FilterPanel({
  searchQuery,
  setSearchQuery,
  roleFilter,
  setRoleFilter,
  micFilter,
  setMicFilter,
  eliteFilter,
  setEliteFilter,
  players = [],
  onSelectPlayer,
  showDropdown = false,
  setShowDropdown,
}: FilterPanelProps) {
  const hasActiveFilters = searchQuery || roleFilter || micFilter || eliteFilter
  const searchInputRef = useRef<HTMLInputElement>(null)
  const [highlightedIndex, setHighlightedIndex] = useState(0)

  const filteredSearchPlayers = players.filter((player) =>
    player.name.toLowerCase().includes(searchQuery.toLowerCase()),
  )

  useEffect(() => {
    setHighlightedIndex(0)
  }, [searchQuery])

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (!showDropdown || filteredSearchPlayers.length === 0) return

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setHighlightedIndex((prev) => Math.min(prev + 1, filteredSearchPlayers.length - 1))
        break
      case "ArrowUp":
        e.preventDefault()
        setHighlightedIndex((prev) => Math.max(prev - 1, 0))
        break
      case "Enter":
        e.preventDefault()
        if (filteredSearchPlayers[highlightedIndex] && onSelectPlayer) {
          handleSelectPlayer(filteredSearchPlayers[highlightedIndex].name)
        }
        break
      case "Escape":
        e.preventDefault()
        setSearchQuery("")
        setShowDropdown?.(false)
        break
    }
  }

  const handleSelectPlayer = (playerName: string) => {
    onSelectPlayer?.(playerName)
    setSearchQuery("")
    setShowDropdown?.(true)
    // Auto-refocus the input
    setTimeout(() => {
      searchInputRef.current?.focus()
    }, 0)
  }

  const clearAll = () => {
    setSearchQuery("")
    setRoleFilter(null)
    setMicFilter(false)
    setEliteFilter(false)
  }

  return (
    <div className="mt-4 pt-4 border-t border-border space-y-3">
      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-text-dim" />
        <input
          ref={searchInputRef}
          type="text"
          placeholder="Search players..."
          value={searchQuery}
          onChange={(e) => {
            setSearchQuery(e.target.value)
            setShowDropdown?.(true)
          }}
          onFocus={() => setShowDropdown?.(true)}
          onKeyDown={handleKeyDown}
          className="w-full pl-10 pr-4 py-2 bg-background/60 backdrop-blur-sm border border-border rounded-md text-text focus:outline-none focus:border-primary transition-colors"
        />

        {showDropdown && searchQuery && filteredSearchPlayers.length > 0 && (
          <div className="absolute z-50 w-full mt-1 bg-surface-elevated/95 backdrop-blur-md border border-border rounded-md shadow-lg max-h-60 overflow-y-auto">
            {filteredSearchPlayers.map((player, index) => (
              <button
                key={player.name}
                onClick={() => handleSelectPlayer(player.name)}
                className={`w-full px-4 py-2 text-left text-sm transition-colors ${
                  index === highlightedIndex ? "bg-primary/30 text-text" : "text-text hover:bg-primary/20"
                }`}
              >
                {player.name}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Filter Chips */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text-dim text-sm">Filters:</span>

        {/* Role Filters */}
        {ROLES.map((role) => (
          <button
            key={role}
            onClick={() => setRoleFilter(roleFilter === role ? null : role)}
            className={`px-3 py-1 rounded-md text-xs font-bold transition-all backdrop-blur-sm ${
              roleFilter === role
                ? "bg-primary text-background"
                : "bg-surface-elevated/60 text-text hover:bg-primary/20"
            }`}
          >
            {role}
          </button>
        ))}

        {/* Mic Filter */}
        <button
          onClick={() => setMicFilter(!micFilter)}
          className={`px-3 py-1 rounded-md text-xs font-bold transition-all backdrop-blur-sm ${
            micFilter ? "bg-primary text-background" : "bg-surface-elevated/60 text-text hover:bg-primary/20"
          }`}
        >
          Has Mic
        </button>

        {/* Elite Filter */}
        <button
          onClick={() => setEliteFilter(!eliteFilter)}
          className={`px-3 py-1 rounded-md text-xs font-bold transition-all backdrop-blur-sm ${
            eliteFilter ? "bg-primary text-background" : "bg-surface-elevated/60 text-text hover:bg-primary/20"
          }`}
        >
          Elite (8+)
        </button>

        {/* Clear All */}
        {hasActiveFilters && (
          <button
            onClick={clearAll}
            className="px-3 py-1 rounded-md text-xs font-bold bg-danger/20 text-danger hover:bg-danger/30 transition-all backdrop-blur-sm"
          >
            <X className="w-3 h-3 inline mr-1" />
            Clear
          </button>
        )}
      </div>
    </div>
  )
}
