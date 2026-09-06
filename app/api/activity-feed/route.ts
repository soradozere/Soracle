import { NextResponse } from "next/server"
import { computeAchievementLedger, computeHomeSummary } from "@/lib/achievements-server"
import { listFeedDemoUploads } from "@/lib/demos-server"
import type { ActivityItem } from "@/components/home-activity-feed"

export const revalidate = 3600

const FEED_SIZE = 15

// JSON twin of the homepage's activity feed (app/(main)/page.tsx), for the JK2
// Launcher's Home screen. Deliberately a second copy of that merge/sort rather
// than a shared import: the homepage is a live, already-tested render path and
// this route reads the exact same cached sources without touching it. THE TWO
// ARE NOT COUPLED BY THE COMPILER - if the feed composition changes on the
// homepage, mirror it here too.
export async function GET() {
  const [ledger, home, demoUploads] = await Promise.all([
    computeAchievementLedger(),
    computeHomeSummary(),
    listFeedDemoUploads(FEED_SIZE),
  ])

  const allMatches = home.matches
  const totalMatches = allMatches.length

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

  return NextResponse.json({ activityFeed })
}
