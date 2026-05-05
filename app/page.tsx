"use client"

import { useState, useEffect, useMemo, useRef, useCallback } from "react"
import { PlayerCard } from "@/components/player-card"
import { TeamDisplay } from "@/components/team-display"
import { FilterPanel } from "@/components/filter-panel"
import { BackgroundParticles, type BackgroundParticlesRef } from "@/components/background-particles"
import { BalanceOptions } from "@/components/balance-options"
import { BalanceHistory } from "@/components/balance-history"
import { ThemeSelector } from "@/components/theme-selector"
import { TierListView } from "@/components/tier-list-view"
import { TutorialDialog } from "@/components/tutorial-dialog"
import { MatchHistoryTab } from "@/components/match-history-tab"
import { ReportsTab } from "@/components/reports-tab"
import { getMonthlyPlayerStats } from "@/app/admin/actions"
import { balanceTeamsWithOptions, balanceTeamsCompetitive } from "@/lib/balance-algorithm"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import { themes, applyTheme, type ThemeName } from "@/lib/themes"
import type { Player, BalanceOption, BalanceHistoryEntry } from "@/lib/types"
import { Search, Users, Zap, Shuffle, X, Trophy, Grid3x3, UserX, HelpCircle, History, BarChart3 } from "lucide-react"
import Image from "next/image"
import { useToast } from "@/hooks/use-toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

export default function TeamBalancer() {
  const [players, setPlayers] = useState<Player[]>([])
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([])
  const [balanceOptions, setBalanceOptions] = useState<BalanceOption[]>([])
  const [selectedOptionIndex, setSelectedOptionIndex] = useState(0)
  const [balanceHistory, setBalanceHistory] = useState<BalanceHistoryEntry[]>([])
  const [searchQuery, setSearchQuery] = useState("")
  const [roleFilter, setRoleFilter] = useState<string | null>(null)
  const [micFilter, setMicFilter] = useState(false)
  const [eliteFilter, setEliteFilter] = useState(false)
  const [showFilters, setShowFilters] = useState(false)
  const [showSearchDropdown, setShowSearchDropdown] = useState(false)
  const [competitiveMode, setCompetitiveMode] = useState(false)
  const [cutPlayers, setCutPlayers] = useState<string[]>([])
  const [currentTheme, setCurrentTheme] = useState<ThemeName>("jedi")
  const [playerView, setPlayerView] = useState<"select" | "tierList">("select")
  const [playerDisabledRoles, setPlayerDisabledRoles] = useState<Map<string, string[]>>(new Map())
  const [globalOffRole, setGlobalOffRole] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)
  const [playerStats, setPlayerStats] = useState<Record<string, { wins: number; losses: number; draws: number }>>({})
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<"balancer" | "history" | "reports" | "info">("balancer")

  const particlesRef = useRef<BackgroundParticlesRef>(null)
  const balanceOptionsRef = useRef<HTMLDivElement>(null)
  const { toast } = useToast()

  useEffect(() => {
    fetchPlayersFromDB().then((data) => {
      setPlayers(data)
      setLoading(false)
    })
    getMonthlyPlayerStats().then((result) => {
      if (result.success) {
        setPlayerStats(result.data as Record<string, { wins: number; losses: number; draws: number }>)
      }
    })
  }, [])

  useEffect(() => {
    const savedTheme = localStorage.getItem("jk2-theme") as ThemeName
    if (savedTheme && themes[savedTheme]) {
      setCurrentTheme(savedTheme)
      applyTheme(themes[savedTheme])
    } else {
      applyTheme(themes.jedi)
    }
  }, [])

  useEffect(() => {
    const hasSeenTutorial = localStorage.getItem("hasSeenTutorial")
    if (!hasSeenTutorial) {
      setShowTutorial(true)
      localStorage.setItem("hasSeenTutorial", "true")
    }
  }, [])

  const handleThemeChange = (theme: ThemeName) => {
    setCurrentTheme(theme)
    applyTheme(themes[theme])
    localStorage.setItem("jk2-theme", theme)

    toast({
      title: `${themes[theme].displayName} Theme Activated`,
      description: "The Force is strong with this one.",
      duration: 3000,
    })
  }

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

  const handleCopyTeams = () => {
    if (balanceOptions.length > 0) {
      const result = balanceOptions[selectedOptionIndex].result
      const text = `🔥 Red Team: ${result.teamRed.join(", ")}\n💧 Blue Team: ${result.teamBlue.join(", ")}`
      navigator.clipboard.writeText(text)
    }
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
      <div className="min-h-screen flex items-center justify-center">
        <BackgroundParticles ref={particlesRef} />
        <div className="text-center relative z-10">
          <div className="w-16 h-16 border-4 border-primary border-t-transparent rounded-full animate-spin mx-auto mb-4"></div>
          <p className="text-text-dim">Loading player data...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen pb-20 relative">
      <BackgroundParticles ref={particlesRef} />

      <header
        className="border-b backdrop-blur-xl sticky top-0 z-50"
        style={{
          borderColor: "var(--color-border)",
          backgroundColor: "var(--color-surface)",
        }}
      >
        <div className="container mx-auto px-4 py-4 md:py-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-3 md:gap-4">
              <Image
                src="/logo.png"
                alt="JK2 Logo"
                width={50}
                height={50}
                className="drop-shadow-[0_0_10px_rgba(102,252,241,0.5)] md:w-[60px] md:h-[60px]"
              />
              <div>
                <h1 className="text-xl md:text-2xl lg:text-3xl font-bold glow-text mb-1">JK2 CTF TEAM BALANCER</h1>
                <p className="text-xs md:text-sm" style={{ color: "var(--color-text-dim)" }}>
                  Jedi Knight 2: Jedi Outcast • 6v6 Competitive • Also known as Soracle
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              <ThemeSelector currentTheme={currentTheme} onThemeChange={handleThemeChange} />
              <button
                onClick={() => setActiveTab("balancer")}
                className={`flex-1 md:flex-none px-3 md:px-4 py-2 rounded-md transition-all font-medium text-sm ${
                  activeTab === "balancer" ? "font-bold" : "hover:bg-[#3d4855] border"
                }`}
                style={
                  activeTab === "balancer"
                    ? {
                        backgroundColor: "var(--color-primary)",
                        color: "var(--color-background)",
                        boxShadow: "0 0 15px var(--color-primary-glow)",
                      }
                    : {
                        backgroundColor: "var(--color-surface-elevated)",
                        color: "var(--color-text)",
                        borderColor: "var(--color-border)",
                      }
                }
              >
                Team Balancer
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`flex-1 md:flex-none px-3 md:px-4 py-2 rounded-md transition-all font-medium text-sm flex items-center gap-1.5 ${
                  activeTab === "history" ? "font-bold" : "hover:bg-[#3d4855] border"
                }`}
                style={
                  activeTab === "history"
                    ? {
                        backgroundColor: "var(--color-primary)",
                        color: "var(--color-background)",
                        boxShadow: "0 0 15px var(--color-primary-glow)",
                      }
                    : {
                        backgroundColor: "var(--color-surface-elevated)",
                        color: "var(--color-text)",
                        borderColor: "var(--color-border)",
                      }
                }
              >
                <History className="w-4 h-4" />
                Match History
              </button>
              <button
                onClick={() => setActiveTab("reports")}
                className={`flex-1 md:flex-none px-3 md:px-4 py-2 rounded-md transition-all font-medium text-sm flex items-center gap-1.5 ${
                  activeTab === "reports" ? "font-bold" : "hover:bg-[#3d4855] border"
                }`}
                style={
                  activeTab === "reports"
                    ? {
                        backgroundColor: "var(--color-primary)",
                        color: "var(--color-background)",
                        boxShadow: "0 0 15px var(--color-primary-glow)",
                      }
                    : {
                        backgroundColor: "var(--color-surface-elevated)",
                        color: "var(--color-text)",
                        borderColor: "var(--color-border)",
                      }
                }
              >
                <BarChart3 className="w-4 h-4" />
                Reports
              </button>
              <button
                onClick={() => setActiveTab("info")}
                className={`flex-1 md:flex-none px-3 md:px-4 py-2 rounded-md transition-all font-medium text-sm ${
                  activeTab === "info" ? "font-bold" : "hover:bg-[#3d4855] border"
                }`}
                style={
                  activeTab === "info"
                    ? {
                        backgroundColor: "var(--color-primary)",
                        color: "var(--color-background)",
                        boxShadow: "0 0 15px var(--color-primary-glow)",
                      }
                    : {
                        backgroundColor: "var(--color-surface-elevated)",
                        color: "var(--color-text)",
                        borderColor: "var(--color-border)",
                      }
                }
              >
                How It Works
              </button>
              <button
                onClick={() => setShowTutorial(!showTutorial)}
                className="px-3 py-1.5 rounded-md text-sm transition-all font-medium flex items-center gap-1.5 bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855]"
                title="Show Tutorial"
              >
                <HelpCircle className="w-4 h-4" />
                Help
              </button>
            </div>
          </div>
        </div>
      </header>

      {showTutorial && <TutorialDialog onClose={() => setShowTutorial(false)} />}

      {activeTab === "balancer" ? (
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

                <button
                  onClick={() => setShowFilters(!showFilters)}
                  className={`px-3 py-1.5 rounded-md text-sm transition-all font-medium ${
                    showFilters
                      ? "bg-[#66fcf1] text-[#0b0c10] font-bold"
                      : "bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855]"
                  }`}
                >
                  <Search className="w-4 h-4 inline mr-1" />
                  Search
                </button>
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
              </div>
            </div>

            {showFilters && (
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
            )}
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

          <div className="mb-6">
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
        </div>
      ) : activeTab === "history" ? (
        <div className="container mx-auto px-4 py-8 relative z-10">
          <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-6">
            <MatchHistoryTab />
          </div>
        </div>
      ) : activeTab === "reports" ? (
        <div className="container mx-auto px-4 py-8 relative z-10">
          <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-6">
            <ReportsTab />
          </div>
        </div>
      ) : (
        <div className="container mx-auto px-4 py-8 max-w-4xl relative z-10">
          <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-8">
            <h2 className="text-2xl font-bold text-[#66fcf1] mb-6">How The Balancer Works</h2>

            <div className="space-y-6 text-[#c5c6c7]">
              <section>
                <h3 className="text-xl font-bold text-text-bright mb-3">The Challenge</h3>
                <p className="leading-relaxed">
                  JK2 CTF requires both balanced overall skill AND proper role coverage. You can&apos;t just average player
                  ratings—that ignores whether teams can actually cap, chase, or defend effectively. It also matters how
                  skill is distributed—two evenly-totalled teams can still produce a blowout if one side has all the top
                  players.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-text-bright mb-3">How It Works</h3>
                <p className="leading-relaxed mb-4">
                  The balancer evaluates every possible team split using a priority system:
                </p>
                <ul className="space-y-3">
                  <li className="flex items-start gap-3">
                    <span className="text-primary font-mono font-bold">1.</span>
                    <div>
                      <strong className="text-text-bright">Tier Balance (weight: 3.0)</strong>
                      <p className="text-sm text-text-dim mt-1">
                        Balances total team strength using tier values (1-10). Target: ≤2 point difference. Tier
                        measures your overall competitive impact.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-accent-red font-mono font-bold">2.</span>
                    <div>
                      <strong className="text-text-bright">Critical Role Coverage (penalty: 500)</strong>
                      <p className="text-sm text-text-dim mt-1">
                        Ensures both teams have viable Cappers and Chasers (4+ role rating). Missing either =
                        unplayable.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-accent-green font-mono font-bold">3.</span>
                    <div>
                      <strong className="text-text-bright">Top-3 Strength Balance (weight: 2.0)</strong>
                      <p className="text-sm text-text-dim mt-1">
                        Compares the combined tier of each team&apos;s three strongest players. This prevents &quot;top-heavy&quot;
                        splits where one team has all the elite players even though the tier totals look close.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-accent-purple font-mono font-bold">4.</span>
                    <div>
                      <strong className="text-text-bright">Role Strength Balance (weight: 0.8)</strong>
                      <p className="text-sm text-text-dim mt-1">
                        Balances the total role ratings for each position (Capper, Chase, Camp, Cleaner, Support)
                        between teams. Example: If Red has 25 total Capper rating and Blue has 15, that creates
                        imbalance—even if tier totals are equal.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-accent-yellow font-mono font-bold">5.</span>
                    <div>
                      <strong className="text-text-bright">Elite Distribution (weight: 1.5)</strong>
                      <p className="text-sm text-text-dim mt-1">
                        Prevents stacking top-tier players on one team. The threshold is dynamic—it&apos;s based on the top
                        25% of players in the current pool, not a fixed number.
                      </p>
                    </div>
                  </li>
                  <li className="flex items-start gap-3">
                    <span className="text-primary font-mono font-bold">6.</span>
                    <div>
                      <strong className="text-text-bright">Top Two Separation (penalty: 8000)</strong>
                      <p className="text-sm text-text-dim mt-1">Never puts the two highest-tier players together.</p>
                    </div>
                  </li>
                </ul>
              </section>

              <section>
                <h3 className="text-xl font-bold text-text-bright mb-3">Understanding the Two Rating Systems</h3>
                <p className="leading-relaxed">
                  Tier values balance overall strength. Role ratings ensure team composition works. A tier 8 Capper and
                  tier 8 Chaser might have a similar tier value (both impact the game equally), but different role
                  profiles (they fill different needs).
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-text-bright mb-3">Balance Confidence</h3>
                <p className="leading-relaxed">
                  Each balance option shows a confidence percentage — this is the balancer&apos;s assessment of how fair the
                  split is, based on all the factors above. Higher is better. You&apos;ll also see this score on logged
                  matches in the Match History tab, so you can track whether higher-confidence balances produce closer
                  games.
                </p>
              </section>

              <section>
                <h3 className="text-xl font-bold text-text-bright mb-3">Role System</h3>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div className="bg-background p-3 rounded-md border border-border">
                    <span className="inline-block px-2 py-1 bg-[#62d6e8] text-background text-xs font-bold rounded mb-2">
                      CAP
                    </span>
                    <p className="text-sm">Capper - Flag carrier, evasion and speed specialist</p>
                  </div>
                  <div className="bg-background p-3 rounded-md border border-border">
                    <span className="inline-block px-2 py-1 bg-[#27ae60] text-background text-xs font-bold rounded mb-2">
                      CHA
                    </span>
                    <p className="text-sm">Chase returner - Pursues enemy flag carrier</p>
                  </div>
                  <div className="bg-background p-3 rounded-md border border-border">
                    <span className="inline-block px-2 py-1 bg-[#45a29e] text-background text-xs font-bold rounded mb-2">
                      CAM
                    </span>
                    <p className="text-sm">Camp returner - blocks off enemy capper and protects base hallways</p>
                  </div>
                  <div className="bg-background p-3 rounded-md border border-border">
                    <span className="inline-block px-2 py-1 bg-[#9b59b6] text-background text-xs font-bold rounded mb-2">
                      BC
                    </span>
                    <p className="text-sm">Base Cleaner - Base control specialist</p>
                  </div>
                  <div className="bg-background p-3 rounded-md border border-border col-span-full">
                    <span className="inline-block px-2 py-1 bg-[#f39c12] text-background text-xs font-bold rounded mb-2">
                      SUP
                    </span>
                    <p className="text-sm">Support - Flexible utility player</p>
                  </div>
                </div>
              </section>

              <section>
                <h3 className="text-xl font-bold text-text-bright mb-3">Pro Tips</h3>
                <ul className="space-y-2 text-sm">
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>Hit &quot;Copy Teams&quot; to paste the lineup to Discord</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>
                      Check alternative balance options if the first balance doesn&apos;t feel right, or if you want to
                      rematch with different lineups
                    </span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>Sides are randomized—use Swap Sides to change up team colours</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>No coverage on a specific role? Time to improvise and try out new positions!</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-primary">•</span>
                    <span>Check the Match History tab to see past results and player win rates</span>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </div>
      )}

      <TutorialDialog open={showTutorial} onOpenChange={setShowTutorial} />
    </div>
  )
}
