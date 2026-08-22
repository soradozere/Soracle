"use client"

import { useEffect, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { Activity, HelpCircle, RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { RankMedal } from "@/components/rank-medal"
import {
  ALL_TIME_MIN_MATCHES,
  MONTHLY_MIN_FRACTION,
  computeImpactBoard,
  type ImpactBoard,
  type ImpactMatch,
  type ImpactPlayer,
  type ImpactRow,
  type ImpactStatRow,
} from "@/lib/impact-rating"

// The Impact board — the fourth leaderboard, alongside Wins, ELO and TrueSkill.
//
// Two votes, added: a player's standing on win rate, ELO and TrueSkill collapsed
// into one result (they move together, so counted separately they would outvote
// production three-to-one), plus average score per game. All of the maths lives in
// lib/impact-rating.ts; this file only fetches and draws.
//
// Nothing is persisted. The board is derived fresh from matches + match_stats on
// every load, so a re-uploaded scoreboard shows up immediately.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/**
 * Scoreboards only exist from this date. Before it the site recorded who played and
 * who won but not what anybody did, so score per game — a quarter of this rating —
 * is unanswerable for March-May 2026, and the empty state says so rather than
 * showing a table with no rows and letting people assume nobody qualified.
 */
const SCOREBOARD_ERA = "1 June 2026"

/** Columns the board reads. Kept in one place so the two scopes cannot drift. */
const STAT_COLUMNS =
  "match_id, player_id, team, score, captures, returns, base_cleaner, assists, flag_grabs, kills, deaths, time_played"

/**
 * PostgREST caps a response at 1000 rows and says nothing about it. A month of 6v6
 * is ~12 rows a match, so the monthly board is safe, but the all-time table passed
 * 1000 rows around mid-July 2026 and would silently drop everything after it —
 * which looks exactly like a quiet month rather than a bug.
 */
const PAGE_SIZE = 1000

/**
 * Every paged query MUST be ordered on something unique. `.range()` becomes
 * LIMIT/OFFSET, and Postgres gives no stability guarantee across two separate
 * statements without an ORDER BY — the same row can come back in both pages, or in
 * neither.
 */
const PAGE_ORDER = "id"

/** Where a standing bar is drawn at full width, in standard deviations. */
const Z_BAR_CLAMP = 2.5

/**
 * One colour per ingredient, used by the column headers and the bars, so a reader
 * can see at a glance which of the four moved somebody.
 */
const PART_COLOURS = {
  win: "var(--color-accent-green)",
  elo: "var(--color-accent-yellow)",
  trueskill: "var(--color-accent-purple)",
  score: "var(--color-accent-blue)",
} as const

interface ImpactLeaderboardProps {
  year: number
  month: number
  /** Unused by this board; kept so the caller's props match the other three. */
  isAdmin?: boolean
  /** Which board to show: every statted match ever, or the selected month. */
  scope: "alltime" | "month"
}

interface MatchRow extends ImpactMatch {
  created_at: string
}

const signed = (z: number) => `${z >= 0 ? "+" : ""}${z.toFixed(1)}`

/**
 * Page through a query until a batch comes back short. Same shape as the helper in
 * lib/returner-rate.ts: the query is rebuilt per page because a PostgREST builder
 * is single-use once awaited.
 */
async function fetchAll<T>(
  build: () => {
    range: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>
  },
): Promise<T[]> {
  const rows: T[] = []
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await build().range(from, from + PAGE_SIZE - 1)
    if (error) throw new Error(error.message)
    const batch = (data ?? []) as T[]
    rows.push(...batch)
    if (batch.length < PAGE_SIZE) return rows
  }
}

/**
 * One of the four standings, as a bar diverging from the pool average.
 *
 * Centred on zero rather than filled from the left, because the number is "compared
 * to everyone else who qualified" and a left-filled bar would imply a floor at
 * nobody-does-this rather than at the pool mean.
 */
function PartBar({ z, part, label, detail }: { z: number; part: keyof typeof PART_COLOURS; label: string; detail: string }) {
  const half = Math.max((Math.min(Math.abs(z), Z_BAR_CLAMP) / Z_BAR_CLAMP) * 50, 1.5)
  const title = `${label}: ${signed(z)} SD vs the qualified pool — ${detail}`
  return (
    <div className="flex flex-col items-center gap-1" title={title}>
      <div
        role="img"
        aria-label={title}
        className="relative w-14 h-2 rounded-sm bg-[var(--color-surface-elevated)] overflow-hidden"
      >
        <span className="absolute inset-y-0 left-1/2 w-px bg-[var(--color-border)]" />
        <span
          className="absolute inset-y-0"
          style={{
            backgroundColor: PART_COLOURS[part],
            left: z >= 0 ? "50%" : `${50 - half}%`,
            width: `${half}%`,
          }}
        />
      </div>
      <span className="font-mono text-[10px] text-[var(--color-text-dim)]">{signed(z)}</span>
    </div>
  )
}

function FormPills({ form }: { form: ("W" | "L" | "D")[] }) {
  if (form.length === 0) return <span className="text-[var(--color-text-dim)]">—</span>
  return (
    <div className="flex items-center justify-center gap-1">
      {form.map((result, i) => (
        <span
          key={i}
          className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
            result === "W"
              ? "bg-[#27ae60] text-white"
              : result === "L"
                ? "bg-[#ff4757] text-white"
                : "bg-[var(--color-surface-elevated)] text-[var(--color-text-dim)]"
          }`}
        >
          {result}
        </span>
      ))}
    </div>
  )
}

export function ImpactLeaderboard({ year, month, scope }: ImpactLeaderboardProps) {
  const [board, setBoard] = useState<ImpactBoard | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  /**
   * `isStale` lets the effect abandon a response whose month is no longer on screen.
   * The Refresh button passes nothing, because there is nothing newer to lose to.
   */
  const load = async ({ isStale }: { isStale?: () => boolean } = {}) => {
    const stale = () => isStale?.() ?? false
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      // Oldest first, and it matters: ELO and TrueSkill are running ratings, so the
      // order they are replayed in IS the answer.
      const matchQuery = () => {
        const q = supabase
          .from("matches")
          .select("id, red_team, blue_team, red_score, blue_score, created_at")
          .order("created_at", { ascending: true })
          // created_at is not unique — two matches logged in the same second would
          // make the page boundary ambiguous.
          .order(PAGE_ORDER, { ascending: true })
        if (scope === "alltime") return q
        // UTC month boundaries, matching the rest of the site — bucketing on the
        // viewer's local month would put the same match in different months for
        // players either side of midnight UTC.
        const start = new Date(Date.UTC(year, month - 1, 1))
        const end = new Date(Date.UTC(year, month, 1))
        return q.gte("created_at", start.toISOString()).lt("created_at", end.toISOString())
      }

      const allMatches = (await fetchAll<MatchRow>(matchQuery)).filter(
        (m) => m.red_team?.length && m.blue_team?.length,
      )

      const players = await fetchAll<ImpactPlayer>(() =>
        supabase.from("players").select("id, name, tier_value").order(PAGE_ORDER, { ascending: true }),
      )

      const monthIds = allMatches.map((m) => m.id)
      const statRows =
        scope === "month" && monthIds.length === 0
          ? []
          : await fetchAll<ImpactStatRow>(() => {
              const q = supabase.from("match_stats").select(STAT_COLUMNS).order(PAGE_ORDER, { ascending: true })
              return scope === "month" ? q.in("match_id", monthIds) : q
            })

      // All-time drops the pre-scoreboard era: keeping those matches would let a
      // player's win rate, ELO and TrueSkill run over games their score per game
      // cannot see, so three quarters of the rating would cover a wider history
      // than the fourth.
      const withStats = new Set(statRows.map((r) => r.match_id))
      const matches: ImpactMatch[] =
        scope === "alltime" ? allMatches.filter((m) => withStats.has(m.id)) : allMatches

      const result = computeImpactBoard(
        matches,
        statRows,
        players,
        scope === "alltime" ? { minGames: ALL_TIME_MIN_MATCHES } : { minGamesFraction: MONTHLY_MIN_FRACTION },
      )
      if (stale()) return
      setBoard(result)
    } catch (err) {
      if (stale()) return
      setError(err instanceof Error ? err.message : "Failed to calculate Impact ratings")
    }

    if (stale()) return
    setLoading(false)
  }

  useEffect(() => {
    // Guard against an out-of-order response. Clicking back through months fires a
    // load per click and nothing makes them finish in order.
    let cancelled = false
    load({ isStale: () => cancelled })
    return () => {
      cancelled = true
    }
  }, [year, month, scope])

  if (loading) {
    return (
      <div className="flex items-center justify-center p-8">
        <RefreshCw className="w-6 h-6 animate-spin text-[var(--color-primary)]" />
        <span className="ml-2 text-[var(--color-text-dim)]">Calculating Impact ratings...</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-6 text-center space-y-3">
        <p className="text-red-400">{error}</p>
        <Button onClick={() => load()} variant="outline" size="sm">
          Retry
        </Button>
      </div>
    )
  }

  const rows: ImpactRow[] = board?.rows ?? []
  const monthLabel = `${MONTH_NAMES[month - 1]} ${year}`
  const stattedMatches = board?.stattedMatches ?? 0
  const totalMatches = board?.totalMatches ?? 0
  const minGames = board?.minGames ?? 0
  const unstatted = Math.max(totalMatches - stattedMatches, 0)

  const qualifier =
    scope === "alltime"
      ? `Players with ${ALL_TIME_MIN_MATCHES}+ scoreboard games, across the ${stattedMatches} matches that have one. Scoreboards start on ${SCOREBOARD_ERA}, so nothing before that counts here.`
      : `Players with ${minGames}+ scoreboard games in ${monthLabel} (30% of the ${stattedMatches} with a scoreboard).` +
        (unstatted > 0
          ? ` ${unstatted} of the month's ${totalMatches} matches have no scoreboard, so they count toward win rate, ELO and TrueSkill but not toward score per game.`
          : "")

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-[var(--color-text-dim)]">
          {scope === "alltime"
            ? "Where each player stands across every match with a scoreboard, on results and production."
            : `Where each player stood in ${monthLabel}, on results and production.`}{" "}
          Win rate, ELO and TrueSkill combine into one result, then add to average score per game — each compared
          to everyone else who qualified.
        </p>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <HelpCircle className="w-4 h-4 mr-1.5" />
                How this is worked out
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Impact Rating</DialogTitle>
                <DialogDescription>
                  Two votes, added together — how your month's results went, and how much you put on the
                  scoreboard.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm text-[var(--color-text)]">
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Four measures, two votes</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Your <span style={{ color: PART_COLOURS.win }}>win rate</span>,{" "}
                    <span style={{ color: PART_COLOURS.elo }}>ELO</span> and{" "}
                    <span style={{ color: PART_COLOURS.trueskill }}>TrueSkill</span>{" "}
                    are each compared to everyone
                    else who qualified — the −2 to +2 numbers in those columns are standard deviations from the
                    pool average, not points. Those three are then averaged into a single result, because all three
                    are built from nothing but who won: over one month they agree with each other 93–97% of the
                    time, so counting them separately would let &ldquo;who won&rdquo; outvote everything else
                    three-to-one. That combined result is added to{" "}
                    <span style={{ color: PART_COLOURS.score }}>average score per game</span>, standardised the
                    same way, and the total is shown on a scale where 50 is an average month.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">ELO and TrueSkill reset each month</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Both are replayed from level at the start of the month, so this board reflects the month you
                    actually had rather than the rating you brought into it. The ELO and TrueSkill boards keep
                    their own running all-time versions.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Why results only get one vote</h4>
                  <p className="text-[var(--color-text-dim)]">
                    An earlier version added all four numbers separately. Win rate, ELO and TrueSkill moved in
                    lockstep on almost every row — they are close to one measurement counted three times, and in a
                    balanced 6v6 that measurement is decided mostly by your other eleven players rather than by
                    you. Average score per game was the only column carrying independent information, so next to
                    three numbers that always agreed with each other, it looked erratic by comparison — even
                    though it wasn&apos;t the miscalibrated one. Collapsing results to a single vote fixed that:
                    split a month in half at random and rebuild this board on each half, and the two halves now
                    agree about 0.56, up from 0.28 when all four were added raw. Score per minute alone still
                    agrees with itself more (0.87) than this board does — winning is kept in deliberately, at equal
                    weight to production, because a leaderboard that ignored who won would stop being about the
                    game.
                  </p>
                </div>
                <div>
                  <h4 className="font-bold text-[var(--color-text)] mb-1">Where the numbers come from</h4>
                  <p className="text-[var(--color-text-dim)]">
                    Win rate, ELO and TrueSkill come from match results, which the site has for every match ever
                    played. Score per game comes from the uploaded scoreboards, which begin on {SCOREBOARD_ERA} —
                    so this board cannot be built for earlier months.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button onClick={() => load()} variant="outline" size="sm">
            <RefreshCw className="w-4 h-4 mr-1.5" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg overflow-hidden">
        <div className="p-4 border-b border-[var(--color-border)]">
          <h3 className="text-lg font-bold text-[var(--color-primary)] flex items-center gap-2">
            <Activity className="w-5 h-5" />
            Impact Leaderboard
          </h3>
          {stattedMatches > 0 && (
            <p className="text-xs text-[var(--color-text-dim)] mt-1">{qualifier}</p>
          )}
        </div>

        {rows.length > 0 ? (
          <>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-[var(--color-border)] text-[var(--color-text-dim)] text-xs uppercase">
                    <th className="px-4 py-3 text-left">#</th>
                    <th className="px-4 py-3 text-left">Player</th>
                    <th className="px-4 py-3 text-right">Rating</th>
                    <th className="px-4 py-3 text-center">GP</th>
                    <th className="px-4 py-3 text-center">W–L</th>
                    <th className="px-4 py-3 text-center" style={{ color: PART_COLOURS.win }}>
                      Win %
                    </th>
                    <th className="px-4 py-3 text-center" style={{ color: PART_COLOURS.elo }}>
                      ELO
                    </th>
                    <th className="px-4 py-3 text-center" style={{ color: PART_COLOURS.trueskill }}>
                      TrueSkill
                    </th>
                    <th className="px-4 py-3 text-center" style={{ color: PART_COLOURS.score }}>
                      Score/game
                    </th>
                    <th className="px-4 py-3 text-center">Form</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, index) => {
                    const isTop3 = index < 3
                    return (
                      <tr
                        key={row.name}
                        className={`border-b border-[var(--color-border)]/50 ${isTop3 ? "bg-[#ffd700]/5" : ""}`}
                      >
                        <td className="px-4 py-3">
                          {isTop3 ? (
                            <RankMedal index={index} />
                          ) : (
                            <span className="text-[var(--color-text-dim)]">{index + 1}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <span className={`font-medium ${isTop3 ? "text-[#ffd700]" : "text-[var(--color-text)]"}`}>
                              {row.name}
                            </span>
                            {row.tier !== null && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold tabular-nums bg-[var(--color-surface-elevated)] text-[var(--color-text-dim)] border border-[var(--color-border)]">
                                T{row.tier}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-base text-[var(--color-primary)]">
                          {row.rating}
                        </td>
                        <td
                          className="px-4 py-3 text-center text-[var(--color-text)]"
                          title={`${row.minutes} minutes on the scoreboard`}
                        >
                          {row.games}
                        </td>
                        <td className="px-4 py-3 text-center whitespace-nowrap">
                          <span className="text-[#27ae60] font-bold">{row.wins}</span>
                          <span className="text-[var(--color-text-dim)] mx-0.5">–</span>
                          <span className="text-[#ff4757] font-bold">{row.losses}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center">
                            <PartBar
                              z={row.winRateZ}
                              part="win"
                              label="Win rate"
                              detail={`${row.winPct.toFixed(0)}% from ${row.wins + row.losses + row.draws} matches`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center">
                            <PartBar
                              z={row.eloZ}
                              part="elo"
                              label="ELO"
                              detail={`${Math.round(row.elo)}, replayed from level at the start of the month`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center">
                            <PartBar
                              z={row.trueSkillZ}
                              part="trueskill"
                              label="TrueSkill"
                              detail={`${row.trueSkill.toFixed(1)} conservative rating`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-center">
                            <PartBar
                              z={row.scoreZ}
                              part="score"
                              label="Score per game"
                              detail={`${Math.round(row.scorePerGame)} a game, ${row.scorePerMin.toFixed(1)} a minute`}
                            />
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <FormPills form={row.form} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div className="px-4 py-3 border-t border-[var(--color-border)] bg-[var(--color-background)]/40 space-y-2">
              <div className="flex flex-wrap gap-4 text-xs text-[var(--color-text-dim)]">
                {[
                  ["win", "Win rate", "share of matches your side won"],
                  ["elo", "ELO", "reset to level at the start of the month"],
                  ["trueskill", "TrueSkill", "reset likewise, shown three sigma below the mean"],
                  ["score", "Score/game", "the game's own scoreboard total, per match"],
                ].map(([key, name, note]) => (
                  <span key={key} className="flex items-center gap-2">
                    <span
                      className="w-2.5 h-2.5 rounded-sm"
                      style={{ backgroundColor: PART_COLOURS[key as keyof typeof PART_COLOURS] }}
                    />
                    <span>
                      <span className="text-[var(--color-text)] font-medium">{name}</span> — {note}
                    </span>
                  </span>
                ))}
              </div>
              <p className="text-xs text-[var(--color-text-dim)]">
                Bars are standard deviations from the qualified pool, so they diverge either side of the average
                rather than filling from zero. Win rate, ELO and TrueSkill are all built from who won and agree
                with each other 93–97% of the time over a single month, so they are combined into one result
                before the rating is worked out — otherwise match results would outvote everything else
                three-to-one. The rating is that combined result plus Score/game, in equal parts.
              </p>
            </div>
          </>
        ) : (
          <div className="p-8 text-center text-[var(--color-text-dim)] space-y-2">
            {stattedMatches === 0 ? (
              <>
                <p className="text-[var(--color-text)]">
                  {totalMatches === 0
                    ? scope === "alltime"
                      ? "No matches with a scoreboard yet."
                      : `No matches were played in ${monthLabel}.`
                    : scope === "alltime"
                      ? "No match on record has a full scoreboard yet."
                      : `None of the ${totalMatches} matches in ${monthLabel} has a scoreboard.`}
                </p>
                <p className="text-sm">
                  A quarter of this rating is average score per game, which comes from the uploaded scoreboards —
                  and those only start on {SCOREBOARD_ERA}. Earlier months have results and rosters but nothing
                  about what anybody did, so the Wins, ELO and TrueSkill boards still work for them.
                </p>
              </>
            ) : (
              <p>
                {scope === "alltime"
                  ? `Nobody has ${minGames}+ games with a scoreboard yet.`
                  : `No players with ${minGames}+ scoreboard games in ${monthLabel} (30% of the ${stattedMatches} with a scoreboard).`}
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
