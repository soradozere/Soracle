"use client"

import type { Player } from "@/lib/types"
import { Mic, MicOff, Slash, X, UserSearch } from "lucide-react"
import { useState, memo } from "react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Switch } from "@/components/ui/switch"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
} from "@/components/ui/context-menu"
import { playerSlug } from "@/lib/player-profile"

interface PlayerCardProps {
  player: Player
  isSelected: boolean
  selectionNumber?: number
  onToggle: () => void
  didNotMakeCut?: boolean
  currentTheme?: string
  onDisabledRolesChange?: (disabledRoles: string[]) => void
  winStats?: { wins: number; losses: number; draws: number }
}

const ROLE_COLORS = {
  Capper: "#62d6e8",
  Chase: "#27ae60",
  Camp: "#45a29e",
  Cleaner: "#9b59b6",
  Support: "#f39c12",
}

const ROLE_LABELS = {
  Capper: "CAP",
  Chase: "CHA",
  Camp: "CAM",
  Cleaner: "BC",
  Support: "SUP",
}

export const PlayerCard = memo(function PlayerCard({
  player,
  isSelected,
  selectionNumber,
  onToggle,
  didNotMakeCut,
  currentTheme = "jedi",
  onDisabledRolesChange,
  winStats,
}: PlayerCardProps) {
  const [showTooltip, setShowTooltip] = useState(false)
  const [popoverOpen, setPopoverOpen] = useState(false)

  const isBespin = currentTheme === "bespin"

  const primaryRole = Object.entries(player.roles).reduce((a, b) =>
    player.roles[a[0] as keyof typeof player.roles] > player.roles[b[0] as keyof typeof player.roles] ? a : b,
  )[0] as keyof typeof player.roles

  // Get roles that have ratings > 0
  const availableRoles = Object.entries(player.roles)
    .filter(([_, rating]) => rating > 0)
    .map(([role]) => role)

  const disabledRoles = player.disabledRoles || []
  const hasDisabledRoles = disabledRoles.length > 0

  // Check if all roles are disabled
  const allRolesDisabled = availableRoles.length > 0 && availableRoles.every((role) => disabledRoles.includes(role))

  const handleRoleToggle = (role: string) => {
    if (!onDisabledRolesChange) return

    const newDisabledRoles = disabledRoles.includes(role)
      ? disabledRoles.filter((r) => r !== role)
      : [...disabledRoles, role]

    onDisabledRolesChange(newDisabledRoles)
  }

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
    <div className="relative" onMouseEnter={() => setShowTooltip(true)} onMouseLeave={() => setShowTooltip(false)}>
      {showTooltip && player.tooltip && !popoverOpen && (
        <div
          className="absolute left-1/2 -translate-x-1/2 px-3 py-2 bg-[#1f2833]/95 backdrop-blur-md border border-[#66fcf1]/30 rounded-lg text-xs text-[#c5c6c7] whitespace-nowrap z-50 pointer-events-none shadow-lg"
          style={{ bottom: "calc(100% + 15px)" }}
        >
          {player.tooltip}
          <div className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-2 h-2 bg-[#1f2833] border-r border-b border-[#66fcf1]/30 rotate-45" />
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={onToggle}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onToggle() }}
        className={`relative bg-[#1f2833]/30 border rounded-lg p-4 text-left transition-all cursor-pointer hover:border-[#66fcf1] hover:shadow-[0_0_10px_rgba(102,252,241,0.3)] ${
          didNotMakeCut
            ? "border-[#ff4757] opacity-60"
            : isSelected
              ? "border-[#66fcf1] glow-border"
              : "border-[#3d4855]"
        } backdrop-blur-lg w-full`}
      >
        {isSelected && selectionNumber && (
          <div
            style={{
              backgroundColor: "var(--color-primary)",
              color: "var(--color-background)",
              boxShadow: "0 0 12px var(--color-primary-glow)",
            }}
            className="absolute -top-2 -right-2 w-8 h-8 rounded-full flex items-center justify-center font-bold text-sm border-2"
          >
            {selectionNumber}
          </div>
        )}

        {didNotMakeCut && (
          <div className="absolute -top-2 -left-2 px-2 py-1 bg-[#ff4757] text-white rounded text-xs font-bold">CUT</div>
        )}

        {isSelected && onDisabledRolesChange && (
          <Popover open={popoverOpen} onOpenChange={setPopoverOpen}>
            <PopoverTrigger asChild>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                }}
                className={`absolute -top-2 -left-2 w-7 h-7 rounded-full flex items-center justify-center font-bold text-xs border-2 transition-all z-10 ${
                  hasDisabledRoles
                    ? "bg-[#f39c12] border-[#f39c12] text-[#0b0c10] shadow-[0_0_12px_rgba(243,156,18,0.6)]"
                    : "bg-[#1f2833]/80 border-[#3d4855] text-[#8892a0] hover:border-[#66fcf1]"
                }`}
                title={hasDisabledRoles ? `${disabledRoles.length} role(s) disabled` : "Disable specific roles"}
              >
                <Slash className="w-4 h-4" />
              </button>
            </PopoverTrigger>
            <PopoverContent
              className="w-80 bg-[#1f2833]/95 backdrop-blur-md border-[#66fcf1]/50 p-0 overflow-hidden"
              align="start"
              side="right"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-[#3d4855]">
                <h3 className="font-bold text-[#66fcf1] text-sm font-mono">DISABLE ROLES</h3>
                <p className="text-xs text-[#8892a0] mt-1">{player.name}</p>
              </div>
              <div className="p-3 space-y-2 max-h-[300px] overflow-y-auto">
                {availableRoles.length === 0 ? (
                  <p className="text-xs text-[#8892a0] text-center py-4">No roles available</p>
                ) : (
                  <>
                    {allRolesDisabled && (
                      <div className="bg-[#ff4757]/20 border border-[#ff4757]/50 rounded p-2 mb-2">
                        <p className="text-xs text-[#ff4757] font-medium">
                          ⚠️ All roles disabled — player will have 0 role contribution
                        </p>
                      </div>
                    )}
                    {availableRoles.map((role) => {
                      const isDisabled = disabledRoles.includes(role)
                      const rating = player.roles[role as keyof typeof player.roles]
                      return (
                        <div
                          key={role}
                          className="flex items-center justify-between p-2 rounded hover:bg-[#0b0c10]/30 transition-colors"
                        >
                          <div className="flex items-center gap-3 flex-1">
                            <div
                              className="w-2 h-2 rounded-full"
                              style={{
                                backgroundColor: ROLE_COLORS[role as keyof typeof ROLE_COLORS],
                                opacity: isDisabled ? 0.3 : 1,
                              }}
                            />
                            <span
                              className={`text-sm font-medium ${isDisabled ? "line-through text-[#8892a0]" : "text-[#c5c6c7]"}`}
                            >
                              {role}
                            </span>
                            <span
                              className={`text-xs font-mono ${isDisabled ? "text-[#8892a0]" : "text-[#66fcf1]"}`}
                              style={{
                                color: isDisabled ? "#8892a0" : ROLE_COLORS[role as keyof typeof ROLE_COLORS],
                              }}
                            >
                              ({rating})
                            </span>
                          </div>
                          <Switch
                            checked={!isDisabled}
                            onCheckedChange={() => handleRoleToggle(role)}
                            className="data-[state=checked]:bg-[#27ae60] data-[state=unchecked]:bg-[#8892a0]/30"
                          />
                        </div>
                      )
                    })}
                  </>
                )}
              </div>
              {hasDisabledRoles && (
                <div className="p-3 border-t border-[#3d4855] bg-[#0b0c10]/30">
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      onDisabledRolesChange([])
                    }}
                    className="w-full px-3 py-1.5 bg-[#8b3a3a] text-white rounded text-xs font-medium hover:bg-[#ff4757] transition-colors flex items-center justify-center gap-2"
                  >
                    <X className="w-3 h-3" />
                    Reset All Roles
                  </button>
                </div>
              )}
            </PopoverContent>
          </Popover>
        )}

        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <h3 className="text-white font-bold text-lg mb-2 truncate">{player.name}</h3>
            <div className="flex flex-wrap gap-2 items-center">
              <span
                className="inline-block px-2 py-1 text-xs font-bold rounded opacity-60"
                style={{ backgroundColor: ROLE_COLORS[primaryRole], color: "#0b0c10" }}
              >
                {ROLE_LABELS[primaryRole]}
              </span>
              {hasDisabledRoles && (
                <span className="inline-block px-2 py-1 text-xs font-bold rounded bg-[#f39c12] text-[#0b0c10]">
                  {disabledRoles.length} OFF
                </span>
              )}
            </div>
          </div>
          <div className="ml-2 flex flex-col items-end gap-1">
            {player.mic ? <Mic className="w-4 h-4 text-[#27ae60]" /> : <MicOff className="w-4 h-4 text-[#8892a0]" />}
          </div>
        </div>

        <div className="space-y-2">
          {Object.entries(player.roles).map(([role, value]) => {
            const isDisabled = disabledRoles.includes(role)
            return (
              <div key={role} className="flex items-center gap-2">
                <span
                  className={`text-xs w-12 font-mono ${
                    isBespin
                      ? "text-[#b86b49] font-semibold"
                      : isDisabled
                        ? "text-[#8892a0] line-through"
                        : "text-[#8892a0]"
                  }`}
                >
                  {ROLE_LABELS[role as keyof typeof ROLE_LABELS]}
                </span>
                <div
                  className={`flex-1 h-2 rounded-full overflow-hidden border ${
                    isBespin ? "bg-[#d9cdb9] border-[#c4b59e]" : "bg-[#0b0c10] border-[#3d4855]"
                  }`}
                >
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${(value / 10) * 100}%`,
                      backgroundColor: ROLE_COLORS[role as keyof typeof ROLE_COLORS],
                      opacity: isDisabled ? 0.2 : isBespin ? 0.9 : 0.3,
                    }}
                  />
                </div>
                <span
                  className={`text-xs w-4 text-right font-mono font-bold ${isDisabled ? "text-[#8892a0] line-through" : "text-[#c5c6c7]"}`}
                >
                  {value}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </div>
      </ContextMenuTrigger>
      <ContextMenuContent className="bg-[#1f2833]/95 backdrop-blur-md border-[#66fcf1]/30 text-[#c5c6c7]">
        <ContextMenuItem
          className="gap-2 focus:bg-[#66fcf1]/10 focus:text-[#66fcf1]"
          onSelect={() => window.open(`/player/${playerSlug(player.name)}`, "_blank")}
        >
          <UserSearch className="w-4 h-4" />
          Show Profile
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
})
