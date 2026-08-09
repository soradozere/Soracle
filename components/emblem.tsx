import type React from "react"
import { cn } from "@/lib/utils"

// Renders any of the site's single-colour Star Wars SVGs (public/badges/*,
// public/achievements/*) as a tintable glyph.
//
// Same trick as <BadgeIcon>: the artwork has no baked-in fill, so it's applied
// as a CSS mask and painted with a background colour. The difference is that
// BadgeIcon is keyed to BADGE_META — it can only draw the seven monthly badges,
// and takes its colour from that table. This takes an arbitrary path and colour,
// which is what the Stats page needs to put faction crests behind panels and
// tint a row's emblem with that row's accent.
//
// Defaults to `currentColor`, so a parent can set the tint for a whole row.
export function Emblem({
  src,
  className,
  color = "currentColor",
  glow = false,
  title,
  label,
  style,
}: {
  src: string
  className?: string
  color?: string
  /** Adds the neon drop-shadow. Off for watermarks, which are already soft. */
  glow?: boolean
  title?: string
  label?: string
  /** Merged over the mask/paint styles — for positioning or animation vars. */
  style?: React.CSSProperties
}) {
  const mask = `url(${src}) center / contain no-repeat`
  return (
    <span
      role={label ? "img" : "presentation"}
      aria-label={label}
      aria-hidden={label ? undefined : true}
      title={title}
      className={cn("inline-block shrink-0", className)}
      style={{
        backgroundColor: color,
        WebkitMask: mask,
        mask,
        filter: glow ? `drop-shadow(0 0 4px ${color})` : undefined,
        ...style,
      }}
    />
  )
}
