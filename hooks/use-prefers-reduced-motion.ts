"use client"

import { useEffect, useState } from "react"

/**
 * Respects the OS "reduce motion" setting — we don't auto-animate if it's on.
 *
 * Lives in its own module on purpose. It used to be exported from
 * components/model-viewer.tsx, and that one static import dragged the whole
 * viewer — three.js, react-three-fiber, drei, ~700 KB of it — into every
 * bundle that only wanted this hook, silently defeating the `dynamic()`
 * code-split the callers had set up for the viewer itself. Nothing about a
 * matchMedia listener needs a WebGL renderer in the chunk.
 */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return reduced
}
