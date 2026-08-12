"use client"

import { Emblem } from "@/components/emblem"
import { RankMedal } from "@/components/rank-medal"

export interface WinsRow {
  name: string
  wins: number
  losses: number
  draws: number
  played: number
  form: ("W" | "L")[]
  winPct: number
}

interface WinsLeaderboardProps {
  rows: WinsRow[]
  /** Explains who qualified, e.g. "Players with 6+ matches this month (30% of 19)". */
  qualifier: string
  /** Shown in place of the table when nobody clears the bar. */
  emptyLabel: string
}

/**
 * Won and lost, ranked by win rate.
 *
 * Shared by the monthly Leaderboard tab and the admin All-Time tab, which
 * differ only in which matches they count and who qualifies — the table itself
 * is the same, and a second copy of it would inevitably drift from this one.
 */
export function WinsLeaderboard({ rows, qualifier, emptyLabel }: WinsLeaderboardProps) {
  return (
    <div className="bg-[var(--color-surface)]/60 border border-[var(--color-border)] rounded-lg overflow-hidden">
      <div className="p-4 border-b border-[var(--color-border)]">
        <h3 className="text-lg font-bold text-[var(--color-primary)] flex items-center gap-2">
          <Emblem src="/badges/champion.svg" className="w-5 h-5" />
          Wins Leaderboard
        </h3>
        <p className="text-xs text-[var(--color-text-dim)] mt-1">{qualifier}</p>
      </div>
      {rows.length > 0 ? (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[var(--color-border)] text-[var(--color-text-dim)] text-xs uppercase">
                <th className="px-4 py-3 text-left">#</th>
                <th className="px-4 py-3 text-left">Player</th>
                <th className="px-4 py-3 text-center">Wins</th>
                <th className="px-4 py-3 text-center">Losses</th>
                <th className="px-4 py-3 text-center">Played</th>
                <th className="px-4 py-3 text-right">Win %</th>
                <th className="px-4 py-3 text-center">Form</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((player, index) => {
                const isTop3 = index < 3
                return (
                  <tr
                    key={player.name}
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
                      <span className={`font-medium ${isTop3 ? "text-[#ffd700]" : "text-[var(--color-text)]"}`}>
                        {player.name}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center text-[#27ae60] font-bold">{player.wins}</td>
                    <td className="px-4 py-3 text-center text-[#ff4757] font-bold">{player.losses}</td>
                    <td className="px-4 py-3 text-center text-[var(--color-text)]">{player.played}</td>
                    <td className="px-4 py-3 text-right">
                      <span
                        className={`font-bold ${
                          player.winPct >= 60
                            ? "text-[#27ae60]"
                            : player.winPct >= 40
                              ? "text-[var(--color-text)]"
                              : "text-[#ff4757]"
                        }`}
                      >
                        {player.winPct.toFixed(0)}%
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-1">
                        {player.form.map((result, i) => (
                          <span
                            key={i}
                            className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold ${
                              result === "W" ? "bg-[#27ae60] text-white" : "bg-[#ff4757] text-white"
                            }`}
                          >
                            {result}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="p-8 text-center text-[var(--color-text-dim)]">
          <p>{emptyLabel}</p>
        </div>
      )}
    </div>
  )
}

/**
 * Tally wins, losses and recent form from a set of matches.
 *
 * `matches` must arrive oldest-first, as the match queries return them; form is
 * read from the most recent five backwards, so this reverses before counting.
 */
export function tallyWins(
  matches: { red_team: string[]; blue_team: string[]; red_score: number; blue_score: number }[],
  minMatches: number,
): WinsRow[] {
  const stats = new Map<string, { wins: number; losses: number; draws: number; played: number; form: ("W" | "L")[] }>()

  for (const match of [...matches].reverse()) {
    const redWon = match.red_score > match.blue_score
    const blueWon = match.blue_score > match.red_score

    for (const [team, won, lost] of [
      [match.red_team, redWon, blueWon],
      [match.blue_team, blueWon, redWon],
    ] as const) {
      for (const name of team) {
        if (!stats.has(name)) stats.set(name, { wins: 0, losses: 0, draws: 0, played: 0, form: [] })
        const s = stats.get(name)!
        s.played++
        if (won) {
          s.wins++
          if (s.form.length < 5) s.form.push("W")
        } else if (lost) {
          s.losses++
          if (s.form.length < 5) s.form.push("L")
        }
      }
    }
  }

  return Array.from(stats.entries())
    .map(([name, s]) => ({ name, ...s, winPct: s.played > 0 ? (s.wins / s.played) * 100 : 0 }))
    .filter((p) => p.played >= minMatches)
    .sort((a, b) => {
      if (b.winPct !== a.winPct) return b.winPct - a.winPct
      if (b.wins !== a.wins) return b.wins - a.wins
      return b.played - a.played
    })
}
