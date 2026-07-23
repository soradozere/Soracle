import Link from "next/link"
import { Crest, CrestStyles } from "@/components/achievement-crest"
import { fmtDate } from "@/lib/achievement-format"
import { ACHIEVEMENTS, SECRET_ACHIEVEMENTS } from "@/lib/achievement-meta"
import type { LedgerEntry } from "@/lib/achievements-server"
import type { AchievementView } from "@/lib/achievements"

// The homepage's "Latest Crests" grid: the same crest tile the /achievements
// pages use, fed synthetic AchievementView objects built from ledger entries —
// a ledger entry only carries what was crossed, not the tile's full presentation
// state, so the missing fields are filled with "this is an earned, non-tiered-
// progress view" defaults.
function viewFor(e: LedgerEntry): AchievementView {
  const def = ACHIEVEMENTS.find((d) => d.id === e.achId) ?? SECRET_ACHIEVEMENTS.find((d) => d.id === e.achId)
  return {
    id: e.achId,
    title: e.title,
    titled: e.titled,
    category: def?.category ?? "match",
    rarity: e.rarity,
    icon: def?.icon ?? "galactic-republic",
    condition: def?.condition ?? "",
    pending: false,
    tiered: e.totalRanks > 1,
    rank: e.rank,
    totalRanks: e.totalRanks,
    earned: true,
    earnedDate: e.date,
    earnedMatchId: e.matchId,
    earnedRequirement: null,
    earnedWith: null,
    progressPct: null,
    progressLabel: null,
    value: 0,
  }
}

export function HomeCrestGrid({ entries }: { entries: LedgerEntry[] }) {
  if (!entries.length) {
    return <p className="text-sm text-[#8892a0]">No crests unlocked yet.</p>
  }

  return (
    <div className="home-crest-grid">
      <CrestStyles />
      {entries.map((e) => (
        <Link
          key={`${e.achId}-${e.rank}-${e.playerId}-${e.date}`}
          href={`/achievements/${e.achId}`}
          className="home-crest-card"
        >
          <Crest a={viewFor(e)} showProgress={false} />
          <div className="home-crest-meta">
            <span className="home-crest-player">{e.playerName}</span>
            <span className="home-crest-date">{fmtDate(e.date)}</span>
          </div>
        </Link>
      ))}
      <style>{`
        .home-crest-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:16px 10px;justify-items:center}
        .home-crest-card{display:flex;flex-direction:column;align-items:center;gap:8px;text-decoration:none}
        .home-crest-card .ach-tile{transition:transform .18s ease}
        .home-crest-card:hover .ach-tile{transform:translateY(-4px)}
        .home-crest-card:focus-visible{outline:2px solid #66fcf1;outline-offset:6px;border-radius:8px}
        .home-crest-meta{display:flex;flex-direction:column;align-items:center;gap:1px}
        .home-crest-player{font-size:11.5px;font-weight:700;color:#e6edf3}
        .home-crest-date{font-size:10px;color:#8892a0;font-variant-numeric:tabular-nums}
      `}</style>
    </div>
  )
}
