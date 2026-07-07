"use client"

import { Lock } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RARITY_META } from "@/lib/achievement-meta"
import type { AchievementView } from "@/lib/achievements"

// Horizontal, scrollable strip of rarity-tiered achievement crests for the
// Career section. Earned crests glow by rarity (epic/legendary also pulse,
// legendary gets a holographic sheen sweep); locked crests dim with a padlock.
// Tiered families render as one crest that levels up (rank numeral + pips).
// Icons are single-colour SVGs at /badges/<icon>.svg, mask-tinted like badges.

const ROMAN = ["I", "II", "III", "IV", "V", "VI"]
const roman = (n: number) => ROMAN[n - 1] ?? String(n)

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""

function CrestIcon({ icon, color, locked }: { icon: string; color: string; locked: boolean }) {
  const mask = `url(/achievements/${icon}.svg) center / contain no-repeat`
  return (
    <span
      aria-hidden
      className="ach-ico"
      style={{
        WebkitMask: mask,
        mask,
        backgroundColor: locked ? "#5b6675" : color,
        filter: locked ? "none" : `drop-shadow(0 0 4px ${color}88)`,
      }}
    />
  )
}

function Crest({ a }: { a: AchievementView }) {
  const color = RARITY_META[a.rarity].color
  const pending = a.pending && !a.earned
  const legendaryEarned = a.earned && a.rarity === "legendary"
  const classes = [
    "ach-tile",
    a.earned ? "earned" : "locked",
    a.rarity,
    a.earned && (a.rarity === "epic" || a.rarity === "legendary") ? "pulse" : "",
    pending ? "pending" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={classes} style={{ "--rc": color } as React.CSSProperties}>
          <div className="ach-ring" />
          <div className="ach-bodyfill" />
          {legendaryEarned && <div className="ach-sheen" />}
          <div className="ach-face">
            {a.tiered && a.earned && <div className="ach-rank">{roman(a.rank)}</div>}
            <CrestIcon icon={a.icon} color={color} locked={!a.earned} />
            <div className="ach-name">{a.title}</div>
            <div className="ach-cond">{a.condition}</div>
            {a.tiered && (
              <div className="ach-pips">
                {Array.from({ length: a.totalRanks }).map((_, i) => (
                  <i key={i} className={i < a.rank ? "on" : ""} />
                ))}
              </div>
            )}
            {a.progressPct != null && (
              <div className="ach-prog">
                <div className="ach-bar" style={{ width: `${Math.round(a.progressPct * 100)}%` }} />
              </div>
            )}
            {pending ? (
              <div className="ach-next data">tracking from now</div>
            ) : (
              a.progressLabel && <div className="ach-next">{a.progressLabel}</div>
            )}
          </div>
          {!a.earned && (
            <div className="ach-lock">
              <Lock className="w-6 h-6" strokeWidth={2.5} />
            </div>
          )}
          <div className="ach-tag">
            {RARITY_META[a.rarity].label}
            {a.tiered && a.earned ? ` · ${roman(a.rank)}` : ""}
          </div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="bg-[#1f2833] border border-[#66fcf1]/30 text-[#c5c6c7] text-xs max-w-64">
        <div className="font-bold text-[#e6edf3]">
          {a.title}
          {a.tiered ? ` ${roman(Math.max(1, a.rank))}` : ""}
        </div>
        <div className="mt-0.5">{a.condition}</div>
        <div className="mt-1 text-[#8892a0]">
          {a.earned
            ? `Earned ${fmtDate(a.earnedDate)}${a.tiered ? ` · rank ${a.rank}/${a.totalRanks}` : ""}`
            : pending
              ? "Starts tracking once scoreboards carry this stat"
              : a.progressLabel
                ? `Progress: ${a.progressLabel}`
                : "Locked"}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export function AchievementsStrip({ achievements }: { achievements: AchievementView[] }) {
  if (!achievements.length) return null
  const earned = achievements.filter((a) => a.earned).length

  return (
    <div className="mt-4">
      <style>{ACH_CSS}</style>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] uppercase tracking-wider text-[#8892a0] font-bold">Achievements</span>
        <span className="text-[10px] font-mono text-[#66fcf1]">
          {earned} / {achievements.length} earned
        </span>
      </div>
      <div className="ach-strip">
        {achievements.map((a) => (
          <Crest key={a.id} a={a} />
        ))}
      </div>
    </div>
  )
}

const ACH_CSS = `
.ach-strip{display:flex;gap:14px;overflow-x:auto;padding:10px 2px 14px;scroll-snap-type:x proximity;scrollbar-width:thin;scrollbar-color:#2a3542 #0b0c10}
.ach-strip::-webkit-scrollbar{height:6px}
.ach-strip::-webkit-scrollbar-track{background:#0b0c10;border-radius:999px;margin:0 4px}
.ach-strip::-webkit-scrollbar-thumb{background:#2a3542;border-radius:999px;border:1px solid #0b0c10}
.ach-strip::-webkit-scrollbar-thumb:hover{background:#3d4855}
.ach-tile{position:relative;flex:0 0 auto;width:150px;height:176px;scroll-snap-align:start;--rc:#3ddc84}
.ach-tile .ach-ring,.ach-tile .ach-bodyfill,.ach-tile .ach-sheen{position:absolute;clip-path:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.ach-ring{inset:0;background:linear-gradient(150deg,color-mix(in srgb,var(--rc) 90%,#fff) 0%,var(--rc) 45%,color-mix(in srgb,var(--rc) 55%,#000) 100%)}
.ach-bodyfill{inset:5px;background:radial-gradient(120% 90% at 30% 12%,color-mix(in srgb,var(--rc) 22%,transparent) 0%,transparent 55%),linear-gradient(180deg,#182231 0%,#10161f 48%,#0a0e14 100%)}
.ach-face{position:absolute;inset:5px;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 12px;gap:3px;overflow:hidden}
.ach-ico{width:34px;height:34px;display:block}
.ach-name{font-size:12px;font-weight:800;letter-spacing:.02em;margin-top:3px;color:#e6edf3;line-height:1.1}
.ach-cond{font-size:9px;line-height:1.25;color:#7d8896;font-weight:500}
.ach-rank{position:absolute;top:12px;right:20px;font-size:11px;font-weight:900;font-style:italic;color:var(--rc);text-shadow:0 0 6px color-mix(in srgb,var(--rc) 60%,transparent)}
.ach-pips{display:flex;gap:4px;margin-top:2px}
.ach-pips i{width:6px;height:6px;border-radius:50%;background:#2a3542}
.ach-pips i.on{background:var(--rc);box-shadow:0 0 5px var(--rc)}
.ach-prog{width:74px;height:4px;border-radius:3px;background:#1a2430;margin-top:5px;overflow:hidden}
.ach-bar{height:100%;background:linear-gradient(90deg,color-mix(in srgb,var(--rc) 70%,#fff),var(--rc))}
.ach-next{font-size:8.5px;color:#7d8896;margin-top:3px;font-weight:600;letter-spacing:.02em}
.ach-next.data{color:color-mix(in srgb,var(--rc) 78%,#fff)}
.ach-tag{position:absolute;bottom:-3px;left:50%;transform:translateX(-50%);font-size:8px;font-weight:800;letter-spacing:.1em;padding:2px 9px;border-radius:999px;white-space:nowrap;background:#0b1017;border:1px solid var(--rc);color:color-mix(in srgb,var(--rc) 80%,#fff);box-shadow:0 0 8px color-mix(in srgb,var(--rc) 40%,transparent)}
.ach-tile.earned .ach-ring{filter:drop-shadow(0 0 9px color-mix(in srgb,var(--rc) 65%,transparent)) drop-shadow(0 0 20px color-mix(in srgb,var(--rc) 32%,transparent))}
.ach-tile.pulse{animation:achPulse 3s ease-in-out infinite}
@keyframes achPulse{0%,100%{filter:none}50%{filter:brightness(1.09)}}
.ach-sheen{inset:5px;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.5) 47%,rgba(255,255,255,.04) 55%,transparent 70%);background-size:250% 250%;mix-blend-mode:overlay;animation:achSweep 3.6s linear infinite;pointer-events:none}
@keyframes achSweep{0%{background-position:150% 0}100%{background-position:-90% 0}}
.ach-tile.locked{filter:grayscale(.85);opacity:.6}
.ach-tile.locked .ach-bodyfill{background:linear-gradient(180deg,#141a22,#0a0e13)}
.ach-tile.locked .ach-ring{background:linear-gradient(150deg,#33404e,#1a222c)}
.ach-tile.locked .ach-tag{border-color:#2a3542;color:#5b6675;box-shadow:none;background:#0b0f14}
.ach-tile.pending{opacity:.74}
.ach-lock{position:absolute;top:50%;left:50%;transform:translate(-50%,-64%);color:#c5c6c7;filter:drop-shadow(0 2px 4px #000);z-index:3}
`
