"use client"

import Link from "next/link"
import { useCallback, useEffect, useLayoutEffect, useRef } from "react"
import type { LucideIcon } from "lucide-react"
import { cn } from "@/lib/utils"

export interface Segment {
  /** Stable identity, and what onSelect reports back. For link rails, use the href. */
  key: string
  label: string
  /** Renders a Link instead of a button. */
  href?: string
  icon?: LucideIcon
  /** Tooltip text (see [data-hint] in globals.css). */
  hint?: string
}

interface SegmentedRailProps {
  segments: Segment[]
  /** Which segment is lit. Nothing is lit when this matches no key — the thumb retracts. */
  activeKey: string | null
  onSelect?: (key: string) => void
  className?: string
  /** Compact variant for in-panel toggles, where the masthead's sizing is too loose. */
  dense?: boolean
  "aria-label"?: string
}

/**
 * One segmented control with a thumb that slides between items, shared by the
 * masthead nav and every in-page view toggle so the site has a single motion.
 *
 * The thumb can't be a CSS-only affair: it has to know each item's measured box,
 * which depends on the label text, the icon, and the font that eventually loads.
 * So it's positioned imperatively and re-measured on the things that actually
 * change that geometry — selection, resize, and the web font landing.
 */
export function SegmentedRail({
  segments,
  activeKey,
  onSelect,
  className,
  dense = false,
  "aria-label": ariaLabel,
}: SegmentedRailProps) {
  const railRef = useRef<HTMLElement>(null)
  const thumbRef = useRef<HTMLSpanElement>(null)

  const place = useCallback((animate: boolean) => {
    const rail = railRef.current
    const thumb = thumbRef.current
    if (!rail || !thumb) return

    const active = rail.querySelector<HTMLElement>('[data-active="true"]')
    if (!active) {
      // Nothing selected (e.g. the masthead on a route that isn't in the nav):
      // retract rather than leaving the thumb parked under a stale item.
      thumb.style.opacity = "0"
      thumb.style.width = "0px"
      return
    }

    if (!animate) rail.dataset.noAnim = "true"
    thumb.style.opacity = "1"
    thumb.style.width = `${active.offsetWidth}px`
    thumb.style.height = `${active.offsetHeight}px`
    thumb.style.transform = `translate(${active.offsetLeft}px, ${active.offsetTop}px)`
    if (!animate) {
      // Clear on the next frame, or the flag would also suppress the next real
      // selection change.
      requestAnimationFrame(() => {
        if (railRef.current) delete railRef.current.dataset.noAnim
      })
    }
  }, [])

  // Layout effect so the thumb is never painted at 0-width before its first
  // measurement. A selection change animates; everything else snaps.
  const first = useRef(true)
  useLayoutEffect(() => {
    place(!first.current)
    first.current = false
  }, [activeKey, segments, place])

  useEffect(() => {
    const onResize = () => place(false)
    window.addEventListener("resize", onResize)
    // Fonts land after first paint and change every label's width.
    document.fonts?.ready.then(() => place(false)).catch(() => {})
    return () => window.removeEventListener("resize", onResize)
  }, [place])

  return (
    <nav ref={railRef} className={cn("seg-rail", className)} aria-label={ariaLabel}>
      <span ref={thumbRef} className="seg-thumb" aria-hidden />
      {segments.map((seg) => {
        const active = seg.key === activeKey
        const Icon = seg.icon
        const inner = (
          <>
            {Icon && <Icon className="w-3.5 h-3.5 opacity-85" />}
            {seg.label}
          </>
        )
        const shared = {
          className: cn("seg-item", dense && "px-3 py-2 text-xs"),
          "data-active": active,
          "data-hint": seg.hint,
          "aria-current": active ? ("page" as const) : undefined,
        }

        return seg.href ? (
          <Link key={seg.key} href={seg.href} {...shared}>
            {inner}
          </Link>
        ) : (
          <button
            key={seg.key}
            type="button"
            onClick={() => onSelect?.(seg.key)}
            aria-pressed={active}
            {...shared}
          >
            {inner}
          </button>
        )
      })}
    </nav>
  )
}
