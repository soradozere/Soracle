"use client"

import { Lock } from "lucide-react"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { RARITY_META } from "@/lib/achievement-meta"
import type { AchievementView } from "@/lib/achievements"

// Horizontal, scrollable strip of rarity-tiered achievement crests for the
// Career section. Each earned tier has one tell, escalating with rarity:
//   common     nothing (that is the point of common)
//   rare       a scan line passing down the face, and a half-strength glow
//   epic       a drifting inner nebula + rank pips that charge in sequence
//   legendary  the holo-sheen sweep + specular flares catching the vertices
//   mythic     embers rising, a comet orbiting the rim, a guttering glow
//   oneofone   an OCTAGON, a turning prismatic ring, and sparkles
// Locked crests dim with a padlock. Tiered families render as one crest that
// levels up (rank numeral + pips). Icons are single-colour SVGs at
// /achievements/<icon>.svg, mask-tinted like badges.
//
// GLOW: `clip-path` and `mask` are both applied AFTER `filter`, so a drop-shadow
// declared on the same element as the clip is computed and then erased — it never
// paints a pixel. Both the ring glow and the icon glow used to do exactly that.
// Every glow here therefore lives on an UNCLIPPED PARENT of the clipped shape.
// Don't fold them back together.
//
// Every animation below moves only `transform` or `opacity` (the compositor
// handles those off the main thread); the sole exception is the legendary sheen,
// which animates `background-position` and always has.

const ROMAN = ["I", "II", "III", "IV", "V", "VI"]
const roman = (n: number) => ROMAN[n - 1] ?? String(n)

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : ""

const rep = (n: number) => Array.from({ length: n })

// The glow lives on this wrapper, NOT on the mask-clipped span inside it.
function CrestIcon({ icon, color, locked }: { icon: string; color: string; locked: boolean }) {
  const mask = `url(/achievements/${icon}.svg) center / contain no-repeat`
  return (
    <span
      aria-hidden
      className="ach-icow"
      style={{ filter: locked ? "none" : `drop-shadow(0 0 4px ${color}99)` }}
    >
      <span className="ach-ico" style={{ WebkitMask: mask, mask, backgroundColor: locked ? "#5b6675" : color }} />
    </span>
  )
}

function Crest({ a }: { a: AchievementView }) {
  const color = RARITY_META[a.rarity].color
  const pending = a.pending && !a.earned
  const earned = a.earned
  const is = (r: AchievementView["rarity"]) => earned && a.rarity === r
  // Common stays bare; everything above it glows, rare at half strength (CSS).
  const glows = earned && a.rarity !== "common"
  const classes = [
    "ach-tile",
    earned ? "earned" : "locked",
    a.rarity,
    earned && (a.rarity === "epic" || a.rarity === "legendary" || a.rarity === "mythic") ? "pulse" : "",
    pending ? "pending" : "",
  ]
    .filter(Boolean)
    .join(" ")

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className={classes} style={{ "--rc": color } as React.CSSProperties}>
          {glows && (
            <div className="ach-glow" aria-hidden>
              <i />
            </div>
          )}
          <div className="ach-ring" />
          <div className="ach-bodyfill" />
          {is("rare") && (
            <div className="ach-scan" aria-hidden>
              <i />
            </div>
          )}
          {is("epic") && (
            <div className="ach-neb" aria-hidden>
              <i />
            </div>
          )}
          {is("legendary") && <div className="ach-sheen" aria-hidden />}
          {is("mythic") && (
            <div className="ach-embers" aria-hidden>
              {rep(6).map((_, i) => (
                <i key={i} />
              ))}
            </div>
          )}
          <div className="ach-face">
            {a.tiered && earned && <div className="ach-rank">{roman(a.rank)}</div>}
            <CrestIcon icon={a.icon} color={color} locked={!earned} />
            <div className="ach-name">{a.title}</div>
            <div className="ach-cond">{a.condition}</div>
            {a.tiered && (
              <div className="ach-pips">
                {rep(a.totalRanks).map((_, i) => (
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
          {is("legendary") && (
            <div className="ach-flares" aria-hidden>
              {rep(3).map((_, i) => (
                <i key={i} />
              ))}
            </div>
          )}
          {is("mythic") && <div className="ach-comet" aria-hidden />}
          {is("oneofone") && (
            <div className="ach-sparks" aria-hidden>
              {rep(8).map((_, i) => (
                <i key={i} />
              ))}
            </div>
          )}
          {!earned && (
            <div className="ach-lock">
              <Lock className="w-3.5 h-3.5" strokeWidth={2.5} />
            </div>
          )}
          <div className="ach-tag">
            {RARITY_META[a.rarity].label}
            {a.tiered && earned ? ` · ${roman(a.rank)}` : ""}
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
          {a.rarity === "oneofone"
            ? `The only player who will ever hold this · Claimed ${fmtDate(a.earnedDate)}`
            : earned
              ? `${a.earnedRequirement ? `Reached ${a.earnedRequirement} · ` : ""}Earned ${fmtDate(a.earnedDate)}${a.tiered ? ` · rank ${a.rank}/${a.totalRanks}` : ""}`
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
/* The (now real) glow needs somewhere to bloom, and overflow clips at the PADDING
   box — so the strip is padded on all four sides. The negative inline margin pulls
   it back out into the parent's p-4, which keeps the tiles aligned exactly where
   they were while giving the glow 16px of room instead of 4. overflow-x on a flex
   row also makes overflow-y "auto", hence the generous top/bottom.
   scroll-padding-inline insets the snap-port to match: without it scroll-snap-align
   pins the first tile to the border edge, force-scrolling past the left padding and
   clipping the very glow it was added for. */
.ach-strip{display:flex;gap:14px;overflow-x:auto;padding:26px 16px 30px;margin:0 -16px;scroll-snap-type:x proximity;scroll-padding-inline:16px;scrollbar-width:thin;scrollbar-color:#2a3542 #0b0c10}
.ach-strip::-webkit-scrollbar{height:6px}
.ach-strip::-webkit-scrollbar-track{background:#0b0c10;border-radius:999px;margin:0 4px}
.ach-strip::-webkit-scrollbar-thumb{background:#2a3542;border-radius:999px;border:1px solid #0b0c10}
.ach-strip::-webkit-scrollbar-thumb:hover{background:#3d4855}
/* --ach-shape is the crest silhouette. One-of-one overrides it to an octagon, and
   every clipped layer follows automatically. */
.ach-tile{position:relative;flex:0 0 auto;width:150px;height:176px;scroll-snap-align:start;--rc:#3ddc84;--ach-shape:polygon(50% 0,100% 25%,100% 75%,50% 100%,0 75%,0 25%)}
.ach-tile .ach-ring,.ach-tile .ach-bodyfill,.ach-tile .ach-sheen{position:absolute}
.ach-tile .ach-ring,.ach-tile .ach-bodyfill,.ach-tile .ach-sheen,.ach-tile .ach-glow i,.ach-tile .ach-scan,.ach-tile .ach-neb,.ach-tile .ach-embers{clip-path:var(--ach-shape)}
.ach-ring{inset:0;z-index:1;background:linear-gradient(150deg,color-mix(in srgb,var(--rc) 90%,#fff) 0%,var(--rc) 45%,color-mix(in srgb,var(--rc) 55%,#000) 100%)}
.ach-bodyfill{inset:5px;z-index:2;background:radial-gradient(120% 90% at 30% 12%,color-mix(in srgb,var(--rc) 22%,transparent) 0%,transparent 55%),linear-gradient(180deg,#182231 0%,#10161f 48%,#0a0e14 100%)}
.ach-face{position:absolute;inset:5px;z-index:4;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:0 12px;gap:3px;overflow:hidden}
.ach-icow{display:block;width:34px;height:34px}
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
.ach-tag{position:absolute;bottom:-3px;left:50%;transform:translateX(-50%);z-index:7;font-size:8px;font-weight:800;letter-spacing:.1em;padding:2px 9px;border-radius:999px;white-space:nowrap;background:#0b1017;border:1px solid var(--rc);color:color-mix(in srgb,var(--rc) 80%,#fff);box-shadow:0 0 8px color-mix(in srgb,var(--rc) 40%,transparent)}
.ach-tile.pulse{animation:achPulse 3s ease-in-out infinite}
@keyframes achPulse{0%,100%{filter:none}50%{filter:brightness(1.09)}}

/* ---- glow: filter on the UNCLIPPED wrapper, shape on the child. See header. ---- */
.ach-glow{position:absolute;inset:0;z-index:0;pointer-events:none;filter:drop-shadow(0 0 9px color-mix(in srgb,var(--rc) 70%,transparent)) drop-shadow(0 0 20px color-mix(in srgb,var(--rc) 34%,transparent))}
.ach-glow i{position:absolute;inset:0;display:block;background:var(--rc)}
/* Rare glows at half strength — enough to lift it off common, not enough to reach epic. */
.ach-tile.rare .ach-glow{filter:drop-shadow(0 0 6px color-mix(in srgb,var(--rc) 38%,transparent)) drop-shadow(0 0 14px color-mix(in srgb,var(--rc) 16%,transparent))}

/* ---- rare: a scan line passes down the face ---- */
.ach-scan{position:absolute;inset:5px;z-index:3;pointer-events:none;overflow:hidden}
.ach-scan i{position:absolute;left:0;right:0;top:0;height:26px;display:block;background:linear-gradient(180deg,transparent,rgba(120,180,255,.14) 55%,rgba(165,208,255,.32) 80%,transparent);transform:translateY(-30px);animation:achScan 5.2s cubic-bezier(.4,0,.6,1) infinite}
@keyframes achScan{0%{transform:translateY(-30px)}55%,100%{transform:translateY(180px)}}

/* ---- epic: drifting nebula + pips charging in sequence ---- */
.ach-neb{position:absolute;inset:5px;z-index:3;pointer-events:none;overflow:hidden}
.ach-neb i{position:absolute;left:-25%;top:-25%;width:150%;height:150%;display:block;background:radial-gradient(closest-side,rgba(192,132,252,.36) 0%,rgba(168,85,247,.14) 45%,transparent 72%);animation:achNeb 9s ease-in-out infinite}
@keyframes achNeb{0%,100%{transform:translate3d(-7%,-5%,0) scale(1)}50%{transform:translate3d(9%,7%,0) scale(1.28)}}
.ach-tile.epic.earned .ach-pips i.on{animation:achCharge 2.4s ease-in-out infinite}
.ach-tile.epic.earned .ach-pips i.on:nth-child(2){animation-delay:.28s}
.ach-tile.epic.earned .ach-pips i.on:nth-child(3){animation-delay:.56s}
.ach-tile.epic.earned .ach-pips i.on:nth-child(4){animation-delay:.84s}
@keyframes achCharge{0%,62%,100%{transform:scale(1);opacity:.8}20%{transform:scale(1.5);opacity:1}}

/* ---- legendary: the holo sheen, plus flares catching the vertices ---- */
.ach-sheen{inset:5px;z-index:3;background:linear-gradient(115deg,transparent 30%,rgba(255,255,255,.5) 47%,rgba(255,255,255,.04) 55%,transparent 70%);background-size:250% 250%;mix-blend-mode:overlay;animation:achSweep 3.6s linear infinite;pointer-events:none}
@keyframes achSweep{0%{background-position:150% 0}100%{background-position:-90% 0}}
/* A white star on a bright gold ring has no contrast on its own, so the halo goes
   on the wrapper — the star itself is clipped, which would erase a filter here. */
.ach-flares{position:absolute;inset:0;z-index:5;pointer-events:none;filter:drop-shadow(0 0 5px rgba(255,255,255,.95)) drop-shadow(0 0 13px rgba(245,197,66,.9))}
.ach-flares i{position:absolute;width:28px;height:28px;margin:-14px 0 0 -14px;opacity:0;display:block;background:radial-gradient(closest-side,#fff 0%,#fff 34%,#ffe9a3 62%,transparent 100%);clip-path:polygon(50% 0,56% 44%,100% 50%,56% 56%,50% 100%,44% 56%,0 50%,44% 44%);animation:achFlare 4.2s ease-out infinite}
@keyframes achFlare{0%,26%,100%{opacity:0;transform:scale(.3)}5%{opacity:1;transform:scale(1.15)}15%{opacity:.25;transform:scale(.6)}}
.ach-flares i:nth-child(1){top:0;left:50%;animation-delay:0s}
.ach-flares i:nth-child(2){top:25%;left:100%;animation-delay:1.4s}
.ach-flares i:nth-child(3){top:75%;left:0;animation-delay:2.8s}

/* ---- mythic: a cold fire. Ring kept pearl-silver, not white, so the comet reads. ---- */
.ach-tile.mythic{--rc:#eaeeff}
.ach-tile.mythic.earned .ach-ring{background:linear-gradient(150deg,#cfd7f0 0%,#b3bfe2 32%,#c9bce4 54%,#aec4ea 74%,#95a4cf 100%)}
.ach-tile.mythic.earned .ach-glow{filter:drop-shadow(0 0 11px rgba(226,232,255,.8)) drop-shadow(0 0 24px rgba(196,172,255,.5));animation:achGutter 2.4s ease-in-out infinite}
.ach-tile.mythic.earned .ach-glow i{background:#cfd7f0}
@keyframes achGutter{0%,100%{opacity:.72}38%{opacity:1}61%{opacity:.6}}
.ach-tile.mythic.earned .ach-bodyfill{background:radial-gradient(130% 100% at 30% 8%,rgba(226,230,255,.28) 0%,transparent 52%),linear-gradient(180deg,#1a2030 0%,#12141f 50%,#0b0d15 100%)}
.ach-tile.mythic.earned .ach-name{color:#f4f6ff;text-shadow:0 0 8px rgba(226,230,255,.5)}
.ach-tile.mythic.earned .ach-tag{background:#0c0e17;border-color:#dfe4ff;color:#f4f6ff;box-shadow:0 0 12px rgba(226,230,255,.5)}
.ach-embers{position:absolute;inset:5px;z-index:3;pointer-events:none;overflow:hidden}
.ach-embers i{position:absolute;bottom:-8px;width:4px;height:4px;border-radius:50%;display:block;background:#fff;box-shadow:0 0 4px 1px #fff,0 0 12px 3px rgba(190,168,255,.85);opacity:0;animation:achRise 3.6s ease-in infinite}
@keyframes achRise{0%{opacity:0;transform:translate3d(0,0,0) scale(.5)}12%{opacity:1}70%{opacity:.75}100%{opacity:0;transform:translate3d(var(--dx,6px),-150px,0) scale(.2)}}
.ach-embers i:nth-child(1){left:22%;--dx:9px;animation-delay:0s}
.ach-embers i:nth-child(2){left:41%;--dx:-7px;animation-delay:.5s}
.ach-embers i:nth-child(3){left:58%;--dx:5px;animation-delay:1.05s}
.ach-embers i:nth-child(4){left:73%;--dx:-10px;animation-delay:1.6s}
.ach-embers i:nth-child(5){left:33%;--dx:12px;animation-delay:2.2s}
.ach-embers i:nth-child(6){left:66%;--dx:-4px;animation-delay:2.8s}
/* offset-path traces the six edges; offset-rotate:auto keeps the streak tangent so
   it bends around each corner. Hardcoded to the hexagon at 150x176 — a crest with a
   different silhouette (see one-of-one) cannot reuse this. */
.ach-comet{position:absolute;top:0;left:0;width:56px;height:11px;border-radius:11px;pointer-events:none;z-index:5;mix-blend-mode:screen;background:linear-gradient(90deg,transparent 0%,rgba(167,139,250,.18) 30%,rgba(190,180,255,.55) 62%,rgba(240,244,255,.95) 88%,#fff 100%);filter:blur(2px) drop-shadow(0 0 7px rgba(233,240,255,.95)) drop-shadow(0 0 16px rgba(167,139,250,.8));offset-path:path("M75 0 L150 44 L150 132 L75 176 L0 132 L0 44 Z");offset-rotate:auto;offset-anchor:center;animation:achOrbit 3.2s linear infinite}
@keyframes achOrbit{from{offset-distance:0%}to{offset-distance:100%}}

/* ---- one of one: octagon, turning prismatic ring, sparkles ----
   Sparkles are POSITION-based, not path-based, precisely so this crest's silhouette
   can differ from the hexagon the comet's offset-path is welded to. */
.ach-tile.oneofone{--a:#ff2fb9;--b:#ff8fdc;--c:#7d0a5c;--ach-shape:polygon(20% 0,80% 0,100% 17%,100% 83%,80% 100%,20% 100%,0 83%,0 17%)}
.ach-tile.oneofone .ach-glow{filter:drop-shadow(0 0 10px color-mix(in srgb,var(--a) 65%,transparent)) drop-shadow(0 0 26px color-mix(in srgb,var(--c) 40%,transparent))}
.ach-tile.oneofone .ach-ring{overflow:hidden;background:none}
.ach-tile.oneofone .ach-ring::before{content:"";position:absolute;inset:-62%;background:conic-gradient(from 0turn,var(--c) 0%,var(--a) 8%,var(--b) 16%,#fff 21%,var(--b) 26%,var(--a) 34%,var(--c) 46%,var(--a) 58%,var(--b) 66%,#fff 71%,var(--b) 76%,var(--a) 84%,var(--c) 100%);animation:achSpin 9s linear infinite}
@keyframes achSpin{to{transform:rotate(1turn)}}
.ach-tile.oneofone .ach-bodyfill{background:radial-gradient(125% 95% at 32% 10%,color-mix(in srgb,var(--b) 26%,transparent) 0%,transparent 56%),linear-gradient(180deg,#141c26 0%,#0d1219 50%,#07090d 100%)}
.ach-tile.oneofone .ach-name{color:#f2f6fa;text-shadow:0 0 9px color-mix(in srgb,var(--b) 55%,transparent)}
.ach-tile.oneofone .ach-tag{background:#07090d;border-color:var(--b);color:color-mix(in srgb,var(--b) 45%,#fff);box-shadow:0 0 12px color-mix(in srgb,var(--a) 55%,transparent)}
.ach-sparks{position:absolute;inset:0;z-index:5;pointer-events:none}
.ach-sparks i{position:absolute;width:var(--s,14px);height:var(--s,14px);opacity:0;display:block;margin:calc(var(--s,14px) / -2) 0 0 calc(var(--s,14px) / -2);background:radial-gradient(closest-side,#fff 0%,#fff 30%,color-mix(in srgb,var(--b) 80%,#fff) 62%,transparent 100%);clip-path:polygon(50% 0,57% 43%,100% 50%,57% 57%,50% 100%,43% 57%,0 50%,43% 43%);animation:achTwinkle 3.4s ease-in-out infinite}
@keyframes achTwinkle{0%,58%,100%{opacity:0;transform:scale(.2) rotate(0)}9%{opacity:1;transform:scale(1.15) rotate(28deg)}22%{opacity:.9;transform:scale(.85) rotate(52deg)}40%{opacity:.35;transform:scale(.55) rotate(74deg)}}
/* Kept clear of the text block (x 15-85%, y 44-72%) so a sparkle never reads as a glitch. */
.ach-sparks i:nth-child(1){top:14%;left:22%;--s:18px;animation-delay:0s}
.ach-sparks i:nth-child(2){top:70%;left:87%;--s:14px;animation-delay:.42s}
.ach-sparks i:nth-child(3){top:84%;left:30%;--s:11px;animation-delay:.85s}
.ach-sparks i:nth-child(4){top:26%;left:79%;--s:16px;animation-delay:1.25s}
.ach-sparks i:nth-child(5){top:38%;left:9%;--s:12px;animation-delay:1.7s}
.ach-sparks i:nth-child(6){top:8%;left:58%;--s:20px;animation-delay:2.1s}
.ach-sparks i:nth-child(7){top:92%;left:66%;--s:13px;animation-delay:2.5s}
.ach-sparks i:nth-child(8){top:18%;left:40%;--s:9px;animation-delay:2.95s}

.ach-tile.locked{filter:grayscale(.85);opacity:.6}
.ach-tile.locked .ach-bodyfill{background:linear-gradient(180deg,#141a22,#0a0e13)}
.ach-tile.locked .ach-ring{background:linear-gradient(150deg,#33404e,#1a222c)}
.ach-tile.locked .ach-tag{border-color:#2a3542;color:#5b6675;box-shadow:none;background:#0b0f14}
.ach-tile.pending{opacity:.74}
/* Tucked into the hexagon's apex, not over the crest. The apex is free on locked
   tiles because .ach-rank only renders once earned. Small and muted: grayscale +
   dimming already say "locked", so the padlock only has to confirm it. */
.ach-lock{position:absolute;top:13px;left:50%;transform:translateX(-50%);color:#8892a0;filter:drop-shadow(0 1px 3px #000);z-index:6}

@media (prefers-reduced-motion:reduce){
  .ach-tile.pulse,.ach-sheen,.ach-comet,.ach-scan i,.ach-neb i,.ach-embers i,.ach-flares i,.ach-sparks i,
  .ach-tile.epic.earned .ach-pips i.on,.ach-tile.mythic.earned .ach-glow,.ach-tile.oneofone .ach-ring::before{animation:none}
  .ach-sparks i,.ach-flares i{opacity:.85;transform:scale(1)}
}
`
