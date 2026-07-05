import { Crown, Star, Medal, Flag, Crosshair, type LucideIcon } from "lucide-react"
import type { BadgeId } from "@/lib/player-profile"

// Shared badge presentation (single source of truth for label/colour/icon),
// used by the profile page's badge chips and the balancer Player Cards (which
// show only the player's single best badge). Order of BADGE_PRIORITY =
// prestige, best first.

export const BADGE_META: Record<BadgeId, { label: string; color: string; icon: LucideIcon }> = {
  // Champion = topped the public monthly W/L leaderboard.
  champion: { label: "Champion", color: "#f1c40f", icon: Crown },
  // Star Player = the Reports "Star Player of the Month" (upset-weighted win value).
  star: { label: "Star Player", color: "#ffd700", icon: Star },
  top5: { label: "Top 5 Finish", color: "#c5c6c7", icon: Medal },
  "top-capper": { label: "Top Capper", color: "#62d6e8", icon: Flag },
  "top-kd": { label: "Top K/D", color: "#ff4757", icon: Crosshair },
}

export const BADGE_PRIORITY: BadgeId[] = ["champion", "star", "top5", "top-capper", "top-kd"]
