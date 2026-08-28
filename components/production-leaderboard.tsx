"use client"

import { useEffect, useMemo, useState } from "react"
import { createClient } from "@/lib/supabase/client"
import { ChevronLeft, ChevronRight, Hammer, HelpCircle, ListChecks, RefreshCw } from "lucide-react"
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
  WIN_SHARE,
  computeProductionBoard,
  type Job,
  type ProductionBoard,
  type ProductionMatch,
  type ProductionPlayer,
  type ProductionRow,
  type ProductionStatRow,
} from "@/lib/production-rating"

/**
 * The W/L share as a percentage, for copy. Read from the constant rather than
 * written out, because it has been changed twice and the prose went stale both
 * times.
 */
const WIN_PCT = `${Math.round(WIN_SHARE * 100)}%`

// The Impact board — rating a month on what players did rather than on what the
// scoreboard said at the end.
//
// NAMING: displayed as "Impact", but the files are named production-* because
// lib/impact-rating.ts is the PREVIOUS Impact board (win rate + ELO + TrueSkill +
// score per game), left in place but unwired so it can be restored in one line.
//
// All of the maths lives in lib/production-rating.ts; this file only fetches and
// draws. Nothing is persisted — the board is derived fresh from matches +
// match_stats on every load.

const MONTH_NAMES = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
]

/** Scoreboards only exist from this date; before it there is nothing to rate. */
const SCOREBOARD_ERA = "1 June 2026"

const STAT_COLUMNS =
  "match_id, player_id, team, captures, flag_grabs, flag_hold_ms, returns, assists, base_cleaner, " +
  "mine_kills, mine_grabs_red, mine_grabs_blue, mine_returns, time_played"

const PAGE_SIZE = 1000

/** Every paged query must order on something unique — `.range()` is LIMIT/OFFSET. */
const PAGE_ORDER = "id"

/** One colour per job, shared by the legend, the bars and the breakdown columns. */
const JOB_COLOURS: Record<Job, string> = {
  cap: "var(--color-accent-blue)",
  base: "var(--color-accent-green)",
  returns: "var(--color-accent-yellow)",
  support: "var(--color-accent-purple)",
}

const JOB_LABELS: Record<Job, string> = {
  cap: "Cap",
  base: "Base",
  returns: "Return",
  support: "Support",
}

const JOB_DETAIL: Record<Job, string> = {
  cap: "captures, flag grabs and time carrying the flag",
  base: "base cleans, mines picked up in your own base, mine kills",
  returns: "returns and assists",
  support: "mines picked up in the enemy base, and mine returns",
}

const JOBS: Job[] = ["cap", "base", "returns", "support"]

/** The raw per-game numbers behind each job, for the column tooltips. */
function jobDetail(row: ProductionRow, job: Job): string {
  const per = (total: number) => (total / Math.max(row.games, 1)).toFixed(1)
  switch (job) {
    case "cap":
      return `${per(row.captures)} caps, ${per(row.grabs)} grabs a game — ${
        row.grabs > 0 ? Math.round((row.captures / row.grabs) * 100) : 0
      }% conversion`
    case "base":
      return `${per(row.clears)} base cleans, ${per(row.homeMines)} own-base mines, ${per(row.mineKills)} mine kills a game`
    case "returns":
      return `${per(row.returns)} returns, ${per(row.assists)} assists a game`
    case "support":
      return `${per(row.awayMines)} enemy-base mines, ${per(row.mineReturns)} mine returns a game`
  }
}

interface ProductionLeaderboardProps {
  year: number
  month: number
  /** Unused by this board; kept so the caller's props match the other boards. */
  isAdmin?: boolean
  scope: "alltime" | "month"
}

interface MatchRow extends ProductionMatch {
  created_at: string
}

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
 * A player's rating, drawn as the four jobs stacked.
 *
 * FULL WIDTH for everyone, on purpose. This column answers "what is this rating made
 * of", which is a question about proportions — and proportions are only comparable
 * between players if the bars are the same length. Magnitude is already the Rating
 * column right next to it, so varying the length too said the same thing twice while
 * making the mixes impossible to compare by eye.
 *
 * Stacked rather than diverging because every part is non-negative: a capper's bar is
 * mostly one blue block, which is the whole point, since not doing a job costs
 * nothing here.
 */
function JobBar({ row }: { row: ProductionRow }) {
  // Share of this player's MATCHES spent in each role — not the share of their
  // points, which is what this used to be.
  //
  // Points-share was actively misleading. Captures are the most expensive thing on
  // the board, so a capper's bar filled with blue and a support player's purple
  // sliver stayed thin no matter how well they played. It read as "capping is the
  // only way to make headway and support is worthless" when it was really just
  // showing which jobs carry the biggest price tags. What a player actually spent
  // the month doing is both more useful and not a value judgement.
  const total = JOBS.reduce((t, j) => t + row.rolesPlayed[j], 0)
  const title = JOBS.filter((j) => row.rolesPlayed[j] > 0)
    .map((j) => `${JOB_LABELS[j]} ${row.rolesPlayed[j]}`)
    .join(" · ")
  return (
    <div className="flex items-center gap-2" title={`Matches played in each role — ${title}`}>
      {/* Naming the main role matters more than it looks. The Support COLUMN is a
          small percentage for everyone, because the scoreboard records little of
          what support does — which reads as "support does not pay" unless you can
          also see that support mains are sitting near the top of the board. They
          are: in August the best median finish of any role was support's. */}
      {total > 0 && (
        <span
          className="shrink-0 text-[11px] font-medium w-14 text-right"
          style={{ color: JOB_COLOURS[row.mainRole] }}
        >
          {JOB_LABELS[row.mainRole]}
        </span>
      )}
      <div
        role="img"
        aria-label={`Matches played in each role: ${title}`}
        className="relative h-3 w-full rounded-sm overflow-hidden bg-[var(--color-surface-elevated)] flex"
      >
        {total > 0 &&
          JOBS.map((job) => {
            const share = (row.rolesPlayed[job] / total) * 100
            if (share <= 0) return null
            return (
              <span key={job} style={{ width: `${share}%`, backgroundColor: JOB_COLOURS[job] }} />
            )
          })}
      </div>
    </div>
  )
}

/**
 * Each job's share of a player's rating, as whole percentages that sum to 100.
 *
 * The Combined table's job columns used to be per-job RATINGS, each standardised
 * against that job's own spread. They were never addends -- "50" stood for a
 * different number of points in every column -- but they looked like addends, and
 * on August adding them up contradicted the actual ranking for 21% of player
 * pairs: fetchd sat 1st on a column sum of 204 while shax sat 10th on 213.
 *
 * Shares cannot do that. They answer the question this view is for -- what is this
 * rating made of -- and nobody reads a percentage as a skill score. How good a
 * player is at a job COMPARED TO OTHERS DOING IT is a different question, and it
 * has its own view: By role.
 *
 * Largest-remainder rounding, because "sums to 100" is the entire point and naive
 * rounding lands on 99 or 101 often enough to undermine it.
 */
function jobShares(row: ProductionRow): Record<Job, number> {
  const total = JOBS.reduce((t, j) => t + row.jobs[j], 0)
  if (!(total > 0)) return { cap: 0, base: 0, returns: 0, support: 0 }

  const exact = JOBS.map((job) => ({ job, value: (row.jobs[job] / total) * 100 }))
  const out = { cap: 0, base: 0, returns: 0, support: 0 } as Record<Job, number>
  for (const { job, value } of exact) out[job] = Math.floor(value)

  let short = 100 - JOBS.reduce((t, j) => t + out[j], 0)
  const byRemainder = [...exact].sort(
    (a, b) => (b.value - Math.floor(b.value)) - (a.value - Math.floor(a.value)),
  )
  for (let i = 0; short > 0; i++, short--) out[byRemainder[i % byRemainder.length].job]++
  return out
}

/** Everything one fetch returns, kept so the day cursor can re-slice it locally. */
interface Fetched {
  matches: MatchRow[]
  statRows: ProductionStatRow[]
  players: ProductionPlayer[]
}

/** UTC day of a match, as YYYY-MM-DD. UTC to match the month bucketing. */
const dayOf = (m: MatchRow) => (m.created_at ?? "").slice(0, 10)

export function ProductionLeaderboard({ year, month, scope }: ProductionLeaderboardProps) {
  const [data, setData] = useState<Fetched | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  /**
   * How far through the month to count, as an index into `matchDays`.
   *
   * null means the whole period, which is what the board shows by default and
   * what every other board shows. Stepping back re-runs the rating over only the
   * matches played up to that day, so the table reads as it stood that night --
   * that is the point of the control, rather than paging between months, which
   * the selector at the top of Stats already does.
   */
  const [dayIndex, setDayIndex] = useState<number | null>(null)
  /**
   * "combined" is the ordinary board. "byrole" splits it into one table per job,
   * rating each player only on the matches they actually played that job.
   *
   * The combined board answers "who produced most this month". It cannot answer
   * "who is the best BC", because it divides a player's base work by every match
   * they played including the ones spent capping — which is exactly the complaint
   * that prompted this view.
   */
  const [view, setView] = useState<"combined" | "byrole">("combined")

  const load = async ({ isStale }: { isStale?: () => boolean } = {}) => {
    const stale = () => isStale?.() ?? false
    setLoading(true)
    setError(null)

    try {
      const supabase = createClient()

      const matchQuery = () => {
        const q = supabase
          .from("matches")
          .select("id, red_team, blue_team, red_score, blue_score, created_at")
          .order(PAGE_ORDER, { ascending: true })
        if (scope === "alltime") return q
        const start = new Date(Date.UTC(year, month - 1, 1))
        const end = new Date(Date.UTC(year, month, 1))
        return q.gte("created_at", start.toISOString()).lt("created_at", end.toISOString())
      }

      const allMatches = (await fetchAll<MatchRow>(matchQuery)).filter(
        (m) => m.red_team?.length && m.blue_team?.length,
      )

      const players = await fetchAll<ProductionPlayer>(() =>
        supabase.from("players").select("id, name, tier_value").order(PAGE_ORDER, { ascending: true }),
      )

      const monthIds = allMatches.map((m) => m.id)
      const statRows =
        scope === "month" && monthIds.length === 0
          ? []
          : await fetchAll<ProductionStatRow>(() => {
              const q = supabase.from("match_stats").select(STAT_COLUMNS).order(PAGE_ORDER, { ascending: true })
              return scope === "month" ? q.in("match_id", monthIds) : q
            })

      if (stale()) return
      setData({ matches: allMatches, statRows, players })
      setDayIndex(null)
    } catch (err) {
      if (stale()) return
      setError(err instanceof Error ? err.message : "Failed to calculate Impact ratings")
    }

    if (stale()) return
    setLoading(false)
  }

  useEffect(() => {
    let cancelled = false
    load({ isStale: () => cancelled })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year, month, scope])

  /**
   * The days that actually saw a statted match, oldest first.
   *
   * Only these are offered as stops. Stepping through every calendar day would
   * mean a dozen presses that change nothing, since the league plays on a
   * handful of nights a month.
   */
  const matchDays = useMemo(() => {
    if (!data) return []
    const statted = new Set(data.statRows.map((r) => r.match_id))
    const days = new Set(data.matches.filter((m) => statted.has(m.id)).map(dayOf).filter(Boolean))
    return [...days].sort()
  }, [data])

  const cutoff = dayIndex == null ? null : matchDays[dayIndex]

  /**
   * The board for the selected slice. Recomputed locally, never refetched — the
   * whole month is already in memory, so stepping a day is instant.
   */
  const board = useMemo(() => {
    if (!data) return null
    const matches = cutoff ? data.matches.filter((m) => dayOf(m) <= cutoff) : data.matches
    const keep = new Set(matches.map((m) => m.id))
    const statRows = cutoff ? data.statRows.filter((r) => keep.has(r.match_id)) : data.statRows
    return computeProductionBoard(
      matches,
      statRows,
      data.players,
      scope === "alltime" ? { minGames: ALL_TIME_MIN_MATCHES } : { minGamesFraction: MONTHLY_MIN_FRACTION },
    )
  }, [data, cutoff, scope])

  const monthLabel = scope === "alltime" ? "every statted match" : `${MONTH_NAMES[month - 1]} ${year}`

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-[var(--color-text)]">
            <Hammer className="w-5 h-5" aria-hidden />
            Impact
            <span className="rounded-full border border-[var(--color-accent-yellow)] px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent-yellow)]">
              Experimental
            </span>
          </h3>
          <p className="max-w-2xl text-sm text-[var(--color-text-dim)]">
            <strong className="text-[var(--color-text)]">
              This board is experimental and the weights may still change.
            </strong>{" "}
            What players actually did in {monthLabel}, totalled up per match — with each thing
            priced by how much it actually swung the games it happened in. Doing none of a job
            costs nothing, and turning up more often does not help. W/L counts for {WIN_PCT} on top.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <HelpCircle className="w-4 h-4 mr-1.5" aria-hidden />
                How it works
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>How the Impact board works</DialogTitle>
                <DialogDescription>
                  It counts what you did in each match, prices each thing, and adds it up.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-5 text-sm text-[var(--color-text-dim)]">
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">The four steps</h4>
                  <ol className="list-decimal list-inside space-y-1">
                    <li>
                      Count your captures, returns, BC kills, mine grabs, assists, flag grabs,
                      mine kills and flag carry time
                    </li>
                    <li>Multiply each by its price and add them together, per match</li>
                    <li>Average over the matches you played, so turning up more does not help</li>
                    <li>
                      Adjust slightly for how strong the opposition was, then add a bit for your
                      W/L record
                    </li>
                  </ol>
                  <p className="mt-2">
                    <strong className="text-[var(--color-text)]">50 is an average month. 62 is a good one.</strong>
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">The prices</h4>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="text-left text-[var(--color-text-dim)]">
                          <th className="py-1 font-medium">One of these</th>
                          <th className="py-1 font-medium text-right">is worth</th>
                        </tr>
                      </thead>
                      <tbody className="tabular-nums">
                        {[
                          ["Capture", "100"],
                          ["Assist", "63"],
                          ["Return", "21"],
                          ["Mine return", "12.5"],
                          ["Flag carry (per min)", "7.7"],
                          ["BC kill", "7"],
                          ["Mine grab, enemy base", "5.2"],
                          ["Mine kill", "3.8"],
                          ["Flag grab", "0.5"],
                          ["Mine grab, own base", "0"],
                        ].map(([label, value]) => (
                          <tr key={label} className="border-t border-[var(--color-border)]/40">
                            <td className="py-1">{label}</td>
                            <td className="py-1 text-right font-mono">{value}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <p className="mt-2">
                    These prices are not guesses. Sora went through ten real scoreboards and
                    rated every player on them for how much they actually swung that game. These
                    are the prices that best reproduce those calls — on games the fit had never
                    seen, they agree with him 92% of the time, against 83% for the prices this
                    board used before.
                  </p>
                  <p className="mt-2">
                    A capture is worth 14 BC kills, but base cleans happen 16 times a game and
                    captures 0.87 times — so they still end up close on the board overall.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    The three rules that make it fair
                  </h4>
                  <p>
                    <strong className="text-[var(--color-text)]">Not doing a job costs nothing.</strong>{" "}
                    Never touch support? You score zero for it, not below. A capper is not marked
                    down for base cleans he never made — he was in the enemy base, which is the
                    job. That is why a column shows a dash rather than a number when you barely
                    played it.
                  </p>
                  <p className="mt-2">
                    <strong className="text-[var(--color-text)]">Nothing decides what role you played.</strong>{" "}
                    Your caps go in Cap and your returns in Return, whoever you are. So switching
                    role mid-game costs you nothing — you are credited for both halves. This is
                    the reason the board works this way at all: scoring by role punished swappers
                    by a full standard deviation.
                  </p>
                  <p className="mt-2">
                    <strong className="text-[var(--color-text)]">A small Support share does not mean support is worth little.</strong>{" "}
                    The scoreboard records almost nothing of what a support player actually does —
                    screening, denying mine switches, holding space — so the Support column is a
                    small slice of everyone&apos;s rating. What it does record is everything else
                    those players do, and they do a lot of it: support players post the highest
                    median production of any role, and in August they had the best median finish
                    on this board. Play support well and you rank well; you just do it through
                    your whole line rather than through one column.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    What it deliberately ignores
                  </h4>
                  <ul className="space-y-1">
                    <li>
                      <strong className="text-[var(--color-text)]">Kills and K/D</strong> — tested
                      three times; they are a base-cleaner stat, not a general one
                    </li>
                    <li>
                      <strong className="text-[var(--color-text)]">Sentry kills</strong> — marks
                      who picks up a sentry, not who played well
                    </li>
                    <li>
                      <strong className="text-[var(--color-text)]">ELO, TrueSkill, score</strong> —
                      all downstream of winning
                    </li>
                    <li>
                      <strong className="text-[var(--color-text)]">Winning</strong> — in, at {WIN_PCT}.
                      Players on the winning side really do rate as more impactful, but a
                      season win rate says much less than a single result does
                    </li>
                  </ul>
                </div>

                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    The one thing to remember
                  </h4>
                  <p>
                    It measures what you produced, not how good you are. It is checked for
                    consistency — the board says the same thing about you from one half of the
                    month to the other. It cannot be checked against winning, because in a league
                    this balanced, win rates are indistinguishable from coin flips.
                  </p>
                  <p className="mt-2">
                    So it is a fair, stable record of output. It is not a ranking of who is best,
                    and it cannot be.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Dialog>
            <DialogTrigger asChild>
              <Button variant="outline" size="sm">
                <ListChecks className="w-4 h-4 mr-1.5" aria-hidden />
                Open questions
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>What we are still unsure about</DialogTitle>
                <DialogDescription>
                  This board is experimental. Here is everything we know is unsettled, so you
                  can argue with it rather than guess at it.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 text-sm text-[var(--color-text-dim)]">
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    Resolved: assists are not paid twice
                  </h4>
                  <p>
                    This was listed as a possible bug and has now been checked. Assists move
                    almost in lockstep with returns across players, which looked like the same
                    act being counted twice. It is not: an assist is a <em>capture</em> assist —
                    you helped someone else score. It runs slightly <em>negative</em> against
                    your own captures, and a team&apos;s assist count tracks that team&apos;s
                    captures at 0.83 (about 1.25 assists per capture) against 0.44 for returns.
                    Returners collect most of them because they are the ones in the middle of the
                    map making it happen, which is where the resemblance came from. Removing
                    assists makes the board markedly less fair, not more.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    Resolved: the prices are now measured, not chosen
                  </h4>
                  <p>
                    They used to be a judgement call about JK2 with nothing behind them. Sora has
                    since gone through ten real scoreboards and rated every player on them for how
                    much they actually swung that game — 121 players, 464 head-to-head judgements.
                    These are the prices that best reproduce those calls, and on games the fit had
                    never seen they agree with him 92% of the time against 83% for the old ones.
                    Two consequences: this <em>reordered</em> his own stat ranking (assists came
                    out second), and base cleans are now worth about half what they were, which is
                    what had a fourth-best base cleaner out-ranking the best returner in the
                    league.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    Resolved: support is not a bad role to play
                  </h4>
                  <p>
                    The Support column is a small share of everyone&apos;s rating, and that is
                    real — the scoreboard records little of what support actually does. It does
                    not mean support does not pay. Support players are rated on their whole line,
                    not their mine grabs, and in August they had the <em>best</em> median finish
                    of any role: the top of the board included two support mains, one of them on a
                    50% win record. A player who did nothing but grab enemy mines would score
                    badly, but that is not a support player.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    Combat is still not measured at all
                  </h4>
                  <p>
                    Kills, K/D and sentry kills were each tested and left out. Every one turned out
                    to be a base-cleaner stat rather than a general one: per minute, base cleaners
                    kill 28% above average and support players only 9%. Base cleaners fight in
                    their own base with mines and a spawn behind them, so this scoreboard can only
                    see combat through their circumstances. Adding K/D lifts base cleaners 6.7% and
                    pushes everyone else down.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    Ten boards is enough to settle direction, not detail
                  </h4>
                  <p>
                    The prices come from 464 judgements across ten games. That is plenty to
                    establish that base cleaning was overpaid and returning underpaid; it is not
                    enough to be precise about any single number. A second batch of labelled
                    boards would tighten them, and could move any individual price.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    Roles are still guessed, but the guess is now measured
                  </h4>
                  <p>
                    Nobody tells the site who played what, so roles are inferred from the
                    scoreboard. Against the ten hand-labelled boards that guess is right{" "}
                    <strong>94%</strong> of the time — perfect for returning and base, and
                    weakest on support at 84%. It used to be an unchecked assumption; it is now a
                    number. Note the combined board never consults a role at all, so this only
                    affects the By role tab and the roles-played bar.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">Not yet checked</h4>
                  <p>
                    June and July have never been eyeballed, only August. The all-time view has
                    not been reviewed at all. The qualifying bar (30% of the month&apos;s statted
                    matches) was inherited from the old board rather than chosen for this one. And
                    the labelled boards are all recent — the prices may fit today&apos;s meta
                    better than June&apos;s.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    What we can never settle here
                  </h4>
                  <p>
                    We cannot check this board against winning. Teams are close enough that win
                    rates come out statistically indistinguishable from coin flips, so there is no
                    scoreboard for &ldquo;who was actually best&rdquo; to test against. What the
                    board <em>is</em> now checked against is Sora&apos;s own judgement of real
                    games — which is a genuine outside standard, and the only one available, but
                    it is one person&apos;s eye rather than a fact about JK2. If he is
                    systematically wrong about something, this board is wrong about it too, and
                    confidently.
                  </p>
                </div>
              </div>
            </DialogContent>
          </Dialog>
          <Button variant="outline" size="sm" onClick={() => load()} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-1.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            Refresh
          </Button>
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-[#ff4757] bg-[#ff4757]/10 px-3 py-2 text-sm text-[#ff4757]">
          {error}
        </div>
      )}

      {loading ? (
        <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg overflow-hidden py-12 text-center text-[var(--color-text-dim)]">Calculating…</div>
      ) : !board || board.rows.length === 0 ? (
        <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg overflow-hidden px-6 py-12 text-center text-[var(--color-text-dim)]">
          {board && board.stattedMatches === 0 ? (
            <>
              No scoreboards for {monthLabel}. Uploads only start from {SCOREBOARD_ERA} — matches
              before then recorded who played and who won, but not what anybody did.
            </>
          ) : (
            <>
              Nobody has played the {board?.minGames ?? 0} statted matches needed to qualify for{" "}
              {monthLabel} yet.
            </>
          )}
        </div>
      ) : (
        <>
          {/* Same box the Wins, ELO and TrueSkill boards use, header strip and
              all, so the four read as one family rather than this one floating
              loose. The board's name is not repeated in here — it is already
              above with the experimental badge, which the other three lack. */}
          <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 p-4 border-b border-[var(--color-border)] text-xs text-[var(--color-text-dim)]">
              {JOBS.map((job) => (
                <span key={job} className="flex items-center gap-1.5">
                  <span
                    className="inline-block w-3 h-3 rounded-sm"
                    style={{ backgroundColor: JOB_COLOURS[job] }}
                    aria-hidden
                  />
                  {JOB_LABELS[job]}
                </span>
              ))}
              <span className="italic">
                {board.rows.length} qualified · {board.minGames}+ statted matches · {board.stattedMatches} with
                scoreboards
              </span>

              {/* Combined vs by-role. Sits with the day cursor because both change
                  what the table below is answering, rather than filtering it. */}
              <div className="ml-auto flex items-center gap-1">
                {(["combined", "byrole"] as const).map((v) => (
                  <button
                    key={v}
                    onClick={() => setView(v)}
                    className="rounded-md px-2 py-1 text-[11px] font-medium transition-colors"
                    style={{
                      border: "1px solid var(--color-border)",
                      background: view === v ? "var(--color-surface-elevated)" : "transparent",
                      color: view === v ? "var(--color-text)" : "var(--color-text-dim)",
                    }}
                  >
                    {v === "combined" ? "Combined" : "By role"}
                  </button>
                ))}
              </div>

              {/* Day cursor, top right. Steps back through the nights the league
                  actually played, re-rating on only the matches up to that point,
                  so the table can be read as it stood on the night. */}
              {scope === "month" && matchDays.length > 1 && (
                <div className="flex items-center gap-1.5">
                  <button
                    onClick={() =>
                      setDayIndex((i) => Math.max(0, (i == null ? matchDays.length - 1 : i) - 1))
                    }
                    disabled={dayIndex === 0}
                    aria-label="Earlier in the month"
                    className="w-6 h-6 rounded-md grid place-items-center transition-colors hover:bg-[var(--color-surface-elevated)] disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ border: "1px solid var(--color-border)" }}
                  >
                    <ChevronLeft className="w-3 h-3" />
                  </button>
                  <span className="min-w-[104px] text-center font-medium not-italic text-[var(--color-text)]">
                    {cutoff
                      ? `up to ${new Date(`${cutoff}T00:00:00Z`).toLocaleDateString("en-GB", {
                          day: "numeric",
                          month: "short",
                          timeZone: "UTC",
                        })}`
                      : `all of ${MONTH_NAMES[month - 1]}`}
                  </span>
                  <button
                    onClick={() =>
                      setDayIndex((i) => (i == null || i >= matchDays.length - 1 ? null : i + 1))
                    }
                    disabled={dayIndex == null}
                    aria-label="Later in the month"
                    className="w-6 h-6 rounded-md grid place-items-center transition-colors hover:bg-[var(--color-surface-elevated)] disabled:opacity-30 disabled:cursor-not-allowed"
                    style={{ border: "1px solid var(--color-border)" }}
                  >
                    <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
              )}
            </div>

            {view === "byrole" ? (
              <div className="divide-y divide-[var(--color-border)]">
                {JOBS.map((job) => {
                  const list = board.rows
                    .filter((r) => r.roleRatings[job] != null)
                    .sort((a, b) => (b.roleRatings[job] ?? 0) - (a.roleRatings[job] ?? 0))
                  if (list.length === 0) return null
                  return (
                    <div key={job} className="p-4">
                      <h4
                        className="mb-2 text-xs font-semibold uppercase tracking-wide"
                        style={{ color: JOB_COLOURS[job] }}
                      >
                        {JOB_LABELS[job]}
                        <span className="ml-2 font-normal normal-case tracking-normal text-[var(--color-text-dim)]">
                          rated against others doing this job
                        </span>
                      </h4>
                      <div className="overflow-x-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-dim)]">
                              <th className="px-2 py-1.5 font-medium">#</th>
                              <th className="px-2 py-1.5 font-medium">Player</th>
                              <th className="px-2 py-1.5 font-medium text-center">Rating</th>
                              <th className="px-2 py-1.5 font-medium text-right">Games in role</th>
                              <th className="px-2 py-1.5 font-medium text-right">Of total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {list.map((r, i) => (
                              <tr
                                key={r.name}
                                className="border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-elevated)]/40"
                              >
                                <td className="px-2 py-1.5 text-[var(--color-text-dim)]">{i + 1}</td>
                                <td className="px-2 py-1.5 font-medium text-[var(--color-text)]">
                                  {r.name}
                                </td>
                                <td
                                  className="px-2 py-1.5 text-center font-mono tabular-nums"
                                  style={{
                                    color:
                                      (r.roleRatings[job] ?? 50) >= 62
                                        ? JOB_COLOURS[job]
                                        : "var(--color-text-dim)",
                                  }}
                                >
                                  {r.roleRatings[job]}
                                </td>
                                <td
                                  className="px-2 py-1.5 text-right tabular-nums"
                                  style={{
                                    // A rating off 3-4 matches is a different kind of
                                    // claim from one off 30. Dim it rather than hide it.
                                    color:
                                      r.rolesPlayed[job] < 5
                                        ? "var(--color-accent-yellow)"
                                        : "var(--color-text-dim)",
                                  }}
                                  title={
                                    r.rolesPlayed[job] < 5
                                      ? "Few matches in this role — treat the rating with caution"
                                      : undefined
                                  }
                                >
                                  {r.rolesPlayed[job]}
                                </td>
                                <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text-dim)]">
                                  {r.games}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )
                })}
              </div>
            ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-dim)]">
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Player</th>
                  <th className="px-2 py-2 font-medium text-right">Rating</th>
                  <th className="px-2 py-2 font-medium text-right">GP</th>
                  <th className="px-2 py-2 font-medium text-right" title={`Counts for ${WIN_PCT} of the rating`}>
                    W-L
                  </th>
                  <th className="px-2 py-2 font-medium min-w-[160px]">Roles played</th>
                  {JOBS.map((job, i) => (
                    <th
                      key={job}
                      className="px-2 py-2 font-medium text-center"
                      style={{ color: JOB_COLOURS[job] }}
                      title={`${JOB_DETAIL[job]} — shown as a share of the rating, so the four add to 100%`}
                    >
                      {JOB_LABELS[job]}
                      {/* Said once, over the first column, so the row of numbers
                          reads as a breakdown rather than four separate scores. */}
                      {i === 0 && (
                        <span className="block text-[10px] font-normal normal-case tracking-normal text-[var(--color-text-dim)]">
                          share of rating →
                        </span>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {board.rows.map((row, i) => {
                  // RankMedal renders nothing past 3rd, so the number has to be
                  // supplied here — same as the other three boards do it. Without
                  // this the rank column is simply blank from 4th down.
                  const isTop3 = i < 3
                  return (
                  <tr
                    key={row.name}
                    className={`border-b border-[var(--color-border)]/50 hover:bg-[var(--color-surface-elevated)]/40 ${
                      isTop3 ? "bg-[#ffd700]/5" : ""
                    }`}
                  >
                    <td className="px-2 py-1.5">
                      {isTop3 ? (
                        <RankMedal index={i} />
                      ) : (
                        <span className="text-[var(--color-text-dim)]">{i + 1}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5 font-medium text-[var(--color-text)]">{row.name}</td>
                    <td className="px-2 py-1.5 text-right font-mono font-semibold text-[var(--color-text)]">
                      {row.rating}
                    </td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text-dim)]">
                      {row.games}
                    </td>
                    <td
                      className="px-2 py-1.5 text-right tabular-nums text-[var(--color-text-dim)]"
                      title={`${row.winPct.toFixed(0)}% — ${row.winAdjustment >= 0 ? "+" : ""}${row.winAdjustment.toFixed(2)} index points`}
                    >
                      {row.wins}-{row.losses}
                      {row.draws > 0 ? `-${row.draws}` : ""}
                    </td>
                    <td className="px-2 py-1.5 min-w-[190px]">
                      <JobBar row={row} />
                    </td>
                    {/* ACROSS EVERY MATCH, not only the ones where this was the
                        player's main job — jobRatings, not roleRatings.

                        These columns used to show the by-role figure, and it made
                        the table contradict itself. A player who returns heavily
                        in every match without returning ever being their MAIN job
                        that game showed a dash under Return, while a player who
                        returned less overall showed a number off the four matches
                        where it happened to be their main job. On August that put
                        original above Interlude on the total with a dash in the
                        column carrying his second-biggest contribution: 245 points
                        a match against 204, displayed as nothing at all.

                        The by-role view answers "who is the best BC", and it still
                        does, on the By role tab. This column has to answer "what is
                        this player's rating made of", so it has to count every
                        match. */}
                    {(() => {
                      const shares = jobShares(row)
                      return JOBS.map((job) => (
                        <td
                          key={job}
                          className="px-2 py-1.5 text-center font-mono tabular-nums"
                          style={{
                            color:
                              shares[job] === 0
                                ? "var(--color-border)"
                                : shares[job] >= 30
                                  ? JOB_COLOURS[job]
                                  : "var(--color-text-dim)",
                          }}
                          title={
                            shares[job] > 0
                              ? `${shares[job]}% of ${row.name}'s rating, across all ${row.games} matches — ${jobDetail(row, job)}. For how they compare against others whose main job this was, see By role.`
                              : `Did none of this job — ${jobDetail(row, job)}. Costs nothing.`
                          }
                        >
                          {shares[job] > 0 ? `${shares[job]}%` : "–"}
                        </td>
                      ))
                    })()}
                  </tr>
                  )
                })}
              </tbody>
              </table>
            </div>
            )}
          </div>

          <p className="text-xs italic text-[var(--color-text-dim)]">
            Rating is on a fixed scale: 50 is an average month, 62 is one standard deviation
            above. The four job columns are shares of that rating and add up to 100% — they say
            what a player&rsquo;s month was <em>made of</em>, not how good they are at each job.
            A low share means they did little of that job, never a penalty. For how someone
            compares against others whose main job it was, use <strong>By role</strong>, which
            rates each job properly within its own cohort. The two answer different questions:
            a player can contribute more returning than someone rated higher there, by doing it
            in every game rather than as their main job in a few. The name beside each bar is the
            role that player spent most of their month in — a small Support share is about what
            the scoreboard can see, not about what the role is worth. Hover any column for the
            real per-game numbers.
          </p>
        </>
      )}
    </div>
  )
}
