import { createClient } from "@/lib/supabase/server"

// Server-only helpers for the /player/[slug] page metadata + OG image. Kept
// separate from lib/player-profile.ts because that module uses the browser
// Supabase client; metadata/image routes run on the server. Only a tiny slice
// of the player row is needed here (no match history), so this stays cheap.

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

export interface MetaPlayer {
  name: string
  tier: number
  slogan: string | null
  avatarUrl: string | null
}

// Resolve a URL slug to the minimal player fields used by metadata/OG. Returns
// null if not found — and degrades to null (rather than throwing) if the
// avatar_url column isn't present yet, i.e. before migration 014 has run.
export async function findPlayerForMeta(slug: string): Promise<MetaPlayer | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("players").select("name, tier_value, tooltip, avatar_url")
  if (error || !data) return null

  let decoded = slug
  try {
    decoded = decodeURIComponent(slug)
  } catch {
    // keep raw slug
  }
  const target = decoded.trim().toLowerCase()
  const row = data.find(
    (p: { name: string }) => p.name.trim().toLowerCase().replace(/\s+/g, "-") === target,
  ) as { name: string; tier_value: number; tooltip: string | null; avatar_url: string | null } | undefined
  if (!row) return null

  return {
    name: row.name,
    tier: row.tier_value,
    slogan: row.tooltip ?? null,
    avatarUrl: row.avatar_url ?? null,
  }
}

export function tierLabel(tier: number): string {
  return `Tier ${tier} — ${TIER_NAMES[tier] ?? "Unranked"}`
}

// Two-letter monogram used by the OG image when no avatar is set (mirrors the
// initials shown on the profile itself).
export function initialsOf(name: string): string {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()
}
