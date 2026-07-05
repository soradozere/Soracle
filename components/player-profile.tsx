"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  loadPlayerProfile,
  playerSlug,
  type PlayerProfileData,
  type ProfileBadge,
  type ProfileMatchEntry,
} from "@/lib/player-profile"
import type { Player } from "@/lib/types"
import { Flame, Swords, Heart, ChevronDown } from "lucide-react"
import { BADGE_META } from "@/lib/badge-meta"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts"

// The player profile body, rendered by the /player/[slug] page (right-click →
// Show Profile opens it in a new tab). Design is deliberately freeform for now —
// Sam wants to nail visuals later with custom images, so badges etc. are simple
// styled chips.

interface PlayerProfileProps {
  player: Player
  allPlayers: Player[]
}

const ROLE_COLORS: Record<string, string> = {
  Capper: "#62d6e8",
  Chase: "#27ae60",
  Camp: "#45a29e",
  Cleaner: "#9b59b6",
  Support: "#f39c12",
}

const ROLE_LABELS: Record<string, string> = {
  Capper: "CAP",
  Chase: "CHA",
  Camp: "CAM",
  Cleaner: "BC",
  Support: "SUP",
}

const TIER_NAMES: Record<number, string> = {
  10: "The Chosen One",
  9: "Jedi Grandmaster",
  8: "Jedi Master",
  7: "Jedi Sentinel",
  6: "Jedi Guardian",
  5: "Jedi Knight",
  4: "Jedi",
  3: "Padawan",
  2: "Initiate",
  1: "Youngling",
}

function formatFlagHold(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function kdRatio(kills: number, deaths: number): string {
  if (kills === 0 && deaths === 0) return "—"
  if (deaths === 0) return "∞"
  return (kills / deaths).toFixed(2)
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="bg-[#0b0c10]/60 border border-[#3d4855] rounded-lg p-3 text-center cursor-default">
          <div className="text-xl font-bold font-mono text-[#c5c6c7]">{value}</div>
          <div className="text-[10px] uppercase tracking-wider text-[#8892a0] mt-1">{label}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="bg-[#1f2833] border border-[#66fcf1]/30 text-[#c5c6c7] text-xs max-w-56">
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg backdrop-blur-lg">
      <div className="px-4 py-3 border-b border-[#3d4855]">
        <h2 className="text-sm font-bold font-mono tracking-wider text-[#66fcf1]">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function BadgeChip({ badge }: { badge: ProfileBadge }) {
  const { icon: Icon, color } = BADGE_META[badge.id]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-[#0b0c10]/60 cursor-default"
          style={{ borderColor: `${color}66`, boxShadow: `0 0 10px ${color}22` }}
        >
          <Icon className="w-4 h-4" style={{ color }} />
          <span className="text-xs font-bold text-[#c5c6c7]">{badge.label}</span>
          {badge.entries.length > 1 && (
            <span className="text-xs font-mono font-bold" style={{ color }}>
              ×{badge.entries.length}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className="bg-[#1f2833] border border-[#66fcf1]/30 p-3">
        <div className="space-y-1">
          {badge.entries.map((entry) => (
            <div key={entry.month} className="flex items-center justify-between gap-4 text-xs">
              <span className="text-[#c5c6c7]">{entry.month}</span>
              <span className="font-mono font-bold" style={{ color }}>
                {entry.detail}
              </span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

const RESULT_STYLES: Record<ProfileMatchEntry["result"], { label: string; color: string }> = {
  W: { label: "WIN", color: "#27ae60" },
  L: { label: "LOSS", color: "#ff4757" },
  D: { label: "DRAW", color: "#8892a0" },
}

// One team panel inside a history row: names as chips, this profile's player
// highlighted, everyone else linking through to their own profile. Deliberately
// does NOT highlight the winning team — the card's green/red glow already says
// how the match went for THIS player, which is the profile's point of view.
function HistoryTeam({
  team,
  names,
  score,
  playerName,
}: {
  team: "Red" | "Blue"
  names: string[]
  score: number
  playerName: string
}) {
  const color = team === "Red" ? "#ff4757" : "#00d4ff"
  return (
    <div className="p-3 rounded-lg" style={{ backgroundColor: `${color}10` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-sm" style={{ color }}>
          {team.toUpperCase()} TEAM
        </span>
        <span className="text-xl font-bold font-mono" style={{ color }}>
          {score}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {/* Key includes the index: team arrays can contain the same name twice
            (e.g. a partial player logged in two stints). */}
        {names.map((name, i) =>
          name === playerName ? (
            <span
              key={`${name}-${i}`}
              className="text-xs font-bold bg-[#66fcf1] text-[#0b0c10] px-2 py-0.5 rounded"
            >
              {name}
            </span>
          ) : (
            <Link
              key={`${name}-${i}`}
              href={`/player/${playerSlug(name)}`}
              className="text-xs text-[#c5c6c7] bg-[#1f2833] px-2 py-0.5 rounded hover:text-[#66fcf1] transition-colors"
            >
              {name}
            </Link>
          ),
        )}
      </div>
    </div>
  )
}

function HistoryRow({ entry, playerName }: { entry: ProfileMatchEntry; playerName: string }) {
  const result = RESULT_STYLES[entry.result]
  const date = new Date(entry.date)
  return (
    <div
      className="bg-[#0b0c10]/60 border rounded-lg p-4"
      style={{
        borderColor: `${result.color}55`,
        boxShadow: `0 0 14px ${result.color}26, inset 0 0 24px ${result.color}0d`,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded text-xs font-bold"
            style={{ backgroundColor: `${result.color}33`, color: result.color }}
          >
            {result.label}
          </span>
          {entry.matchType && (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-[#8892a0]/20 text-[#8892a0]">
              {entry.matchType.toUpperCase()}
            </span>
          )}
        </div>
        <span className="text-xs text-[#8892a0]">
          {date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{" "}
          {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <HistoryTeam team="Red" names={entry.redTeam} score={entry.redScore} playerName={playerName} />
        <HistoryTeam team="Blue" names={entry.blueTeam} score={entry.blueScore} playerName={playerName} />
      </div>

      {entry.my && (
        <div className="mt-3 pt-3 border-t border-[#3d4855] text-xs font-mono text-[#8892a0]">
          <span className="text-[#66fcf1] font-bold">{entry.my.score}</span> pts
          {" · "}
          {entry.my.captures} caps
          {" · "}
          {entry.my.returns} ret
          {" · "}
          {entry.my.kills}/{entry.my.deaths} K/D
          {" · "}
          {formatFlagHold(entry.my.flagHoldMs)} hold
        </div>
      )}
    </div>
  )
}

// Short initial view keeps the profile page compact; Show More digs in faster.
const HISTORY_INITIAL = 5
const HISTORY_PAGE_SIZE = 10

function MatchHistorySection({ entries, playerName }: { entries: ProfileMatchEntry[]; playerName: string }) {
  const [visible, setVisible] = useState(HISTORY_INITIAL)

  if (entries.length === 0) {
    return <p className="text-sm text-[#8892a0]">No matches recorded yet.</p>
  }

  return (
    <div className="space-y-3">
      {entries.slice(0, visible).map((entry) => (
        <HistoryRow key={entry.id} entry={entry} playerName={playerName} />
      ))}
      {visible < entries.length && (
        <button
          onClick={() => setVisible((v) => v + HISTORY_PAGE_SIZE)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#3d4855] text-sm text-[#8892a0] hover:text-[#66fcf1] hover:border-[#66fcf1]/50 transition-colors"
        >
          <ChevronDown className="w-4 h-4" />
          Show more ({entries.length - visible} older)
        </button>
      )}
    </div>
  )
}

function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  return (
    <div className="bg-[#1f2833]/95 border border-[#66fcf1]/30 rounded-lg px-3 py-2 text-xs text-[#c5c6c7] shadow-lg">
      <div className="font-bold text-[#66fcf1] mb-1">{label}</div>
      {point.games > 0 ? (
        <>
          <div>
            {point.wins}W – {point.losses}L{point.draws > 0 ? ` – ${point.draws}D` : ""} ({point.games} games)
          </div>
          <div>Win rate: {point.winRate}%</div>
        </>
      ) : (
        <div className="text-[#8892a0]">Didn't play</div>
      )}
      <div className="text-[#f39c12]">Rating: {point.elo}</div>
    </div>
  )
}

export function PlayerProfile({ player, allPlayers }: PlayerProfileProps) {
  const [data, setData] = useState<PlayerProfileData | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    loadPlayerProfile(player, allPlayers)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((e) => {
        console.error("Failed to load player profile:", e)
        if (!cancelled) setError("Failed to load profile data. Try again in a moment.")
      })
    return () => {
      cancelled = true
    }
  }, [player.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const initials = player.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  if (error) {
    return <div className="p-8 text-center text-[#ff4757]">{error}</div>
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-4 text-[#c5c6c7]">
      {/* ---- Header: avatar, name, aliases, slogan, tier + roles ---- */}
      <div className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg backdrop-blur-lg p-5">
        <div className="flex flex-col sm:flex-row gap-5">
          {/* Placeholder avatar (Discord / in-game model avatars are later phases) */}
          <div
            className="w-24 h-24 shrink-0 rounded-xl border-2 border-[#66fcf1]/40 bg-[#0b0c10] flex items-center justify-center"
            style={{ boxShadow: "0 0 20px rgba(102,252,241,0.15)" }}
          >
            <span className="text-4xl font-bold font-mono text-[#66fcf1]">{initials}</span>
          </div>

          <div className="flex-1 min-w-0">
            <h1 className="text-3xl font-bold text-white">{player.name}</h1>

            {data && data.aliases.length > 0 && (
              <div className="text-sm text-[#8892a0] mt-1">
                aka {data.aliases.join(", ")}
              </div>
            )}

            {player.tooltip && (
              <p className="text-sm italic text-[#66fcf1]/80 mt-2">“{player.tooltip}”</p>
            )}

            <div className="flex items-center gap-2 mt-3">
              <span className="px-3 py-1 rounded-md text-xs font-bold bg-[#66fcf1] text-[#0b0c10]">
                Tier {player.tierValue} — {TIER_NAMES[player.tierValue] ?? "Unranked"}
              </span>
            </div>
          </div>

          {/* Role ratings */}
          <div className="w-full sm:w-72 shrink-0 space-y-2">
            {Object.entries(player.roles).map(([role, value]) => (
              <div key={role} className="flex items-center gap-2.5">
                <span className="text-xs w-9 font-mono text-[#8892a0]">{ROLE_LABELS[role]}</span>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-[#0b0c10] border border-[#3d4855]">
                  <div
                    className="h-full"
                    style={{
                      width: `${(value / 10) * 100}%`,
                      backgroundColor: ROLE_COLORS[role],
                      opacity: 0.7,
                    }}
                  />
                </div>
                <span className="text-xs w-4 text-right font-mono font-bold text-[#c5c6c7]">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ---- Awards ---- */}
        {data && data.badges.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#3d4855]">
            {data.badges.map((badge) => (
              <BadgeChip key={badge.id} badge={badge} />
            ))}
          </div>
        )}
      </div>

      {!data ? (
        <div className="p-10 text-center text-[#8892a0] animate-pulse font-mono text-sm">
          COMPILING SERVICE RECORD…
        </div>
      ) : (
        <>
          {/* ---- This month ---- */}
          <SectionCard title={`THIS MONTH — ${data.currentMonth.label.toUpperCase()}`}>
              {data.currentMonth.games === 0 ? (
                <p className="text-sm text-[#8892a0]">No matches played this month yet.</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-4 mb-4">
                    <div className="text-3xl font-bold font-mono">
                      <span className="text-[#27ae60]">{data.currentMonth.wins}W</span>
                      <span className="text-[#8892a0] mx-1">–</span>
                      <span className="text-[#ff4757]">{data.currentMonth.losses}L</span>
                      {data.currentMonth.draws > 0 && (
                        <>
                          <span className="text-[#8892a0] mx-1">–</span>
                          <span className="text-[#8892a0]">{data.currentMonth.draws}D</span>
                        </>
                      )}
                    </div>
                    <div className="text-sm text-[#8892a0]">{data.currentMonth.winRate}% win rate</div>
                    {data.currentMonth.bestStreak >= 2 && (
                      <div className="flex items-center gap-1 text-sm text-[#f39c12]">
                        <Flame className="w-4 h-4" />
                        {data.currentMonth.bestStreak} streak
                      </div>
                    )}
                  </div>
                  {data.currentMonth.stats ? (
                    <>
                      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
                        <StatTile label="Caps" value={data.currentMonth.stats.captures} hint="Flag captures this month" />
                        <StatTile label="Returns" value={data.currentMonth.stats.returns} hint="Flag returns this month" />
                        <StatTile label="Assists" value={data.currentMonth.stats.assists} hint="Capture assists this month" />
                        <StatTile label="BC" value={data.currentMonth.stats.baseCleaner} hint="Base cleaner kills — clearing defenders out of the enemy base" />
                        <StatTile label="Grabs" value={data.currentMonth.stats.flagGrabs} hint="Flag grabs this month" />
                        <StatTile label="Kills" value={data.currentMonth.stats.kills} hint="Total kills this month" />
                        <StatTile label="Deaths" value={data.currentMonth.stats.deaths} hint="Total deaths this month" />
                        <StatTile
                          label="K/D"
                          value={kdRatio(data.currentMonth.stats.kills, data.currentMonth.stats.deaths)}
                          hint="Kills per death this month"
                        />
                        <StatTile
                          label="Flag Hold"
                          value={formatFlagHold(data.currentMonth.stats.flagHoldMs)}
                          hint="Total time carrying the flag this month (min:sec)"
                        />
                      </div>
                      <p className="text-[10px] text-[#8892a0] mt-3">
                        Scoreboard stats recorded for {data.currentMonth.stats.statMatches} of {data.currentMonth.games}{" "}
                        matches this month.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-[#8892a0]">No scoreboard stats uploaded for this month yet.</p>
                  )}
                </>
              )}
            </SectionCard>

          {/* ---- Career ---- */}
            <SectionCard title="CAREER">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                <StatTile label="Matches" value={data.totals.games} hint="All matches on record" />
                <StatTile
                  label="Record"
                  value={`${data.totals.wins}–${data.totals.losses}${data.totals.draws ? `–${data.totals.draws}` : ""}`}
                  hint={`All-time wins–losses${data.totals.draws ? "–draws" : ""}`}
                />
                <StatTile
                  label="Win Rate"
                  value={data.totals.winRate !== null ? `${data.totals.winRate}%` : "—"}
                  hint="All-time win percentage"
                />
                <StatTile
                  label="Peak Rating"
                  value={data.totals.peakElo}
                  hint="Highest ELO rating ever reached (tier-seeded, replayed over every match)"
                />
              </div>
              <Tooltip>
                <TooltipTrigger asChild>
              <div className="bg-[#0b0c10]/60 border border-[#f1c40f]/40 rounded-lg p-4 flex items-center justify-between cursor-default">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#8892a0]">
                    Highest match score
                  </div>
                  {data.careerHigh ? (
                    <div className="text-xs text-[#8892a0] mt-1">
                      {data.careerHigh.date
                        ? new Date(data.careerHigh.date).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : ""}
                    </div>
                  ) : (
                    <div className="text-xs text-[#8892a0] mt-1">No scoreboard stats recorded yet</div>
                  )}
                </div>
                <div className="text-4xl font-bold font-mono text-[#f1c40f]">
                  {data.careerHigh ? data.careerHigh.score : "—"}
                </div>
              </div>
                </TooltipTrigger>
                <TooltipContent className="bg-[#1f2833] border border-[#66fcf1]/30 text-[#c5c6c7] text-xs max-w-64">
                  Best single-match scoreboard score. Only matches with an uploaded stats CSV count.
                </TooltipContent>
              </Tooltip>
              {data.totals.firstMatch && (
                <p className="text-[10px] text-[#8892a0] mt-3">
                  First recorded match:{" "}
                  {new Date(data.totals.firstMatch).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              )}
            </SectionCard>

          {/* ---- Performance graph ---- */}
          <SectionCard title="ALL-TIME PERFORMANCE">
            {data.series.length === 0 ? (
              <p className="text-sm text-[#8892a0]">No matches recorded yet.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.series} margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#8892a0", fontSize: 11 }}
                      axisLine={{ stroke: "#3d4855" }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="winrate"
                      domain={[0, 100]}
                      tick={{ fill: "#8892a0", fontSize: 11 }}
                      axisLine={{ stroke: "#3d4855" }}
                      tickLine={false}
                      unit="%"
                    />
                    <YAxis
                      yAxisId="elo"
                      orientation="right"
                      domain={["auto", "auto"]}
                      tick={{ fill: "#f39c12", fontSize: 11 }}
                      axisLine={{ stroke: "#3d4855" }}
                      tickLine={false}
                      width={50}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      yAxisId="winrate"
                      dataKey="winRate"
                      name="Win rate"
                      fill="#66fcf1"
                      fillOpacity={0.35}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={28}
                    />
                    <Line
                      yAxisId="elo"
                      dataKey="elo"
                      name="Rating"
                      type="monotone"
                      stroke="#f39c12"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="flex gap-4 justify-center mt-1 text-[10px] text-[#8892a0]">
                  <span>
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[#66fcf1]/40 mr-1 align-middle" />
                    Monthly win rate
                  </span>
                  <span>
                    <span className="inline-block w-4 h-0.5 bg-[#f39c12] mr-1 align-middle" />
                    Rating (tier-seeded ELO)
                  </span>
                </div>
              </div>
            )}
          </SectionCard>

          {/* ---- Friends & nemeses ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="BEST TEAM-MATES">
              {data.friends.length === 0 ? (
                <p className="text-sm text-[#8892a0]">Not enough games played together yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.friends.map((friend, i) => (
                    <div
                      key={friend.name}
                      className="flex items-center justify-between bg-[#0b0c10]/60 border border-[#3d4855] rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-[#8892a0] w-4">#{i + 1}</span>
                        <Heart className="w-4 h-4 text-[#27ae60]" />
                        <Link
                          href={`/player/${playerSlug(friend.name)}`}
                          className="text-sm font-bold text-[#c5c6c7] hover:text-[#66fcf1] transition-colors"
                        >
                          {friend.name}
                        </Link>
                      </div>
                      <div className="text-xs font-mono text-[#8892a0]">
                        <span className="text-[#27ae60] font-bold">{Math.round(friend.rate * 100)}%</span>
                        {" · "}
                        {friend.wins}W–{friend.losses}L together ({friend.games} games)
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="NEMESES">
              {data.nemeses.length === 0 ? (
                <p className="text-sm text-[#8892a0]">No recurring opponents yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.nemeses.map((nemesis, i) => (
                    <div
                      key={nemesis.name}
                      className="flex items-center justify-between bg-[#0b0c10]/60 border border-[#3d4855] rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-[#8892a0] w-4">#{i + 1}</span>
                        <Swords className="w-4 h-4 text-[#ff4757]" />
                        <Link
                          href={`/player/${playerSlug(nemesis.name)}`}
                          className="text-sm font-bold text-[#c5c6c7] hover:text-[#66fcf1] transition-colors"
                        >
                          {nemesis.name}
                        </Link>
                      </div>
                      <div className="text-xs font-mono text-[#8892a0]">
                        <span className="text-[#ff4757] font-bold">beats you {Math.round(nemesis.rate * 100)}%</span>
                        {" · "}
                        {nemesis.myWins}W–{nemesis.theirWins}L vs ({nemesis.meetings} meetings)
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          {/* ---- Personal match history ---- */}
          <SectionCard title={`MATCH HISTORY — ${data.matches.length} GAMES`}>
            <MatchHistorySection entries={data.matches} playerName={player.name} />
          </SectionCard>
        </>
      )}
    </div>
    </TooltipProvider>
  )
}
