"use client"

import { useState } from "react"
import Link from "next/link"
import { Crest, CrestStyles } from "@/components/achievement-crest"
import { fmtDate, roman } from "@/lib/achievement-format"
import { rarityColor, rarityLabel, type AchievementSummary } from "@/lib/achievement-pages"
import type { AchievementCategory, Rarity } from "@/lib/achievement-meta"

// The /achievements index: what's recently been earned, then every crest in the
// game with how many people hold it. Client-side only for the category filter —
// all the data is computed on the server and passed in.

export interface FeedItem {
  achId: string
  title: string
  tiered: boolean
  rank: number
  rarity: Rarity
  icon: string
  condition: string
  playerName: string
  date: string
  ordinal: number
}

type Filter = "all" | "held" | "unclaimed" | AchievementCategory

const FILTERS: { key: Filter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "held", label: "Held" },
  { key: "unclaimed", label: "Unclaimed" },
  { key: "match", label: "Single match" },
  { key: "career", label: "Career" },
  { key: "streak", label: "Streak" },
]

const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

function FeedRow({ item }: { item: FeedItem }) {
  const color = rarityColor(item.rarity)
  const name = item.tiered && item.rank > 1 ? `${item.title} ${roman(item.rank)}` : item.title
  const mask = `url(/achievements/${item.icon}.svg) center / contain no-repeat`

  return (
    <li>
      <Link href={`/achievements/${item.achId}`} className="ach-feed-row">
        <span
          className="ach-feed-ico"
          aria-hidden
          style={{ filter: `drop-shadow(0 0 5px ${color}99)` }}
        >
          <i style={{ WebkitMask: mask, mask, backgroundColor: color }} />
        </span>
        <span className="ach-feed-main">
          <span>
            <b className="text-[#e6edf3]">{item.playerName}</b>
            <span className="text-[#8892a0]"> unlocked </span>
            <b style={{ color }}>{name}</b>
          </span>
          <span className="ach-feed-sub">
            {item.condition} · {ord(item.ordinal)} to reach this{item.tiered ? " rank" : ""}
          </span>
        </span>
        <span className="ach-feed-rar" style={{ "--rc": color } as React.CSSProperties}>
          {rarityLabel(item.rarity)}
        </span>
        <span className="ach-feed-date">{fmtDate(item.date)}</span>
      </Link>
    </li>
  )
}

export function AchievementsIndex({
  summaries,
  feed,
  sealedSecrets,
  playerCount,
  totalUnlocks,
}: {
  summaries: AchievementSummary[]
  feed: FeedItem[]
  sealedSecrets: number
  playerCount: number
  totalUnlocks: number
}) {
  const [filter, setFilter] = useState<Filter>("all")

  const held = summaries.filter((s) => s.holderCount > 0).length
  const shown = summaries.filter((s) => {
    if (filter === "all") return true
    if (filter === "held") return s.holderCount > 0
    if (filter === "unclaimed") return s.holderCount === 0
    return s.category === filter
  })

  const counts = [
    { n: summaries.length, label: "Achievements" },
    { n: held, label: "Unlocked by someone" },
    { n: summaries.length - held, label: "Still untouched" },
    { n: totalUnlocks, label: "Total unlocks" },
    { n: playerCount, label: "Players tracked" },
  ]

  return (
    <div className="relative z-10">
      <CrestStyles />
      <style>{PAGE_CSS}</style>

      <header className="mb-7">
        <h1 className="ach-h1">Achievements</h1>
        <p className="text-[#8892a0] max-w-[62ch] text-sm md:text-base">
          Every crest in the game, who holds it, and who got there first. Ranks stack — a tiered crest levels up as you
          climb, and each rank is its own unlock.
        </p>
      </header>

      <div className="ach-counts">
        {counts.map((c) => (
          <div key={c.label} className="ach-count">
            <b>{c.n}</b>
            <span>{c.label}</span>
          </div>
        ))}
      </div>

      <h2 className="ach-h2">Latest achievements earned</h2>
      {feed.length ? (
        <ul className="ach-feed">
          {feed.map((f) => (
            <FeedRow key={`${f.achId}-${f.rank}-${f.playerName}-${f.date}`} item={f} />
          ))}
        </ul>
      ) : (
        <p className="text-[#8892a0] text-sm">No achievements have been unlocked yet.</p>
      )}

      <h2 className="ach-h2">All achievements</h2>
      <div className="ach-filters">
        {FILTERS.map((f) => (
          <button key={f.key} onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}>
            {f.label}
          </button>
        ))}
      </div>
      <div className="ach-grid">
        {shown.map((s) => (
          <Link key={s.id} href={`/achievements/${s.id}`} className="ach-card">
            <Crest a={s.view} showProgress={false} />
            <span className="ach-card-meta" data-held={s.holderCount > 0 ? "y" : "n"}>
              {s.holderCount ? `${s.holderCount} ${s.holderCount === 1 ? "holder" : "holders"}` : "Unclaimed"}
            </span>
          </Link>
        ))}
      </div>

      {sealedSecrets > 0 && (
        <>
          <h2 className="ach-h2">The vault · One of One</h2>
          <p className="text-[#8892a0] text-sm max-w-[70ch] mb-3">
            {sealedSecrets === 1 ? "One secret crest exists" : `${sealedSecrets} secret crests exist`} that exactly one
            player will ever hold. Their conditions are not published — the only way one surfaces is when somebody claims
            it.
          </p>
          <div className="ach-vault">
            {Array.from({ length: sealedSecrets }).map((_, i) => (
              <div key={i} className="ach-sealed" aria-label="Unclaimed one-of-one achievement">
                ?
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// Prefixed .ach- throughout so nothing here can collide with the crest CSS the
// page also loads.
const PAGE_CSS = `
.ach-h1{font-family:var(--font-orbitron),sans-serif;font-size:clamp(26px,5vw,36px);letter-spacing:.05em;text-transform:uppercase;font-weight:800;color:#e6edf3;margin:0 0 8px;text-wrap:balance}
.ach-h2{font-family:var(--font-orbitron),sans-serif;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#8892a0;font-weight:800;margin:34px 0 10px}
.ach-counts{display:flex;gap:10px;flex-wrap:wrap}
.ach-count{flex:1 1 150px;background:#151b24;border:1px solid #2a3542;border-radius:8px;padding:12px 14px}
.ach-count b{display:block;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:24px;font-variant-numeric:tabular-nums;color:#66fcf1}
.ach-count span{font-size:10.5px;text-transform:uppercase;letter-spacing:.12em;color:#8892a0;font-weight:700}

/* Capped at ~6 rows and scrolled internally: the feed is deep enough now that a
   full-height list would bury the crest grid. max-height, not a fixed one, so a
   short list (a new season, a fresh database) still collapses to its content. */
.ach-feed{list-style:none;margin:0;padding:0;border:1px solid #2a3542;border-radius:8px;background:#151b24;max-height:420px;overflow-y:auto;overscroll-behavior:contain;scrollbar-width:thin;scrollbar-color:#2a3542 #0b0c10}
.ach-feed::-webkit-scrollbar{width:6px}
.ach-feed::-webkit-scrollbar-track{background:#0b0c10;border-radius:999px;margin:4px 0}
.ach-feed::-webkit-scrollbar-thumb{background:#2a3542;border-radius:999px;border:1px solid #0b0c10}
.ach-feed::-webkit-scrollbar-thumb:hover{background:#3d4855}
.ach-feed-row{display:grid;grid-template-columns:34px 1fr auto auto;gap:12px;align-items:center;padding:10px 14px;border-top:1px solid #2a3542;color:#c5c6c7;text-decoration:none}
.ach-feed li:first-child .ach-feed-row{border-top:0}
.ach-feed-row:hover{background:#1f2833}
.ach-feed-row:focus-visible{outline:none;background:#1f2833;box-shadow:inset 3px 0 0 #66fcf1}
.ach-feed-ico{width:28px;height:28px;display:grid;place-items:center}
.ach-feed-ico i{width:24px;height:24px;display:block}
.ach-feed-main{display:flex;flex-direction:column;gap:1px;min-width:0}
.ach-feed-sub{font-size:11px;color:#8892a0}
.ach-feed-rar{font-size:9px;font-weight:800;letter-spacing:.1em;text-transform:uppercase;padding:3px 9px;border-radius:999px;border:1px solid var(--rc);color:color-mix(in srgb,var(--rc) 80%,#fff);white-space:nowrap}
.ach-feed-date{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11px;color:#8892a0;font-variant-numeric:tabular-nums;white-space:nowrap}

.ach-filters{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:6px}
.ach-filters button{font-size:11px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;padding:6px 12px;border-radius:999px;border:1px solid #3d4855;background:transparent;color:#8892a0;cursor:pointer;transition:color .15s,background .15s}
.ach-filters button:hover{color:#e6edf3}
.ach-filters button[aria-pressed="true"]{background:#66fcf1;border-color:#66fcf1;color:#0b0c10}
.ach-filters button:focus-visible{outline:2px solid #66fcf1;outline-offset:2px}

.ach-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(168px,1fr));gap:16px 10px;padding-top:8px;justify-items:center}
.ach-card{display:flex;flex-direction:column;align-items:center;gap:14px;text-decoration:none}
.ach-card .ach-tile{transition:transform .18s ease}
.ach-card:hover .ach-tile{transform:translateY(-4px)}
.ach-card:focus-visible{outline:2px solid #66fcf1;outline-offset:6px;border-radius:8px}
.ach-card-meta{font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:#8892a0}
.ach-card-meta[data-held="n"]{color:#5b6675}

.ach-vault{display:grid;grid-template-columns:repeat(auto-fill,minmax(96px,1fr));gap:10px}
.ach-sealed{aspect-ratio:1;display:grid;place-items:center;border:1px dashed #ff2fb955;border-radius:8px;background:linear-gradient(180deg,#1a1220,#0d0810);color:#ff2fb9;font-family:var(--font-orbitron),sans-serif;font-size:20px;font-weight:800;letter-spacing:.1em;text-shadow:0 0 12px #ff2fb977}

@media (max-width:640px){
  .ach-feed-row{grid-template-columns:28px 1fr;row-gap:4px}
  .ach-feed-rar,.ach-feed-date{grid-column:2}
}
`
