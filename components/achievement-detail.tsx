import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Crest, CrestStyles } from "@/components/achievement-crest"
import { fmtDate, roman, slug } from "@/lib/achievement-format"
import { rarityColor, rarityLabel } from "@/lib/achievement-pages"
import type { AchievementView } from "@/lib/achievements"
import type { Rarity } from "@/lib/achievement-meta"

// One achievement's page: what it is, the rank ladder, and who has unlocked it in
// what order. Tiered families list each rank separately, highest first — a player
// who climbed I→III appears in all three, each time in that rank's own chronology.

export interface HolderRow {
  playerName: string
  date: string
  matchId: string
}

export interface RankBlock {
  rank: number
  title: string
  rarity: Rarity
  requirement: string
  holders: HolderRow[]
}

const CATEGORY_LABEL = { match: "Single match", career: "Career total", streak: "Streak" } as const

const ord = (n: number) => {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

function HolderTable({ holders }: { holders: HolderRow[] }) {
  if (!holders.length) {
    return <p className="ach-empty">Nobody has reached this yet. Be the first.</p>
  }
  return (
    <div className="ach-tw">
      <table className="ach-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Player</th>
            <th>Earned</th>
          </tr>
        </thead>
        <tbody>
          {holders.map((h, i) => (
            <tr key={`${h.playerName}-${h.matchId}`}>
              <td className="ach-ord">{ord(i + 1)}</td>
              <td>
                <Link href={`/player/${slug(h.playerName)}`} className="ach-who">
                  {h.playerName}
                </Link>
              </td>
              <td className="ach-dim">{fmtDate(h.date)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function AchievementDetail({
  view,
  category,
  tiered,
  blocks,
  holderCount,
  unlockCount,
}: {
  view: AchievementView
  category: keyof typeof CATEGORY_LABEL
  tiered: boolean
  blocks: RankBlock[]
  holderCount: number
  unlockCount: number
}) {
  return (
    <div className="relative z-10">
      <CrestStyles />
      <style>{DETAIL_CSS}</style>

      <Link href="/achievements" className="ach-back">
        <ArrowLeft className="w-4 h-4" />
        All achievements
      </Link>

      <div className="ach-head">
        <Crest a={view} showProgress={false} />
        <div>
          <p className="ach-eyebrow">{CATEGORY_LABEL[category]}</p>
          <h1 className="ach-title">{view.title}</h1>
          <p className="text-[#8892a0] max-w-[56ch]">{view.condition}</p>
          <p className="ach-statline">
            <b>{holderCount}</b> {holderCount === 1 ? "player holds" : "players hold"} this
            {tiered ? (
              <>
                {" · "}
                <b>{unlockCount}</b> total rank unlocks
              </>
            ) : null}
          </p>
        </div>
      </div>

      {tiered ? (
        <>
          <h2 className="ach-h2">Rank ladder</h2>
          <div className="ach-tw">
            <table className="ach-table">
              <thead>
                <tr>
                  <th>Rank</th>
                  <th>Name</th>
                  <th className="ach-num">Needs</th>
                  <th>Rarity</th>
                  <th className="ach-num">Reached</th>
                </tr>
              </thead>
              <tbody>
                {blocks
                  .slice()
                  .reverse()
                  .map((b) => (
                    <tr key={b.rank}>
                      <td className="ach-rk" style={{ color: rarityColor(b.rarity) }}>
                        {roman(b.rank)}
                      </td>
                      <td>{b.title}</td>
                      <td className="ach-num">{b.requirement}</td>
                      <td>
                        <span className="ach-pill" style={{ "--rc": rarityColor(b.rarity) } as React.CSSProperties}>
                          {rarityLabel(b.rarity)}
                        </span>
                      </td>
                      <td className="ach-num">{b.holders.length}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>

          <h2 className="ach-h2">Unlock order · by rank</h2>
          {blocks
            .slice()
            .reverse()
            .map((b) => (
              <section key={b.rank} className="ach-rank-block">
                <div className="ach-rank-head" style={{ "--rc": rarityColor(b.rarity) } as React.CSSProperties}>
                  <span className="ach-rank-num">{roman(b.rank)}</span>
                  <span className="ach-rank-name">{b.title}</span>
                  <span className="ach-pill" style={{ "--rc": rarityColor(b.rarity) } as React.CSSProperties}>
                    {rarityLabel(b.rarity)}
                  </span>
                  <span className="ach-rank-need">{b.requirement}</span>
                  <span className="ach-rank-count">
                    {b.holders.length} {b.holders.length === 1 ? "player" : "players"}
                  </span>
                </div>
                <HolderTable holders={b.holders} />
              </section>
            ))}
        </>
      ) : (
        <>
          <h2 className="ach-h2">Unlock order</h2>
          <HolderTable holders={blocks[0]?.holders ?? []} />
        </>
      )}
    </div>
  )
}

const DETAIL_CSS = `
.ach-back{display:inline-flex;align-items:center;gap:8px;font-size:13px;color:#8892a0;text-decoration:none;margin-bottom:18px}
.ach-back:hover{color:#66fcf1}
.ach-head{display:flex;gap:28px;align-items:center;flex-wrap:wrap;padding:8px 0 4px}
.ach-eyebrow{font-size:10px;letter-spacing:.18em;text-transform:uppercase;color:#66fcf1;font-weight:800;margin:0 0 6px}
.ach-title{font-family:var(--font-orbitron),sans-serif;font-size:clamp(22px,4vw,30px);letter-spacing:.05em;text-transform:uppercase;font-weight:800;color:#e6edf3;margin:0 0 6px;text-wrap:balance}
.ach-statline{margin-top:12px;font-size:13px;color:#8892a0}
.ach-statline b{color:#e6edf3;font-family:ui-monospace,SFMono-Regular,Menlo,monospace}
.ach-h2{font-family:var(--font-orbitron),sans-serif;font-size:13px;letter-spacing:.16em;text-transform:uppercase;color:#8892a0;font-weight:800;margin:34px 0 10px}

.ach-tw{overflow-x:auto;border:1px solid #2a3542;border-radius:8px;background:#151b24}
.ach-table{border-collapse:collapse;width:100%;font-size:13px;min-width:420px}
.ach-table th{text-align:left;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#8892a0;padding:9px 14px;border-bottom:1px solid #3d4855;white-space:nowrap;font-weight:700}
.ach-table td{padding:9px 14px;border-top:1px solid #2a3542;color:#c5c6c7}
.ach-table tbody tr:first-child td{border-top:0}
.ach-num{text-align:right;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-variant-numeric:tabular-nums}
.ach-ord{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;color:#66fcf1;font-weight:700;width:64px}
.ach-who{font-weight:700;color:#e6edf3;text-decoration:none}
.ach-who:hover{color:#66fcf1}
.ach-rk{font-style:italic;font-weight:800;width:56px}
.ach-dim{color:#8892a0}
.ach-empty{text-align:center;color:#8892a0;padding:22px;border:1px dashed #2a3542;border-radius:8px;font-size:13px;margin:0}
.ach-pill{font-size:10px;font-weight:800;letter-spacing:.06em;padding:2px 9px;border-radius:999px;border:1px solid var(--rc);color:color-mix(in srgb,var(--rc) 82%,#fff);white-space:nowrap}

.ach-rank-block{margin-bottom:16px}
.ach-rank-head{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:0 2px 8px}
.ach-rank-num{font-family:var(--font-orbitron),sans-serif;font-size:17px;font-weight:800;font-style:italic;color:var(--rc);text-shadow:0 0 8px color-mix(in srgb,var(--rc) 55%,transparent);min-width:26px}
.ach-rank-name{font-weight:700;font-size:14px;color:#e6edf3}
.ach-rank-need{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:11.5px;color:#8892a0;font-variant-numeric:tabular-nums}
.ach-rank-count{margin-left:auto;font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:700;color:#8892a0}
`
