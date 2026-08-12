"use client"

import { useEffect, useMemo, useState } from "react"
import Link from "next/link"
import { Check, ChevronsUpDown, Crosshair, Ghost, Heart, Link2, Skull, Sparkles, Swords, Target, type LucideIcon } from "lucide-react"
import { createClient } from "@/lib/supabase/client"
import { getAchievementsEarnedInMonth } from "@/app/admin/actions"
import { Emblem } from "@/components/emblem"
import { tallyWins } from "@/components/wins-leaderboard"
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
  team: string | null
  // Per-style kill columns. These come from the CSV era onwards (83 matches back
  // to June), which is far wider coverage than the JSON kill matrix below.
  red_kills: number | null
  yellow_kills: number | null
  blue_kills: number | null
  dfa_kills: number | null
  ydfa_kills: number | null
  bs_kills: number | null
  dbs_kills: number | null
  blubs_kills: number | null
  upcut_kills: number | null
  mine_kills: number | null
  turret_kills: number | null
  idle_kills: number | null
  tele_kills: number | null
  doom_kills: number | null
}

/** One (killer, victim) pair in a match — the JSON-era scoreboard matrix. */
interface KillRow {
  match_id: string
  killer_player_id: string
  victim_player_id: string
  kills: number
}

/** How a player fared against one opponent, by kills traded. */
export interface DuelRecord {
  name: string
  /** Kills this player landed on them. */
  for: number
  /** Kills they landed on this player. */
  against: number
}

/** A single result in the month, oldest first — the shape the W/L strip draws. */
interface Result {
  outcome: "W" | "L" | "D"
  date: string
  scoreFor: number
  scoreAgainst: number
}

interface PlayerRow {
  id: string
  name: string
  tier_value: number
  avatar_url: string | null
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
  avatarUrl: string | null
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
  /** Team-mates you lost most alongside — the dark twin of friends. */
  curses: PairRecord[]
  /** Every result this month, oldest first, for the form strip. */
  results: Result[]
  /** Record split by which side they were on. */
  byTeam: { red: { wins: number; losses: number }; blue: { wins: number; losses: number } }
  /** Kills by style, highest first; only styles they actually landed. */
  killTypes: { label: string; value: number; order: number }[]
  /** From the JSON kill matrix — empty when the month has no matrix data. */
  prey: DuelRecord[]
  bullies: DuelRecord[]
  rivals: DuelRecord[]
}

// Same floor and ranking the bot's monthly =friend/=nemesis commands use
// (app/api/bot/friend, app/api/bot/nemesis by-discord routes) — highest win
// rate, not raw volume, with a minimum so two lucky games together don't read
// as a bond. Kept in step with those deliberately; if one changes, check the
// other.
const PAIR_MIN_GAMES = 3

/*
 * Kill styles, in the order they read as a scoreboard rather than alphabetically.
 * Labels are the words players actually use -- "DBS", not "dbs_kills" -- and any
 * style nobody landed is dropped rather than shown as a zero, so a light month
 * does not fill the card with blanks.
 */
const KILL_STYLES: { key: keyof StatRow; label: string }[] = [
  // Fixed running order, not sorted by count: sabre styles first in stance
  // order, then the special moves, then everything that is not a sabre at all.
  // A value-sorted list reshuffles itself every month, so you can never learn
  // where to look.
  //
  // Names as players use them, which do not follow the column names: bs_kills is
  // a BACKSLASH, and a backstab is the blue one (blubs). DBS is the Double
  // Backhanded Slash, and not a variant of either.
  { key: "yellow_kills", label: "Yellow" },
  { key: "red_kills", label: "Red" },
  { key: "blue_kills", label: "Blue" },
  { key: "dfa_kills", label: "DFA" },
  { key: "bs_kills", label: "Backslash" },
  { key: "dbs_kills", label: "DBS" },
  { key: "upcut_kills", label: "Upcut" },
  { key: "ydfa_kills", label: "YDFA" },
  { key: "blubs_kills", label: "Backstab" },
  { key: "mine_kills", label: "Mines" },
  { key: "turret_kills", label: "Turret" },
  { key: "doom_kills", label: "Doom" },
  { key: "tele_kills", label: "Tele" },
  { key: "idle_kills", label: "Idle" },
]

/** Duels need more than a couple of recorded games to mean anything. */
const DUEL_MIN_KILLS = 3

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


/**
 * One ranked list of people — best team-mates, nemeses, prey, whatever.
 *
 * Six of these appear on a card and they differ only in wording and colour, so
 * they share a component: six hand-rolled copies would drift the moment one of
 * them got a fix.
 */
function PeopleCard({
  title,
  blurb,
  icon: Icon,
  accent,
  rows,
  empty,
}: {
  title: string
  blurb: string
  icon: LucideIcon
  accent: string
  rows: { name: string; primary: string; secondary: string }[]
  empty: string
}) {
  return (
    <section className="glass-panel p-5 flex flex-col">
      <div
        className="text-[11px] font-semibold uppercase tracking-[0.16em]"
        style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
      >
        {title}
      </div>
      <p className="mt-1 mb-3 text-[11px] leading-snug" style={{ color: "var(--color-text-dim)" }}>
        {blurb}
      </p>
      {rows.length === 0 ? (
        <p className="text-sm" style={{ color: "var(--color-text-dim)" }}>
          {empty}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => (
            <div
              key={row.name}
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
                <Icon className="w-3.5 h-3.5 shrink-0" style={{ color: accent }} />
                <Link href={`/player/${playerSlug(row.name)}`} className="text-sm font-semibold truncate hover:underline">
                  {row.name}
                </Link>
              </div>
              <div className="text-xs shrink-0 tabular-nums" style={{ color: "var(--color-text-dim)" }}>
                <b style={{ color: accent }}>{row.primary}</b>
                {row.secondary && <> · {row.secondary}</>}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}

/**
 * The month as a line: cumulative wins minus losses, game by game.
 *
 * A row of W/L pips says what happened but not the shape of it — a run of six
 * losses in the middle of a winning month reads the same as six spread out. The
 * line shows the shape; the pips underneath keep the detail.
 */
function FormGraph({ results }: { results: Result[] }) {
  if (results.length < 2) return null
  let running = 0
  const points = results.map((r, i) => {
    running += r.outcome === "W" ? 1 : r.outcome === "L" ? -1 : 0
    return { x: i, y: running }
  })
  const ys = points.map((p) => p.y)
  const lo = Math.min(0, ...ys)
  const hi = Math.max(0, ...ys)
  const span = hi - lo || 1
  const W = 100
  const H = 32
  const px = (i: number) => (points.length === 1 ? 0 : (i / (points.length - 1)) * W)
  const py = (y: number) => H - ((y - lo) / span) * H
  const d = points.map((p, i) => `${i === 0 ? "M" : "L"}${px(p.x).toFixed(2)},${py(p.y).toFixed(2)}`).join(" ")
  const zeroY = py(0)
  const end = points[points.length - 1].y
  const endColour = end > 0 ? "#27ae60" : end < 0 ? "#ff4757" : "var(--color-text-dim)"

  return (
    <div className="flex flex-col gap-2">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-12" aria-hidden>
        <line x1="0" y1={zeroY} x2={W} y2={zeroY} stroke="var(--glass-hair)" strokeWidth="0.5" strokeDasharray="2 2" />
        <path d={d} fill="none" stroke={endColour} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        <circle cx={px(points.length - 1)} cy={py(end)} r="2" fill={endColour} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The pips stretch to the same width as the line above them. Fixed-width
          pips left the strip ending short of the graph, so the last game sat
          under empty axis and the two rows read as unrelated. */}
      <div className="flex gap-1">
        {results.map((r, i) => (
          <span
            key={i}
            // data-hint, not title: the site's own CSS tooltip appears on hover
            // straight away, where the browser's native one waits a second and
            // reads as nothing happening.
            data-hint={`${new Date(r.date).toLocaleDateString(undefined, {
              day: "numeric",
              month: "short",
            })} — ${r.outcome === "W" ? "Won" : r.outcome === "L" ? "Lost" : "Drew"} ${r.scoreFor}-${r.scoreAgainst}`}
            className="relative flex-1 min-w-[3px] h-4 rounded-sm"
            style={{
              backgroundColor: r.outcome === "W" ? "#27ae60" : r.outcome === "L" ? "#ff4757" : "#5a6472",
            }}
          />
        ))}
      </div>
    </div>
  )
}

export function WrappedView({ year, month, selectedName, onSelectName }: WrappedViewProps) {
  const [matches, setMatches] = useState<Match[]>([])
  const [stats, setStats] = useState<StatRow[]>([])
  const [kills, setKills] = useState<KillRow[]>([])
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
      supabase.from("players").select("id, name, tier_value, avatar_url"),
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
        setKills([])
        setLoading(false)
        return
      }
      const { data: statRows } = await supabase
        .from("match_stats")
        .select(
          "player_id, match_id, captures, returns, assists, base_cleaner, flag_grabs, flag_hold_ms, kills, deaths, score, time_played, team, red_kills, yellow_kills, blue_kills, dfa_kills, ydfa_kills, bs_kills, dbs_kills, blubs_kills, upcut_kills, mine_kills, turret_kills, idle_kills, tele_kills, doom_kills",
        )
        .in("match_id", matchIds)
      // The per-opponent matrix only exists for JSON-era scoreboards, so this is
      // deliberately allowed to come back empty -- the duel sections hide
      // themselves rather than inventing rivalries out of two recorded games.
      const { data: killRows } = await supabase
        .from("match_kills")
        .select("match_id, killer_player_id, victim_player_id, kills")
        .in("match_id", matchIds)
      if (cancelled) return
      setStats((statRows ?? []) as StatRow[])
      setKills((killRows ?? []) as KillRow[])
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
          avatarUrl: null,
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
          curses: [],
          results: [],
          byTeam: { red: { wins: 0, losses: 0 }, blue: { wins: 0, losses: 0 } },
          killTypes: [],
          prey: [],
          bullies: [],
          rivals: [],
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
      for (const [team, opp, won, lost, side] of [
        [match.red_team, match.blue_team, redWon, blueWon, "red"] as const,
        [match.blue_team, match.red_team, blueWon, redWon, "blue"] as const,
      ]) {
        for (const name of team) {
          const c = ensure(name)
          c.played++
          if (won) c.wins++
          else if (lost) c.losses++
          else c.draws++
          c.results.push({
            outcome: won ? "W" : lost ? "L" : "D",
            date: match.created_at,
            scoreFor: side === "red" ? match.red_score : match.blue_score,
            scoreAgainst: side === "red" ? match.blue_score : match.red_score,
          })
          // Which side of the map treated them better. Teams are assigned by the
          // balancer, so this is closer to luck than skill -- but it is the kind
          // of thing people notice and argue about.
          if (won) c.byTeam[side].wins++
          else if (lost) c.byTeam[side].losses++
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
    for (const [name, mates] of teammateTally) {
      // Same pairs as friends, ranked the other way up. Matching the bot's
      // =curse so the site and Discord never name different people.
      const c = ensure(name)
      c.curses = Array.from(mates.entries())
        .map(([mate, rec]) => ({ name: mate, ...rec, rate: rec.losses / rec.games }))
        .filter((r) => r.games >= PAIR_MIN_GAMES && r.losses > 0)
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
      if (c) {
        c.tier = p.tier_value
        c.avatarUrl = p.avatar_url
      }
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
      for (const style of KILL_STYLES) {
        const n = (row[style.key] as number | null) || 0
        if (!n) continue
        const found = c.killTypes.find((k) => k.label === style.label)
        if (found) found.value += n
        else c.killTypes.push({ label: style.label, value: n, order: KILL_STYLES.indexOf(style) })
      }
      c.killTypes.sort((a, b) => a.order - b.order)
    }

    /*
     * Prey, bullies and rivals, from the JSON kill matrix.
     *
     *   prey    -- you killed them most
     *   bully   -- they killed you most
     *   rival   -- the closest record between you, i.e. who you actually trade
     *              with rather than who you beat or lose to
     *
     * Rivals are ranked by margin first and volume second, so a 9-8 outranks a
     * 2-2: both are level, but only one of them is a rivalry.
     */
    const duels = new Map<string, Map<string, { for: number; against: number }>>()
    const pair = (a: string, b: string) => {
      let m = duels.get(a)
      if (!m) {
        m = new Map()
        duels.set(a, m)
      }
      let rec = m.get(b)
      if (!rec) {
        rec = { for: 0, against: 0 }
        m.set(b, rec)
      }
      return rec
    }
    for (const k of kills) {
      const killer = nameById.get(k.killer_player_id)
      const victim = nameById.get(k.victim_player_id)
      if (!killer || !victim || killer === victim) continue
      pair(killer, victim).for += k.kills || 0
      pair(victim, killer).against += k.kills || 0
    }
    for (const [name, opps] of duels) {
      const c = ensure(name)
      const rows = Array.from(opps.entries()).map(([opp, rec]) => ({ name: opp, ...rec }))
      c.prey = rows
        .filter((r) => r.for >= DUEL_MIN_KILLS)
        .sort((a, b) => b.for - a.for || a.against - b.against)
        .slice(0, 3)
      c.bullies = rows
        .filter((r) => r.against >= DUEL_MIN_KILLS)
        .sort((a, b) => b.against - a.against || a.for - b.for)
        .slice(0, 3)
      c.rivals = rows
        .filter((r) => r.for + r.against >= DUEL_MIN_KILLS * 2)
        .sort(
          (a, b) =>
            Math.abs(a.for - a.against) - Math.abs(b.for - b.against) ||
            b.for + b.against - (a.for + a.against),
        )
        .slice(0, 3)
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

  /*
   * Where they finished on the month's Wins board.
   *
   * Uses the same tally and the same 30%-of-matches bar the Leaderboard tab
   * uses, rather than a second ranking of its own -- two definitions of "you
   * came third" would eventually disagree, and the one on your own recap is the
   * one you would screenshot.
   */
  const finish = useMemo(() => {
    if (!selectedName || matches.length === 0) return null
    const min = Math.ceil(matches.length * 0.3)
    const board = tallyWins(matches, min)
    const at = board.findIndex((r) => r.name === selectedName)
    return at === -1 ? { qualified: false as const, min } : { qualified: true as const, place: at + 1, of: board.length }
  }, [selectedName, matches])

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
          {/* No player picker: the card is the reader's own month now, so a
              dropdown of 69 names to find yourself in was a step backwards. */}
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
            {/* Identity down the left, the nine numbers down the right, both
                starting at the top edge. Stacked, the card ran nearly a full
                screen for one player's month; side by side it reads at a
                glance and the record strip fills the height the grid needs. */}
            <div className="grid lg:grid-cols-[minmax(0,0.95fr)_minmax(0,1fr)] gap-x-8 gap-y-5 items-start">
            <div className="min-w-0">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                {card.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element -- admin-set URLs
                  <img
                    src={card.avatarUrl}
                    alt=""
                    className="w-16 h-16 rounded-xl object-cover shrink-0"
                    style={{
                      border: "1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)",
                      boxShadow: "0 0 18px -6px var(--color-primary-glow)",
                    }}
                  />
                )}
              <div className="min-w-0">
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
              {finish && (
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--color-text-dim)" }}>
                    Leaderboard
                  </span>
                  <b className="text-base font-semibold tabular-nums">
                    {finish.qualified ? (
                      <>
                        #{finish.place}
                        <small className="text-[11px] font-normal ml-1" style={{ color: "var(--color-text-dim)" }}>
                          of {finish.of}
                        </small>
                      </>
                    ) : (
                      <small className="text-[11px] font-normal" style={{ color: "var(--color-text-dim)" }}>
                        Under {finish.min} games
                      </small>
                    )}
                  </b>
                </div>
              )}
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
            {/* The stat block lives in the same card as the name and record --
                two panels left both half-empty, and this is all one player's
                month. */}
            {/* Sits under the record rather than at the foot of the card: the
                left column ran out of content well before the stat grid on the
                right did, leaving a band of empty panel between the two. */}
            {card.bestScore && (
              <div
                className="mt-5 pt-4 flex items-center gap-3"
                style={{ borderTop: "1px solid var(--glass-hair)" }}
              >
                <Emblem
                  src="/achievements/rebel-alliance-jedi-order.svg"
                  color="#ffd700"
                  className="w-[18px] h-[18px] shrink-0"
                />
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
            </div>

            {card.hasStats ? (
              /* Three columns at every width, not four on desktop. There are
                 nine stats: 3x3 is a block, 4+4+1 leaves Flag hold stranded on a
                 row of its own with three empty cells beside it. */
              <div className="grid grid-cols-3 gap-2.5">
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
            ) : null}
            </div>

            {card.hasStats ? (
              <>
                {/* Only when some match is actually missing its scoreboard.
                    Every match gets one now, so stating "23 of 23" was a line of
                    noise on every card -- but a silent undercount would make the
                    totals above simply look wrong, with nothing to explain it. */}
                {card.statsMatches < card.played && (
                  <p className="mt-4 text-[11px]" style={{ color: "var(--color-text-dim)" }}>
                    Scoreboard stats recorded for {card.statsMatches} of {card.played} matches this month — the
                    totals above cover those {card.statsMatches}.
                  </p>
                )}
                {/* Folded into the same panel as the headline stats rather than
                    given a card of its own: it is the same scoreboard, read a
                    level finer, and a second panel for it left both looking
                    thin. Smaller boxes so a dozen styles fit without the block
                    competing with the nine numbers above it. */}
                {card.killTypes.length > 0 && (
                  <div className="mt-4 pt-4" style={{ borderTop: "1px solid var(--glass-hair)" }}>
                    <div
                      className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-2.5"
                      style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
                    >
                      How you killed
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {card.killTypes.map((k) => (
                        <div
                          key={k.label}
                          className="rounded-md px-2 py-1 flex items-baseline gap-1.5"
                          style={{
                            background: "color-mix(in srgb, var(--color-background) 55%, transparent)",
                            border: "1px solid var(--glass-hair)",
                          }}
                        >
                          <span className="text-sm font-semibold tabular-nums">{k.value.toLocaleString()}</span>
                          <span
                            className="text-[10px] uppercase tracking-[0.1em]"
                            style={{ color: "var(--color-text-dim)" }}
                          >
                            {k.label}
                          </span>
                        </div>
                      ))}
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

          {/* The month at a glance: shape of the run, and which side favoured
              them.

              Same three-column grid as the people rows below, with the graph
              spanning two of them -- a 2fr/1fr split looks equivalent but is off
              by a third of the gap, so the panel edges never quite lined up with
              the row underneath. */}
          {card.results.length >= 2 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <section className="glass-panel p-5 sm:col-span-1 lg:col-span-2">
                <div
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-3"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
                >
                  How the month ran
                </div>
                <FormGraph results={card.results} />
              </section>
              <section className="glass-panel p-5">
                <div
                  className="text-[11px] font-semibold uppercase tracking-[0.16em] mb-3"
                  style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
                >
                  Red vs Blue
                </div>
                <div className="grid grid-cols-2 gap-2.5">
                  {([["Red", card.byTeam.red, "#ff4757"], ["Blue", card.byTeam.blue, "#62d6e8"]] as const).map(
                    ([label, rec, colour]) => {
                      const games = rec.wins + rec.losses
                      return (
                        <div
                          key={label}
                          className="rounded-lg px-3 py-2.5"
                          style={{
                            background: "color-mix(in srgb, var(--color-background) 55%, transparent)",
                            border: "1px solid var(--glass-hair)",
                          }}
                        >
                          <div className="text-[10px] uppercase tracking-[0.13em]" style={{ color: colour }}>
                            {label}
                          </div>
                          <div className="text-lg font-semibold tabular-nums">
                            {games > 0 ? `${Math.round((rec.wins / games) * 100)}%` : "—"}
                          </div>
                          <div className="text-[11px] tabular-nums" style={{ color: "var(--color-text-dim)" }}>
                            {rec.wins}W–{rec.losses}L
                          </div>
                        </div>
                      )
                    },
                  )}
                </div>
              </section>
            </div>
          )}

          {(card.friends.length > 0 || card.nemeses.length > 0 || card.curses.length > 0) && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <PeopleCard
                title="Best team-mates"
                blurb="Highest win rate alongside you."
                icon={Heart}
                accent="#27ae60"
                empty="Not enough games together this month."
                rows={card.friends.map((f) => ({
                  name: f.name,
                  primary: `${Math.round(f.rate * 100)}%`,
                  secondary: `${f.wins}W–${f.losses}L`,
                }))}
              />
              <PeopleCard
                title="Nemeses"
                blurb="Beat you more than anyone else did."
                icon={Swords}
                accent="#ff4757"
                empty="Nobody faced enough times this month."
                rows={card.nemeses.map((n) => ({
                  name: n.name,
                  primary: `${Math.round(n.rate * 100)}%`,
                  secondary: `${n.myWins}W–${n.theirWins}L`,
                }))}
              />
              <PeopleCard
                title="Curses"
                blurb="You lose when you play together."
                icon={Ghost}
                accent="#f39c12"
                empty="No unlucky pairings this month."
                rows={card.curses.map((c) => ({
                  name: c.name,
                  primary: `${Math.round(c.rate * 100)}%`,
                  secondary: `${c.wins}W–${c.losses}L`,
                }))}
              />
            </div>
          )}

          {/* Duels need the JSON scoreboard matrix, which only exists for recent
              matches — the row hides entirely rather than crowning a nemesis off
              two recorded kills. */}
          {(card.prey.length > 0 || card.bullies.length > 0 || card.rivals.length > 0) && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
              <PeopleCard
                title="Prey"
                blurb="You killed them most."
                icon={Target}
                accent="#27ae60"
                empty="No kills recorded yet."
                rows={card.prey.map((d) => ({ name: d.name, primary: `${d.for}`, secondary: `${d.against} back` }))}
              />
              <PeopleCard
                title="Rivals"
                blurb="Closest record — the ones you actually trade with."
                icon={Crosshair}
                accent="var(--color-primary)"
                empty="No close duels yet."
                rows={card.rivals.map((d) => ({ name: d.name, primary: `${d.for}–${d.against}`, secondary: "" }))}
              />
              <PeopleCard
                title="Bullies"
                blurb="They killed you most."
                icon={Skull}
                accent="#ff4757"
                empty="Nobody has your number yet."
                rows={card.bullies.map((d) => ({ name: d.name, primary: `${d.against}`, secondary: `${d.for} back` }))}
              />
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
