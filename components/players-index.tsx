"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { Search, Trophy, ArrowRight } from "lucide-react"
import { RARITY_META, type Rarity } from "@/lib/achievement-meta"
import { rarityColor } from "@/lib/achievement-pages"
import { RARITY_ORDER, RARITY_POINTS } from "@/lib/achievement-score"
import { slug } from "@/lib/achievement-format"
import { SegmentedRail } from "@/components/segmented-rail"
import { Emblem } from "@/components/emblem"
import { ACHIEVEMENTS, SECRET_ACHIEVEMENTS } from "@/lib/achievement-meta"

// The board's row shape. Deliberately plain data — this is a client component,
// so nothing here may carry a function across the server boundary.
export interface BoardRow {
  id: string
  name: string
  tierValue: number
  avatarUrl: string | null
  score: number
  unlocks: number
  /** The title the player has actually equipped on their profile, if any.
   *  Drives the row's accent colour as well as the Title column. */
  equippedTitle: { title: string; rarity: Rarity } | null
  rarityCounts: Record<Rarity, number>
  form: ("W" | "L" | "D")[]
  formWins: number
  formLosses: number
  matches: number
  /** In-game score this calendar month — the "Monthly Score" sort. */
  monthScore: number
  /** Matches played this month, shown beside the score so a big number from one
   *  heavy night reads differently from the same number over ten games. */
  monthMatches: number
  inactive: boolean
}

// Counts for the achievements CTA, read off the catalogue itself so they can't
// drift from what's actually in the game.
const ACHIEVEMENT_FAMILIES = ACHIEVEMENTS.length
// The secret list IS the one-of-ones: no ranked family carries a oneofone rank,
// so counting the secrets is counting them (6 since #122 retired two unearnable
// ones — hardcoding "8" here would have gone stale that day).
const ONE_OF_ONES = SECRET_ACHIEVEMENTS.length

// Five real crests for the CTA's fan, one per rarity step, each in its own
// rarity colour — the ladder in miniature.
const CTA_CRESTS = [
  { icon: "galactic-republic", color: rarityColor("common") },
  { icon: "rebel-alliance", color: rarityColor("rare") },
  { icon: "sith-eternal", color: rarityColor("epic") },
  { icon: "mandalorian-crest", color: rarityColor("legendary") },
  { icon: "lord-revan", color: rarityColor("oneofone") },
]
const CTA_WATERMARK = "rebel-alliance-jedi-order"

type SortKey = "score" | "month" | "form" | "tier" | "name"

const SORTS: { key: SortKey; label: string }[] = [
  { key: "score", label: "Achievement Score" },
  { key: "month", label: "Monthly Score" },
  { key: "form", label: "Form" },
  { key: "tier", label: "Tier" },
  { key: "name", label: "Name" },
]

// A row is coloured by the title the player has CHOSEN to wear, not by the
// rarest crest they happen to own. The two came apart often enough to be
// confusing: the Title column already renders the equipped title in its own
// rarity colour, so a row accented from the rarest achievement put two
// different colours on the same person. Someone wearing a title they earned
// three seasons ago should read in that title's colour.
//
// No title equipped means no colour rather than a fall back to the rarest
// crest: the accent means one thing this way, and an untitled row showing "—"
// in a neutral grey is honest about there being nothing to show.
const accentFor = (row: BoardRow) =>
  row.equippedTitle ? rarityColor(row.equippedTitle.rarity) : "#3d4855"

// Rank 1-3 get medal colours; everyone else stays quiet so the top of the board
// reads instantly without turning the whole list into a rainbow.
const MEDALS = ["#f5c542", "#c7d0da", "#cd7f32"]

function Avatar({ row }: { row: BoardRow }) {
  const accent = accentFor(row)
  // Avatars are Discord CDN proxy links, which are signed and do expire — a dead
  // one must degrade to the monogram rather than leaving a broken-image box.
  const [failed, setFailed] = useState(false)
  const imgRef = useRef<HTMLImageElement>(null)

  // onError alone isn't enough: the markup is server-rendered, so an image can
  // finish failing before React hydrates and attaches the handler, and that
  // error event is never replayed. Re-check the resolved state on mount.
  useEffect(() => {
    const img = imgRef.current
    if (img?.complete && img.naturalWidth === 0) setFailed(true)
  }, [])

  if (row.avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary admin-set URLs
      <img
        ref={imgRef}
        src={row.avatarUrl}
        alt=""
        onError={() => setFailed(true)}
        className="w-11 h-11 rounded-full object-cover shrink-0"
        style={{
          border: `2px solid ${accent}`,
          boxShadow: `0 0 12px color-mix(in srgb, ${accent} 25%, transparent)`,
        }}
      />
    )
  }
  // Monogram fallback, tinted by the same equipped-title colour as the rest of
  // the row so the board still has a colour signal before anyone uploads a
  // picture.
  return (
    <div
      className="w-11 h-11 rounded-full shrink-0 flex items-center justify-center font-bold text-base"
      style={{
        border: `2px solid ${accent}`,
        boxShadow: `0 0 12px color-mix(in srgb, ${accent} 25%, transparent)`,
        backgroundColor: `color-mix(in srgb, ${accent} 10%, transparent)`,
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
            color: rarityColor(r),
            backgroundColor: `color-mix(in srgb, ${rarityColor(r)} 10%, transparent)`,
            border: `1px solid color-mix(in srgb, ${rarityColor(r)} 33%, transparent)`,
          }}
        >
          {row.rarityCounts[r]}
        </span>
      ))}
    </div>
  )
}

// What the right-hand cell shows, per sort: the value the board is ordered by,
// plus the denominator that makes it readable.
function scoreCell(row: BoardRow, sort: SortKey): { value: string; note: string } {
  const games = (n: number) => (n === 1 ? "1 game" : `${n} games`)
  switch (sort) {
    case "month":
      return { value: row.monthScore.toLocaleString(), note: games(row.monthMatches) }
    case "form": {
      // The sort key is the win rate over the form window, so show it — the pips
      // to the left already give the shape of it, this gives the number.
      const played = row.form.length
      const pct = played ? Math.round((row.formWins / played) * 100) : null
      return {
        value: pct === null ? "—" : `${pct}%`,
        note: played ? `${row.formWins}–${row.formLosses} last ${played}` : "no games yet",
      }
    }
    case "tier":
      // Tier is the key; career volume is the context that says whether it's a
      // settled rating or a provisional one.
      return { value: `T${row.tierValue}`, note: games(row.matches) }
    default:
      return { value: row.score.toLocaleString(), note: `${row.unlocks} ranks` }
  }
}

export function PlayersIndex({ rows }: { rows: BoardRow[] }) {
  const [query, setQuery] = useState("")
  const [sort, setSort] = useState<SortKey>("score")
  const heldRanks = useMemo(() => rows.reduce((n, r) => n + r.unlocks, 0), [rows])

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
      // In-game score this month. Ties (and everyone on zero) fall back to the
      // achievement score, so the tail of the board stays in a stable order.
      if (sort === "month") return b.monthScore - a.monthScore || b.score - a.score
      return b.score - a.score || a.name.localeCompare(b.name)
    })
  }, [rows, query, sort])

  return (
    <>
      <style>{PLAYERS_CSS}</style>

      <h1 className="text-3xl md:text-4xl font-bold glow-text mb-2" style={{ fontFamily: "var(--font-orbitron)" }}>
        PLAYERS
      </h1>
      <p className="text-[#8892a0] mb-6 max-w-2xl">
        Everyone on record, ranked by Achievement Score — every achievement rank they&apos;ve ever unlocked, weighted by how
        rare it is. Rarer ones are worth dramatically more, so the top of the board can&apos;t be farmed.
      </p>

      {/* The "look at all achievements" entry point. Full-width and above the
          board, because it's a destination rather than a row-level action. */}
      {/* The entry point to /achievements. It was a flat bar with a lucide trophy
          on it, which said nothing about what's behind it — so it now shows the
          thing itself: real crest emblems, the rarest ones the board actually
          holds, fanned out and lifting on hover, over a watermark of the rarest
          of them. The stat line gives a reason to click rather than a
          restatement of the label. */}
      <Link href="/achievements" className="pl-cta">
        <Emblem src={`/achievements/${CTA_WATERMARK}.svg`} className="pl-cta-mark" color="var(--color-primary)" />
        <span className="pl-cta-icon">
          <Trophy className="w-5 h-5" />
        </span>
        <span className="pl-cta-body">
          <strong>Browse all achievements</strong>
          <span>
            {ACHIEVEMENT_FAMILIES} families · {ONE_OF_ONES} one-of-ones · {heldRanks.toLocaleString()} ranks unlocked
            so far
          </span>
        </span>
        <span className="pl-cta-fan" aria-hidden>
          {CTA_CRESTS.map((c, i) => (
            <Emblem key={c.icon} src={`/achievements/${c.icon}.svg`} color={c.color} style={{ ["--i" as string]: i }} />
          ))}
        </span>
        <ArrowRight className="w-5 h-5 pl-cta-arrow" />
      </Link>

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
        {/* The same segmented rail the masthead and the Stats views use, so the
            whole site has one control and one motion for "pick a view". */}
        <SegmentedRail
          aria-label="Sort players"
          dense
          activeKey={sort}
          onSelect={(key) => setSort(key as SortKey)}
          segments={SORTS.map((s) => ({ key: s.key, label: s.label }))}
        />
      </div>

      <div className="pl-head" aria-hidden="true">
        <span>#</span>
        <span>Player</span>
        <span>Title</span>
        <span>Tier</span>
        <span>Form (last 5)</span>
        <span>Achievements</span>
        <span className="pl-head-score">
          {sort === "month" ? "Month" : sort === "form" ? "Win %" : sort === "tier" ? "Tier" : "Score"}
        </span>
      </div>

      <ul className="pl-list">
        {shown.map((row) => {
          const rank = rankById.get(row.id)!
          const accent = accentFor(row)
          return (
            <li key={row.id}>
              <Link
                href={`/player/${slug(row.name)}`}
                // The board lists the whole roster, and /player/[slug] renders
                // per request -- prefetching every row as it scrolled into view
                // was rendering profiles nobody had asked for.
                prefetch={false}
                className={`pl-row ${row.inactive ? "is-inactive" : ""}`}
                style={{ ["--accent" as string]: accent }}
                title={row.inactive ? `${row.name} — inactive` : undefined}
              >
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
                      {sort === "month" ? `${row.monthMatches} this month` : `${row.matches} matches`}
                    </span>
                  </span>
                </span>

                {/* The equipped title from the player's profile — not the rarest
                    achievement they hold, which is what this column used to show
                    and is a different thing entirely (it still drives the row's
                    accent). Coloured by the title's own rarity. */}
                <span
                  className="pl-title"
                  style={{ color: row.equippedTitle ? rarityColor(row.equippedTitle.rarity) : "var(--color-text-dim)" }}
                  title={row.equippedTitle?.title ?? undefined}
                >
                  {row.equippedTitle?.title ?? "—"}
                </span>

                <span className="pl-tier tabular-nums">T{row.tierValue}</span>

                <span className="pl-form">
                  <FormPips row={row} />
                </span>

                <span className="pl-crests">
                  <RarityBar row={row} />
                </span>

                <span className="pl-score">
                  {/* Sorting by a number you can't see is disorienting, so this
                      cell always shows the sort key itself, with the context that
                      makes it mean something. Under Form and Tier it used to show
                      the achievement score and rank count, which had nothing to do
                      with the order the board was in. */}
                  <b className="tabular-nums" style={{ color: accent }}>
                    {scoreCell(row, sort).value}
                  </b>
                  <span>{scoreCell(row, sort).note}</span>
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
          <span key={r} style={{ color: rarityColor(r) }}>
            {RARITY_META[r].label} {RARITY_POINTS[r]}
          </span>
        )).reduce<React.ReactNode[]>((out, el, i) => (i ? [...out, " · ", el] : [el]), [])}
      </p>
    </>
  )
}

const PLAYERS_CSS = `
.pl-cta{display:flex;align-items:center;gap:14px;padding:16px 18px;margin-bottom:24px;border:1px solid color-mix(in srgb, var(--color-border) 72%, var(--color-background));border-radius:10px;background:linear-gradient(90deg,color-mix(in srgb, var(--color-surface) 62%, var(--color-background)),color-mix(in srgb, var(--color-surface) 88%, var(--color-background)));transition:border-color .18s ease,transform .18s ease,box-shadow .18s ease}
.pl-cta:hover{border-color:var(--color-primary);transform:translateY(-2px);box-shadow:0 6px 24px color-mix(in srgb, var(--color-primary) 14%, transparent)}
.pl-cta:focus-visible{outline:2px solid var(--color-primary);outline-offset:3px}
.pl-cta-icon{display:flex;align-items:center;justify-content:center;width:42px;height:42px;border-radius:9px;background:rgba(102,252,241,.1);color:var(--color-primary);flex:0 0 auto}
.pl-cta-body{display:flex;flex-direction:column;gap:2px;flex:1;min-width:0}
.pl-cta-body strong{color:var(--color-text-bright);font-size:15px}
.pl-cta-body span{color:var(--color-text-dim);font-size:13px}
.pl-cta-arrow{color:var(--color-text-dim);flex:0 0 auto;transition:transform .18s ease,color .18s ease;z-index:1}
.pl-cta:hover .pl-cta-arrow{color:var(--color-primary);transform:translateX(3px)}

/* A crest bleeding off the right-hand edge, clipped by the CTA. Sits under
   everything and never moves — the fan in front of it does the moving. */
.pl-cta{position:relative;overflow:hidden}
.pl-cta-mark{position:absolute;right:-26px;top:-38px;width:170px;height:170px;opacity:.06;pointer-events:none}

/* Five crests, overlapped like a hand of cards. On hover they fan apart and
   lift in sequence, so the panel previews what's behind it instead of
   describing it. */
.pl-cta-fan{display:flex;align-items:center;flex:0 0 auto;padding-right:6px;z-index:1}
.pl-cta-fan > span{
  width:26px;height:26px;margin-left:-9px;
  transform:translateY(0) rotate(calc((var(--i) - 2) * 4deg));
  transition:transform .34s cubic-bezier(.62,.04,.31,1),margin-left .34s cubic-bezier(.62,.04,.31,1),opacity .2s ease;
  opacity:.75;
}
.pl-cta:hover .pl-cta-fan > span{
  margin-left:-2px;
  opacity:1;
  transform:translateY(calc(var(--i) * -1.5px)) rotate(calc((var(--i) - 2) * 7deg));
}
@media (max-width:860px){.pl-cta-fan{display:none}}
@media (prefers-reduced-motion:reduce){
  .pl-cta-fan > span,.pl-cta:hover .pl-cta-fan > span{transition:none;transform:none;margin-left:-6px}
}

.pl-controls{display:flex;flex-wrap:wrap;gap:12px;align-items:center;justify-content:space-between;margin-bottom:16px}
.pl-search{display:flex;align-items:center;gap:8px;padding:8px 12px;border:1px solid color-mix(in srgb, var(--color-border) 72%, var(--color-background));border-radius:8px;background:color-mix(in srgb, var(--color-surface) 62%, var(--color-background));flex:1;min-width:200px}
.pl-search input{background:transparent;border:0;outline:0;color:var(--color-text-bright);font-size:14px;width:100%}
.pl-search input::placeholder{color:color-mix(in srgb, var(--color-text-dim) 78%, var(--color-background))}
.pl-search:focus-within{border-color:var(--color-primary)}
.pl-head,.pl-row{display:grid;grid-template-columns:44px minmax(150px,1.3fr) minmax(120px,1.1fr) 52px minmax(104px,.7fr) minmax(100px,.7fr) 92px;gap:12px;align-items:center}
.pl-head{padding:0 14px 8px;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:color-mix(in srgb, var(--color-text-dim) 78%, var(--color-background))}
.pl-head-score{text-align:right}

.pl-list{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:6px}
.pl-row{padding:10px 14px;border:1px solid color-mix(in srgb, var(--color-border) 72%, var(--color-background));border-left:3px solid var(--accent);border-radius:8px;background:color-mix(in srgb, var(--color-surface) 62%, var(--color-background));transition:background .16s ease,transform .16s ease,border-color .16s ease}
.pl-row:hover{background:color-mix(in srgb, var(--color-surface) 88%, var(--color-background));transform:translateX(3px);border-color:var(--color-border);border-left-color:var(--accent)}
.pl-row:focus-visible{outline:2px solid var(--color-primary);outline-offset:2px}

.pl-rank{font-family:var(--font-orbitron);font-size:14px;color:var(--color-text-dim);text-align:center;border:1px solid color-mix(in srgb, var(--color-border) 72%, var(--color-background));border-radius:6px;padding:4px 0}
.pl-who{display:flex;align-items:center;gap:10px;min-width:0}
.pl-who-text{display:flex;flex-direction:column;min-width:0}
.pl-who-text strong{color:var(--color-text-bright);font-size:15px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pl-who-text span{font-size:11px;color:var(--color-text-dim)}
.pl-tier-inline{display:none;font-style:normal;color:var(--color-primary)}
.pl-title{font-size:12px;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pl-tier{font-family:var(--font-orbitron);font-size:13px;color:var(--color-primary);text-align:center}

/* Inactive players stay on the board — their score is still earned — but drop
   back so the active roster reads first. Hovering restores full opacity, so a
   dimmed row is never harder to actually read. */
.pl-row.is-inactive{opacity:.45;filter:saturate(.55)}
.pl-row.is-inactive:hover,.pl-row.is-inactive:focus-visible{opacity:1;filter:none}
.pl-score{display:flex;flex-direction:column;align-items:flex-end}
/* Oxanium, matching every figure on the Stats page. Orbitron is a display face
   — it reads as a logo at 19px, not as a number you compare down a column. */
.pl-score b{font-family:var(--font-mono);font-size:19px;line-height:1.1;font-variant-numeric:tabular-nums;letter-spacing:-0.01em}
.pl-score span{font-size:10px;color:var(--color-text-dim)}

.pl-key{margin-top:20px;font-size:11px;color:color-mix(in srgb, var(--color-text-dim) 78%, var(--color-background));text-align:center}

/* Below the table breakpoint the row becomes a two-line card: identity and score
   on top, form and crests beneath. The grid columns would be unreadable here. */
@media (max-width:860px){
  .pl-head{display:none}
  .pl-row{grid-template-columns:40px 1fr auto;grid-template-areas:"rank who score" ". title title" ". form form" ". crests crests";row-gap:6px}
  .pl-rank{grid-area:rank}
  .pl-who{grid-area:who}
  .pl-score{grid-area:score}
  .pl-title{grid-area:title;white-space:normal}
  .pl-form{grid-area:form}
  .pl-crests{grid-area:crests}
  .pl-tier{display:none}
  .pl-tier-inline{display:inline}
}
`
