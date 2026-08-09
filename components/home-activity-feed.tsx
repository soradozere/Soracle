import Link from "next/link"
import { Swords, Sparkles, Film } from "lucide-react"
import { fmtDate } from "@/lib/achievement-format"
import { rarityColor, rarityLabel } from "@/lib/achievement-pages"
import { roman } from "@/lib/achievement-format"
import type { LedgerEntry } from "@/lib/achievements-server"

export type ActivityItem =
  | { type: "match"; date: string; ordinal: number; redScore: number; blueScore: number; playerCount: number }
  | { type: "crest"; date: string; entry: LedgerEntry }
  | { type: "demo"; date: string; demoId: string; title: string; uploaderName: string | null; gametype: string }

function MatchRow({ item }: { item: Extract<ActivityItem, { type: "match" }> }) {
  return (
    <li>
      <Link href="/matches" className="home-feed-row home-feed-row--match">
        <span className="home-feed-ico home-feed-ico--match" aria-hidden>
          <Swords className="w-4 h-4" />
        </span>
        <span className="home-feed-main">
          <span>
            <b className="text-[var(--color-text-bright)]">Match #{item.ordinal}</b>
            <span className="text-[var(--color-text-dim)]"> logged &mdash; </span>
            <b className="text-[var(--color-accent-red)]">Red {item.redScore}</b>
            <span className="text-[var(--color-text-dim)]"> : </span>
            <b className="text-[var(--color-accent-blue)]">{item.blueScore} Blue</b>
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
            <b className="text-[var(--color-text-bright)]">{e.playerName}</b>
            <span className="text-[var(--color-text-dim)]"> earned </span>
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

function DemoRow({ item }: { item: Extract<ActivityItem, { type: "demo" }> }) {
  return (
    <li>
      {/* Plain <a>: the demo page boots a page-scoped engine singleton, so it
          has to be reached by a full navigation (see components/demo-library.tsx). */}
      <a href={`/demos/${item.demoId}`} className="home-feed-row home-feed-row--demo">
        <span className="home-feed-ico home-feed-ico--demo" aria-hidden>
          <Film className="w-4 h-4" />
        </span>
        <span className="home-feed-main">
          <span>
            <span className="text-[var(--color-text-dim)]">New demo &mdash; </span>
            <b className="text-[var(--color-text-bright)]">{item.title}</b>
          </span>
          <span className="home-feed-sub">
            {item.gametype}
            {item.uploaderName && ` · ${item.uploaderName}`}
          </span>
        </span>
        <span className="home-feed-date">{fmtDate(item.date)}</span>
      </a>
    </li>
  )
}

export function HomeActivityFeed({ items }: { items: ActivityItem[] }) {
  if (!items.length) {
    return <p className="text-sm text-[var(--color-text-dim)]">Nothing logged yet.</p>
  }

  return (
    <ul className="home-feed">
      {items.map((item) => {
        if (item.type === "match") return <MatchRow key={`match-${item.ordinal}`} item={item} />
        if (item.type === "demo") return <DemoRow key={`demo-${item.demoId}`} item={item} />
        return (
          <CrestRow
            key={`crest-${item.entry.achId}-${item.entry.rank}-${item.entry.playerId}-${item.entry.date}`}
            item={item}
          />
        )
      })}
      <style>{`
        /* Absolute, deliberately: it fills the panel exactly, and because an
           absolutely-positioned box contributes nothing to intrinsic sizing, the
           panel beside it decides how tall the row is. That's what keeps the feed
           level with the video at every width without a magic pixel height. */
        .home-feed{list-style:none;margin:0;padding:0;position:absolute;inset:0;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:color-mix(in srgb, var(--color-border) 72%, var(--color-background)) var(--color-background)}
        .home-feed::-webkit-scrollbar{width:6px}
        .home-feed::-webkit-scrollbar-track{background:var(--color-background);border-radius:999px;margin:4px 0}
        .home-feed::-webkit-scrollbar-thumb{background:color-mix(in srgb, var(--color-border) 72%, var(--color-background));border-radius:999px;border:1px solid var(--color-background)}
        .home-feed::-webkit-scrollbar-thumb:hover{background:var(--color-border)}
        .home-feed-row{display:grid;grid-template-columns:30px 1fr auto;gap:12px;align-items:center;padding:11px 14px;border-top:1px solid color-mix(in srgb, var(--color-border) 72%, var(--color-background));color:var(--color-text);text-decoration:none}
        .home-feed li:first-child .home-feed-row{border-top:0}
        a.home-feed-row:hover{background:color-mix(in srgb, var(--color-surface-elevated) 70%, transparent)}
        a.home-feed-row:focus-visible{outline:none;background:color-mix(in srgb, var(--color-surface-elevated) 70%, transparent);box-shadow:inset 3px 0 0 var(--color-primary)}
        .home-feed-row--match{background:color-mix(in srgb, var(--color-accent-blue) 8%, transparent);box-shadow:inset 3px 0 0 var(--color-accent-blue)}
        .home-feed-row--demo{background:color-mix(in srgb, var(--color-accent-purple) 8%, transparent);box-shadow:inset 3px 0 0 var(--color-accent-purple)}
        .home-feed-ico{width:28px;height:28px;border-radius:7px;display:grid;place-items:center;background:color-mix(in srgb, var(--color-surface) 62%, var(--color-background));border:1px solid color-mix(in srgb, var(--color-border) 72%, var(--color-background));color:var(--color-primary);flex-shrink:0}
        .home-feed-ico--match{color:var(--color-accent-blue);border-color:var(--color-accent-blue)55}
        .home-feed-ico--demo{color:var(--color-accent-purple);border-color:var(--color-accent-purple)55}
        .home-feed-main{display:flex;flex-direction:column;gap:1px;min-width:0;font-size:13.5px}
        .home-feed-sub{font-size:11px;color:var(--color-text-dim);font-weight:700;text-transform:uppercase;letter-spacing:.04em}
        .home-feed-date{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:var(--color-text-dim);font-variant-numeric:tabular-nums;white-space:nowrap}
        @media (max-width:640px){
          .home-feed-row{grid-template-columns:26px 1fr;row-gap:4px}
          .home-feed-date{grid-column:2}
        }
      `}</style>
    </ul>
  )
}
