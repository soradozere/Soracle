import { findAchievementDef, RARITY_META } from "@/lib/achievement-meta"
import type { AchievementView } from "@/lib/achievements"

// Presentation helpers shared by the Discord flows (unlock ping + =achievements):
// how a rank is named, its crest image URL, profile URL, colour, ordinals.

const ROMAN = ["I", "II", "III", "IV", "V", "VI"]
export const roman = (n: number) => ROMAN[n - 1] ?? String(n)

export const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL ?? "https://jk2ctf.vercel.app").replace(/\/$/, "")
export const slug = (name: string) => encodeURIComponent(name.trim().toLowerCase().replace(/\s+/g, "-"))
export const profileUrl = (name: string) => `${appUrl()}/player/${slug(name)}`
export const imageUrl = (v: AchievementView) => `${appUrl()}/api/achievement-image/${v.id}?rank=${v.rank}`

export function ordinal(n: number): string {
  const s = ["th", "st", "nd", "rd"]
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

// Families with a per-rank title override use that title alone (Unstoppable, Cap
// Legend, MF DOOM); otherwise append the roman numeral for tiered ranks above I.
export function displayName(v: AchievementView): string {
  const base = findAchievementDef(v.id)?.title
  if (v.tiered && v.rank > 1 && v.title === base) return `${v.title} ${roman(v.rank)}`
  return v.title
}

export const colorInt = (v: AchievementView) => parseInt(RARITY_META[v.rarity].color.slice(1), 16)
