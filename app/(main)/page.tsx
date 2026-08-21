import type { Metadata } from "next"
import Link from "next/link"
import { BookOpen, BarChart3 } from "lucide-react"
import { computeAchievementLedger, computePlayersDirectory, computeHomeSummary } from "@/lib/achievements-server"
import { resolveEquippedTitles } from "@/lib/titles-server"
import { listFeedDemoUploads } from "@/lib/demos-server"
import { HomeActivityFeed, type ActivityItem } from "@/components/home-activity-feed"
import { HomeVideoPanel } from "@/components/home-video-panel"
import { getFeaturedVideo } from "@/lib/youtube-feed"
import { HomeActivePlayers, type ActivePlayerRow } from "@/components/home-active-players"
import { HomeStarTile } from "@/components/home-star-tile"
import { HomeToolsPanel } from "@/components/home-tools-panel"
import { HomeProfileButton } from "@/components/home-profile-button"
import { HomeGreetingName } from "@/components/home-greeting-name"
import { Emblem } from "@/components/emblem"


export const metadata: Metadata = {
  title: "JK2 Capture the Flag — Soracle",
  description: "Recent activity, latest achievements and the active roster for JK2 Capture the Flag.",
}

// Matches only arrive when an admin approves one -- and now that landing a
// match calls revalidateTag(HISTORY_TAG) itself (see app/admin/actions.ts),
// this window is a safety net rather than the thing keeping the page fresh.
// It was 60s under the old reasoning ("short window = fresh"), which was
// backwards for how expensive the underlying ledger computation is: every
// page sharing that computation on its own 60s clock, uncached, was the
// direct cause of a Vercel usage flag on Fluid CPU and ISR Writes both
// (5 Aug 2026 audit). Long now that on-demand invalidation carries the real
// freshness requirement.
//
// Worth knowing that this line did nothing at all until 7 Aug 2026. Every
// reader below now avoids cookies, but three of them (getMatches,
// getMatchStatsByMonth, getMonthlyPlayerStats) used to go through the
// cookie-carrying Supabase client, and a single cookie read anywhere in a
// render opts the whole route out of static rendering -- so this page was
// rebuilt from scratch on every single visit, at ~538ms of CPU each, for its
// entire life. It never once honoured the window it declares. If you add a
// reader here, use an anonymous, cached one (see lib/supabase/anon.ts) or this
// silently goes back to being a lie.
export const revalidate = 3600

// Everything here is bucketed in UTC, matching the rest of the site's monthly
// splits (lib/player-profile.ts, the bot's monthly-report route).
const monthKeyOf = (iso: string) => {
  const d = new Date(iso)
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`
}

const FEED_SIZE = 15
const CREST_GRID_SIZE = 6
const ACTIVE_PLAYERS_SIZE = 12
// Fallback only. The featured video is normally whatever the channel uploaded
// last (lib/youtube-feed.ts); this is what shows if that feed is unreachable, so
// the panel never renders empty.
const FALLBACK_VIDEO_ID = "hECQ3AgK8rU"

export default async function HomePage() {
  const now = new Date()
  const currentKey = monthKeyOf(now.toISOString())
  const monthName = now.toLocaleString("en-GB", { month: "long" })

  const [ledger, directory, home, demoUploads] = await Promise.all([
    computeAchievementLedger(),
    computePlayersDirectory(),
    computeHomeSummary(),
    listFeedDemoUploads(FEED_SIZE),
  ])

  // An admin's pinned video if there is one, otherwise the newest upload on
  // youtube.com/@jk2ctf. Both are cached; the constant below only runs if the
  // channel feed is unreachable AND nothing is pinned.
  const featured = await getFeaturedVideo()
  const videoId = featured.videoId ?? FALLBACK_VIDEO_ID

  // Already filtered to matches with both teams, and already newest-first --
  // computeHomeSummary reverses the ledger's chronological order for exactly
  // the two uses below (the feed slice, and numbering backwards from the total).
  const allMatches = home.matches
  const totalMatches = allMatches.length

  const matchesThisMonth = allMatches.filter((m) => monthKeyOf(m.created_at) === currentKey)
  const crestsThisMonth = ledger.recent.filter((e) => monthKeyOf(e.date) === currentKey)
  const killsThisMonth = home.killsThisMonth

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
  const demoItems: ActivityItem[] = demoUploads.map((d) => ({
    type: "demo",
    date: d.createdAt,
    demoId: d.id,
    title: d.title,
    uploaderName: d.uploaderName,
    gametype: d.gametype,
  }))
  const activityFeed = [...matchItems, ...crestItems, ...demoItems]
    .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
    .slice(0, FEED_SIZE)

  const monthlyStats = home.monthlyPlayerStats
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
        {/* One row, not two. The hero used to stack a primary pair above a
            secondary pair, which read as four competing decisions; the hairline
            does the same job of separating "go do something" from "go look at
            something" without a second line. */}
        <div className="flex flex-wrap items-center justify-center gap-3 mt-8">
          {/* Was "Open the Team Balancer" — the balancer itself is one click away
              in the nav rail, but nothing on the homepage explained the ratings,
              the balance rules, or auto-calibration to a new or returning player.
              This is the front door to that explanation now. */}
          <Link
            href="/how-it-works"
            style={{ backgroundColor: "var(--color-primary)", color: "var(--color-background)" }}
            className="px-6 py-2.5 font-bold rounded-md transition-all text-sm hover-glow inline-flex items-center gap-2"
          >
            <BookOpen className="w-4 h-4" />
            How It Works
          </Link>
          <Link
            href="/stats"
            className="px-6 py-2.5 font-bold rounded-md text-sm bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855] transition-all inline-flex items-center gap-2"
          >
            <BarChart3 className="w-4 h-4" />
            {monthName}&apos;s Stats
          </Link>
          <span
            aria-hidden
            className="hidden sm:block w-px h-7 mx-1"
            style={{ backgroundColor: "var(--glass-hair)" }}
          />
          {/* Secondary, but not dim: "who's on right now" and "my profile" are
              two of the most-wanted destinations on the page, and at 11px grey
              on grey they were the easiest things to miss. Same size as before —
              the lift comes from a glass fill, a primary-tinted edge and an
              accent icon, so they still read below the two solid CTAs. */}
          {/* Replaces the old "Browse Servers" link out to jk2t.ddns.net. That
              sent people off-site to find a server they then had to have the
              game installed to join; this watches one here, in the browser.
              Red rather than the primary teal, and the only red on the page --
              it is the one thing that is only true sometimes. */}
          <Link
            href="/live"
            className="px-4 py-2 rounded-md text-[13px] font-semibold transition-all inline-flex items-center gap-2 hover-glow"
            style={{
              color: "var(--color-text-bright)",
              border: "1px solid color-mix(in srgb, #E24B4A 45%, transparent)",
              background:
                "linear-gradient(180deg, color-mix(in srgb, var(--color-surface-elevated) 75%, transparent), color-mix(in srgb, var(--color-surface) 55%, transparent))",
              boxShadow: "inset 0 1px 0 var(--glass-spec)",
            }}
          >
            {/* animate-pulse is a fade, not a glow: a halo on something this
                small reads as a smudge rather than a light. */}
            <span
              aria-hidden
              className="w-2 h-2 rounded-full animate-pulse"
              style={{ backgroundColor: "#E24B4A" }}
            />
            Watch Live
          </Link>
          <HomeProfileButton />
        </div>
      </section>

      {/* ---------------------------------------------------------------- stat strip */}
      <section className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-10">
        <div className="glass-panel p-4">
          {/* Same watermark treatment as the Player of the Month tile beside it —
              the Republic crest is what the Stats page uses for match counts. */}
          <Emblem
            src="/achievements/galactic-republic.svg"
            color="var(--color-primary)"
            className="absolute -right-5 -top-4 w-[112px] h-[112px] opacity-[0.07] pointer-events-none"
          />
          <div
            className="relative text-2xl font-extrabold text-white font-mono"
            style={{ fontFamily: "var(--font-orbitron)" }}
          >
            {matchesThisMonth.length}
          </div>
          <div className="relative mt-1 text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8892a0]">
            Matches This Month
          </div>
        </div>
        {/* Clicks through to the full board — same treatment the Player of the
            Month tile gives its profile link. */}
        <Link href="/achievements" className="glass-panel p-4 block transition-transform hover:-translate-y-0.5">
          <div
            className="text-2xl font-extrabold font-mono"
            style={{ fontFamily: "var(--font-orbitron)", color: "var(--color-primary)" }}
          >
            {crestsThisMonth.length}
          </div>
          <div className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8892a0]">
            Achievements Earned
          </div>
        </Link>
        {/* The month's record rides along from data the page already has, so the
            tile can show more than a bare name. */}
        <HomeStarTile monthlyStats={monthlyStats} />
        <div className="glass-panel p-4">
          <div className="text-2xl font-extrabold text-white font-mono" style={{ fontFamily: "var(--font-orbitron)" }}>
            {killsThisMonth.toLocaleString()}
          </div>
          <div className="mt-1 text-[10.5px] uppercase tracking-[0.08em] font-bold text-[#8892a0]">
            Kills This Month
          </div>
        </div>
      </section>

      {/* ---------------------------------------------------------------- activity + crests */}
      {/* Both columns are flex, and both panels flex-1, so whichever is taller
          sets the row and the other stretches to meet it -- the two boxes always
          finish level instead of the feed running past by whatever its item
          count happens to make it. The feed's own max-height (see
          home-activity-feed.tsx) keeps it from being the one that always wins. */}
      <section className="grid grid-cols-1 lg:grid-cols-[1.3fr_1fr] gap-5 mb-10 items-stretch">
        <div className="flex flex-col min-h-0">
          <h2
            className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#8892a0] mb-3"
            style={{ fontFamily: "var(--font-orbitron)" }}
          >
            Recent Activity
          </h2>
          {/* The feed's scroller is absolutely positioned inside this panel
              (see home-activity-feed.tsx), so its fifteen items contribute
              nothing to layout and the video panel opposite sets the row height
              at every width — no pixel constant to re-guess. The min-height is
              for the stacked mobile layout, where there is no video beside it to
              borrow a height from. */}
          <div className="glass-panel relative flex-1 min-h-[340px] lg:min-h-0 overflow-hidden">
            <HomeActivityFeed items={activityFeed} />
          </div>
        </div>
        <div className="flex flex-col min-h-0">
          <div className="flex items-baseline justify-between mb-3">
            <h2
              className="text-[13px] font-extrabold uppercase tracking-[0.16em] text-[#8892a0]"
              style={{ fontFamily: "var(--font-orbitron)" }}
            >
              Latest Video
            </h2>
            <a
              href={`https://www.youtube.com/watch?v=${videoId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs font-bold"
              style={{ color: "var(--color-primary)" }}
            >
              Watch on YouTube &rarr;
            </a>
          </div>
          {/* TRIAL — to restore Latest Achievements exactly as it was, re-import
              HomeCrestGrid from "@/components/home-crest-grid" and swap
              HomeVideoPanel for the two lines below:

                <div className="glass-panel flex-1 p-4">
                  <HomeCrestGrid entries={ledger.recent.slice(0, CREST_GRID_SIZE)} />

              (that panel must not be a flex container: the crest grid is
              auto-fill and would collapse to one column as a flex item.) */}
          <div className="glass-panel flex-1 p-4">
            <HomeVideoPanel videoId={videoId} title={featured.title ?? undefined} />
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
