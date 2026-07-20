"use client"

import { useMemo, useState } from "react"
import Link from "next/link"
import { Search, Trophy, ArrowRight } from "lucide-react"
import { RARITY_META, type Rarity } from "@/lib/achievement-meta"
import { RARITY_ORDER, RARITY_POINTS } from "@/lib/achievement-score"
import { slug } from "@/lib/achievement-format"

// The board's row shape. Deliberately plain data — this is a client component,
// so nothing here may carry a function across the server boundary.
export interface BoardRow {
  id: string
  name: string
  tierValue: number
  avatarUrl: string | null
  score: number
  unlocks: number
  best: Rarity | null
  rarityCounts: Record<Rarity, number>
  form: ("W" | "L" | "D")[]
  formWins: number
  formLosses: number
  matches: number
}

type SortKey = "score" | "form" | "tier" | "name"

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Achievement Score" },
  { key: "form", label: "Form" },
  { key: "tier", label: "Tier" },
  { key: "name", label: "Name" },
]

const accentFor = (r: Rarity | null) => (r ? RARITY_META[r].color : "#3d4855")

// Rank 1-3 get medal colours; everyone else stays quiet so the top of the board
// reads instantly without turning the whole list into a rainbow.
const MEDALS = ["#f5c542", "#c7d0da", "#cd7f32"]

function Avatar({ row }: { row: BoardRow }) {
  const accent = accentFor(row.best)
  if (row.avatarUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary admin-set URLs
      <img
        src={row.avatarUrl}
        alt=""
        className="w-11 h-11 rounded-full object-cover shrink-0"
        style={{ border: `2px solid ${accent}`, boxShadow: `0 0 12px ${accent}40` }}
      />
    )
  }
  // Monogram fallback, tinted by the player's rarest crest so the board still
  // has a colour signal before anyone uploads a picture.
  return (
    <div
      className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center font-bold text-base"
      style={{
        border: `2px solid ${accent}`,
        boxShadow: `0 0 12px ${accent}40`,
        backgroundColor: `${accent}1a`,
        color: accent,
        fontFamily: "var(--font-orbitron)",
      }}
    >
      {row.name.slice(0, 1).toUpperCase()}
    </div>
  )
}

function FormPips({ row }: { row: BoardRow }) {
  if (!row.form.length) return <span className="text-xs text-[#8892a0]">No games yet</span>
  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1" aria-label={`Recent form: ${row.form.join("")}`}>
        {/* Oldest-to-newest left-to-right reads like a timeline; the data comes
            in newest-first, so flip it here rather than in the query. */}
        {[...row.form].reverse().map((f, i) => (
          <span
            key={i}
            title={f === "W" ? "Win" : f === "L" ? "Loss" : "Draw"}
            className="w-2.5 h-5 rounded-sm"
            style={{ backgroundColor: f === "W" ? "#3ddc84" : f === "L" ? "#ff4757" : "#5a6472" }}
          />
        ))}
      </div>
      <span className="text-xs font-mono text-[#8892a0] tabular-nums whitespace-nowrap">
        {row.formWins}–{row.formLosses}
      </span>
    </div>
  )
}

function RarityBar({ row }: { row: BoardRow }) {
  const held = RARITY_ORDER.filter((r) => row.rarityCounts[r] > 0)
  if (!held.length) return <span className="text-xs text-[#8892a0]">—</span>
  return (
    <div className="flex flex-wrap gap-1">
      {held.map((r) => (
        <span
          key={r}
          title={`${row.rarityCounts[r]} × ${RARITY_META[r].label} (${RARITY_POINTS[r]} pts each)`}
          className="text-[10px] font-mono font-bold px-1.5 py-0.5 rounded tabular-nums"
          style={{
            color: RARITY_META[r].color,
            backgroundColor: `${RARITY_META[r].color}1a`,
            border: `1px solid ${RARITY_META[r].color}55`,
          }}
        >
          {row.rarityCounts[r]}
        </span>
      ))}
    </div>
  )
}

export function PlayersIndex({ rows }: { rows: BoardRow[] }) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("score")

  // Standings are always by score, independent of the current sort — so a
  // player's "#4" badge doesn't change meaning when you re-sort by name.
  const rankById = useMemo(() => {
    const m = new Map<string, number>()
    ;[...rows]
      .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
      .forEach((r, i) => m.set(r.id, i + 1))
    return m
  }, [rows])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = q ? rows.filter((r) => r.name.toLowerCase().includes(q)) : rows
    const winRate = (r: BoardRow) => (r.form.length ? r.formWins / r.form.length : -1)
    return [...filtered].sort((a, b) => {
      if (sort === "name") return a.name.localeCompare(b.name)
      if (sort === "tier") return b.tierValue - a.tierValue || b.score - a.score
      if (sort === "form") return winRate(b) - winRate(a) || b.score - a.score
      return b.score - a.score || a.name.localeCompare(b.name)
    })
  }, [rows, query, sort])

  const totalScore = useMemo(() => rows.reduce((n, r) => n + r.score, 0), [rows])

  return (
    <>
      <style>{PLAYERS_CSS}</style>

      <h1 className="text-3xl md:text-4xl font-bold glow-text mb-2" style={{ fontFamily: "var(--font-orbitron)" }}>
        PLAYERS
      </h1>
      <p className="text-[#8892a0] mb-6 max-w-2xl">
        Everyone on record, ranked by Achievement Score — every crest rank they&apos;ve ever unlocked, weighted by how
        rare it is. Rarer crests are worth dramatically more, so the top of the board can&apos;t be farmed.
      </p>

      {/* The "look at all achievements" entry point. Full-width and above the
          board, because it's a destination rather than a row-level action. */}
      <Link href="/achievements" className="pl-cta">
        <span className="pl-cta-icon">
          <Trophy className="w-5 h-5" />
        </span>
        <span className="pl-cta-body">
          <strong>Browse all achievements</strong>
          <span>Every crest in the game, who holds it, and who got there first</span>
        </span>
        <ArrowRight className="w-5 h-5 pl-cta-arrow" />
      </Link>

      <div className="pl-stats">
        <div className="pl-stat">
          <b>{rows.length}</b>
          <span>Players ranked</span>
        </div>
        <div className="pl-stat">
          <b>{rows.reduce((n, r) => n + r.unlocks, 0)}</b>
          <span>Crest ranks held</span>
        </div>
        <div className="pl-stat">
          <b>{totalScore.toLocaleString()}</b>
          <span>Total score awarded</span>
        </div>
      </div>

      <div className="pl-controls">
        <div className="pl-search">
          <Search className="w-4 h-4 shrink-0 text-[#8892a0]" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search players..."
            aria-label="Search players"
          />
        </div>
        <div className="pl-sorts">
          <span className="pl-sorts-label">Sort</span>
          {SORTS.map((s) => (
            <button
              key={s.key}
              onClick={() => setSort(s.key)}
              className={`pl-sort ${sort === s.key ? "is-on" : ""}`}
              aria-pressed={sort === s.key}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="pl-head" aria-hidden="true">
        <span>#</span>
        <span>Player</span>
        <span>Tier</span>
        <span>Form (last 10)</span>
        <span>Crests</span>
        <span className="pl-head-score">Score</span>
      </div>

      <ul className="pl-list">
        {shown.map((row) => {
          const rank = rankById.get(row.id)!
          const accent = accentFor(row.best)
          return (
            <li key={row.id}>
              <Link href={`/player/${slug(row.name)}`} className="pl-row" style={{ ["--accent" as string]: accent }}>
                <span
                  className="pl-rank tabular-nums"
                  style={rank <= 3 ? { color: MEDALS[rank - 1], borderColor: `${MEDALS[rank - 1]}66` } : undefined}
                >
                  {rank}
                </span>

                <span className="pl-who">
                  <Avatar row={row} />
                  <span className="pl-who-text">
                    <strong>{row.name}</strong>
                    <span>
                      {/* Tier has its own column on desktop; on narrow screens
                          that column is dropped, so it folds in here instead of
                          disappearing. */}
                      <em className="pl-tier-inline">T{row.tierValue} · </em>
                      {row.matches} matches
                    </span>
                  </span>
                </span>

                <span className="pl-tier tabular-nums">T{row.tierValue}</span>

                <span className="pl-form">
                  <FormPips row={row} />
                </span>

                <span className="pl-crests">
                  <RarityBar row={row} />
                </span>

                <span className="pl-score">
                  <b className="tabular-nums" style={{ color: accent }}>
                    {row.score.toLocaleString()}
                  </b>
                  <span>{row.unlocks} ranks</span>
                </span>
              </Link>
            </li>
          )
        })}
      </ul>

      {!shown.length && <p className="text-[#8892a0] py-8 text-center">No players match “{query}”.</p>}

      <p className="pl-key">
        Score weighting:{" "}
        {RARITY_ORDER.map((r) => (
          <span key={r} style={{ color: RARITY_META[r].color }}>
            {RARITY_META[r].label} {RARITY_POINTS[r]}
          </span>
        )).reduce<React.ReactNode[]>((out, el, i) => (i ? [...out, " · ", el] : [el]), [])}
      </p>
    </>
  )
}

const PLAYERS_CSS = `
.pl-cta{display:flex;align-items:center;gap:14px;padding:16px 18px;margin-bottom:24px;border:1px solid #2a3542;border-radius:10px;background:linear-gradient(90deg,#151b24,#1a2230);transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease}
.pl-cta:hover{border-color:#66fcf1;transform:translateY(-2px);box-shadow:0 6px 24px rgba(102,252,241,.12)}
.pl-cta:focus-visible{outline:2px solid #66fcf1;outline-offset:3px}
.pl-cta-icon{display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:9px;background:rgba(102,252,241,.1);color:#66fcf1;flex:0 0 auto}
.pl-cta-body{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.pl-cta-body strong{color:#e8ecf1;font-size:15px}
.pl-cta-body span{color:#8892a0;font-size:13px}
.pl-cta-arrow{color:#8892a0;flex:0 0 auto;transition:transform .18s ease,color .18s ease}
.pl-cta:hover .pl-cta-arrow{color:#66fcf1;transform:translateX(3px)}

.pl-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:24px}
.pl-stat{border:1px solid #2a3542;border-radius:8px;background:#151b24;padding:12px 14px;display:flex;flex-direction:column;gap:2px}
.pl-stat b{font-family:var(--font-orbitron);font-size:22px;color:#66fcf1;font-variant-numeric:tabular-nums}
.pl-stat span{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8892a0}

.pl-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.pl-search{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid #2a3542;border-radius:8px;background:#151b24;flex:1;min-width:200px}
.pl-search input{background:transparent;border:0;outline:0;color:#e8ecf1;font-size:14px;width:100%}
.pl-search input::placeholder{color:#5a6472}
.pl-search:focus-within{border-color:#66fcf1}
.pl-sorts{display:flex;flex-wrap:wrap;align-items:center;gap:6px}
.pl-sorts-label{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#8892a0;margin-right:2px}
.pl-sort{font-size:12px;padding:6px 10px;border-radius:6px;border:1px solid #2a3542;background:#151b24;color:#c5c6c7;transition:all .15s ease}
.pl-sort:hover{border-color:#3d4855;color:#e8ecf1}
.pl-sort.is-on{background:#66fcf1;border-color:#66fcf1;color:#0b0c10;font-weight:700}

/* One grid template shared by the header and every row, so the columns line up
   without the header having to know the row markup. */
.pl-head,.pl-row{display:grid;grid-template-columns:44px minmax(160px,1.4fr) 60px minmax(150px,1fr) minmax(110px,.8fr) 96px;gap:14px;align-items:center}
.pl-head{padding:0 14px 8px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#5a6472}
.pl-head-score{text-align:right}

.pl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.pl-row{padding:10px 14px;border:1px solid #2a3542;border-left:3px solid var(--accent);border-radius:8px;background:#151b24;transition:background .16s ease,transform .16s ease,border-color .16s ease}
.pl-row:hover{background:#1a2230;transform:translateX(3px);border-color:#3d4855;border-left-color:var(--accent)}
.pl-row:focus-visible{outline:2px solid #66fcf1;outline-offset:2px}

.pl-rank{font-family:var(--font-orbitron);font-size:14px;color:#8892a0;text-align:center;border:1px solid #2a3542;border-radius:6px;padding:4px 0}
.pl-who{display:flex;align-items:center;gap:10px;min-width:0}
.pl-who-text{display:flex;flex-direction:column;min-width:0}
.pl-who-text strong{color:#e8ecf1;font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pl-who-text span{font-size:11px;color:#8892a0}
.pl-tier-inline{display:none;font-style:normal;color:#66fcf1}
.pl-tier{font-family:var(--font-orbitron);font-size:13px;color:#66fcf1;text-align:center}
.pl-score{display:flex;flex-direction:column;align-items:flex-end}
.pl-score b{font-family:var(--font-orbitron);font-size:19px;line-height:1.1}
.pl-score span{font-size:10px;color:#8892a0}

.pl-key{margin-top:20px;font-size:11px;color:#5a6472;text-align:center}

/* Below the table breakpoint the row becomes a two-line card: identity and score
   on top, form and crests beneath. The grid columns would be unreadable here. */
@media (max-width:860px){
  .pl-head{display:none}
  .pl-row{grid-template-columns:40px 1fr auto;grid-template-areas:"rank who score" ". form form" ". crests crests";row-gap:8px}
  .pl-rank{grid-area:rank}
  .pl-who{grid-area:who}
  .pl-score{grid-area:score}
  .pl-form{grid-area:form}
  .pl-crests{grid-area:crests}
  .pl-tier{display:none}
  .pl-tier-inline{display:inline}
}
`
