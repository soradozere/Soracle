"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { fetchPlayersFromDB } from "@/lib/fetch-players-db"
import { loadPlayerBadges, playerSlug, type BadgeId } from "@/lib/player-profile"
import { BADGE_META } from "@/lib/badge-meta"
import { BadgeIcon } from "@/components/badge-icon"
import { RARITY_META, type Rarity } from "@/lib/achievement-meta"
import type { PlayerRow } from "@/lib/achievements-server"

// Badges are only knowable client-side (lib/player-profile.ts builds its own
// browser Supabase client — see the note on loadPlayerBadges), so this strip
// renders immediately off the server-computed directory + monthly stats and
// the badge chips pop in once the client-side pass resolves. Same non-blocking
// shape as the balancer's Player Cards.

const crestAccentFor = (row: PlayerRow) => (row.best ? RARITY_META[row.best].color : "#3d4855")

function Avatar({ row }: { row: PlayerRow }) {
  const accent = crestAccentFor(row)
  const [failed, setFailed] = useState(false)
  if (row.avatarUrl && !failed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- avatars are arbitrary admin-set URLs
      <img
        src={row.avatarUrl}
        alt=""
        onError={() => setFailed(true)}
        className="w-12 h-12 rounded-full object-cover shrink-0"
        style={{ border: `2px solid ${accent}`, boxShadow: `0 0 12px ${accent}40` }}
      />
    )
  }
  return (
    <div
      className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center font-bold text-base"
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

function FormPips({ form }: { form: PlayerRow["form"] }) {
  if (!form.length) return <span className="text-[10px] text-[#8892a0]">No games yet</span>
  return (
    <div className="flex gap-1" aria-label={`Recent form: ${form.join("")}`}>
      {[...form].reverse().map((f, i) => (
        <span
          key={i}
          title={f === "W" ? "Win" : f === "L" ? "Loss" : "Draw"}
          className="w-1.5 h-1.5 rounded-full"
          style={{ backgroundColor: f === "W" ? "#3ddc84" : f === "L" ? "#ff4757" : "#8892a0" }}
        />
      ))}
    </div>
  )
}

export interface ActivePlayerRow extends PlayerRow {
  monthMatches: number
  // The player's equipped Title — a separate progression axis (seasonal or
  // Achievement Score ladders, lib/titles.ts) from PlayerRow.title, which is
  // the rarest crest they hold. Null if they have none equipped.
  equippedTitle: { title: string; rarity: Rarity; source: string } | null
}

export function HomeActivePlayers({ players }: { players: ActivePlayerRow[] }) {
  const [badgesByPlayer, setBadgesByPlayer] = useState<Record<string, BadgeId[]>>({})

  useEffect(() => {
    let cancelled = false
    fetchPlayersFromDB()
      .then((all) => loadPlayerBadges(all))
      .then((badges) => {
        if (!cancelled) setBadgesByPlayer(badges)
      })
      .catch(console.error)
    return () => {
      cancelled = true
    }
  }, [])

  if (!players.length) {
    return <p className="text-sm text-[#8892a0]">No games logged this month yet.</p>
  }

  return (
    <div className="home-active-strip">
      {players.map((row) => (
        <Link key={row.id} href={`/player/${playerSlug(row.name)}`} className="home-active-card">
          <div className="flex items-center gap-3">
            <Avatar row={row} />
            <div className="min-w-0">
              <div className="font-bold text-[#e6edf3] text-sm truncate" style={{ fontFamily: "var(--font-orbitron)" }}>
                {row.name}
              </div>
              {row.equippedTitle && (
                <div
                  className="text-[11px] truncate font-semibold"
                  style={{ color: RARITY_META[row.equippedTitle.rarity].color }}
                >
                  {row.equippedTitle.title}
                </div>
              )}
            </div>
          </div>

          <div className="mt-3 flex items-center justify-between">
            <FormPips form={row.form} />
            <div className="flex items-center gap-1">
              {(badgesByPlayer[row.name] ?? []).map((id) => (
                <span key={id} className="home-badge-dot" title={BADGE_META[id].label}>
                  <BadgeIcon id={id} className="w-3.5 h-3.5" />
                </span>
              ))}
            </div>
          </div>
        </Link>
      ))}
      <style>{`
        .home-active-strip{display:flex;gap:16px;overflow-x:auto;padding:24px 16px 26px;margin:0 -16px;scroll-snap-type:x proximity;scroll-padding-inline:16px;scrollbar-width:thin;scrollbar-color:#2a3542 #0b0c10}
        .home-active-strip::-webkit-scrollbar{height:6px}
        .home-active-strip::-webkit-scrollbar-track{background:#0b0c10;border-radius:999px;margin:0 4px}
        .home-active-strip::-webkit-scrollbar-thumb{background:#2a3542;border-radius:999px;border:1px solid #0b0c10}
        .home-active-card{position:relative;flex:0 0 auto;scroll-snap-align:start;width:196px;padding:16px 14px 14px;border-radius:12px;background:linear-gradient(160deg,rgba(42,52,65,0.85) 0%,rgba(21,27,36,0.9) 100%);border:1px solid #3d4855;text-decoration:none;overflow:hidden;transition:border-color .18s,transform .18s,box-shadow .18s;box-shadow:0 0 14px -6px var(--color-primary-glow)}
        .home-active-card::after{content:"";position:absolute;top:-60%;left:50%;width:150%;height:150%;transform:translateX(-50%);background:radial-gradient(closest-side,color-mix(in srgb,var(--color-primary) 14%,transparent),transparent 70%);pointer-events:none}
        .home-active-card:hover{border-color:var(--color-primary);transform:translateY(-3px);box-shadow:0 12px 28px -12px rgba(0,0,0,.65),0 0 18px -6px var(--color-primary-glow)}
        .home-active-card:focus-visible{outline:2px solid var(--color-primary);outline-offset:3px}
        .home-badge-dot{display:inline-flex;align-items:center;justify-content:center;width:20px;height:20px;border-radius:999px;background:rgba(11,12,16,0.7);border:1px solid #3d4855}
      `}</style>
    </div>
  )
}
