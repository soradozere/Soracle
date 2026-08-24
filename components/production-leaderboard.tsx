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
  computeProductionBoard,
  type Job,
  type ProductionBoard,
  type ProductionMatch,
  type ProductionPlayer,
  type ProductionRow,
  type ProductionStatRow,
} from "@/lib/production-rating"

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
  const title = JOBS.map((j) => `${JOB_LABELS[j]} ${row.jobs[j].toFixed(2)}`).join(" · ")
  return (
    <div className="flex items-center gap-2" title={`${title} — total ${row.value.toFixed(2)}`}>
      <div
        role="img"
        aria-label={title}
        className="relative h-3 w-full rounded-sm overflow-hidden bg-[var(--color-surface-elevated)] flex"
      >
        {JOBS.map((job) => {
          const share = row.value > 0 ? (row.jobs[job] / row.value) * 100 : 0
          if (share <= 0) return null
          return (
            <span key={job} style={{ width: `${share}%`, backgroundColor: JOB_COLOURS[job] }} />
          )
        })}
      </div>
    </div>
  )
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
            What players actually did in {monthLabel}, per minute played — with the jobs priced
            so no role is worth more than another. Doing none of a job costs nothing. W/L counts
            for 25% on top.
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
                  It counts what you did per minute, prices each thing, and adds it up.
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
                    <li>Divide by minutes played, so a short appearance is not punished</li>
                    <li>Multiply each by its price and add them together</li>
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
                          ["Assist", "35"],
                          ["Return", "11"],
                          ["Mine grab", "5"],
                          ["Mine kill / return", "4"],
                          ["BC kill", "3.6"],
                          ["Flag grab", "2.6"],
                          ["Flag carry (per min)", "2"],
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
                    These stats were ranked by Sora, who is open to suggestions on changes.
                  </p>
                  <p className="mt-2">
                    A capture is worth 30 BC kills each, but base cleans happen 16 times a game
                    and captures 0.87 times — so they end up nearly level on the board overall.
                  </p>
                </div>

                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    The two rules that make it fair
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
                      <strong className="text-[var(--color-text)]">Winning</strong> — in, but only
                      25%, because a result says more about the team draw than about you
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
                    Prices set by judgement, not by data
                  </h4>
                  <p>
                    The order of the stats is a call about JK2, not a measurement — nothing in the
                    data can settle what a capture is worth against a base clean. Specifically
                    unconfirmed: a mine grab is currently worth about two flag grabs, and it is
                    what carries the top mine-heavy players. Assists are priced 4th. W/L counts
                    for 25%, which costs some accuracy in exchange for reflecting results.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    Combat is not measured at all
                  </h4>
                  <p>
                    Kills, K/D and sentry kills were each tested and left out. Every one of them
                    turned out to be a base-cleaner stat rather than a general one: per minute,
                    base cleaners kill 28% above average and support players only 9%. Base
                    cleaners fight in their own base with mines and a spawn behind them, so this
                    scoreboard can only see combat through their circumstances. Adding K/D lifts
                    base cleaners 6.7% and pushes everyone else down.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    Support players rate about 13% low
                  </h4>
                  <p>
                    Their only measurable output is mine work. Promoting mine grabs took this from
                    17% to 12%, and sentry kills, kills and base cleans were all tested as fixes
                    and rejected. The rest is missing data rather than bad weighting — the
                    scoreboard does not record most of what a support player actually does.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    The fairness check rests on guessed roles
                  </h4>
                  <p>
                    Weights are tuned until each role&apos;s median player scores the same — but
                    nobody tells us who plays what, so roles are inferred from the scoreboard and
                    that guess agrees with the hand-written roster only about 57% of the time.
                    The measured role gap swung from 2% to 18% purely on a change to how support
                    players were identified. Treat &ldquo;every role pays the same&rdquo; as
                    approximately true, not exactly.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">Not yet checked</h4>
                  <p>
                    June and July have never been eyeballed, only August. The all-time view has
                    not been reviewed at all. The qualifying bar (30% of the month&apos;s statted
                    matches) was inherited from the old board rather than chosen for this one.
                  </p>
                </div>
                <div>
                  <h4 className="font-semibold text-[var(--color-text)] mb-1">
                    What we can never settle here
                  </h4>
                  <p>
                    We cannot check this board against winning. Teams are close enough that win
                    rates come out statistically indistinguishable from coin flips, so there is no
                    scoreboard for &ldquo;who was actually best&rdquo; to test against. Everything
                    above is measured for <em>consistency</em> — the board says the same thing
                    about a player from one half of the month to the other — which is not the same
                    as being right.
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

              {/* Day cursor, top right. Steps back through the nights the league
                  actually played, re-rating on only the matches up to that point,
                  so the table can be read as it stood on the night. */}
              {scope === "month" && matchDays.length > 1 && (
                <div className="ml-auto flex items-center gap-1.5">
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

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--color-border)] text-left text-[var(--color-text-dim)]">
                  <th className="px-2 py-2 font-medium">#</th>
                  <th className="px-2 py-2 font-medium">Player</th>
                  <th className="px-2 py-2 font-medium text-right">Rating</th>
                  <th className="px-2 py-2 font-medium text-right">GP</th>
                  <th className="px-2 py-2 font-medium text-right" title="Counts for 25% of the rating">
                    W-L
                  </th>
                  <th className="px-2 py-2 font-medium min-w-[160px]">What the rating is made of</th>
                  {JOBS.map((job) => (
                    <th
                      key={job}
                      className="px-2 py-2 font-medium text-center"
                      style={{ color: JOB_COLOURS[job] }}
                      title={JOB_DETAIL[job]}
                    >
                      {JOB_LABELS[job]}
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
                    <td className="px-2 py-1.5">
                      <JobBar row={row} />
                    </td>
                    {JOBS.map((job) => (
                      <td
                        key={job}
                        className="px-2 py-1.5 text-center font-mono tabular-nums"
                        style={{
                          color:
                            !row.jobPlayed[job]
                              ? "var(--color-border)"
                              : row.jobRatings[job] >= 62
                                ? JOB_COLOURS[job]
                                : "var(--color-text-dim)",
                        }}
                        title={
                          row.jobPlayed[job]
                            ? `${JOB_LABELS[job]} ${row.jobRatings[job]} — ${jobDetail(row, job)}`
                            : `Barely played this job — ${jobDetail(row, job)}. Costs nothing.`
                        }
                      >
                        {row.jobPlayed[job] ? row.jobRatings[job] : "–"}
                      </td>
                    ))}
                  </tr>
                  )
                })}
              </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs italic text-[var(--color-text-dim)]">
            Every number on this board is the same scale: 50 is an average month, 62 is one
            standard deviation above. The four job columns each say how you did at that job
            specifically, so Base 88 means the same thing as Cap 88. A low one means you did
            little of that job, never a penalty. Hover any of them for the real per-game numbers.
          </p>
        </>
      )}
    </div>
  )
}
