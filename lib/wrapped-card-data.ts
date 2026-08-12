/*
 * The shape of a shareable Wrapped card.
 *
 * There is no component here any more. The card started as JSX that was printed
 * to PDF, which meant browser headers, paper margins and three pages; it is now
 * drawn to a canvas in lib/wrapped-card-image.ts, which gives an exact PNG with
 * no chrome. This type is what the two ends agree on.
 */
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
