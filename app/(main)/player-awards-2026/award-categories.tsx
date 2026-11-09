// Shared between the awards hub (the category grid) and each category's vote
// sub-page, so the two can't drift out of sync on title/slug/icon.

export interface AwardCategory {
  title: string
  blurb?: string
  // Path into one of the site's own Star Wars crest sets (public/badges or
  // public/achievements) rather than a generic icon library.
  icon: string
  color: string
  // "player" votes pick a name off the roster. "quote" is open but freeform --
  // there's no roster to search, so the voter types the quote itself. "closed"
  // categories (a clip, a render) have no vote mechanism yet.
  kind: "player" | "quote" | "closed"
}

export const AWARD_CATEGORIES: AwardCategory[] = [
  { title: "Best overall player", icon: "/badges/champion.svg", color: "#f1c40f", kind: "player" },
  { title: "Best capper", icon: "/badges/top-capper.svg", color: "#62d6e8", kind: "player" },
  { title: "Best chase/ret", icon: "/badges/dbs-god.svg", color: "#9b59b6", kind: "player" },
  { title: "Best camp", icon: "/achievements/mandalorian-guard.svg", color: "#4a90d9", kind: "player" },
  { title: "Best BC", icon: "/badges/top5.svg", color: "#c5c6c7", kind: "player" },
  { title: "Best support", icon: "/achievements/rebel-fist.svg", color: "#2ecc71", kind: "player" },
  { title: "Most fearsome opponent", icon: "/badges/top-kd.svg", color: "#ff4757", kind: "player" },
  { title: "Best teammate", icon: "/badges/star.svg", color: "#ffd700", kind: "player" },
  { title: "Most improved", icon: "/achievements/new-jedi-order.svg", color: "#66fcf1", kind: "player" },
  {
    title: "Best highlight",
    blurb: "The craziest clip of 2026",
    icon: "/achievements/rogue-one.svg",
    color: "#f39c12",
    kind: "closed",
  },
  {
    title: "Render of the year",
    blurb: "Best cinematic to come out of the community.",
    icon: "/badges/tbd.svg",
    color: "#a78bfa",
    kind: "closed",
  },
  {
    title: "Quote of the year",
    blurb: "The wisest, funniest, or weirdest message in-game or in Discord",
    icon: "/badges/other.svg",
    color: "#ec4899",
    kind: "quote",
  },
]

// The DB-facing identifier for a category -- its slug. award_votes_2026.category
// stores this, so it must stay stable even if a title's wording changes later.
export const CATEGORY_SLUGS = AWARD_CATEGORIES.map((c) => categorySlug(c.title))

export function categorySlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
}

// Single-colour silhouette SVGs with no baked-in fill (same convention as
// BadgeIcon) -- tinted via CSS mask so one asset can serve any category colour.
export function CategoryIcon({ icon, color, className }: { icon: string; color: string; className?: string }) {
  const mask = `url(${icon}) center / contain no-repeat`
  return (
    <span
      aria-hidden
      className={className}
      style={{
        display: "inline-block",
        backgroundColor: color,
        WebkitMask: mask,
        mask,
        filter: `drop-shadow(0 0 4px ${color}88)`,
      }}
    />
  )
}
