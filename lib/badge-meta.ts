import type { BadgeId } from "@/lib/player-profile"

// Shared badge presentation (single source of truth for label/colour), used by
// the profile page's badge chips and the balancer Player Cards (which show only
// the player's single best badge). The emblem itself is the custom Star Wars
// SVG at public/badges/<id>.svg, rendered + tinted by <BadgeIcon>. Order of
// BADGE_PRIORITY = prestige, best first.

export const BADGE_META: Record<BadgeId, { label: string; color: string }> = {
  // Champion = topped the public monthly W/L leaderboard.
  champion: { label: "Champion", color: "#f1c40f" },
  // Star Player = the Reports "Star Player of the Month" (upset-weighted win value).
  star: { label: "Star Player", color: "#ffd700" },
  // All-time records (single holder each): highest single-match score, and the
  // most cumulative DBS returns on record.
  highscore: { label: "High Score", color: "#f39c12" },
  "dbs-god": { label: "DBS God", color: "#9b59b6" },
  top5: { label: "Top 5 Finish", color: "#c5c6c7" },
  "top-capper": { label: "Top Capper", color: "#62d6e8" },
  "top-kd": { label: "Top K/D", color: "#ff4757" },
}

export const BADGE_PRIORITY: BadgeId[] = [
  "champion",
  "star",
  "highscore",
  "dbs-god",
  "top5",
  "top-capper",
  "top-kd",
]
