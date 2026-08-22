/*
 * Deterministic tie-breaking for player rankings.
 *
 * Every ranking here — leaderboards, monthly honours, Star Player, the records
 * cards, the bot's boards — ends in a tie eventually, and a comparator that runs
 * out of keys leaves the winner to Array.prototype.sort's stability, i.e. to the
 * order the rows arrived in. That order comes from Supabase queries which mostly
 * carry no ORDER BY, so it is unspecified Postgres row order: it changes when a
 * row is updated, when a page boundary moves, or for no visible reason at all.
 *
 * The observable symptom is a badge or a board place that belongs to one of two
 * indistinguishable players and silently swaps between page loads — and, where a
 * ranking feeds the seasonal ladders, a title BANKED PERMANENTLY to whichever
 * player the database happened to return first (lib/titles-server.ts).
 *
 * This is the same failure family as the 22 Aug 2026 balancer incident, where a
 * rule that assumed a unique strongest player picked an arbitrary one of two
 * tied 9s and stacked the teams. Rule of thumb going in: if a comparator can
 * return 0 for two different players, it is not finished.
 *
 * `rankBy` closes the comparator with the player's name, which is unique on the
 * players table and stable across loads. Alphabetical is arbitrary as a matter
 * of fairness — but it is arbitrary ONCE, not arbitrary per page load, and an
 * award that has to break a genuine tie should at least break it the same way
 * every time it is asked.
 */

/** Wraps a comparator so ties resolve by name instead of by database row order. */
export function rankBy<T>(nameOf: (x: T) => string, compare: (a: T, b: T) => number) {
  return (a: T, b: T) => compare(a, b) || nameOf(a).localeCompare(nameOf(b))
}

/** `rankBy` for the common case of a `{ name }` row. */
export function rankByName<T extends { name: string }>(compare: (a: T, b: T) => number) {
  return rankBy<T>((x) => x.name, compare)
}
