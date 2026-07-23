import type { Metadata } from "next"
import Link from "next/link"
import { Zap, BarChart3, Server } from "lucide-react"
import { computeAchievementLedger, computePlayersDirectory } from "@/lib/achievements-server"
import { resolveEquippedTitles } from "@/lib/titles-server"
import { getMatches, getMatchStatsByMonth, getMonthlyPlayerStats } from "@/app/admin/actions"
import { HomeActivityFeed, type ActivityItem } from "@/components/home-activity-feed"
import { HomeCrestGrid } from "@/components/home-crest-grid"
import { HomeActivePlayers, type ActivePlayerRow } from "@/components/home-active-players"
import { HomeStarTile } from "@/components/home-star-tile"
import { HomeToolsPanel } from "@/components/home-tools-panel"
import { HomeProfileButton } from "@/components/home-profile-button"
import { HomeGreetingName } from "@/components/home-greeting-name"

const SERVERS_URL = "https://jk2t.ddns.net/servers/?game=jk2"

export const metadata: Metadata = {
  title: "JK2 Capture the Flag — Soracle",
  description: "Recent activity, latest crests and the active roster for JK2 Capture the Flag.",
}

// Matches only arrive when an admin approves one, so a short revalidate is
// plenty fresh without recomputing the whole ledger on every visitor.
export const revalidate = 60

interface RawMatch {
  id: string
  red_team: string[] | null
  blue_team: string[] | null
  red_score: number
  blue_score: number
  created_at: string
}

// Everything here is bucketed in UTC, matching the rest of the site's monthly
// splits (lib/player-profile.ts, the bot's monthly-report route).
const monthKeyOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

const FEED_SIZE = 15
const CREST_GRID_SIZE = 6
const ACTIVE_PLAYERS_SIZE = 12

export default async function HomePage() {
  const now = new Date()
  const year = now.getUTCFullYear()
  const month = now.getUTCMonth() + 1
  const currentKey = monthKeyOf(now.toISOString())
  const monthName = now.toLocaleString("en-GB", { month: "long" })

  const [ledger, directory, matchesRes, statsMonthRes, monthlyPlayerStatsRes] = await Promise.all([
    computeAchievementLedger(),
    computePlayersDirectory(),
    getMatches(),
    getMatchStatsByMonth(year, month),
    getMonthlyPlayerStats(),
  ])

  const allMatches = (matchesRes.success ? (matchesRes.data as RawMatch[]) : []).filter(
    (m) => m.red_team?.length && m.blue_team?.length,
  )
  const totalMatches = allMatches.length

  const matchesThisMonth = allMatches.filter((m) => monthKeyOf(m.created_at) === currentKey)
  const crestsThisMonth = ledger.recent.filter((e) => monthKeyOf(e.date) === currentKey)
  const killsThisMonth = statsMonthRes.success
    ? (statsMonthRes.data as { kills: number }[]).reduce((sum, row) => sum + (row.kills ?? 0), 0)
    : 0

  const matchItems: ActivityItem[] = allMatches.slice(0, FEED_SIZE).map((m, i) => ({
    type: "match",
    date: m.created_at,
    ordinal: totalMatches - i,
    redScore: m.red_score,
    blueScore: m.blue_score,
    playerCount: (m.red_team?.length ?? 0) + (m.blue_team?.length ?? 0),
  }))
  const crestItems: ActivityItem[] = ledger.recent
    .slice(0, FEED_SIZE)
    .map((entry) => ({ type: "crest", date: entry.date, entry }))
  const activityFeed = [...matchItems, ...crestItems]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, FEED_SIZE)

  const monthlyStats = monthlyPlayerStatsRes.success
    ? (monthlyPlayerStatsRes.data as Record<string, { wins: number; losses: number; draws: number }>)
    : {}
  const activePlayersRanked = directory
    .map((row) => {
      const s = monthlyStats[row.name]
      return { ...row, monthMatches: s ? s.wins + s.losses + s.draws : 0 }
    })
    .filter((row) => row.monthMatches > 0)
    .sort((a, b) => b.monthMatches - a.monthMatches || b.score - a.score)
    .slice(0, ACTIVE_PLAYERS_SIZE)

  // The directory's own `title` is the rarest crest a player holds (a career
  // stat) — not their equipped Title (a separate progression axis: seasonal or
  // Achievement Score ladders, see lib/titles.ts). Only resolved for the
  // players actually shown here, not the whole directory.
  const equippedTitles = await resolveEquippedTitles(activePlayersRanked.map((row) => row.id))
  const activePlayers: ActivePlayerRow[] = activePlayersRanked.map((row) => ({
    ...row,
    equippedTitle: equippedTitles.get(row.id) ?? null,
  }))

  return (
    <div className="container mx-auto px-4 py-8 relative z-10">
      {/* ---------------------------------------------------------------- hero */}
      <section className="text-center py-10 mb-8">
        <div className="inline-flex items-center gap-3 mb-4">
          <span className="h-px w-6 bg-[#45a29e]" />
          <span className="text-[11px] font-bold uppercase tracking-[0.16em] text-[#66fcf1]">Jedi Outcast CTF</span>
          <span className="h-px w-6 bg-[#45a29e]" />
        </div>
        <h1
          className="text-4xl md:text-6xl font-extrabold glow-text mb-4 text-balance"
          style={{ fontFamily: "var(--font-orbitron)" }}
        >
          Welcome back
          <HomeGreetingName />
        </h1>
        <p className="max-w-2xl mx-auto text-[#8892a0] text-sm md:text-base leading-relaxed">
          See what&apos;s happening on this 2002 Star Wars game of CTF on CTF_Yavin_No_outside, no wallhacks, no
          mineswitching, no stacks and perfect SD
        </p>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
          <Link
            href="/balancer"
            style={{ backgroundColor: "var(--color-primary)", color: "var(--color-background)" }}
            className="px-6 py-2.5 font-bold rounded-md transition-all text-sm hover-glow inline-flex items-center gap-2"
          >
            <Zap className="w-4 h-4" />
            Open the Team Balancer
          </Link>
          <Link
            href="/stats"
            className="px-6 py-2.5 font-bold rounded-md text-sm bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855] transition-all inline-flex items-center gap-2"
          >
            <BarChart3 className="w-4 h-4" />
            {monthName}&apos;s Stats
          </Link>
        </div>
        <div className="flex flex-wrap items-center justify-center gap-3 mt-3">
          <a
            href={SERVERS_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="px-4 py-1.5 rounded-md text-xs font-medium text-[#8892a0] hover:text-[#66fcf1] border border-[#3d4855] hover:border-[#66fcf1]/50 transition-all inline-flex items-center gap-1.5"
          >
            <Server className="w-3.5 h-3.5" />
            Browse Servers
          </a>
          <HomeProfileButton />
        </div>
      </section>

      {/* ---------------------------------------------------------------- stat strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-4">
          <div className="text-2xl font-extrabold text-white font-mono" style={{ fontFamily: "var(--font-orbitron)" }}>
            {matchesThisMonth.length}
          </div>
          <div className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8892a0]">
            Matches This Month
          </div>
        </div>
        <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-4">
          <div
            className="text-2xl font-extrabold font-mono"
            style={{ fontFamily: "var(--font-orbitron)", color: "var(--color-primary)" }}
          >
            {crestsThisMonth.length}
          </div>
          <div className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8892a0]">
            Crests Unlocked
          </div>
        </div>
        <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-4">
          <HomeStarTile />
          <div className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8892a0]">
            Player of the Month
          </div>
        </div>
        <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-4">
          <div className="text-2xl font-extrabold text-white font-mono" style={{ fontFamily: "var(--font-orbitron)" }}>
            {killsThisMonth.toLocaleString()}
          </div>
          <div className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8892a0]">
            Kills This Month
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- activity + crests */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-5 mb-10">
        <div>
          <h2
            className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#8892a0] mb-3"
            style={{ fontFamily: "var(--font-orbitron)" }}
          >
            Recent Activity
          </h2>
          <div className="bg-[#151b24] border border-[#2a3542] rounded-lg overflow-hidden">
            <HomeActivityFeed items={activityFeed} />
          </div>
        </div>
        <div>
          <div className="flex items-baseline justify-between mb-3">
            <h2
              className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#8892a0]"
              style={{ fontFamily: "var(--font-orbitron)" }}
            >
              Latest Achievements
            </h2>
            <Link href="/achievements" className="text-xs font-bold" style={{ color: "var(--color-primary)" }}>
              All achievements &rarr;
            </Link>
          </div>
          <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-4">
            <HomeCrestGrid entries={ledger.recent.slice(0, CREST_GRID_SIZE)} />
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- active players */}
      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <h2
            className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#8892a0]"
            style={{ fontFamily: "var(--font-orbitron)" }}
          >
            Active Players
          </h2>
          <Link href="/players" className="text-xs font-bold" style={{ color: "var(--color-primary)" }}>
            Full player directory &rarr;
          </Link>
        </div>
        <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-4">
          <HomeActivePlayers players={activePlayers} />
        </div>
      </section>

      {/* ---------------------------------------------------------------- tools */}
      <section>
        <h2
          className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#8892a0] mb-3"
          style={{ fontFamily: "var(--font-orbitron)" }}
        >
          Tools
        </h2>
        <HomeToolsPanel />
      </section>
    </div>
  )
}
