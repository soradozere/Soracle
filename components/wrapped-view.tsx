"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Check, ChevronsUpDown, Heart, Link2, Sparkles, Swords, Trophy } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { getAchievementsEarnedInMonth } from "@/app/admin/actions"
import { Emblem } from "@/components/emblem"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useToast } from "@/hooks/use-toast"
import { fmtDate, roman } from "@/lib/achievement-format"
import { rarityColor, rarityLabel } from "@/lib/achievement-pages"
import type { LedgerEntry } from "@/lib/achievements-server"
import { playerSlug } from "@/lib/player-profile"
import { cn } from "@/lib/utils"

// A per-player recap of one closed month — the personal numbers the profile's
// own "This Month" panel shows live, preserved past month-end instead of
// quietly overwritten by the next one. Self-contained (fetches its own
// matches/stats/players/achievements for the given year+month), matching how
// EloLeaderboard/TrueSkillLeaderboard/TierChangelog are each their own view
// rather than threading data down from ReportsTab.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

// Duplicated rather than imported: the shared copy in lib/profile-meta.ts pulls
// in the server Supabase client, which a "use client" module can't carry.
const TIER_NAMES: Record<number, string> = {
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

interface Match {
  id: string
  red_team: string[]
  blue_team: string[]
  red_score: number
  blue_score: number
  created_at: string
}

interface StatRow {
  player_id: string
  match_id: string
  captures: number
  returns: number
  assists: number
  base_cleaner: number
  flag_grabs: number
  flag_hold_ms: number
  kills: number
  deaths: number
  score: number
  time_played: number | null
}

interface PlayerRow {
  id: string
  name: string
  tier_value: number
}

interface PairRecord {
  name: string
  games: number
  wins: number
  losses: number
  rate: number
}

interface OppRecord {
  name: string
  meetings: number
  theirWins: number
  myWins: number
  rate: number
}

interface WrappedCard {
  name: string
  tier: number | null
  wins: number
  losses: number
  draws: number
  played: number
  streak: number
  streakLive: boolean
  hasStats: boolean
  statsMatches: number
  captures: number
  returns: number
  assists: number
  baseCleaner: number
  flagGrabs: number
  kills: number
  deaths: number
  flagHoldMs: number
  bestScore: { value: number; match: Match } | null
  friends: PairRecord[]
  nemeses: OppRecord[]
}

// Same floor and ranking the bot's monthly =friend/=nemesis commands use
// (app/api/bot/friend, app/api/bot/nemesis by-discord routes) — highest win
// rate, not raw volume, with a minimum so two lucky games together don't read
// as a bond. Kept in step with those deliberately; if one changes, check the
// other.
const PAIR_MIN_GAMES = 3

function formatFlagHold(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

function kdRatio(kills: number, deaths: number): string {
  if (kills === 0 && deaths === 0) return "—"
  if (deaths === 0) return "∞"
  return (kills / deaths).toFixed(2)
}

// One number + label — the profile's StatTile and the Stats hero's record row
// share this exact grammar (small mono label, big tabular value); reused here
// rather than imported since neither original is exported.
function Stat({ label, value, accent }: { label: string; value: string | number; accent?: string }) {
  return (
    <div
      className="rounded-[10px] px-2.5 py-2.5 text-center"
      style={{
        background: "color-mix(in srgb, var(--color-background) 55%, transparent)",
        border: "1px solid var(--glass-hair)",
        boxShadow: "inset 0 1px 0 var(--glass-spec)",
      }}
    >
      <div
        className="text-lg font-bold tabular-nums leading-tight"
        style={{ fontFamily: "var(--font-mono)", color: accent ?? "var(--color-text-bright)" }}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] uppercase tracking-[0.08em]" style={{ color: "var(--color-text-dim)" }}>
        {label}
      </div>
    </div>
  )
}

function PlayerPicker({
  names,
  selected,
  onSelect,
}: {
  names: string[]
  selected: string | null
  onSelect: (name: string) => void
}) {
  const [open, setOpen] = useState(false)
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          role="combobox"
          aria-expanded={open}
          className="flex items-center gap-2.5 px-4 py-2.5 rounded-xl text-sm font-semibold transition-colors"
          style={{
            border: "1px solid var(--glass-hair)",
            background: "color-mix(in srgb, var(--color-surface-elevated) 70%, transparent)",
            boxShadow: "inset 0 1px 0 var(--glass-spec)",
            color: selected ? "var(--color-text-bright)" : "var(--color-text-dim)",
          }}
        >
          {selected ?? "Choose a player…"}
          <ChevronsUpDown className="w-3.5 h-3.5 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-64 p-0"
        style={{
          background: "color-mix(in srgb, var(--color-surface) 97%, transparent)",
          borderColor: "var(--glass-hair)",
          backdropFilter: "blur(24px) saturate(160%)",
        }}
      >
        <Command style={{ background: "transparent" }}>
          <CommandInput placeholder="Search players…" className="text-sm" />
          <CommandList>
            <CommandEmpty>No players found.</CommandEmpty>
            <CommandGroup>
              {names.map((name) => (
                <CommandItem
                  key={name}
                  value={name}
                  onSelect={() => {
                    onSelect(name)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn("mr-2 h-3 w-3", selected === name ? "opacity-100" : "opacity-0")}
                    style={{ color: "var(--color-primary)" }}
                  />
                  {name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface WrappedViewProps {
  year: number
  month: number
  selectedName: string | null
  onSelectName: (name: string | null) => void
}

export function WrappedView({ year, month, selectedName, onSelectName }: WrappedViewProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [stats, setStats] = useState<StatRow[]>([])
  const [players, setPlayers] = useState<PlayerRow[]>([])
  const [achievements, setAchievements] = useState<LedgerEntry[]>([])
  const [loading, setLoading] = useState(true)
  const { toast } = useToast()

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    const supabase = createClient()
    const startIso = new Date(Date.UTC(year, month - 1, 1)).toISOString()
    const endIso = new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)).toISOString()

    Promise.all([
      supabase
        .from("matches")
        .select("id, red_team, blue_team, red_score, blue_score, created_at")
        .gte("created_at", startIso)
        .lte("created_at", endIso)
        .order("created_at", { ascending: true }),
      supabase.from("players").select("id, name, tier_value"),
      getAchievementsEarnedInMonth(year, month),
    ]).then(async ([matchResult, playerResult, achResult]) => {
      if (cancelled) return
      const monthMatches = (matchResult.data ?? []) as Match[]
      setMatches(monthMatches)
      setPlayers((playerResult.data ?? []) as PlayerRow[])
      setAchievements(achResult.success ? achResult.data : [])

      const matchIds = monthMatches.map((m) => m.id)
      if (matchIds.length === 0) {
        setStats([])
        setLoading(false)
        return
      }
      const { data: statRows } = await supabase
        .from("match_stats")
        .select(
          "player_id, match_id, captures, returns, assists, base_cleaner, flag_grabs, flag_hold_ms, kills, deaths, score, time_played",
        )
        .in("match_id", matchIds)
      if (cancelled) return
      setStats((statRows ?? []) as StatRow[])
      setLoading(false)
    })

    return () => {
      cancelled = true
    }
  }, [year, month])

  const cards = useMemo(() => {
    const byName = new Map<string, WrappedCard>()
    const ensure = (name: string): WrappedCard => {
      let c = byName.get(name)
      if (!c) {
        c = {
          name,
          tier: null,
          wins: 0,
          losses: 0,
          draws: 0,
          played: 0,
          streak: 0,
          streakLive: false,
          hasStats: false,
          statsMatches: 0,
          captures: 0,
          returns: 0,
          assists: 0,
          baseCleaner: 0,
          flagGrabs: 0,
          kills: 0,
          deaths: 0,
          flagHoldMs: 0,
          bestScore: null,
          friends: [],
          nemeses: [],
        }
        byName.set(name, c)
      }
      return c
    }

    // Record, chronological per-player history for the streak pass below —
    // mirrors the Reports tab's own monthly-streak calc (allStreaks), kept as
    // its own copy since this view owns its own match fetch. Teammate/opponent
    // tallies ride the same loop (same team-membership data), feeding the
    // friends/nemeses pass right after.
    const history = new Map<string, boolean[]>() // true = won, in play order
    const teammateTally = new Map<string, Map<string, { games: number; wins: number; losses: number }>>()
    const opponentTally = new Map<string, Map<string, { meetings: number; theirWins: number; myWins: number }>>()
    for (const match of matches) {
      const redWon = match.red_score > match.blue_score
      const blueWon = match.blue_score > match.red_score
      for (const [team, opp, won, lost] of [
        [match.red_team, match.blue_team, redWon, blueWon] as const,
        [match.blue_team, match.red_team, blueWon, redWon] as const,
      ]) {
        for (const name of team) {
          const c = ensure(name)
          c.played++
          if (won) c.wins++
          else if (lost) c.losses++
          else c.draws++
          if (!history.has(name)) history.set(name, [])
          history.get(name)!.push(won)

          let mates = teammateTally.get(name)
          if (!mates) {
            mates = new Map()
            teammateTally.set(name, mates)
          }
          for (const mate of team) {
            if (mate === name) continue
            let rec = mates.get(mate)
            if (!rec) {
              rec = { games: 0, wins: 0, losses: 0 }
              mates.set(mate, rec)
            }
            rec.games++
            if (won) rec.wins++
            else if (lost) rec.losses++
          }

          let opps = opponentTally.get(name)
          if (!opps) {
            opps = new Map()
            opponentTally.set(name, opps)
          }
          for (const foe of opp) {
            let rec = opps.get(foe)
            if (!rec) {
              rec = { meetings: 0, theirWins: 0, myWins: 0 }
              opps.set(foe, rec)
            }
            rec.meetings++
            if (lost) rec.theirWins++
            else if (won) rec.myWins++
          }
        }
      }
    }
    for (const [name, results] of history) {
      let current = 0
      let max = 0
      for (const won of results) {
        current = won ? current + 1 : 0
        max = Math.max(max, current)
      }
      const c = ensure(name)
      c.streak = max
      c.streakLive = current === max && max > 0
    }
    for (const [name, mates] of teammateTally) {
      const c = ensure(name)
      c.friends = Array.from(mates.entries())
        .map(([mate, rec]) => ({ name: mate, ...rec, rate: rec.wins / rec.games }))
        .filter((r) => r.games >= PAIR_MIN_GAMES)
        .sort((a, b) => (b.rate !== a.rate ? b.rate - a.rate : b.games - a.games))
        .slice(0, 3)
    }
    for (const [name, opps] of opponentTally) {
      const c = ensure(name)
      c.nemeses = Array.from(opps.entries())
        .map(([foe, rec]) => ({ name: foe, ...rec, rate: rec.theirWins / rec.meetings }))
        .filter((r) => r.meetings >= PAIR_MIN_GAMES)
        .sort((a, b) => (b.rate !== a.rate ? b.rate - a.rate : b.meetings - a.meetings))
        .slice(0, 3)
    }

    const nameById = new Map(players.map((p) => [p.id, p.name] as const))
    for (const p of players) {
      const c = byName.get(p.name)
      if (c) c.tier = p.tier_value
    }

    const matchById = new Map(matches.map((m) => [m.id, m] as const))
    for (const row of stats) {
      const name = nameById.get(row.player_id)
      if (!name) continue
      const c = ensure(name) // a player can have stats without being resolved above only if name matching drifted; ensure() keeps this safe
      c.hasStats = true
      c.statsMatches++
      c.captures += row.captures || 0
      c.returns += row.returns || 0
      c.assists += row.assists || 0
      c.baseCleaner += row.base_cleaner || 0
      c.flagGrabs += row.flag_grabs || 0
      c.kills += row.kills || 0
      c.deaths += row.deaths || 0
      c.flagHoldMs += row.flag_hold_ms || 0
      if (row.score && (!c.bestScore || row.score > c.bestScore.value)) {
        const match = matchById.get(row.match_id)
        if (match) c.bestScore = { value: row.score, match }
      }
    }

    return byName
  }, [matches, stats, players])

  const names = useMemo(
    () => Array.from(cards.values()).sort((a, b) => b.played - a.played || a.name.localeCompare(b.name)).map((c) => c.name),
    [cards],
  )

  // Land on the month's most active player rather than an empty picker — a
  // shared link with ?player=name still overrides this via selectedName.
  useEffect(() => {
    if (!loading && !selectedName && names.length > 0) {
      onSelectName(names[0])
    }
  }, [loading, selectedName, names, onSelectName])

  const card = selectedName ? cards.get(selectedName) ?? null : null
  const cardAchievements = selectedName ? achievements.filter((a) => a.playerName === selectedName) : []

  const copyLink = () => {
    if (typeof window === "undefined") return
    navigator.clipboard
      .writeText(window.location.href)
      .then(() => toast({ description: "Link copied." }))
      .catch(() => toast({ description: "Couldn't copy the link.", variant: "destructive" }))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"></div>
      </div>
    )
  }

  if (names.length === 0) {
    return (
      <div className="text-center py-12" style={{ color: "var(--color-text-dim)" }}>
        Nobody has a Wrapped card for {MONTH_NAMES[month - 1]} {year} yet.
      </div>
    )
  }

  return (
    <div className="space-y-3.5">
      <div className="glass-panel flex flex-wrap items-center gap-3 p-3">
        <div
          className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em]"
          style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
        >
          <Sparkles className="w-3.5 h-3.5" style={{ color: "var(--color-primary)" }} />
          {MONTH_NAMES[month - 1]} {year} Wrapped
        </div>
        <div className="ml-auto flex items-center gap-2">
          <PlayerPicker names={names} selected={selectedName} onSelect={onSelectName} />
          <button
            type="button"
            onClick={copyLink}
            className="hint-left w-9 h-9 rounded-xl grid place-items-center transition-colors"
            data-hint="Copy a link to this player's Wrapped"
            style={{ border: "1px solid var(--glass-hair)", color: "var(--color-text-dim)" }}
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {card && (
        <>
          <section className="glass-panel p-6 relative overflow-hidden">
            <Emblem
              src="/badges/star.svg"
              color="var(--color-primary)"
              className="absolute -right-[52px] -top-[44px] w-[210px] h-[210px] opacity-[0.06] pointer-events-none"
            />
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <div
                  className="text-[40px] font-bold leading-[1.05]"
                  style={{
                    fontFamily: "var(--font-orbitron)",
                    color: "var(--color-text-bright)",
                    textShadow: "0 0 26px color-mix(in srgb, var(--color-primary) 30%, transparent)",
                  }}
                >
                  {card.name}
                </div>
                {card.tier !== null && (
                  <span
                    className="inline-block mt-2 px-3 py-1 rounded-md text-xs font-bold"
                    style={{ background: "var(--color-primary)", color: "var(--color-background)" }}
                  >
                    Tier {card.tier} — {TIER_NAMES[card.tier] ?? "Unranked"}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-5 flex flex-wrap items-end gap-x-7 gap-y-3">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--color-text-dim)" }}>
                  Record
                </span>
                <b className="text-base font-semibold tabular-nums">
                  <span style={{ color: "#27ae60" }}>{card.wins}W</span>
                  {" – "}
                  <span style={{ color: "#ff4757" }}>{card.losses}L</span>
                  {card.draws > 0 && <span style={{ color: "var(--color-text-dim)" }}> – {card.draws}D</span>}
                </b>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--color-text-dim)" }}>
                  Win rate
                </span>
                <b className="text-base font-semibold tabular-nums">
                  {card.played > 0 ? Math.round((card.wins / card.played) * 100) : 0}%
                </b>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--color-text-dim)" }}>
                  Matches
                </span>
                <b className="text-base font-semibold tabular-nums">{card.played}</b>
              </div>
              {card.streak > 1 && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--color-text-dim)" }}>
                    Best streak
                  </span>
                  <b className="text-base font-semibold tabular-nums" style={{ color: "#f39c12" }}>
                    {card.streak}
                    <small className="text-[11px] font-normal ml-1" style={{ color: "var(--color-text-dim)" }}>
                      {card.streakLive ? "still running" : "wins"}
                    </small>
                  </b>
                </div>
              )}
            </div>
          </section>

          <section className="glass-panel p-5">
            {card.hasStats ? (
              <>
                <div className="grid grid-cols-3 sm:grid-cols-4 gap-2.5">
                  <Stat label="Caps" value={card.captures} />
                  <Stat label="Returns" value={card.returns} />
                  <Stat label="Assists" value={card.assists} />
                  <Stat label="BC" value={card.baseCleaner} />
                  <Stat label="Grabs" value={card.flagGrabs} />
                  <Stat label="Kills" value={card.kills} />
                  <Stat label="Deaths" value={card.deaths} />
                  <Stat label="K/D" value={kdRatio(card.kills, card.deaths)} accent="var(--color-primary)" />
                  <Stat label="Flag hold" value={formatFlagHold(card.flagHoldMs)} />
                </div>
                <p className="mt-3 text-[11px]" style={{ color: "var(--color-text-dim)" }}>
                  Scoreboard stats recorded for {card.statsMatches} of {card.played} matches this month.
                </p>
                {card.bestScore && (
                  <div className="mt-4 pt-4 flex items-center gap-3" style={{ borderTop: "1px solid var(--glass-hair)" }}>
                    <Trophy className="w-4 h-4 shrink-0" style={{ color: "#ffd700" }} />
                    <div>
                      <span className="text-sm font-semibold">Best single-game score: </span>
                      <b className="text-sm tabular-nums" style={{ color: "#ffd700" }}>
                        {card.bestScore.value}
                      </b>
                      <span className="text-xs ml-2" style={{ color: "var(--color-text-dim)" }}>
                        {card.bestScore.match.red_score}–{card.bestScore.match.blue_score},{" "}
                        {new Date(card.bestScore.match.created_at).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                        })}
                      </span>
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-center py-4" style={{ color: "var(--color-text-dim)" }}>
                No scoreboard stats recorded this month.
              </p>
            )}
          </section>

          {(card.friends.length > 0 || card.nemeses.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-3.5">
              <section className="glass-panel p-5">
                <div
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-3"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
                >
                  Best team-mates
                </div>
                {card.friends.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--color-text-dim)" }}>
                    Not enough games together this month.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {card.friends.map((friend, i) => (
                      <div
                        key={friend.name}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg"
                        style={{
                          background: "color-mix(in srgb, var(--color-background) 55%, transparent)",
                          border: "1px solid var(--glass-hair)",
                        }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xs font-mono w-3.5 shrink-0" style={{ color: "var(--color-text-dim)" }}>
                            {i + 1}
                          </span>
                          <Heart className="w-3.5 h-3.5 shrink-0" style={{ color: "#27ae60" }} />
                          <Link
                            href={`/player/${playerSlug(friend.name)}`}
                            className="text-sm font-semibold truncate hover:underline"
                          >
                            {friend.name}
                          </Link>
                        </div>
                        <div className="text-xs shrink-0" style={{ color: "var(--color-text-dim)" }}>
                          <b style={{ color: "#27ae60" }}>{Math.round(friend.rate * 100)}%</b>
                          {" · "}
                          {friend.wins}W–{friend.losses}L
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              <section className="glass-panel p-5">
                <div
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-3"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
                >
                  Nemeses
                </div>
                {card.nemeses.length === 0 ? (
                  <p className="text-sm" style={{ color: "var(--color-text-dim)" }}>
                    No recurring opponents this month.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {card.nemeses.map((nemesis, i) => (
                      <div
                        key={nemesis.name}
                        className="flex items-center justify-between gap-3 px-3 py-2 rounded-lg"
                        style={{
                          background: "color-mix(in srgb, var(--color-background) 55%, transparent)",
                          border: "1px solid var(--glass-hair)",
                        }}
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span className="text-xs font-mono w-3.5 shrink-0" style={{ color: "var(--color-text-dim)" }}>
                            {i + 1}
                          </span>
                          <Swords className="w-3.5 h-3.5 shrink-0" style={{ color: "#ff4757" }} />
                          <Link
                            href={`/player/${playerSlug(nemesis.name)}`}
                            className="text-sm font-semibold truncate hover:underline"
                          >
                            {nemesis.name}
                          </Link>
                        </div>
                        <div className="text-xs shrink-0" style={{ color: "var(--color-text-dim)" }}>
                          <b style={{ color: "#ff4757" }}>beats you {Math.round(nemesis.rate * 100)}%</b>
                          {" · "}
                          {nemesis.myWins}W–{nemesis.theirWins}L
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {cardAchievements.length > 0 && (
            <section className="glass-panel p-5">
              <div
                className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-3"
                style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
              >
                Unlocked this month
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                {cardAchievements.map((e, i) => {
                  const color = rarityColor(e.rarity)
                  const name = e.totalRanks > 1 && e.rank > 1 && !e.titled ? `${e.title} ${roman(e.rank)}` : e.title
                  return (
                    <div
                      key={`${e.achId}-${e.rank}-${i}`}
                      className="flex items-center gap-2.5 px-3 py-2 rounded-lg"
                      style={{
                        background: "color-mix(in srgb, var(--color-background) 55%, transparent)",
                        border: "1px solid var(--glass-hair)",
                      }}
                    >
                      <Sparkles className="w-3.5 h-3.5 shrink-0" style={{ color }} />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold truncate" style={{ color }}>
                          {name}
                        </div>
                        <div className="text-[10px]" style={{ color: "var(--color-text-dim)" }}>
                          {rarityLabel(e.rarity)} · {fmtDate(e.date)}
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  )
}
