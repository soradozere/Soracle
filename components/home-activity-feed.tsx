import Link from "next/link"
import { Swords, Sparkles } from "lucide-react"
import { fmtDate } from "@/lib/achievement-format"
import { rarityColor, rarityLabel } from "@/lib/achievement-pages"
import { roman } from "@/lib/achievement-format"
import type { LedgerEntry } from "@/lib/achievements-server"

export type ActivityItem =
  | { type: "match"; date: string; ordinal: number; redScore: number; blueScore: number; playerCount: number }
  | { type: "crest"; date: string; entry: LedgerEntry }

function MatchRow({ item }: { item: Extract<ActivityItem, { type: "match" }> }) {
  return (
    <li>
      <Link href="/matches" className="home-feed-row home-feed-row--match">
        <span className="home-feed-ico home-feed-ico--match" aria-hidden>
          <Swords className="w-4 h-4" />
        </span>
        <span className="home-feed-main">
          <span>
            <b className="text-[#e6edf3]">Match #{item.ordinal}</b>
            <span className="text-[#8892a0]"> logged &mdash; </span>
            <b className="text-[#ff4757]">Red {item.redScore}</b>
            <span className="text-[#8892a0]"> : </span>
            <b className="text-[#62d6e8]">{item.blueScore} Blue</b>
          </span>
          <span className="home-feed-sub">{item.playerCount} players</span>
        </span>
        <span className="home-feed-date">{fmtDate(item.date)}</span>
      </Link>
    </li>
  )
}

function CrestRow({ item }: { item: Extract<ActivityItem, { type: "crest" }> }) {
  const e = item.entry
  const color = rarityColor(e.rarity)
  const name = e.totalRanks > 1 && e.rank > 1 && !e.titled ? `${e.title} ${roman(e.rank)}` : e.title
  return (
    <li>
      <Link href={`/achievements/${e.achId}`} className="home-feed-row">
        <span className="home-feed-ico" aria-hidden style={{ color }}>
          <Sparkles className="w-4 h-4" />
        </span>
        <span className="home-feed-main">
          <span>
            <b className="text-[#e6edf3]">{e.playerName}</b>
            <span className="text-[#8892a0]"> earned </span>
            <b style={{ color }}>{name}</b>
          </span>
          <span className="home-feed-sub" style={{ color }}>
            {rarityLabel(e.rarity)}
          </span>
        </span>
        <span className="home-feed-date">{fmtDate(e.date)}</span>
      </Link>
    </li>
  )
}

export function HomeActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) {
    return <p className="text-sm text-[#8892a0]">Nothing logged yet.</p>
  }

  return (
    <ul className="home-feed">
      {items.map((item) =>
        item.type === "match" ? (
          <MatchRow key={`match-${item.ordinal}`} item={item} />
        ) : (
          <CrestRow
            key={`crest-${item.entry.achId}-${item.entry.rank}-${item.entry.playerId}-${item.entry.date}`}
            item={item}
          />
        ),
      )}
      <style>{`
        .home-feed{list-style:none;margin:0;padding:0;max-height:560px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#2a3542 #0b0c10}
        .home-feed::-webkit-scrollbar{width:6px}
        .home-feed::-webkit-scrollbar-track{background:#0b0c10;border-radius:999px;margin:4px 0}
        .home-feed::-webkit-scrollbar-thumb{background:#2a3542;border-radius:999px;border:1px solid #0b0c10}
        .home-feed::-webkit-scrollbar-thumb:hover{background:#3d4855}
        .home-feed-row{display:grid;grid-template-columns:30px 1fr auto;gap:12px;align-items:center;padding:11px 14px;border-top:1px solid #2a3542;color:#c5c6c7;text-decoration:none}
        .home-feed li:first-child .home-feed-row{border-top:0}
        a.home-feed-row:hover{background:#1f2833}
        a.home-feed-row:focus-visible{outline:none;background:#1f2833;box-shadow:inset 3px 0 0 #66fcf1}
        .home-feed-row--match{background:rgba(98,214,232,0.06);box-shadow:inset 3px 0 0 #62d6e8}
        .home-feed-ico{width:28px;height:28px;border-radius:7px;display:grid;place-items:center;background:#151b24;border:1px solid #2a3542;color:#66fcf1;flex-shrink:0}
        .home-feed-ico--match{color:#62d6e8;border-color:#62d6e855}
        .home-feed-main{display:flex;flex-direction:column;gap:1px;min-width:0;font-size:13.5px}
        .home-feed-sub{font-size:11px;color:#8892a0;font-weight:700;text-transform:uppercase;letter-spacing:.04em}
        .home-feed-date{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#8892a0;font-variant-numeric:tabular-nums;white-space:nowrap}
        @media (max-width:640px){
          .home-feed-row{grid-template-columns:26px 1fr;row-gap:4px}
          .home-feed-date{grid-column:2}
        }
      `}</style>
    </ul>
  )
}
