import { RARITY_META, type Rarity } from "@/lib/achievement-meta"

// Achievement Score turns a player's crest collection into one comparable number.
//
// Two decisions worth stating, because they're what give the number its shape:
//
//  1. Every RANK counts, not every crest. Climbing On Fire I -> II -> III scores
//     all three, so a deep ladder rewards the grind rather than only the summit.
//     This falls out of the ledger for free: it already stores one entry per rank
//     crossed, which is exactly what we want to sum.
//
//  2. The curve is steep on purpose. A Mythic is worth fifty Commons, so the
//     board can't be climbed by farming easy crests — the top of the table has to
//     be earned with rare ones. Grinding still moves you, it just can't win.
export const RARITY_POINTS: Record<Rarity, number> = {
  common: 1,
  rare: 3,
  epic: 8,
  legendary: 20,
  mythic: 50,
  oneofone: 150,
}

export const scoreFor = (rarities: Iterable<Rarity>) => {
  let total = 0
  for (const r of rarities) total += RARITY_POINTS[r]
  return total
}

// The rarest thing a player holds — drives their accent colour on the board, so
// one Legendary reads at a glance without having to parse the breakdown.
export function bestRarity(rarities: Iterable<Rarity>): Rarity | null {
  let best: Rarity | null = null
  for (const r of rarities) {
    if (!best || RARITY_META[r].order > RARITY_META[best].order) best = r
  }
  return best
}

export const RARITY_ORDER: Rarity[] = (Object.keys(RARITY_META) as Rarity[]).sort(
  (a, b) => RARITY_META[a].order - RARITY_META[b].order,
)
