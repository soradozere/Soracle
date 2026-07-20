"use client"

import { RARITY_META } from "@/lib/achievement-meta"
import { progressFor, type TitleLadder } from "@/lib/titles"

// Two progression bars on the profile: the month's seasonal ladder and the
// lifetime Achievement Score ladder. One bar per ladder, with the tiers marked
// along it — so a player can see both what they've banked and how far the next
// title is, without a separate legend.

const fmt = (n: number) => n.toLocaleString()

function Ladder({ ladder, value, caption }: { ladder: TitleLadder; value: number; caption: string }) {
  const p = progressFor(ladder, value)
  const top = ladder.tiers[ladder.tiers.length - 1].threshold
  const accent = p.current ? RARITY_META[p.current.rarity].color : "#3d4855"

  return (
    <div className="tp-ladder">
      <div className="tp-head">
        <div className="tp-head-left">
          <span className="tp-label">{caption}</span>
          <strong className="tp-current" style={{ color: accent }}>
            {p.current ? p.current.title : "Unranked"}
          </strong>
        </div>
        <div className="tp-head-right">
          <span className="tp-value">{fmt(value)}</span>
          {p.next ? (
            <span className="tp-next">{fmt(p.next.threshold - value)} to {p.next.title}</span>
          ) : (
            <span className="tp-next tp-maxed">Ladder complete</span>
          )}
        </div>
      </div>

      <div className="tp-track">
        <div className="tp-fill" style={{ width: `${p.pct * 100}%`, background: accent, boxShadow: `0 0 10px ${accent}80` }} />
        {/* Tier markers sit at their true position on the track, so the spacing
            shows how the thresholds actually escalate rather than evenly. */}
        {ladder.tiers.map((t) => {
          const got = value >= t.threshold
          const c = RARITY_META[t.rarity].color
          return (
            <span
              key={t.id}
              className={`tp-node ${got ? "is-got" : ""}`}
              style={{ left: `${(t.threshold / top) * 100}%`, borderColor: got ? c : "#3d4855", background: got ? c : "#0b0c10" }}
              title={`${t.title} — ${fmt(t.threshold)}`}
            />
          )
        })}
      </div>

      <div className="tp-ticks">
        {ladder.tiers.map((t) => {
          const got = value >= t.threshold
          return (
            <span
              key={t.id}
              className={`tp-tick ${got ? "is-got" : ""}`}
              style={{ left: `${(t.threshold / top) * 100}%`, color: got ? RARITY_META[t.rarity].color : "#5a6472" }}
            >
              {t.title}
            </span>
          )
        })}
      </div>
    </div>
  )
}

export function TitleProgression({
  seasonName,
  seasonLadder,
  monthScore,
  scoreLadder,
  achievementScore,
}: {
  seasonName: string | null
  seasonLadder: TitleLadder | null
  monthScore: number
  scoreLadder: TitleLadder
  achievementScore: number
}) {
  return (
    <>
      <style>{TP_CSS}</style>
      <div className="tp-wrap">
        {seasonLadder ? (
          <Ladder ladder={seasonLadder} value={monthScore} caption={`This season · ${seasonName}`} />
        ) : (
          <p className="tp-none">No season running this month.</p>
        )}
        <Ladder ladder={scoreLadder} value={achievementScore} caption="All-time · Achievement Score" />
      </div>
    </>
  )
}

const TP_CSS = `
.tp-wrap{display:flex;flex-direction:column;gap:26px}
.tp-none{color:#8892a0;font-size:13px;margin:0}

.tp-head{display:flex;align-items:baseline;justify-content:space-between;gap:12px;margin-bottom:10px;flex-wrap:wrap}
.tp-head-left{display:flex;align-items:baseline;gap:10px;min-width:0}
.tp-label{font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#8892a0;white-space:nowrap}
.tp-current{font-family:var(--font-orbitron);font-size:17px;line-height:1}
.tp-head-right{display:flex;align-items:baseline;gap:10px}
.tp-value{font-family:var(--font-orbitron);font-size:15px;color:#e8ecf1;font-variant-numeric:tabular-nums}
.tp-next{font-size:11px;color:#8892a0;font-variant-numeric:tabular-nums}
.tp-maxed{color:#66fcf1}

.tp-track{position:relative;height:8px;border-radius:999px;background:#0b0c10;border:1px solid #2a3542}
.tp-fill{position:absolute;left:0;top:0;bottom:0;border-radius:999px;transition:width .5s ease}
.tp-node{position:absolute;top:50%;width:11px;height:11px;margin-left:-5.5px;border-radius:50%;border:2px solid;transform:translateY(-50%);transition:background .3s ease,border-color .3s ease}
.tp-node.is-got{box-shadow:0 0 8px currentColor}

/* Labels are absolutely positioned to match their node, then nudged left by half
   their own width via the translate — keeps each name centred under its marker
   at any threshold spacing. */
.tp-ticks{position:relative;height:16px;margin-top:8px}
.tp-tick{position:absolute;top:0;transform:translateX(-50%);font-size:10px;letter-spacing:.04em;text-transform:uppercase;white-space:nowrap}
.tp-tick.is-got{font-weight:700}
/* The top tier sits at 100%, where centring would hang half the label off the
   right edge — pull it fully inside instead. */
.tp-tick:last-child{transform:translateX(-100%)}

@media (max-width:640px){
  .tp-tick{font-size:9px}
  .tp-tick:not(.is-got):not(:last-child){display:none}
}
`
