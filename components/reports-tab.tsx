"use client"

import { useEffect, useState } from "react"
import { rankBy, rankByName } from "@/lib/rank-order"
import {
  getCapConversionByMonth,
  getMatchesByMonth,
  getMatchStatsByMonth,
  getReturnerRateByMonth,
  getStreakRecord,
  getMatches,
} from "@/app/admin/actions"
import type { CapConversion } from "@/lib/cap-conversion"
import type { ReturnerRate } from "@/lib/returner-rate"
import type { StreakRecord } from "@/lib/achievements-server"
import { ChevronLeft, ChevronRight, BarChart3 } from "lucide-react"
import { SegmentedRail } from "@/components/segmented-rail"
import { Emblem } from "@/components/emblem"
import Link from "next/link"
import { RankMedal } from "@/components/rank-medal"
import { WinsLeaderboard, tallyWins } from "@/components/wins-leaderboard"
import { WrappedView } from "@/components/wrapped-view"
export { RankMedal }
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import type { Player } from "@/lib/types"
import { createClient } from "@/lib/supabase/client"
import { checkIsAdmin } from "@/lib/is-admin"
import { TierChangelog } from "@/components/tier-changelog"
import { EloLeaderboard } from "@/components/elo-leaderboard"
import { TrueSkillLeaderboard } from "@/components/trueskill-leaderboard"
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts"



interface Match {
  id: string
  red_team: string[]
  blue_team: string[]
  red_tiers?: number[] | null
  blue_tiers?: number[] | null
  red_score: number
  blue_score: number
  match_type: "algorithm" | "manual"
  balance_confidence: number | null
  notes: string | null
  created_at: string
}

interface PlayerMatchStats {
  name: string
  matches: number
  wins: number
  losses: number
}

// Raw match_stats rows for the month (see getMatchStatsByMonth).
interface MatchStatRow {
  match_id: string
  player_id: string
  score: number
  flag_hold_ms: number
  dbs_kills: number
  captures: number
  returns: number
  kills: number
  deaths: number
  time_played: number | null
}

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
]

// flag_hold_ms is stored in milliseconds — render as m:ss (e.g. 272500 -> "4:32").
function formatFlagHold(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}:${String(seconds).padStart(2, "0")}`
}

/**
 * Upset-weighted win value per player, for one set of matches.
 *
 * Extracted from the Star Player block so the same scoring can run over last
 * month as well as this one — the hero's "vs <previous month>" delta is the
 * current holder's average scored on both months with identical rules.
 *
 * Tiers come from the match's OWN red_tiers/blue_tiers snapshot, so a past
 * month's Star Player is frozen: retuning a player's tier today must not
 * quietly re-award July. (It used to read the players table as it stands,
 * which did exactly that.) Matches predating the snapshot columns fall back
 * to the live map — those months can still drift, there is nothing recorded
 * to freeze them against.
 */
function scoreMatches(matches: Match[], playerTierMap: Map<string, number>) {
  const stats = new Map<string, { name: string; wins: number; losses: number; score: number; matches: number }>()

  for (const match of matches) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score
    if (!redWon && !blueWon) continue // draws score nothing either way

    const snapshot = match.red_tiers?.length && match.blue_tiers?.length
    const redTierTotal = snapshot
      ? match.red_tiers!.reduce((sum, t) => sum + t, 0)
      : match.red_team.reduce((sum, name) => sum + (playerTierMap.get(name) || 5), 0)
    const blueTierTotal = snapshot
      ? match.blue_tiers!.reduce((sum, t) => sum + t, 0)
      : match.blue_team.reduce((sum, name) => sum + (playerTierMap.get(name) || 5), 0)

    for (const [team, won, tierAdvantage] of [
      [match.red_team, redWon, blueTierTotal - redTierTotal],
      [match.blue_team, blueWon, redTierTotal - blueTierTotal],
    ] as const) {
      for (const playerName of team) {
        if (!stats.has(playerName)) {
          stats.set(playerName, { name: playerName, wins: 0, losses: 0, score: 0, matches: 0 })
        }
        const entry = stats.get(playerName)!
        entry.matches++
        if (!won) {
          entry.losses++
          continue
        }
        entry.wins++
        entry.score +=
          tierAdvantage > 0
            ? // Upset win — worth more the stronger the opposition was.
              1.0 + tierAdvantage * 0.1
            : // Expected win — worth less, floored so it's never worthless.
              Math.max(0.3, 1.0 + tierAdvantage * 0.05)
      }
    }
  }

  return stats
}

// Panel heading: a label, a rule that fades out, and an optional qualifier on
// the right. The qualifier is where "players with N+ stat-tracked matches" now
// lives — stated once per panel instead of under every single stat.
function SectionHead({ title, tag }: { title: string; tag?: string }) {
  return (
    <div className="flex items-center gap-2.5 mb-3.5">
      <h3
        className="text-[11px] font-semibold uppercase tracking-[0.16em]"
        style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
      >
        {title}
      </h3>
      <span
        className="flex-1 h-px"
        style={{ background: "linear-gradient(90deg, var(--glass-hair), transparent)" }}
      />
      {tag && (
        <span className="text-[10.5px] tracking-[0.05em]" style={{ color: "var(--color-text-dim)" }}>
          {tag}
        </span>
      )}
    </div>
  )
}

// One row of the records list: emblem, what the record is, who holds it, the
// figure. `accent` tints the emblem and the value, so each row reads as its own
// record without the panel turning into a rainbow.
function RecordRow({
  emblem,
  accent,
  label,
  hint,
  who,
  value,
  note,
}: {
  emblem: string
  accent: string
  label: string
  hint: string
  who?: string
  value: string | number | null
  note?: string
}) {
  const empty = value === null || value === undefined || who === undefined
  return (
    <div
      className="flex items-center gap-3 py-2.5 border-b last:border-b-0"
      style={{ color: accent, borderColor: "color-mix(in srgb, var(--color-border) 45%, transparent)" }}
    >
      <span className="glyph-chip w-[34px] h-[34px]">
        <Emblem src={emblem} className="w-[19px] h-[19px] opacity-90" />
      </span>
      <span className="text-[12.5px] flex-1 min-w-0 flex items-center gap-1.5" style={{ color: "var(--color-text-dim)" }}>
        {label}
        <span
          className="w-3.5 h-3.5 rounded-full grid place-items-center text-[8px] font-semibold shrink-0 cursor-help opacity-70"
          style={{ border: "1px solid var(--glass-hair)" }}
          data-hint={hint}
        >
          ?
        </span>
      </span>
      {empty ? (
        <span className="text-[11.5px] italic" style={{ color: "var(--color-text-dim)" }}>
          no data
        </span>
      ) : (
        <>
          <span className="text-sm font-semibold mr-3" style={{ color: "var(--color-text-bright)" }}>
            {who}
          </span>
          <span className="text-sm font-bold min-w-[96px] text-right tabular-nums" style={{ fontFamily: "var(--font-mono)" }}>
            {value}
            {note && (
              <span className="block text-[10.5px] font-normal mt-0.5" style={{ color: "var(--color-text-dim)" }}>
                {note}
              </span>
            )}
          </span>
        </>
      )}
    </div>
  )
}

// A summary line under the streak list: emblem, what it is, and the figure.
function StreakFoot({
  emblem,
  title,
  sub,
  value,
  unit,
  muted = false,
}: {
  emblem: string
  title: string
  sub: string
  value: number
  unit: string
  muted?: boolean
}) {
  const accent = muted ? "var(--color-text-dim)" : "#f39c12"
  return (
    <div
      className="flex items-center gap-3 mt-3 pt-3 border-t"
      style={{ borderColor: "color-mix(in srgb, var(--color-border) 45%, transparent)" }}
    >
      <span className="glyph-chip w-[30px] h-[30px]" style={{ color: accent }}>
        <Emblem src={emblem} className="w-[17px] h-[17px]" />
      </span>
      <span className="min-w-0">
        <b className="text-[13px] font-semibold" style={{ color: "var(--color-text-bright)" }}>
          {title}
        </b>
        <span className="block text-[11px] mt-0.5 truncate" style={{ color: "var(--color-text-dim)" }}>
          {sub}
        </span>
      </span>
      <span className="ml-auto text-right">
        <b className="text-[19px] font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)", color: accent }}>
          {value}
        </b>
        <span className="block text-[10px] mt-0.5 uppercase tracking-[0.1em]" style={{ color: "var(--color-text-dim)" }}>
          {unit}
        </span>
      </span>
    </div>
  )
}

function HoodStat({
  value,
  color,
  label,
  note,
}: {
  value: string | number
  color: string
  label: string
  note: string
}) {
  return (
    <div
      className="px-4 py-3.5 rounded-[11px]"
      style={{
        border: "1px solid var(--glass-hair)",
        backgroundColor: "color-mix(in srgb, var(--color-surface-elevated) 45%, transparent)",
      }}
    >
      <b className="block text-[26px] font-bold leading-none mb-1.5 tabular-nums" style={{ fontFamily: "var(--font-mono)", color }}>
        {value}
      </b>
      <span className="block text-[11px] font-medium" style={{ color: "var(--color-text)" }}>
        {label}
      </span>
      <span className="block text-[11px] leading-snug" style={{ color: "var(--color-text-dim)" }}>
        {note}
      </span>
    </div>
  )
}

function EmptyHood({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-sm italic text-center py-10" style={{ color: "var(--color-text-dim)" }}>
      {children}
    </p>
  )
}

export function ReportsTab() {
  // "Current month" in UTC, matching the UTC month bucketing used everywhere
  // (badges, boards, server actions) — viewer-local months made viewers in
  // different timezones see different boards.
  const now = new Date()
  const [selectedYear, setSelectedYear] = useState(now.getUTCFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getUTCMonth() + 1)
  const [matches, setMatches] = useState<Match[]>([])
  const [matchStats, setMatchStats] = useState<MatchStatRow[]>([])
  // Previous month, for the "vs <month>" deltas; and the all-time streak record.
  const [prevMatches, setPrevMatches] = useState<Match[]>([])
  // Null until loaded, and legitimately null for any month before the kill
  // matrix existed (9 Aug 2026) — the card hides itself rather than showing 0%.
  const [capConversion, setCapConversion] = useState<CapConversion | null>(null)
  const [returnerRate, setReturnerRate] = useState<ReturnerRate | null>(null)
  const [streakRecord, setStreakRecord] = useState<StreakRecord | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [loading, setLoading] = useState(true)
  /*
   * Two levels now. The top rail picks the page -- Monthly stats or the
   * Leaderboard -- and the Leaderboard picks which board it is showing. ELO and
   * TrueSkill used to sit at the top level beside Monthly, which read as four
   * unrelated pages when three of them are the same question answered by
   * different maths.
   */
  const [currentView, setCurrentView] = useState<"stats" | "leaderboard" | "alltime" | "wrapped">("stats")
  const [boardView, setBoardView] = useState<"normal" | "elo" | "trueskill">("normal")
  // The All-Time tab shows the same two rating boards, so it needs its own
  // selection -- sharing boardView would leave it on "Wins", which has no
  // all-time form.
  const [allTimeBoard, setAllTimeBoard] = useState<"wins" | "elo" | "trueskill">("wins")
  // Every match ever played, for the all-time Wins board. Fetched separately
  // from the month's matches and only once the admin-only All-Time tab is
  // actually opened -- no reason to pull the whole history for a page most
  // people never see.
  const [allTimeMatches, setAllTimeMatches] = useState<Match[] | null>(null)
  /*
   * Wrapped is personal, so the tab needs to know who is reading it. null while
   * the check is in flight, "" once it comes back logged out -- told apart so a
   * signed-in player never sees the login prompt flash before their own card.
   */
  const [me, setMe] = useState<{ playerId: string; name: string } | null | "">(null)
  useEffect(() => {
    fetch("/api/player-auth/me")
      .then((r) => r.json())
      .then((d) => setMe(d?.playerId ? { playerId: d.playerId, name: d.name } : ""))
      .catch(() => setMe(""))
  }, [])
  const [isAdmin, setIsAdmin] = useState(false)
  // The "Under the hood" band: four working views of the same month, sharing one
  // panel rather than stacking four full-width slabs down the page.
  const [hoodView, setHoodView] = useState<"reality" | "compare" | "accuracy" | "tiers">("reality")

  // Check if user is admin (server-side allowlist, RLS-enforced)
  useEffect(() => {
    checkIsAdmin().then(setIsAdmin)
  }, [])

  useEffect(() => {
    setLoading(true)
    // The previous month rides along so the headline figures can say which way
    // they moved. It's the same query one month back, and nothing on the page
    // blocks on it beyond the deltas themselves.
    const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1
    const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear

    Promise.all([
      getMatchesByMonth(selectedYear, selectedMonth),
      fetchPlayersFromDB(),
      getMatchStatsByMonth(selectedYear, selectedMonth),
      getMatchesByMonth(prevYear, prevMonth),
      getCapConversionByMonth(selectedYear, selectedMonth),
      getReturnerRateByMonth(selectedYear, selectedMonth),
    ]).then(([matchResult, playersData, statsResult, prevResult, capResult, retResult]) => {
      if (matchResult.success) {
        setMatches(matchResult.data as Match[])
      }
      setPlayers(playersData)
      setMatchStats(statsResult.success ? (statsResult.data as MatchStatRow[]) : [])
      setPrevMatches(prevResult.success ? (prevResult.data as Match[]) : [])
      setCapConversion(capResult.success ? capResult.data : null)
      setReturnerRate(retResult.success ? retResult.data : null)
      setLoading(false)
    })
  }, [selectedYear, selectedMonth])

  // All-time streak record — fetched once, not per month: it doesn't depend on
  // which month is selected.
  useEffect(() => {
    getStreakRecord().then((result) => {
      if (result.success) setStreakRecord(result.data)
    })
  }, [])

  const isCurrentMonth = selectedYear === now.getUTCFullYear() && selectedMonth === now.getUTCMonth() + 1

  // isAdmin resolves after the first render, so a non-admin could be sitting on
  // All-Time for a frame. Send them back rather than leave them on a tab that
  // is about to vanish from the rail.
  useEffect(() => {
    if (!isAdmin && currentView === "alltime") setCurrentView("stats")
  }, [isAdmin, currentView])

  useEffect(() => {
    if (currentView !== "alltime" || allTimeMatches !== null) return
    getMatches().then((r) => {
      // getMatches returns newest-first; getMatchesByMonth returns oldest-first,
      // and tallyWins reads recent form off the tail. Normalise, or the Form
      // column would show everyone's first five games instead of their last.
      if (r.success) setAllTimeMatches([...(r.data as Match[])].reverse())
      else setAllTimeMatches([])
    })
  }, [currentView, allTimeMatches])

  /*
   * All-time qualifying bar. The month's 30%-of-matches rule does not carry
   * over: 30% of every match on record is 80-odd games, which only a handful of
   * people clear. A flat 20 keeps win rate meaningful (five games can read 80%
   * on a fluke) while leaving a real board -- 39 of 69 players at time of
   * writing.
   */
  const ALL_TIME_MIN_MATCHES = 20
  const allTimeWins = tallyWins(allTimeMatches ?? [], ALL_TIME_MIN_MATCHES)

  /*
   * Every board is public. The month's own leaderboard used to be admin-only
   * until the month closed, and ELO and TrueSkill were admin-only outright --
   * so the people the ratings are about were the only ones who could not see
   * them. Nothing here is private; it is all derived from matches everybody
   * played. No view can now become unavailable mid-session, so the effect that
   * used to force the selection back to Monthly is gone with it.
   */

  const canGoNext = !(selectedYear === now.getUTCFullYear() && selectedMonth === now.getUTCMonth() + 1)

  const goToPrevMonth = () => {
    if (selectedMonth === 1) {
      setSelectedMonth(12)
      setSelectedYear(selectedYear - 1)
    } else {
      setSelectedMonth(selectedMonth - 1)
    }
  }

  const goToNextMonth = () => {
    if (!canGoNext) return
    if (selectedMonth === 12) {
      setSelectedMonth(1)
      setSelectedYear(selectedYear + 1)
    } else {
      setSelectedMonth(selectedMonth + 1)
    }
  }

  // Calculate stats
  const totalMatches = matches.length
  const scoreMargins = matches.map(m => Math.abs(m.red_score - m.blue_score))
  const avgMargin = totalMatches > 0 ? scoreMargins.reduce((a, b) => a + b, 0) / totalMatches : 0

  const blowoutCount = matches.filter(m => Math.abs(m.red_score - m.blue_score) > 4).length

  // Nail-biters (matches decided by exactly 1 point)
  const nailBiters = matches.filter(m => Math.abs(m.red_score - m.blue_score) === 1)

  // Average Team Strength - average total tier per individual team (not per full lobby)
  const matchesWithTierSnapshots = matches.filter(m => m.red_tiers && m.blue_tiers)
  const avgLobbyStrength = matchesWithTierSnapshots.length > 0
    ? matchesWithTierSnapshots.reduce((sum, m) => {
        const redTotal = m.red_tiers!.reduce((a, b) => a + b, 0)
        const blueTotal = m.blue_tiers!.reduce((a, b) => a + b, 0)
        return sum + redTotal + blueTotal
      }, 0) / (matchesWithTierSnapshots.length * 2)
    : null

  // Star Player of the Month - weighted wins calculation
  const playerTierMap = new Map<string, number>()
  for (const player of players) {
    playerTierMap.set(player.name, player.tierValue)
  }

  const starPlayerStats = scoreMatches(matches, playerTierMap)

  const starPlayerMinMatches = Math.ceil(totalMatches * 0.35)
  const starPlayer = Array.from(starPlayerStats.values())
    .filter(p => p.matches >= starPlayerMinMatches)
    .map(p => ({ ...p, avgScore: p.score / p.matches }))
    .sort(
      rankByName((a, b) => {
        // Sort by average score first
        if (b.avgScore !== a.avgScore) return b.avgScore - a.avgScore
        // Tiebreaker: more matches = more proven
        return b.matches - a.matches
      }),
    )[0] || null

  // How this month compares with the last one. Only shown where there is a
  // previous month to compare against — a first month reads as no delta rather
  // than as a fall from zero.
  const prevMonthIndex = selectedMonth === 1 ? 12 : selectedMonth - 1
  const prevMonthYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear
  const prevMonthName = MONTH_NAMES[prevMonthIndex - 1]

  // A part-month can't be compared with a whole one — on the 9th, "−48 vs July"
  // is true and useless. So while the current month is still running, the
  // previous month is cut to the same point in its own calendar: nine days
  // against nine days. Finished months compare in full.
  //
  // Date.UTC rolls a day-of-month the previous month doesn't have (the 31st
  // against a 30-day month) forward into the next one, which is the behaviour
  // we want: the whole of the shorter month has elapsed by then.
  const partialCutoff = isCurrentMonth
    ? Date.UTC(
        prevMonthYear,
        prevMonthIndex - 1,
        now.getUTCDate(),
        now.getUTCHours(),
        now.getUTCMinutes(),
        now.getUTCSeconds(),
      )
    : null
  const comparablePrevMatches =
    partialCutoff === null ? prevMatches : prevMatches.filter((m) => Date.parse(m.created_at) <= partialCutoff)
  const matchesDelta = prevMatches.length > 0 ? totalMatches - comparablePrevMatches.length : null
  const matchesDeltaLabel =
    partialCutoff === null
      ? `vs ${prevMonthName}`
      : // Spell the window out, or "+3 vs July" reads as a full-month claim.
        `vs 1–${now.getUTCDate()} ${prevMonthName.slice(0, 3)}`
  const prevStarScores = prevMatches.length > 0 ? scoreMatches(prevMatches, playerTierMap) : null
  const starPlayerPrev = starPlayer && prevStarScores ? prevStarScores.get(starPlayer.name) ?? null : null
  // Same player, same scoring, one month earlier. Null when they didn't play.
  const starValueDelta =
    starPlayer && starPlayerPrev && starPlayerPrev.matches > 0
      ? starPlayer.avgScore - starPlayerPrev.score / starPlayerPrev.matches
      : null

  // Winning Streak - longest consecutive wins by any player within the month
  const playerMatchHistory = new Map<string, { won: boolean; date: Date }[]>()
  
  // Sort matches by date for proper chronological order
  const sortedMatches = [...matches].sort((a, b) => 
    new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
  )
  
  for (const match of sortedMatches) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score
    const matchDate = new Date(match.created_at)
    
    for (const playerName of match.red_team) {
      if (!playerMatchHistory.has(playerName)) {
        playerMatchHistory.set(playerName, [])
      }
      playerMatchHistory.get(playerName)!.push({ won: redWon, date: matchDate })
    }
    
    for (const playerName of match.blue_team) {
      if (!playerMatchHistory.has(playerName)) {
        playerMatchHistory.set(playerName, [])
      }
      playerMatchHistory.get(playerName)!.push({ won: blueWon, date: matchDate })
    }
  }

  // Find all player streaks and get top 5.
  //
  // `live` marks a streak that is still running at the end of the month — the
  // trailing run of wins is the same length as the player's best. A 7-game run
  // that ended three weeks ago and one that is still going are different stories,
  // and the number alone can't tell them apart.
  const allStreaks: { name: string; streak: number; live: boolean }[] = []

  for (const [playerName, history] of playerMatchHistory.entries()) {
    let currentStreak = 0
    let maxStreak = 0

    for (const match of history) {
      if (match.won) {
        currentStreak++
        maxStreak = Math.max(maxStreak, currentStreak)
      } else {
        currentStreak = 0
      }
    }

    if (maxStreak > 1) {
      allStreaks.push({ name: playerName, streak: maxStreak, live: currentStreak === maxStreak })
    }
  }
  
  // Sort by streak length descending and take top 5
  const streakLeaders = allStreaks
    .sort(rankByName((a, b) => b.streak - a.streak))
    .slice(0, 5)
  
  const longestStreak = streakLeaders.length > 0 ? streakLeaders[0].streak : 0

  // Rivalries - find pair of players on opposite teams most often
  const opponentPairs = new Map<string, { player1: string; player2: string; count: number; player1Wins: number }>()
  for (const match of matches) {
    const redWon = match.red_score > match.blue_score
    for (const redPlayer of match.red_team) {
      for (const bluePlayer of match.blue_team) {
        const key = [redPlayer, bluePlayer].sort().join(" vs ")
        if (!opponentPairs.has(key)) {
          opponentPairs.set(key, {
            player1: [redPlayer, bluePlayer].sort()[0],
            player2: [redPlayer, bluePlayer].sort()[1],
            count: 0,
            player1Wins: 0
          })
        }
        const pair = opponentPairs.get(key)!
        pair.count++
        // Track who won - if player1 was on the winning team
        const player1OnRed = match.red_team.includes(pair.player1)
        if ((player1OnRed && redWon) || (!player1OnRed && !redWon && match.blue_score > match.red_score)) {
          pair.player1Wins++
        }
      }
    }
  }

  // Rivalry = the most-contested *even* matchup, not just the most-played pair:
  // among pairs with enough meetings, the head-to-head closest to 50/50 (ties to
  // the one with more meetings).
  const RIVALRY_MIN_MEETINGS = 4
  const rivalryCloseness = (p: { count: number; player1Wins: number }) =>
    Math.abs(0.5 - p.player1Wins / p.count)
  const topRivalry = Array.from(opponentPairs.values())
    .filter((p) => p.count >= RIVALRY_MIN_MEETINGS)
    .sort(
      rankBy(
        (p) => `${p.player1}|${p.player2}`,
        (a, b) =>
          rivalryCloseness(a) !== rivalryCloseness(b)
            ? rivalryCloseness(a) - rivalryCloseness(b)
            : b.count - a.count,
      ),
    )[0] || null

  // Red vs Blue
  const redWins = matches.filter(m => m.red_score > m.blue_score).length
  const blueWins = matches.filter(m => m.blue_score > m.red_score).length
  const draws = matches.filter(m => m.red_score === m.blue_score).length
  const redPct = totalMatches > 0 ? Math.round((redWins / totalMatches) * 100) : 0
  const bluePct = totalMatches > 0 ? Math.round((blueWins / totalMatches) * 100) : 0

  // CSV stat highlights — cumulative monthly totals per player. Only matches with
  // an uploaded stats CSV contribute, so the qualifier is based on the number of
  // matches that actually have stats this month (not all matches).
  const playerIdToName = new Map<string, string>()
  for (const player of players) {
    if (player.id) playerIdToName.set(player.id, player.name)
  }

  const statAgg = new Map<
    string,
    { flagHoldMs: number; dbsKills: number; captures: number; returns: number; kills: number; deaths: number; timePlayed: number; matches: number }
  >()
  for (const row of matchStats) {
    if (!statAgg.has(row.player_id)) {
      statAgg.set(row.player_id, { flagHoldMs: 0, dbsKills: 0, captures: 0, returns: 0, kills: 0, deaths: 0, timePlayed: 0, matches: 0 })
    }
    const agg = statAgg.get(row.player_id)!
    agg.flagHoldMs += row.flag_hold_ms || 0
    agg.dbsKills += row.dbs_kills || 0
    agg.captures += row.captures || 0
    agg.returns += row.returns || 0
    agg.kills += row.kills || 0
    agg.deaths += row.deaths || 0
    agg.timePlayed += row.time_played || 0
    agg.matches += 1
  }

  const statsMatchCount = new Set(matchStats.map((r) => r.match_id)).size
  const statHighlightMinMatches = Math.max(1, Math.ceil(statsMatchCount * 0.3))

  const qualifiedStatPlayers = Array.from(statAgg.entries())
    .filter(([, agg]) => agg.matches >= statHighlightMinMatches)
    .map(([playerId, agg]) => ({
      name: playerIdToName.get(playerId) ?? "Unknown player",
      ...agg,
    }))

  const topFlagHold =
    [...qualifiedStatPlayers]
      .filter((p) => p.flagHoldMs > 0)
      .sort(rankByName((a, b) => b.flagHoldMs - a.flagHoldMs))[0] || null

  const topDbsKills =
    [...qualifiedStatPlayers]
      .filter((p) => p.dbsKills > 0)
      .sort(rankByName((a, b) => b.dbsKills - a.dbsKills))[0] || null

  // Returns per minute of play (TIME-SUM is already in minutes), not raw return count.
  // Counted over returner games only. Dividing returns by every minute played
  // ranked players by how often they were put on returning duty rather than how
  // well they did it — a few games on cap sank the rate. See lib/returner-rate.ts.
  const topRetsPerMin = returnerRate?.rows[0] ?? null

  // Highest kill/death ratio (needs at least one death for a meaningful ratio).
  const highestKd =
    [...qualifiedStatPlayers]
      .filter((p) => p.kills > 0 && p.deaths > 0)
      .map((p) => ({ ...p, kd: p.kills / p.deaths }))
      .sort(rankByName((a, b) => b.kd - a.kd))[0] || null

  // Best conversion — captures as a share of RESOLVED flag runs (capped, or
  // returned while carrying). Replaces minutes-of-hold-per-cap, which measured
  // capper mains only and billed support players for the grab-and-/kill resets
  // that hand the flag to a runner. Computed server-side in lib/cap-conversion.ts
  // because the "times caught" half lives in match_kills, not match_stats.
  const bestConversion = capConversion?.rows[0] ?? null

  // Highest single-match score this month — a single-game record, so (unlike the
  // cumulative stats above) there's no min-match qualifier. Match date and final
  // score come from the already-loaded matches list, keyed by match_id.
  const matchById = new Map(matches.map((m) => [m.id, m]))
  const topScoreRow =
    [...matchStats]
      .filter((r) => (r.score || 0) > 0)
      .sort(rankBy((r) => `${r.player_id}|${r.match_id}`, (a, b) => (b.score || 0) - (a.score || 0)))[0] ||
    null
  const highestScore = topScoreRow
    ? {
        name: playerIdToName.get(topScoreRow.player_id) ?? "Unknown player",
        score: topScoreRow.score,
        match: matchById.get(topScoreRow.match_id) ?? null,
      }
    : null

  // Algorithm vs Manual
  const algorithmMatches = matches.filter(m => m.match_type === "algorithm")
  const manualMatches = matches.filter(m => m.match_type === "manual")

  const algorithmAvgMargin = algorithmMatches.length > 0
    ? algorithmMatches.map(m => Math.abs(m.red_score - m.blue_score)).reduce((a, b) => a + b, 0) / algorithmMatches.length
    : 0

  const manualAvgMargin = manualMatches.length > 0
    ? manualMatches.map(m => Math.abs(m.red_score - m.blue_score)).reduce((a, b) => a + b, 0) / manualMatches.length
    : 0

  // Avg Tier Gap for Algorithm vs Manual (using tier snapshots)
  const algorithmMatchesWithTiers = algorithmMatches.filter(m => m.red_tiers && m.blue_tiers)
  const manualMatchesWithTiers = manualMatches.filter(m => m.red_tiers && m.blue_tiers)

  const algorithmAvgTierGap = algorithmMatchesWithTiers.length > 0
    ? algorithmMatchesWithTiers.reduce((sum, m) => {
        return sum + Math.abs(m.red_tiers!.reduce((a, b) => a + b, 0) - m.blue_tiers!.reduce((a, b) => a + b, 0))
      }, 0) / algorithmMatchesWithTiers.length
    : null

  const manualAvgTierGap = manualMatchesWithTiers.length > 0
    ? manualMatchesWithTiers.reduce((sum, m) => {
        return sum + Math.abs(m.red_tiers!.reduce((a, b) => a + b, 0) - m.blue_tiers!.reduce((a, b) => a + b, 0))
      }, 0) / manualMatchesWithTiers.length
    : null

  // Nailbiters and Blowouts for Algorithm vs Manual
  const algorithmNailbiters = algorithmMatches.filter(m => Math.abs(m.red_score - m.blue_score) === 1).length
  const algorithmBlowouts = algorithmMatches.filter(m => Math.abs(m.red_score - m.blue_score) > 4).length
  const manualNailbiters = manualMatches.filter(m => Math.abs(m.red_score - m.blue_score) === 1).length
  const manualBlowouts = manualMatches.filter(m => Math.abs(m.red_score - m.blue_score) > 4).length

  // Qualifying bar for the month: 30% of the matches actually played that
  // month, so a quiet month does not demand the same attendance as a busy one.
  const leaderboardMinMatches = Math.ceil(totalMatches * 0.30)
  const leaderboard = tallyWins(matches, leaderboardMinMatches)

  // Leaderboard summary stats
  const totalLeaderboardPlayers = leaderboard.length
  const totalLeaderboardWins = leaderboard.reduce((sum, p) => sum + p.wins, 0)
  const topWinner = leaderboard[0]?.name || null
  const mostWinsPlayer = [...leaderboard].sort(rankByName((a, b) => b.wins - a.wins))[0]
  const mostWins = mostWinsPlayer?.wins || 0
  const mostWinsName = mostWinsPlayer?.name || null

  // Balance vs Reality data - only includes matches with tier snapshots
  const balanceVsReality = sortedMatches
    .filter(m => m.red_tiers && m.blue_tiers)
    .map((m, i) => {
      const tierGap = Math.abs(
        m.red_tiers!.reduce((a, b) => a + b, 0) - m.blue_tiers!.reduce((a, b) => a + b, 0)
      )
      const scoreMargin = Math.abs(m.red_score - m.blue_score)
      return {
        match: i + 1,
        tierGap,
        scoreMargin,
        matchType: m.match_type,
        date: new Date(m.created_at).toLocaleDateString()
      }
    })

  // Prediction accuracy — the one measure that says whether the tiers are
  // calibrated at all: the balancer names a favourite every time it splits a
  // lobby (the side with the higher combined tier), so did that side actually
  // win? Built entirely from data already on the row — the tier snapshot and the
  // final score — so it costs nothing extra to load.
  //
  // Level lobbies have no favourite and are excluded rather than counted as a
  // miss; draws can't confirm or deny a prediction, so they're excluded too.
  const predictions = matches
    .filter((m) => m.red_tiers && m.blue_tiers)
    .map((m) => {
      const redTotal = m.red_tiers!.reduce((a, b) => a + b, 0)
      const blueTotal = m.blue_tiers!.reduce((a, b) => a + b, 0)
      if (redTotal === blueTotal) return null
      if (m.red_score === m.blue_score) return null
      const favouriteWon = redTotal > blueTotal ? m.red_score > m.blue_score : m.blue_score > m.red_score
      return { gap: Math.abs(redTotal - blueTotal), favouriteWon }
    })
    .filter((p): p is { gap: number; favouriteWon: boolean } => p !== null)

  const favouriteWins = predictions.filter((p) => p.favouriteWon).length
  const favouriteRate = predictions.length > 0 ? (favouriteWins / predictions.length) * 100 : null
  const upsets = predictions.length - favouriteWins
  // How often the balancer produced a genuinely even lobby, which is the thing
  // it's actually for.
  const evenLobbies = matchesWithTierSnapshots.filter((m) => {
    const gap = Math.abs(
      m.red_tiers!.reduce((a, b) => a + b, 0) - m.blue_tiers!.reduce((a, b) => a + b, 0),
    )
    return gap <= 1
  }).length

  // Same question split by how lopsided the lobby was meant to be. A band whose
  // favourite wins barely more than half the time is a band where the tier
  // numbers aren't carrying real information — that's the signal worth acting on
  // when re-tuning. 50% is marked as the coin-flip reference; no expected curve
  // is asserted, because we don't have one that isn't invented.
  const CALIBRATION_BANDS: { label: string; test: (gap: number) => boolean }[] = [
    { label: "Gap 0–1 (even)", test: (g) => g <= 1 },
    { label: "Gap 2–3", test: (g) => g >= 2 && g <= 3 },
    { label: "Gap 4+", test: (g) => g >= 4 },
  ]
  const calibration = CALIBRATION_BANDS.map((band) => {
    const inBand = predictions.filter((p) => band.test(p.gap))
    const won = inBand.filter((p) => p.favouriteWon).length
    return {
      label: band.label,
      games: inBand.length,
      rate: inBand.length > 0 ? (won / inBand.length) * 100 : null,
    }
  })

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-[var(--color-primary)]"></div>
      </div>
    )
  }

  return (
    <div className="space-y-3.5">
      {/* Month + view bar. The month sits left and the views right, in the same
          segmented rail the masthead uses, so the page has one control surface
          instead of a centred month heading above a centred row of buttons. */}
      <div className="glass-panel flex flex-wrap items-center gap-3 py-2 pl-3.5 pr-2.5">
        <div className="flex items-center gap-1.5">
          <button
            onClick={goToPrevMonth}
            aria-label="Previous month"
            className="w-7 h-7 rounded-lg grid place-items-center transition-colors"
            style={{ border: "1px solid var(--glass-hair)", color: "var(--color-text-dim)" }}
          >
            <ChevronLeft className="w-3.5 h-3.5" />
          </button>
          <h2
            className="text-[15px] font-bold tracking-[0.08em] uppercase min-w-[168px] text-center"
            style={{ fontFamily: "var(--font-orbitron)" }}
          >
            {MONTH_NAMES[selectedMonth - 1]} {selectedYear}
          </h2>
          <button
            onClick={goToNextMonth}
            disabled={!canGoNext}
            aria-label="Next month"
            className="w-7 h-7 rounded-lg grid place-items-center transition-colors disabled:opacity-30"
            style={{ border: "1px solid var(--glass-hair)", color: "var(--color-text-dim)" }}
          >
            <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>

        <SegmentedRail
          className="ml-auto"
          aria-label="Stats views"
          activeKey={currentView}
          onSelect={(key) => setCurrentView(key as typeof currentView)}
          segments={[
            { key: "stats", label: "Monthly" },
            { key: "leaderboard", label: "Leaderboard" },
            ...(isAdmin ? [{ key: "alltime", label: "All-Time" }] : []),
            // Always offered, signed in or not: a visitor who cannot see the
            // card should still find out it exists. The login prompt lives
            // inside the tab rather than in place of it.
            { key: "wrapped", label: "Wrapped" },
          ]}
        />
      </div>

      {currentView === "alltime" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SegmentedRail
            dense
            aria-label="All-time board"
            activeKey={allTimeBoard}
            onSelect={(key) => setAllTimeBoard(key as typeof allTimeBoard)}
            segments={[
              { key: "wins", label: "Wins", hint: "Won and lost across every match on record" },
              { key: "elo", label: "ELO", hint: "Running rating across every match ever played" },
              { key: "trueskill", label: "TrueSkill", hint: "Rating with a confidence interval" },
            ]}
          />
          <p className="text-sm italic text-[var(--color-text-dim)]">
            Every match on record, ignoring the month above.
          </p>
        </div>
      )}

      {currentView === "leaderboard" && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Which board, not which page. Dense, and left of the frame, so it
              reads as a setting on the leaderboard rather than a second nav. */}
          <SegmentedRail
            dense
            aria-label="Leaderboard type"
            activeKey={boardView}
            onSelect={(key) => setBoardView(key as typeof boardView)}
            segments={[
              { key: "normal", label: "Wins", hint: "Won and lost, this month" },
              { key: "elo", label: "ELO", hint: "Running rating, replayed from every match" },
              { key: "trueskill", label: "TrueSkill", hint: "Rating with a confidence interval" },
            ]}
          />
          {isCurrentMonth && boardView === "normal" && (
            <p className="text-sm italic text-[var(--color-text-dim)]">
              {MONTH_NAMES[selectedMonth - 1]} is still being played — this board moves with it.
            </p>
          )}
        </div>
      )}

      {currentView === "wrapped" ? (
        me === "" ? (
          <div className="glass-panel flex flex-col items-center gap-4 py-14 text-center">
            <p className="text-[var(--color-text-dim)]">
              Wrapped is your own month — your record, who you played with, and how it went.
            </p>
            <Link
              href="/login"
              className="rounded-md bg-[var(--color-primary)] px-5 py-2.5 font-medium text-[var(--color-background)]"
            >
              Log in
            </Link>
          </div>
        ) : me === null ? null : isCurrentMonth ? (
          // A month still being played has nothing to wrap up: the record, the
          // finish position and the "best of" all move until it closes.
          <div className="glass-panel py-14 text-center text-[var(--color-text-dim)]">
            {MONTH_NAMES[selectedMonth - 1]} is still being played. Wrapped opens when the month closes — use the
            arrows above to look back at a finished one.
          </div>
        ) : (
          <WrappedView year={selectedYear} month={selectedMonth} selectedName={me.name} onSelectName={() => {}} />
        )
      ) : currentView === "alltime" ? (
        allTimeBoard === "wins" ? (
          allTimeMatches === null ? (
            <div className="py-12 text-center text-[var(--color-text-dim)]">Counting every match…</div>
          ) : (
            <WinsLeaderboard
              rows={allTimeWins}
              qualifier={`Players with ${ALL_TIME_MIN_MATCHES}+ matches all time (${allTimeMatches.length} on record)`}
              emptyLabel={`No players with ${ALL_TIME_MIN_MATCHES}+ matches yet`}
            />
          )
        ) : allTimeBoard === "elo" ? (
          <EloLeaderboard year={selectedYear} month={selectedMonth} isAdmin={isAdmin} scope="alltime" />
        ) : (
          <TrueSkillLeaderboard year={selectedYear} month={selectedMonth} isAdmin={isAdmin} scope="alltime" />
        )
      ) : currentView === "leaderboard" && boardView === "elo" ? (
        // ELO is a running, all-time rating — render it regardless of the selected month.
        // The month selector above drives the ELO view's own All-time / Monthly toggle.
        <EloLeaderboard year={selectedYear} month={selectedMonth} isAdmin={isAdmin} scope="month" />
      ) : currentView === "leaderboard" && boardView === "trueskill" ? (
        // TrueSkill is likewise a running rating replayed fresh; the month selector drives
        // its own All-time / Monthly toggle.
        <TrueSkillLeaderboard year={selectedYear} month={selectedMonth} isAdmin={isAdmin} scope="month" />
      ) : totalMatches === 0 ? (
        <div className="text-center py-12 text-[var(--color-text-dim)]">
          <BarChart3 className="w-12 h-12 mx-auto mb-4 opacity-50" />
          <p>No matches logged in {MONTH_NAMES[selectedMonth - 1]} {selectedYear}</p>
        </div>
      ) : currentView === "stats" ? (
        <>
          {/* ---------------------------------------------------------------
              Monthly view.

              Laid out as three unequal rows rather than a uniform grid of
              one-number cards: a hero, a dense records list, and the
              supporting measures. The old version gave a full-width panel to
              every stat, which is where the empty space came from.
              --------------------------------------------------------------- */}
          <div className="grid grid-cols-12 gap-3.5">
            {/* Star Player — the month's headline, so it gets the width and the
                watermark. */}
            <section className="glass-panel col-span-12 lg:col-span-7 p-6 flex flex-col min-h-[196px]">
              <Emblem
                src="/badges/star.svg"
                color="#ffd700"
                className="absolute -right-[52px] -top-[44px] w-[210px] h-[210px] opacity-[0.055] pointer-events-none"
              />
              <div
                className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] w-fit"
                style={{ fontFamily: "var(--font-mono)", color: "#ffd700" }}
                data-hint="Rewards winning the games you weren't favoured to win. Each win is worth more when your side had the lower combined tier — one upset beats a string of expected wins."
              >
                <Emblem src="/badges/star.svg" color="#ffd700" className="w-[15px] h-[15px]" />
                Star Player of the Month
              </div>

              {starPlayer ? (
                <>
                  <div
                    className="text-[40px] font-bold leading-[1.05] mt-3 mb-0.5"
                    style={{
                      fontFamily: "var(--font-orbitron)",
                      color: "var(--color-text-bright)",
                      textShadow: "0 0 26px color-mix(in srgb, #ffd700 30%, transparent)",
                    }}
                  >
                    {starPlayer.name}
                  </div>
                  <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
                    Highest average win-value · min {starPlayerMinMatches} games this month
                  </p>

                  <div className="mt-auto pt-4 flex flex-wrap items-end gap-x-6 gap-y-3">
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--color-text-dim)" }}>
                        Record
                      </span>
                      <b className="text-base font-semibold tabular-nums" style={{ color: "#27ae60" }}>
                        {starPlayer.wins} – {starPlayer.losses}
                      </b>
                    </div>
                    <div className="flex flex-col gap-0.5" data-hint="Average win-value per game played.">
                      <span className="text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--color-text-dim)" }}>
                        Win value
                      </span>
                      <b className="text-base font-semibold tabular-nums" style={{ color: "#ffd700" }}>
                        {starPlayer.avgScore.toFixed(2)}
                        <small className="text-[11px] font-normal ml-1" style={{ color: "var(--color-text-dim)" }}>
                          /game
                        </small>
                      </b>
                    </div>
                    {starValueDelta !== null && (
                      <div
                        className="flex flex-col gap-0.5"
                        data-hint={`${starPlayer.name}'s win-value per game in ${prevMonthName}, scored the same way.`}
                      >
                        <span className="text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--color-text-dim)" }}>
                          vs {prevMonthName}
                        </span>
                        <b
                          className="text-base font-semibold tabular-nums"
                          style={{ color: starValueDelta >= 0 ? "var(--color-primary)" : "var(--color-text-dim)" }}
                        >
                          {starValueDelta >= 0 ? "+" : "−"}
                          {Math.abs(starValueDelta).toFixed(2)}
                        </b>
                      </div>
                    )}
                    <div className="flex flex-col gap-0.5">
                      <span className="text-[10px] uppercase tracking-[0.13em]" style={{ color: "var(--color-text-dim)" }}>
                        Games
                      </span>
                      <b className="text-base font-semibold tabular-nums">{starPlayer.matches}</b>
                    </div>
                  </div>
                </>
              ) : (
                <p className="mt-6 text-sm italic" style={{ color: "var(--color-text-dim)" }}>
                  Not enough data yet — need players with {starPlayerMinMatches}+ matches this month
                </p>
              )}
            </section>

            {/* The four overview numbers, in ONE panel divided by hairlines. As
                four separate cards they were four boxes each holding one figure. */}
            <section className="glass-panel col-span-12 lg:col-span-5">
              <div className="grid grid-cols-2 h-full">
                {[
                  {
                    label: "Matches",
                    value: totalMatches,
                    note:
                      matchesDelta === null
                        ? "logged this month"
                        : `${matchesDelta >= 0 ? "+" : "−"}${Math.abs(matchesDelta)} ${matchesDeltaLabel}`,
                    hint:
                      matchesDelta === null
                        ? "Matches approved and logged this month."
                        : partialCutoff === null
                          ? `Matches approved and logged this month, against ${prevMonthName}'s full total (${comparablePrevMatches.length}).`
                          : `Matches so far this month, against the same window in ${prevMonthName} — its first ${now.getUTCDate()} days, which had ${comparablePrevMatches.length}.`,
                    color: "var(--color-primary)",
                    crest: "/achievements/galactic-republic.svg",
                  },
                  {
                    label: "Avg margin",
                    value: avgMargin.toFixed(1),
                    note: "of 7 caps",
                    color: "var(--color-text-bright)",
                    crest: "/achievements/galactic-empire.svg",
                    hint: "Mean absolute cap difference across every match this month.",
                  },
                  {
                    label: "Tight games",
                    value: nailBiters.length,
                    note: "decided 7–6",
                    color: "#f39c12",
                    crest: "/achievements/rebel-alliance.svg",
                    hint: "Matches decided by a single cap.",
                  },
                  {
                    label: "Blowouts",
                    value: blowoutCount,
                    note: "margin > 4",
                    color: "#ff4757",
                    crest: "/achievements/sith-order.svg",
                    hint: "Matches won by more than four caps.",
                  },
                ].map((tile, i) => (
                  <div
                    key={tile.label}
                    className={`relative p-[17px] ${i < 2 ? "border-b" : ""} ${i % 2 === 0 ? "border-r" : ""}`}
                    style={{ borderColor: "var(--glass-hair)" }}
                    data-hint={tile.hint}
                  >
                    <Emblem
                      src={tile.crest}
                      color="var(--color-text)"
                      className="absolute right-3.5 top-4 w-4 h-4 opacity-20"
                    />
                    <div
                      className="text-[10px] uppercase tracking-[0.14em] mb-1.5"
                      style={{ color: "var(--color-text-dim)" }}
                    >
                      {tile.label}
                    </div>
                    <div className="text-[28px] font-bold leading-none tabular-nums" style={{ color: tile.color, fontFamily: "var(--font-mono)" }}>
                      {tile.value}
                    </div>
                    <div className="text-[11px] mt-1.5" style={{ color: "var(--color-text-dim)" }}>
                      {tile.note}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </div>

          <div className="grid grid-cols-12 gap-3.5">
            {/* Records: six half-empty cards collapsed into one dense list, each
                row led by the badge it corresponds to. The per-stat explanations
                survive as hints on the "?" rather than as body copy. */}
            <section className="glass-panel col-span-12 lg:col-span-7 p-5">
              <SectionHead title="Records" tag={`${statHighlightMinMatches}+ stat-tracked matches`} />

              <RecordRow
                emblem="/badges/top-capper.svg"
                accent="#f39c12"
                label="Top flag hold"
                hint="Most total time carrying the enemy flag this month, summed across matches."
                who={topFlagHold?.name}
                value={topFlagHold ? formatFlagHold(topFlagHold.flagHoldMs) : null}
                note="total hold"
              />
              <RecordRow
                emblem="/badges/dbs-god.svg"
                accent="#9b59b6"
                label="Most DBS kills"
                hint="Double Backhanded Slash kills, as reported by the uploaded scoreboard."
                who={topDbsKills?.name}
                value={topDbsKills ? topDbsKills.dbsKills : null}
                note="this month"
              />
              <RecordRow
                emblem="/badges/top-kd.svg"
                accent="#ff4757"
                label="Highest K/D"
                hint="Kills divided by deaths across stat-tracked matches."
                who={highestKd?.name}
                value={highestKd ? highestKd.kd.toFixed(2) : null}
                note={highestKd ? `${highestKd.kills} / ${highestKd.deaths}` : undefined}
              />
              <RecordRow
                emblem="/achievements/mandalorian-crest.svg"
                accent="#00d4ff"
                label="Returns per minute"
                hint="Flag returns per minute, counting only the games you played as one of your team's two returners. Caveat: a player who swaps role mid-game can't be detected, since the scoreboard only records end-of-match totals."
                who={topRetsPerMin?.name}
                value={topRetsPerMin ? topRetsPerMin.perMinute.toFixed(2) : null}
                note={
                  topRetsPerMin
                    ? `${topRetsPerMin.returns} rets · ${topRetsPerMin.games} of ${topRetsPerMin.gamesPlayed} games`
                    : undefined
                }
              />
              <RecordRow
                emblem="/badges/top5.svg"
                accent="#45a29e"
                label="Best Cap conversions"
                // The start date is load-bearing, not trivia: the kill matrix this
                // reads can't be backfilled, so a player looking at July sees "no
                // data" and a player looking at August sees a figure covering only
                // part of the month. Say so rather than let them assume otherwise.
                hint="Share of flag runs that ended in a capture. A run only counts once it resolves — you scored, or an enemy returned it off you. Resets and drops are ignored, so playing support doesn't cost you. Needs at least 30% of the month's top run count. Calculating since 9 August 2026."
                who={bestConversion?.name}
                value={bestConversion ? `${bestConversion.conversion.toFixed(1)}%` : null}
                note={
                  bestConversion
                    ? `${bestConversion.captures} caps · ${bestConversion.carries} runs`
                    : undefined
                }
              />
              <RecordRow
                emblem="/badges/highscore.svg"
                accent="var(--color-primary)"
                label="Highest single score"
                hint="Best individual scoreboard total in one match this month."
                who={highestScore?.name}
                value={highestScore ? highestScore.score : null}
                note={
                  highestScore?.match
                    ? `${highestScore.match.red_score}–${highestScore.match.blue_score}, ${new Date(
                        highestScore.match.created_at,
                      ).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}`
                    : undefined
                }
              />
            </section>

            {/* Streaks: the bar carries the length, the pill says whether it's
                still running. */}
            <section className="glass-panel col-span-12 lg:col-span-5 p-5">
              <Emblem
                src="/badges/champion.svg"
                color="#f39c12"
                className="absolute -right-10 -bottom-11 w-[200px] h-[200px] opacity-[0.05] pointer-events-none"
              />
              <SectionHead title="Winning streaks" tag="consecutive wins" />
              {streakLeaders.length > 0 ? (
                <>
                  {streakLeaders.map((leader, index) => (
                    <div key={leader.name} className="flex items-center gap-2.5 py-2">
                      <span className="text-[11px] w-3.5 tabular-nums" style={{ color: "var(--color-text-dim)" }}>
                        {index + 1}
                      </span>
                      <span className="text-[13.5px] w-[104px] shrink-0 truncate">{leader.name}</span>
                      <span
                        className="flex-1 h-[7px] rounded overflow-hidden"
                        style={{
                          backgroundColor: "color-mix(in srgb, var(--color-background) 55%, transparent)",
                          boxShadow: "inset 0 1px 2px var(--glass-shade)",
                        }}
                      >
                        <span
                          className="block h-full rounded"
                          style={{
                            width: `${(leader.streak / longestStreak) * 100}%`,
                            background: "linear-gradient(90deg, color-mix(in srgb, #f39c12 45%, transparent), #f39c12)",
                            boxShadow: "0 0 10px -3px #f39c12",
                          }}
                        />
                      </span>
                      <span className="text-xs font-semibold w-[30px] text-right tabular-nums" style={{ color: "#f39c12" }}>
                        {leader.streak}
                      </span>
                      <span
                        className="hint-left text-[9.5px] font-semibold tracking-[0.08em] w-[52px] text-right"
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: leader.live ? "#27ae60" : "var(--color-text-dim)",
                          opacity: leader.live ? 0.9 : 0.45,
                        }}
                        data-hint={
                          leader.live
                            ? "Still running at the end of this month"
                            : "Broken by a loss before the month ended"
                        }
                      >
                        {leader.live ? "LIVE" : "ENDED"}
                      </span>
                    </div>
                  ))}
                  <StreakFoot
                    emblem="/badges/champion.svg"
                    title="Still running"
                    sub="Streaks carrying into next month"
                    value={allStreaks.filter((s) => s.live).length}
                    unit={`of ${allStreaks.length}`}
                  />
                  {streakRecord && (
                    <StreakFoot
                      emblem="/badges/highscore.svg"
                      title="All-time record"
                      sub={`${streakRecord.name} · ${new Date(streakRecord.endedAt).toLocaleDateString("en-GB", {
                        month: "long",
                        year: "numeric",
                        timeZone: "UTC",
                      })}`}
                      value={streakRecord.streak}
                      unit="wins"
                      /* Dimmed unless this month has matched it — it's a
                         reference point, not a headline. */
                      muted={longestStreak < streakRecord.streak}
                    />
                  )}
                </>
              ) : (
                <p className="text-sm text-center italic py-6" style={{ color: "var(--color-text-dim)" }}>
                  No streaks this month
                </p>
              )}
            </section>
          </div>

          <div className="grid grid-cols-12 gap-3.5">
            {/* Red vs Blue and average strength share a panel — both are "how
                even was the month", and neither fills one on its own. */}
            <section className="glass-panel col-span-12 lg:col-span-7 p-5">
              <SectionHead title="Team balance" tag={`${totalMatches} matches`} />
              <div
                className="flex h-[30px] rounded-[9px] overflow-hidden"
                style={{ boxShadow: "inset 0 1px 0 var(--glass-spec), inset 0 -6px 12px -8px rgba(0,0,0,0.5)" }}
                data-hint="Which side won, across every match this month. A persistent lean usually means a map or spawn advantage rather than a balance bug."
              >
                {redPct > 0 && (
                  <span
                    className="flex items-center pl-3 text-xs font-bold text-white"
                    style={{ width: `${redPct}%`, background: "linear-gradient(180deg, color-mix(in srgb, #ff4757 92%, white), #ff4757)" }}
                  >
                    {redPct}%
                  </span>
                )}
                {bluePct > 0 && (
                  <span
                    className="flex items-center justify-end pr-3 text-xs font-bold"
                    style={{
                      width: `${bluePct}%`,
                      background: "linear-gradient(180deg, color-mix(in srgb, #00d4ff 92%, white), #00d4ff)",
                      color: "color-mix(in srgb, var(--color-background) 80%, #000)",
                    }}
                  >
                    {bluePct}%
                  </span>
                )}
              </div>
              <div className="flex justify-between text-[11.5px] mt-2.5">
                <span style={{ color: "#ff4757" }}>Red — {redWins} wins</span>
                {draws > 0 && <span style={{ color: "var(--color-text-dim)" }}>{draws} drawn</span>}
                <span style={{ color: "#00d4ff" }}>Blue — {blueWins} wins</span>
              </div>

              {avgLobbyStrength !== null && (
                <div className="mt-5">
                  <div className="flex justify-between items-baseline mb-2">
                    <span className="text-[10px] uppercase tracking-[0.14em]" style={{ color: "var(--color-text-dim)" }}>
                      Average team strength
                    </span>
                    <b className="text-xl font-bold tabular-nums" style={{ fontFamily: "var(--font-mono)", color: "var(--color-primary)" }}>
                      {avgLobbyStrength.toFixed(1)}
                      <span className="text-xs font-normal" style={{ color: "var(--color-text-dim)" }}>
                        {" "}
                        / 60
                      </span>
                    </b>
                  </div>
                  <span
                    className="block h-[9px] rounded-[5px] overflow-hidden"
                    style={{
                      backgroundColor: "color-mix(in srgb, var(--color-background) 55%, transparent)",
                      boxShadow: "inset 0 1px 2px var(--glass-shade)",
                    }}
                  >
                    <span
                      className="block h-full"
                      style={{
                        width: `${(avgLobbyStrength / 60) * 100}%`,
                        background: "linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 35%, transparent), var(--color-primary))",
                        boxShadow: "0 0 12px -3px var(--color-primary)",
                      }}
                    />
                  </span>
                  <p className="text-[11px] mt-2" style={{ color: "var(--color-text-dim)" }}>
                    Mean combined tier per side, from tier snapshots on {matchesWithTierSnapshots.length} of{" "}
                    {totalMatches} matches.
                  </p>
                </div>
              )}
            </section>

            <section className="glass-panel col-span-12 lg:col-span-5 p-5">
              <SectionHead title="Top rivalry" />
              {topRivalry && topRivalry.count >= 2 ? (
                <div className="relative flex flex-col justify-center">
                  <Emblem
                    src="/badges/top-kd.svg"
                    color="#ff4757"
                    className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[170px] h-[170px] opacity-[0.06] pointer-events-none"
                  />
                  <div className="flex items-center justify-center gap-3.5 mt-1.5 mb-3">
                    <b className="text-xl font-bold" style={{ color: "var(--color-text-bright)" }}>
                      {topRivalry.player1}
                    </b>
                    <span className="text-[11px] uppercase tracking-[0.18em]" style={{ color: "var(--color-text-dim)" }}>
                      vs
                    </span>
                    <b className="text-xl font-bold" style={{ color: "var(--color-text-bright)" }}>
                      {topRivalry.player2}
                    </b>
                  </div>
                  {/* Tug-of-war: the bar leans as one pulls ahead. */}
                  <span
                    className="flex h-1.5 rounded-full overflow-hidden"
                    style={{ backgroundColor: "color-mix(in srgb, var(--color-background) 50%, transparent)" }}
                  >
                    <span style={{ width: `${(topRivalry.player1Wins / topRivalry.count) * 100}%`, backgroundColor: "#ff4757" }} />
                    <span
                      style={{
                        width: `${((topRivalry.count - topRivalry.player1Wins) / topRivalry.count) * 100}%`,
                        backgroundColor: "#00d4ff",
                      }}
                    />
                  </span>
                  <div className="flex justify-between text-[11.5px] mt-2.5" style={{ color: "var(--color-text-dim)" }}>
                    <span>{topRivalry.player1Wins} wins</span>
                    <span>Faced {topRivalry.count} times</span>
                    <span>{topRivalry.count - topRivalry.player1Wins} wins</span>
                  </div>
                  <p
                    className="text-[11px] leading-relaxed mt-3.5 pt-3 border-t"
                    style={{ color: "var(--color-text-dim)", borderColor: "color-mix(in srgb, var(--color-border) 45%, transparent)" }}
                  >
                    The most-contested even matchup this month — closest to a 50/50 split among pairs who met at
                    least {RIVALRY_MIN_MEETINGS} times.
                  </p>
                </div>
              ) : (
                <p className="text-sm text-center italic py-6" style={{ color: "var(--color-text-dim)" }}>
                  No recurring rivalries yet
                </p>
              )}
            </section>
          </div>

          {/* ---------------------------------------------------------------
              Under the hood.

              The working views — how the balancer did, and what changed —
              share one panel with their own rail. They used to be three
              full-width slabs at the foot of the page, two of which were
              mostly empty.
              --------------------------------------------------------------- */}
          <section className="glass-panel p-5">
            <div className="flex flex-wrap items-center gap-3.5 mb-4">
              <h3
                className="text-[11px] font-semibold uppercase tracking-[0.16em]"
                style={{ fontFamily: "var(--font-mono)", color: "var(--color-text-dim)" }}
              >
                Under the hood
              </h3>
              <SegmentedRail
                className="ml-auto"
                aria-label="Under the hood views"
                dense
                activeKey={hoodView}
                onSelect={(key) => setHoodView(key as typeof hoodView)}
                segments={[
                  { key: "reality", label: "Balance vs reality" },
                  { key: "compare", label: "Algorithm vs manual" },
                  { key: "accuracy", label: "Prediction accuracy" },
                  { key: "tiers", label: "Tier changelog" },
                ]}
              />
            </div>

            {hoodView === "reality" &&
              (balanceVsReality.length > 0 ? (
                <>
                  <p className="text-xs leading-relaxed mb-4 max-w-[78ch]" style={{ color: "var(--color-text-dim)" }}>
                    Did the predicted tier gap match how the games actually went? Where the amber line runs above the
                    cyan, the match was less even than predicted.
                  </p>
                  <div className="h-72">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={balanceVsReality} margin={{ top: 16, right: 8, left: 0, bottom: 16 }}>
                        <XAxis
                          dataKey="match"
                          stroke="var(--color-text-dim)"
                          fontSize={11}
                          label={{ value: "Match #", position: "bottom", fill: "var(--color-text-dim)", fontSize: 11 }}
                        />
                        <YAxis stroke="var(--color-text-dim)" fontSize={11} />
                        <Tooltip
                          content={({ active, payload, label }) => {
                            if (!active || !payload?.length) return null
                            const matchType = payload[0]?.payload?.matchType
                            return (
                              <div
                                style={{
                                  backgroundColor: "var(--color-surface)",
                                  border: "1px solid var(--glass-hair)",
                                  borderRadius: 10,
                                  padding: "8px 12px",
                                }}
                              >
                                <p style={{ color: "var(--color-primary)", marginBottom: 4, fontSize: 12 }}>
                                  Match {label} · {matchType === "algorithm" ? "algorithm" : "manual"}
                                </p>
                                {payload.map((entry) => (
                                  <p key={entry.dataKey as string} style={{ color: entry.color as string, fontSize: 12, margin: "2px 0" }}>
                                    {entry.dataKey === "tierGap" ? "Tier gap" : "Score margin"}: {entry.value}
                                  </p>
                                ))}
                              </div>
                            )
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="tierGap"
                          stroke="var(--color-primary)"
                          strokeWidth={2}
                          /* Shape carries the match type — the old version stamped an
                             ALG/MAN tag above every point, which is what made this
                             chart unreadable. The legend states it once instead. */
                          dot={(props) => {
                            /* recharts doesn't hand a `key` to a custom dot renderer,
                               so derive one from the point's own match number. */
                            const { cx, cy, payload } = props
                            return payload.matchType === "algorithm" ? (
                              <circle key={`tierGap-${payload.match}`} cx={cx} cy={cy} r={4} fill="var(--color-primary)" />
                            ) : (
                              <rect key={`tierGap-${payload.match}`} x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill="var(--color-primary)" opacity={0.65} />
                            )
                          }}
                        />
                        <Line
                          type="monotone"
                          dataKey="scoreMargin"
                          stroke="#f39c12"
                          strokeWidth={2}
                          dot={(props) => {
                            /* recharts doesn't hand a `key` to a custom dot renderer,
                               so derive one from the point's own match number. */
                            const { cx, cy, payload } = props
                            return payload.matchType === "algorithm" ? (
                              <circle key={`scoreMargin-${payload.match}`} cx={cx} cy={cy} r={4} fill="#f39c12" />
                            ) : (
                              <rect key={`scoreMargin-${payload.match}`} x={cx - 3.5} y={cy - 3.5} width={7} height={7} fill="#f39c12" opacity={0.65} />
                            )
                          }}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex flex-wrap justify-center gap-5 mt-2 text-[11.5px]" style={{ color: "var(--color-text-dim)" }}>
                    <span className="flex items-center gap-2">
                      <i className="w-4 h-0.5 rounded" style={{ backgroundColor: "var(--color-primary)" }} />
                      Tier gap (predicted)
                    </span>
                    <span className="flex items-center gap-2">
                      <i className="w-4 h-0.5 rounded" style={{ backgroundColor: "#f39c12" }} />
                      Score margin (actual)
                    </span>
                    <span className="flex items-center gap-2">
                      <i className="w-2 h-2 rounded-full" style={{ backgroundColor: "var(--color-primary)" }} />
                      Algorithm match
                    </span>
                    <span className="flex items-center gap-2">
                      <i className="w-2 h-2" style={{ backgroundColor: "color-mix(in srgb, var(--color-primary) 60%, transparent)" }} />
                      Manual match
                    </span>
                  </div>
                </>
              ) : (
                <EmptyHood>No tier snapshots this month, so there is nothing to compare against.</EmptyHood>
              ))}

            {hoodView === "compare" && (
              <>
                <p className="text-xs leading-relaxed mb-4 max-w-[78ch]" style={{ color: "var(--color-text-dim)" }}>
                  The same five measures, mirrored — so a month with no algorithm matches reads as an empty side
                  rather than a card saying nothing.
                </p>
                <div
                  className="flex justify-between items-center mb-3 text-[10px] font-semibold uppercase tracking-[0.16em]"
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  <span style={{ color: "var(--color-primary)" }}>Algorithm · {algorithmMatches.length}</span>
                  <span style={{ color: "var(--color-text-dim)" }}>vs</span>
                  <span style={{ color: "var(--color-text)" }}>{manualMatches.length} · Manual</span>
                </div>
                {[
                  { label: "Matches", a: algorithmMatches.length, m: manualMatches.length },
                  { label: "Avg margin", a: algorithmMatches.length ? algorithmAvgMargin : null, m: manualMatches.length ? manualAvgMargin : null },
                  { label: "Avg tier gap", a: algorithmAvgTierGap, m: manualAvgTierGap },
                  { label: "Tight games (7–6)", a: algorithmMatches.length ? algorithmNailbiters : null, m: manualMatches.length ? manualNailbiters : null },
                  { label: "Blowouts", a: algorithmMatches.length ? algorithmBlowouts : null, m: manualMatches.length ? manualBlowouts : null },
                ].map((row, i) => {
                  const max = Math.max(row.a ?? 0, row.m ?? 0) || 1
                  return (
                    <div
                      key={row.label}
                      className={`grid grid-cols-[1fr_168px_1fr] items-center gap-3 py-2 ${i ? "border-t" : ""}`}
                      style={{ borderColor: "color-mix(in srgb, var(--color-border) 40%, transparent)" }}
                    >
                      {row.a === null ? (
                        <span className="text-[11.5px] italic text-right" style={{ color: "var(--color-text-dim)" }}>
                          {i === 0 ? "no algorithm matches" : "—"}
                        </span>
                      ) : (
                        <span className="flex items-center justify-end gap-2.5">
                          <span
                            className="h-[9px] rounded-[5px]"
                            style={{
                              width: `${((row.a as number) / max) * 100}%`,
                              background: "linear-gradient(270deg, var(--color-primary), color-mix(in srgb, var(--color-primary) 30%, transparent))",
                            }}
                          />
                          <b className="text-[13px] font-bold min-w-[34px] text-right tabular-nums" style={{ color: "var(--color-primary)" }}>
                            {typeof row.a === "number" && !Number.isInteger(row.a) ? row.a.toFixed(1) : row.a}
                          </b>
                        </span>
                      )}
                      <span className="text-center text-[11.5px]" style={{ color: "var(--color-text-dim)" }}>
                        {row.label}
                      </span>
                      {row.m === null ? (
                        <span className="text-[11.5px] italic" style={{ color: "var(--color-text-dim)" }}>
                          {i === 0 ? "no manual matches" : "—"}
                        </span>
                      ) : (
                        <span className="flex items-center gap-2.5">
                          <span
                            className="h-[9px] rounded-[5px]"
                            style={{
                              width: `${((row.m as number) / max) * 100}%`,
                              background:
                                "linear-gradient(90deg, color-mix(in srgb, var(--color-text) 26%, transparent), color-mix(in srgb, var(--color-text) 55%, transparent))",
                            }}
                          />
                          <b className="text-[13px] font-bold min-w-[34px] tabular-nums">
                            {typeof row.m === "number" && !Number.isInteger(row.m) ? row.m.toFixed(1) : row.m}
                          </b>
                        </span>
                      )}
                    </div>
                  )
                })}
                {algorithmMatches.length > 0 && manualMatches.length > 0 && (
                  <div
                    className="mt-4 px-3.5 py-3 rounded-[10px] text-xs"
                    style={
                      algorithmAvgMargin < manualAvgMargin
                        ? {
                            border: "1px solid color-mix(in srgb, #27ae60 35%, transparent)",
                            backgroundColor: "color-mix(in srgb, #27ae60 10%, transparent)",
                            color: "color-mix(in srgb, #27ae60 85%, var(--color-text-bright))",
                          }
                        : {
                            border: "1px solid color-mix(in srgb, #f39c12 35%, transparent)",
                            backgroundColor: "color-mix(in srgb, #f39c12 10%, transparent)",
                            color: "color-mix(in srgb, #f39c12 85%, var(--color-text-bright))",
                          }
                    }
                  >
                    {algorithmAvgMargin < manualAvgMargin
                      ? `Algorithm matches have closer games on average (${algorithmAvgMargin.toFixed(1)} vs ${manualAvgMargin.toFixed(1)} margin).`
                      : algorithmAvgMargin > manualAvgMargin
                        ? `Manual matches have closer games on average (${manualAvgMargin.toFixed(1)} vs ${algorithmAvgMargin.toFixed(1)} margin).`
                        : "Both approaches produced the same average margin."}
                  </div>
                )}
              </>
            )}

            {hoodView === "accuracy" &&
              (predictions.length > 0 ? (
                <>
                  <p className="text-xs leading-relaxed mb-4 max-w-[78ch]" style={{ color: "var(--color-text-dim)" }}>
                    Every split names a favourite — the side with the higher combined tier. This is whether that side
                    went on to win, which is the one number that says if the tiers are calibrated. Level lobbies and
                    draws are excluded: neither can confirm or deny a prediction.
                  </p>
                  <div className="grid sm:grid-cols-3 gap-3.5 mb-5">
                    <HoodStat
                      value={`${favouriteRate!.toFixed(0)}%`}
                      color="var(--color-primary)"
                      label="Favourite won"
                      note={`${favouriteWins} of ${predictions.length} decided matches`}
                    />
                    <HoodStat
                      value={upsets}
                      color="#f39c12"
                      label="Upsets"
                      note="underdog took it anyway"
                    />
                    <HoodStat
                      value={evenLobbies}
                      color="#27ae60"
                      label="Even lobbies"
                      note={`tier gap of 1 or less, of ${matchesWithTierSnapshots.length} split`}
                    />
                  </div>
                  <SectionHead title="By predicted gap" tag="50% marks a coin flip" />
                  {calibration.map((band) => (
                    <div key={band.label} className="grid grid-cols-[112px_1fr_96px] items-center gap-3 py-1.5 text-xs">
                      <span>{band.label}</span>
                      <span
                        className="relative h-2 rounded overflow-hidden"
                        style={{
                          backgroundColor: "color-mix(in srgb, var(--color-background) 50%, transparent)",
                          boxShadow: "inset 0 1px 2px var(--glass-shade)",
                        }}
                      >
                        {band.rate !== null && (
                          <span
                            className="block h-full"
                            style={{
                              width: `${band.rate}%`,
                              background: "linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 30%, transparent), var(--color-primary))",
                            }}
                          />
                        )}
                        <span
                          className="absolute -top-0.5 -bottom-0.5 w-0.5"
                          style={{ left: "50%", backgroundColor: "#f39c12", boxShadow: "0 0 8px -1px #f39c12" }}
                        />
                      </span>
                      <span className="text-right text-[11.5px]" style={{ color: "var(--color-text-dim)" }}>
                        {band.rate === null ? "no games" : `${band.rate.toFixed(0)}% · ${band.games} games`}
                      </span>
                    </div>
                  ))}
                  <p
                    className="text-[11px] leading-relaxed mt-3.5 pt-3 border-t"
                    style={{ color: "var(--color-text-dim)", borderColor: "color-mix(in srgb, var(--color-border) 45%, transparent)" }}
                  >
                    A band sitting near the coin-flip line is one where the tier numbers aren&apos;t carrying real
                    information — the lobbies play evenly however lopsided they looked on paper.
                  </p>
                </>
              ) : (
                <EmptyHood>
                  No decided matches with tier snapshots this month, so there is no prediction to score.
                </EmptyHood>
              ))}

            {hoodView === "tiers" && (
              <>
                <p className="text-xs leading-relaxed mb-4 max-w-[78ch]" style={{ color: "var(--color-text-dim)" }}>
                  Tier moves inside the selected month.
                </p>
                <TierChangelog year={selectedYear} month={selectedMonth} isAdmin={isAdmin} />
              </>
            )}
          </section>
        </>
      ) : (
        <>
          {/* Leaderboard View. The standing is stated before the table, not
              after it -- read underneath, it lands once you have already taken
              the numbers at face value. */}
          <p className="text-sm text-[var(--color-text-dim)]">
            This is the true monthly leaderboard. ELO and TrueSkill are for fun reference only.
          </p>
          <WinsLeaderboard
            rows={leaderboard}
            qualifier={`Players with ${leaderboardMinMatches}+ matches this month (30% of ${totalMatches})`}
            emptyLabel={`No players with ${leaderboardMinMatches}+ matches yet`}
          />

          {/* Summary Bar */}
          {leaderboard.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Total Players</div>
                <div className="text-2xl font-bold text-[var(--color-primary)]">{totalLeaderboardPlayers}</div>
              </div>
              <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Total Wins</div>
                <div className="text-2xl font-bold text-[#27ae60]">{totalLeaderboardWins}</div>
              </div>
              <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Top Winner</div>
                <div className="text-xl font-bold text-[#ffd700] truncate">{topWinner || "—"}</div>
              </div>
              <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg p-4">
                <div className="text-[var(--color-text-dim)] text-xs uppercase mb-1">Most Wins</div>
                <div className="text-xl font-bold text-[var(--color-text)]">
                  {mostWins > 0 ? `${mostWins} (${mostWinsName})` : "—"}
                </div>
              </div>
            </div>
          )}

        </>
      )}

    </div>
  )
}
