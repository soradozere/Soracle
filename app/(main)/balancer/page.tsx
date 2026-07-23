"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import Link from "next/link"
import { PlayerCard } from "@/components/player-card"
import { TeamDisplay } from "@/components/team-display"
import { FilterPanel } from "@/components/filter-panel"
import { BalanceOptions } from "@/components/balance-options"
import { BalanceHistory } from "@/components/balance-history"
import { HelpFab } from "@/components/help-fab"
import { TierListView } from "@/components/tier-list-view"
import { getMonthlyPlayerStats } from "@/app/admin/actions"
import { balanceTeamsWithOptions, balanceTeamsCompetitive, balanceTeamsByElo } from "@/lib/balance-algorithm"
import { computeMonthlyEloMap } from "@/lib/elo"
import { loadPlayerBadges, type BadgeId } from "@/lib/player-profile"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import { checkIsAdmin } from "@/lib/is-admin"
import type { Player, BalanceOption, BalanceHistoryEntry } from "@/lib/types"
import { Users, Zap, Shuffle, X, Trophy, Grid3x3, UserX, TrendingUp, HelpCircle } from "lucide-react"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { useCurrentTheme } from "@/hooks/use-current-theme"
import { useSessionState } from "@/hooks/use-session-state"

export default function TeamBalancer() {
  const [players, setPlayers] = useState<Player[]>([])
  // Picks-in-progress and balance results survive navigating to /stats etc.
  // (sessionStorage-backed), matching the old keep-it-in-memory tab behaviour.
  const [selectedPlayers, setSelectedPlayers] = useSessionState<string[]>("balancer.selected", [])
  const [balanceOptions, setBalanceOptions] = useSessionState<BalanceOption[]>("balancer.options", [])
  const [selectedOptionIndex, setSelectedOptionIndex] = useSessionState<number>("balancer.optionIndex", 0)
  const [balanceHistory, setBalanceHistory] = useSessionState<BalanceHistoryEntry[]>("balancer.history", [], {
    // timestamp is a Date; JSON turns it into a string, so revive it.
    revive: (raw) =>
      (raw as (Omit<BalanceHistoryEntry, "timestamp"> & { timestamp: string })[]).map((e) => ({
        ...e,
        timestamp: new Date(e.timestamp),
      })),
  })
  const [searchQuery, setSearchQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [micFilter, setMicFilter] = useState(false)
  const [eliteFilter, setEliteFilter] = useState(false)
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [competitiveMode, setCompetitiveMode] = useSessionState<boolean>("balancer.competitive", false)
  const [cutPlayers, setCutPlayers] = useSessionState<string[]>("balancer.cut", [])
  const [playerView, setPlayerView] = useState<"select" | "tierList">("select")
  const [playerDisabledRoles, setPlayerDisabledRoles] = useSessionState<Map<string, string[]>>(
    "balancer.disabledRoles",
    new Map(),
    {
      prepare: (map) => Array.from(map.entries()),
      revive: (raw) => new Map(raw as [string, string[]][]),
    },
  )
  const [globalOffRole, setGlobalOffRole] = useSessionState<boolean>("balancer.offRole", false)
  const [playerStats, setPlayerStats] = useState<Record<string, { wins: number; losses: number; draws: number }>>({})
  // Profile badges per player (priority order), shown on Player Cards where the
  // mic icon was.
  const [playerBadges, setPlayerBadges] = useState<Record<string, BadgeId[]>>({})
  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)
  const [eloBalancing, setEloBalancing] = useState(false)

  const balanceOptionsRef = useRef<HTMLDivElement>(null)
  // Theme is owned by the SiteHeader; the balancer only reads it (Bespin tweaks
  // + PlayerCard/TierList props).
  const currentTheme = useCurrentTheme()

  useEffect(() => {
    fetchPlayersFromDB().then((data) => {
      setPlayers(data)
      setLoading(false)
      // Non-blocking: cards render immediately, badges pop in when computed.
      loadPlayerBadges(data).then(setPlayerBadges).catch(console.error)
    })
    getMonthlyPlayerStats().then((result) => {
      if (result.success) {
        setPlayerStats(result.data as Record<string, { wins: number; losses: number; draws: number }>)
      }
    })
  }, [])

  // Admin gate for the hidden "Balance by ELO" mode — checks the server-side allowlist
  // (RLS-enforced), matching the Reports tab's check.
  useEffect(() => {
    checkIsAdmin().then(setIsAdmin)
  }, [])

  const filteredPlayers = useMemo(() => {
    return players
      .filter((player) => {
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
      .sort((a, b) => {
        const aStats = playerStats[a.name]
        const bStats = playerStats[b.name]
        const aPlayed = aStats ? aStats.wins + aStats.losses + aStats.draws : 0
        const bPlayed = bStats ? bStats.wins + bStats.losses + bStats.draws : 0
        if (bPlayed !== aPlayed) return bPlayed - aPlayed
        return a.name.localeCompare(b.name)
      })
  }, [players, searchQuery, roleFilter, micFilter, eliteFilter, playerStats])

  const handlePlayerToggle = useCallback(
    (playerName: string) => {
      if (selectedPlayers.includes(playerName)) {
        setSelectedPlayers((prev) => prev.filter((p) => p !== playerName))
        setPlayerDisabledRoles((prev) => {
          const newMap = new Map(prev)
          newMap.delete(playerName)
          return newMap
        })
      } else {
        const maxPlayers = competitiveMode ? 18 : 12
        if (selectedPlayers.length < maxPlayers) {
          setSelectedPlayers((prev) => [...prev, playerName])
        }
      }
    },
    [selectedPlayers, competitiveMode],
  )

  const handleClearAll = () => {
    setSelectedPlayers([])
    setBalanceOptions([])
    setCutPlayers([])
    setPlayerDisabledRoles(new Map())
    setGlobalOffRole(false)
  }

  const handleRandomSelection = (count: number) => {
    // Fisher-Yates shuffle for true uniform random selection
    // Only select from active players (exclude inactive and manually_inactive)
    const activePlayers = players.filter(p => p.is_active !== false && !p.manually_inactive)
    const pool = [...activePlayers]
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]]
    }
    setSelectedPlayers(pool.slice(0, Math.min(count, pool.length)).map((p) => p.name))
    setBalanceOptions([])
    setPlayerDisabledRoles(new Map())
    setGlobalOffRole(false)
  }

  const handleDisabledRolesChange = useCallback((playerName: string, disabledRoles: string[]) => {
    setPlayerDisabledRoles((prev) => {
      const newMap = new Map(prev)
      if (disabledRoles.length > 0) {
        newMap.set(playerName, disabledRoles)
      } else {
        newMap.delete(playerName)
      }
      return newMap
    })
  }, [])

  const handleBalance = () => {
    const targetCount = competitiveMode ? 12 : selectedPlayers.length
    if (targetCount === 0) return

    const allRoles = ["Capper", "Chase", "Camp", "Cleaner", "Support"]
    const playersWithDisabledRoles = players.map((p) => ({
      ...p,
      disabledRoles: globalOffRole ? allRoles : playerDisabledRoles.get(p.name) || [],
    }))

    if (competitiveMode) {
      if (selectedPlayers.length < 12 || selectedPlayers.length > 18) {
        alert("Competitive mode requires 12-18 players")
        return
      }
      try {
        const result = balanceTeamsCompetitive(selectedPlayers, playersWithDisabledRoles)
        setBalanceOptions(result.options)
        setSelectedPlayers(result.selectedPlayers)
        setCutPlayers(result.cutPlayers)
        setSelectedOptionIndex(0)

        setPlayerDisabledRoles(new Map())
        setGlobalOffRole(false)

        const newEntry: BalanceHistoryEntry = {
          id: Date.now().toString(),
          result: result.options[0].result,
          timestamp: new Date(),
          selectedPlayers: result.selectedPlayers,
        }
        setBalanceHistory((prev) => [newEntry, ...prev.slice(0, 9)])

        setTimeout(() => {
          balanceOptionsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          })
        }, 100)
      } catch (error) {
        console.error(error)
      }
    } else {
      if (selectedPlayers.length !== 12) {
        alert("Please select exactly 12 players")
        return
      }
      try {
        const options = balanceTeamsWithOptions(selectedPlayers, playersWithDisabledRoles)
        setBalanceOptions(options)
        setSelectedOptionIndex(0)
        setCutPlayers([])
        setPlayerDisabledRoles(new Map())
        setGlobalOffRole(false)

        const newEntry: BalanceHistoryEntry = {
          id: Date.now().toString(),
          result: options[0].result,
          timestamp: new Date(),
          selectedPlayers,
        }
        setBalanceHistory((prev) => [newEntry, ...prev.slice(0, 9)])

        setTimeout(() => {
          balanceOptionsRef.current?.scrollIntoView({
            behavior: "smooth",
            block: "start",
          })
        }, 100)
      } catch (error) {
        console.error(error)
      }
    }
  }

  // Admin-only test mode: balance the 12 selected players purely on this month's ELO.
  const handleBalanceByElo = async () => {
    if (selectedPlayers.length !== 12) {
      alert("Balance by ELO requires exactly 12 selected players")
      return
    }
    setEloBalancing(true)
    try {
      const allRoles = ["Capper", "Chase", "Camp", "Cleaner", "Support"]
      const playersWithDisabledRoles = players.map((p) => ({
        ...p,
        disabledRoles: globalOffRole ? allRoles : playerDisabledRoles.get(p.name) || [],
      }))

      const now = new Date()
      const eloMap = await computeMonthlyEloMap(now.getUTCFullYear(), now.getUTCMonth() + 1)
      const options = balanceTeamsByElo(selectedPlayers, playersWithDisabledRoles, eloMap)
      setBalanceOptions(options)
      setSelectedOptionIndex(0)
      setCutPlayers([])
      setPlayerDisabledRoles(new Map())
      setGlobalOffRole(false)

      const newEntry: BalanceHistoryEntry = {
        id: Date.now().toString(),
        result: options[0].result,
        timestamp: new Date(),
        selectedPlayers,
      }
      setBalanceHistory((prev) => [newEntry, ...prev.slice(0, 9)])

      setTimeout(() => {
        balanceOptionsRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
      }, 100)
    } catch (error) {
      console.error(error)
      alert("Failed to compute ELO balance")
    } finally {
      setEloBalancing(false)
    }
  }

  const handleCopyTeams = () => {
    if (balanceOptions.length > 0) {
      const result = balanceOptions[selectedOptionIndex].result
      const text = `🔥 Red Team: ${result.teamRed.join(", ")}\n💧 Blue Team: ${result.teamBlue.join(", ")}`
      navigator.clipboard.writeText(text)
    }
  }

  const handleCopyAllOptions = () => {
    if (balanceOptions.length === 0) return
    const k = 0.004
    const floor = 30
    const sections = balanceOptions.map((option) => {
      const confidence = Math.round(floor + (100 - floor) * Math.exp(-k * option.score))
      return `${option.label} — ${option.description} (Balance: ${confidence}%)\n🔥 Red Team: ${option.result.teamRed.join(", ")}\n💧 Blue Team: ${option.result.teamBlue.join(", ")}`
    })
    navigator.clipboard.writeText(sections.join("\n\n"))
  }

  const handleSwapSides = () => {
    if (balanceOptions.length > 0) {
      setBalanceOptions((prevOptions) =>
        prevOptions.map((option, index) => {
          if (index === selectedOptionIndex) {
            return {
              ...option,
              result: {
                ...option.result,
                teamRed: option.result.teamBlue,
                teamBlue: option.result.teamRed,
                redTierTotal: option.result.blueTierTotal,
                blueTierTotal: option.result.redTierTotal,
                redMic: option.result.blueMic,
                blueMic: option.result.redMic,
              },
            }
          }
          return option
        }),
      )
    }
  }

  const handleRestoreFromHistory = (entry: BalanceHistoryEntry) => {
    setSelectedPlayers(entry.selectedPlayers)
    const options = balanceTeamsWithOptions(entry.selectedPlayers, players)
    setBalanceOptions(options)
    setSelectedOptionIndex(0)
  }

  const handleClearHistory = () => {
    setBalanceHistory([])
  }

  const selectedPlayerObjects = useMemo(() => {
    return selectedPlayers
      .map((name) => {
        const player = players.find((p) => p.name === name)
        if (!player) return null
        return {
          ...player,
          disabledRoles: playerDisabledRoles.get(name) || [],
        }
      })
      .filter(Boolean) as Player[]
  }, [selectedPlayers, players, playerDisabledRoles])

  const togglePlayer = useCallback(
    (playerName: string) => {
      handlePlayerToggle(playerName)
    },
    [handlePlayerToggle],
  )

  if (loading) {
    return (
      <div className="container mx-auto px-4 py-32 relative z-10">
        <div className="text-center">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-text-dim">Loading player data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="container mx-auto px-4 py-8 relative z-10">
          <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-4 mb-6 sticky top-[100px] md:top-[120px] z-40">
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3 md:gap-4">
              <div className="flex items-center gap-2 flex-1 min-w-[200px]">
                <Users className="w-5 h-5" style={{ color: "var(--color-primary)" }} />
                <span className="text-white font-mono text-lg font-bold">
                  {selectedPlayers.length}/{competitiveMode ? "18" : "12"}
                </span>
                <div className="flex-1 h-2 bg-[#0b0c10] rounded-full overflow-hidden border border-[#3d4855]">
                  <div
                    className="h-full transition-all duration-300"
                    style={{
                      width: `${(selectedPlayers.length / (competitiveMode ? 18 : 12)) * 100}%`,
                      backgroundColor: "var(--color-primary)",
                      boxShadow: "0 0 8px var(--color-primary-glow)",
                    }}
                  />
                </div>
              </div>

              <div className="flex items-center gap-2">
                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => {
                          setCompetitiveMode(!competitiveMode)
                          setBalanceOptions([])
                          setCutPlayers([])
                          if (!competitiveMode && selectedPlayers.length > 18) {
                            setSelectedPlayers((prev) => prev.slice(0, 18))
                          } else if (competitiveMode && selectedPlayers.length > 12) {
                            setSelectedPlayers((prev) => prev.slice(0, 12))
                          }
                        }}
                        className={`px-3 py-1.5 rounded-md text-sm transition-all font-medium flex items-center gap-1.5 ${
                          competitiveMode
                            ? "bg-[#f39c12] text-[#0b0c10] font-bold shadow-[0_0_10px_rgba(243,156,18,0.4)]"
                            : "bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855]"
                        }`}
                      >
                        <Trophy className="w-4 h-4" />
                        Competitive
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="bg-[#1f2833]/95 backdrop-blur-md border border-[#66fcf1]/30 text-[#c5c6c7] px-3 py-2 rounded-lg shadow-lg max-w-[250px] text-center"
                    >
                      <p>Expand queue size to 18 and balance the top 12 players</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

                <TooltipProvider>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <button
                        onClick={() => setGlobalOffRole(!globalOffRole)}
                        className={`px-3 py-1.5 rounded-md text-sm transition-all font-medium flex items-center gap-1.5 ${
                          globalOffRole
                            ? "bg-[#e74c3c] text-white font-bold shadow-[0_0_10px_rgba(231,76,60,0.4)]"
                            : "bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855]"
                        }`}
                      >
                        <UserX className="w-4 h-4" />
                        <span className="hidden md:inline">Off-Role</span>
                      </button>
                    </TooltipTrigger>
                    <TooltipContent
                      side="bottom"
                      className="bg-[#1f2833]/95 backdrop-blur-md border border-[#66fcf1]/30 text-[#c5c6c7] px-3 py-2 rounded-lg shadow-lg max-w-[250px] text-center"
                    >
                      <p>Balances teams using only overall ranks, not role ranks</p>
                    </TooltipContent>
                  </Tooltip>
                </TooltipProvider>

              </div>

              <div className="flex items-center gap-2">
                <button
                  onClick={() => handleRandomSelection(competitiveMode ? 18 : 12)}
                  disabled={players.length < (competitiveMode ? 18 : 12)}
                  className="px-3 py-1.5 bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] rounded-md hover:bg-[#3d4855] disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm border border-[#3d4855]"
                >
                  <Shuffle className="w-4 h-4 inline mr-1" />
                  <span className="hidden md:inline">Random {competitiveMode ? "18" : "12"}</span>
                </button>
                <button
                  onClick={handleClearAll}
                  disabled={selectedPlayers.length === 0}
                  className={`px-3 py-1.5 rounded-md transition-all text-sm font-medium border border-[#3d4855] ${
                    selectedPlayers.length === 0
                      ? "bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] opacity-40 cursor-not-allowed"
                      : "bg-[#8b3a3a] text-white hover:bg-[#ff4757]"
                  }`}
                >
                  <X className="w-4 h-4 inline mr-1" />
                  <span className="hidden md:inline">Clear All</span>
                </button>
                <button
                  onClick={handleBalance}
                  disabled={
                    competitiveMode
                      ? selectedPlayers.length < 12 || selectedPlayers.length > 18
                      : selectedPlayers.length !== 12
                  }
                  style={{
                    backgroundColor: "var(--color-primary)",
                    color: "var(--color-background)",
                  }}
                  className="px-4 md:px-6 py-1.5 font-bold rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm hover-glow"
                >
                  <Zap className="w-4 h-4 inline mr-1" />
                  <span className="hidden md:inline">BALANCE TEAMS</span>
                  <span className="md:hidden">BALANCE</span>
                </button>
                {isAdmin && (
                  <button
                    onClick={handleBalanceByElo}
                    disabled={selectedPlayers.length !== 12 || eloBalancing}
                    style={{ backgroundColor: "#9b59b6", color: "#ffffff" }}
                    className="px-4 md:px-6 py-1.5 font-bold rounded-md disabled:opacity-40 disabled:cursor-not-allowed transition-all text-sm hover-glow"
                    title="Admin: balance the 12 selected players by this month's ELO"
                  >
                    <TrendingUp className="w-4 h-4 inline mr-1" />
                    <span className="hidden md:inline">{eloBalancing ? "BALANCING…" : "BALANCE BY ELO"}</span>
                    <span className="md:hidden">ELO</span>
                  </button>
                )}
              </div>
            </div>

            <FilterPanel
              searchQuery={searchQuery}
              setSearchQuery={setSearchQuery}
              roleFilter={roleFilter}
              setRoleFilter={setRoleFilter}
              micFilter={micFilter}
              setMicFilter={setMicFilter}
              eliteFilter={eliteFilter}
              setEliteFilter={setEliteFilter}
              players={players}
              onSelectPlayer={handlePlayerToggle}
              showDropdown={showSearchDropdown}
              setShowDropdown={setShowSearchDropdown}
            />
          </div>

          {competitiveMode && selectedPlayers.length > 0 && (
            <div className="bg-[#f39c12]/20 backdrop-blur-md border border-[#f39c12]/50 rounded-lg p-4 mb-6">
              <div className="flex items-center gap-3">
                <Trophy className="w-5 h-5" style={{ color: currentTheme === "bespin" ? "#5a3a1a" : "#f39c12" }} />
                <div>
                  <p className="font-bold" style={{ color: currentTheme === "bespin" ? "#5a3a1a" : "#f39c12" }}>
                    Competitive Mode Active
                  </p>
                  <p className="text-sm" style={{ color: currentTheme === "bespin" ? "#5a3a1a" : "#c5c6c7" }}>
                    Select 12-18 players. The best 12 will be chosen and balanced into teams.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* View toggle on the left, How It Works on the right. It sits on this
              row rather than in the global nav or the sticky panel: it explains
              this page specifically, but isn't a control for it. */}
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
            <div
              className="inline-flex rounded-lg border p-1"
              style={{
                backgroundColor: "var(--color-surface)",
                borderColor: "var(--color-border)",
              }}
            >
              <button
                onClick={() => setPlayerView("select")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                  playerView === "select" ? "font-bold" : ""
                }`}
                style={
                  playerView === "select"
                    ? {
                        backgroundColor: "var(--color-primary)",
                        color: "var(--color-background)",
                        boxShadow: "0 0 10px var(--color-primary-glow)",
                      }
                    : {
                        backgroundColor: "transparent",
                        color: "var(--color-text)",
                      }
                }
              >
                <Grid3x3 className="w-4 h-4" />
                Player Cards
              </button>
              <button
                onClick={() => setPlayerView("tierList")}
                className={`px-4 py-2 rounded-md text-sm font-medium transition-all flex items-center gap-2 ${
                  playerView === "tierList" ? "font-bold" : ""
                }`}
                style={
                  playerView === "tierList"
                    ? {
                        backgroundColor: "var(--color-primary)",
                        color: "var(--color-background)",
                        boxShadow: "0 0 10px var(--color-primary-glow)",
                      }
                    : {
                        backgroundColor: "transparent",
                        color: "var(--color-text)",
                      }
                }
              >
                <Trophy className="w-4 h-4" />
                Tier List
              </button>
            </div>

            <Link
              href="/how-it-works"
              className="px-3 py-1.5 rounded-md text-sm transition-all font-medium flex items-center gap-1.5 bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855]"
            >
              <HelpCircle className="w-4 h-4" />
              How It Works
            </Link>
          </div>

          {playerView === "select" ? (
            <>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 mb-8">
                {filteredPlayers.map((player) => (
                  <PlayerCard
                    key={player.name}
                    player={{
                      ...player,
                      disabledRoles: playerDisabledRoles.get(player.name) || [],
                    }}
                    isSelected={selectedPlayers.includes(player.name)}
                    selectionNumber={selectedPlayers.indexOf(player.name) + 1 || undefined}
                    onToggle={() => handlePlayerToggle(player.name)}
                    currentTheme={currentTheme}
                    onDisabledRolesChange={(disabledRoles) => handleDisabledRolesChange(player.name, disabledRoles)}
                    winStats={playerStats[player.name]}
                    badges={playerBadges[player.name]}
                  />
                ))}
              </div>
            </>
          ) : (
            <TierListView
              players={players}
              selectedPlayers={selectedPlayers}
              onTogglePlayer={togglePlayer}
              currentTheme={currentTheme}
              searchQuery={searchQuery}
                roleFilter={roleFilter}
                micFilter={micFilter}
                eliteFilter={eliteFilter}
              />
          )}

          {balanceOptions.length > 0 && (
            <>
              <div ref={balanceOptionsRef} className="scroll-mt-52">
                <BalanceOptions
                  options={balanceOptions}
                  selectedIndex={selectedOptionIndex}
                  onSelect={setSelectedOptionIndex}
                  players={players}
                />
              </div>

              <TeamDisplay
                result={balanceOptions[selectedOptionIndex].result}
                players={players}
                onCopy={handleCopyTeams}
                onCopyAll={handleCopyAllOptions}
                onSwapSides={handleSwapSides}
              />
            </>
          )}

          <BalanceHistory
            history={balanceHistory}
            players={players}
            onRestore={handleRestoreFromHistory}
            onClear={handleClearHistory}
          />

          <HelpFab />
    </div>
  )
}
