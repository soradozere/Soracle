"use client"

import { Emblem } from "@/components/emblem"

export interface ShareCardData {
  name: string
  month: string
  year: number
  avatarUrl: string | null
  tier: number | null
  tierName: string
  wins: number
  losses: number
  winPct: number
  played: number
  streak: number
  /** null when they did not clear the month's qualifying bar. */
  place: number | null
  of: number
  /** Six headline numbers, already formatted. */
  stats: { label: string; value: string }[]
  topFriend: string | null
  topNemesis: string | null
  bestScore: number | null
  /** Gold / silver / bronze foil for a podium month, matching the card on the page. */
  medal: { edge: string; core: string; glow: string } | null
}

/**
 * The shareable card: one month, at arm's length.
 *
 * Deliberately not the Wrapped page in miniature. That page rewards reading —
 * six people lists, a dozen kill styles, a form graph. A card that gets pasted
 * into Discord gets looked at for about two seconds, so this carries the half
 * dozen numbers somebody would actually say out loud, and drops the rest.
 *
 * Fixed 5:7 — trading card proportions — so it prints to a predictable shape
 * rather than reflowing to whatever paper size the browser assumes.
 */
export function WrappedShareCard({ data }: { data: ShareCardData }) {
  const d = data
  const edge = d.medal?.edge ?? "var(--color-primary)"
  const core = d.medal?.core ?? "#ffffff"

  return (
    <div
      className="wrapped-share-card relative overflow-hidden flex flex-col"
      style={{
        width: "460px",
        aspectRatio: "5 / 7",
        borderRadius: "18px",
        background: "linear-gradient(168deg, #141a22 0%, #0d1117 55%, #10161d 100%)",
        border: `1px solid color-mix(in srgb, ${edge} 45%, #253040)`,
        boxShadow: `0 0 40px -18px ${d.medal?.glow ?? "rgba(102, 252, 241, 0.35)"}`,
        color: "#e8ecf2",
        padding: "26px",
      }}
    >
      {/* Foil sweep, same idea as the card on the page. */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage:
            `linear-gradient(104deg, transparent 22%, color-mix(in srgb, ${edge} 15%, transparent) 38%,` +
            ` color-mix(in srgb, ${core} 17%, transparent) 47%,` +
            ` color-mix(in srgb, ${edge} 15%, transparent) 56%, transparent 72%)`,
        }}
      />
      <Emblem
        src="/badges/star.svg"
        color={edge}
        className="absolute -right-[46px] -top-[38px] w-[196px] h-[196px] opacity-[0.07] pointer-events-none"
      />

      {/* Header: who and when */}
      <div className="relative flex items-center gap-3.5">
        {d.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element -- admin-set URLs
          <img
            src={d.avatarUrl}
            alt=""
            className="w-14 h-14 rounded-xl object-cover shrink-0"
            style={{ border: `1px solid color-mix(in srgb, ${edge} 50%, transparent)` }}
          />
        )}
        <div className="min-w-0">
          <div
            className="text-[30px] font-bold leading-none truncate"
            style={{ fontFamily: "var(--font-orbitron)", color: "#ffffff" }}
          >
            {d.name}
          </div>
          <div className="mt-1.5 text-[10px] uppercase tracking-[0.18em]" style={{ color: "#8b96a5" }}>
            {d.month} {d.year} Wrapped
          </div>
        </div>
      </div>

      {/* The headline: record and where it put them */}
      <div className="relative mt-6 flex items-end gap-5">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "#8b96a5" }}>
            Record
          </div>
          <div className="text-[26px] font-bold leading-tight tabular-nums">
            <span style={{ color: "#27ae60" }}>{d.wins}W</span>
            <span style={{ color: "#5a6472" }}> – </span>
            <span style={{ color: "#ff4757" }}>{d.losses}L</span>
          </div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "#8b96a5" }}>
            Win rate
          </div>
          <div className="text-[26px] font-bold leading-tight tabular-nums">{d.winPct}%</div>
        </div>
        {d.place !== null && (
          <div className="ml-auto text-right">
            <div className="text-[10px] uppercase tracking-[0.16em]" style={{ color: "#8b96a5" }}>
              Finished
            </div>
            <div className="text-[26px] font-bold leading-tight tabular-nums" style={{ color: edge }}>
              #{d.place}
              <span className="text-[13px] font-normal" style={{ color: "#8b96a5" }}>
                {" "}
                / {d.of}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Six numbers, no more. */}
      <div className="relative mt-6 grid grid-cols-2 gap-2.5">
        {d.stats.map((s) => (
          <div
            key={s.label}
            className="rounded-lg px-3 py-2.5"
            style={{ background: "rgba(255,255,255,0.035)", border: "1px solid rgba(255,255,255,0.07)" }}
          >
            <div className="text-[19px] font-bold tabular-nums leading-tight">{s.value}</div>
            <div className="text-[9px] uppercase tracking-[0.14em]" style={{ color: "#8b96a5" }}>
              {s.label}
            </div>
          </div>
        ))}
      </div>

      {/* The bit people argue about */}
      <div className="relative mt-auto pt-5 flex flex-col gap-1.5 text-[12px]">
        {d.topFriend && (
          <div className="flex justify-between gap-3">
            <span style={{ color: "#8b96a5" }}>Best alongside</span>
            <span className="font-semibold truncate" style={{ color: "#27ae60" }}>
              {d.topFriend}
            </span>
          </div>
        )}
        {d.topNemesis && (
          <div className="flex justify-between gap-3">
            <span style={{ color: "#8b96a5" }}>Nemesis</span>
            <span className="font-semibold truncate" style={{ color: "#ff4757" }}>
              {d.topNemesis}
            </span>
          </div>
        )}
        {d.bestScore !== null && (
          <div className="flex justify-between gap-3">
            <span style={{ color: "#8b96a5" }}>Best game</span>
            <span className="font-semibold tabular-nums" style={{ color: "#ffd700" }}>
              {d.bestScore}
            </span>
          </div>
        )}
        {d.streak > 1 && (
          <div className="flex justify-between gap-3">
            <span style={{ color: "#8b96a5" }}>Best streak</span>
            <span className="font-semibold tabular-nums" style={{ color: "#f39c12" }}>
              {d.streak} wins
            </span>
          </div>
        )}
        <div
          className="mt-3 pt-3 flex items-center justify-between text-[9px] uppercase tracking-[0.18em]"
          style={{ borderTop: "1px solid rgba(255,255,255,0.08)", color: "#5f6b7a" }}
        >
          <span>jk2ctf.com</span>
          <span>
            {d.tier !== null ? `Tier ${d.tier} — ${d.tierName}` : "Unranked"} · {d.played} games
          </span>
        </div>
      </div>
    </div>
  )
}
