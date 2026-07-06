import { BADGE_META } from "@/lib/badge-meta"
import type { BadgeId } from "@/lib/player-profile"
import { cn } from "@/lib/utils"

// Renders a badge's custom Star Wars emblem (public/badges/<id>.svg). The SVGs
// are single-colour silhouettes with no baked-in fill, so we paint them via CSS
// mask: backgroundColor = the badge's colour tints the shape, and a matching
// drop-shadow gives the neon glow. This keeps BADGE_META's per-badge colour as
// the single source of truth for both tint and glow.
export function BadgeIcon({ id, className, title }: { id: BadgeId; className?: string; title?: string }) {
  const { color, label } = BADGE_META[id]
  const mask = `url(/badges/${id}.svg) center / contain no-repeat`
  return (
    <span
      role="img"
      aria-label={label}
      title={title}
      className={cn("inline-block shrink-0", className)}
      style={{
        backgroundColor: color,
        WebkitMask: mask,
        mask,
        filter: `drop-shadow(0 0 4px ${color}88)`,
      }}
    />
  )
}
