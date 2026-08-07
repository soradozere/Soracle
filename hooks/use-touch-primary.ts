"use client"

import { useEffect, useState } from "react"

/**
 * Whether touch is this device's primary input.
 *
 * `(hover: none) and (pointer: coarse)` rather than a userAgent test, and
 * rather than "is the screen small": the question is what the input device can
 * do. A laptop with a touchscreen can still hover and still has a mouse, so it
 * is not this; a phone in landscape is, at any width.
 *
 * The same test gates whether the demo engine starts at all (see
 * demo-viewer.tsx), so anything deciding what to offer a touch device should
 * ask it the same way rather than inventing a second, subtly different answer.
 *
 * False during the server render and until the first effect, which is the
 * existing convention in this codebase and avoids a hydration mismatch. That
 * means touch devices briefly render the desktop answer. Fine for choosing
 * between camera modes; not fine for anything destructive, which should be
 * hidden in CSS so it is never offered even for a frame -- see the trim panel.
 */
export function useTouchPrimary(): boolean {
  const [touch, setTouch] = useState(false)
  useEffect(() => {
    setTouch(window.matchMedia("(hover: none) and (pointer: coarse)").matches)
  }, [])
  return touch
}
