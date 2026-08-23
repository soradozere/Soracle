/**
 * Kill/death ratio, computed one way for the whole site.
 *
 * This exists because the Reports tab and the player profile / Monthly Wrapped
 * used to disagree about the deathless case, and so could name two different
 * "Highest K/D" holders for the same month: Reports dropped anyone with zero
 * deaths from the running entirely, while the profile ranked them at their raw
 * KILL COUNT — not a ratio at all, so 5 kills and no deaths (a "5.00") lost to a
 * genuine 20/2 (a real 10.0), and 30 kills and no deaths would have beaten it.
 *
 * Floor the divisor at one death instead. A deathless player keeps their place
 * in the running (Sora's call, 23 Aug 2026: "if they do somehow get 0 deaths, it
 * should add to their overall K/D as normal"), and the figure stays a ratio on
 * the same scale as everyone else's rather than a different quantity wearing a
 * ratio's label.
 *
 * Worth knowing how rare this is: across the whole match history at the time of
 * writing, no player has ever finished a MONTH deathless (0 of 136 player-months),
 * and exactly one single-match row out of 1,869 was. So this is about the two
 * boards agreeing on principle, not about a case that decides real months.
 */
export function killDeathRatio(kills: number, deaths: number): number {
  return kills / Math.max(deaths, 1)
}
