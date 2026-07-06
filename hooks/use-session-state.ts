"use client"

import { useEffect, useState } from "react"

// useState that survives client-side navigation by mirroring to sessionStorage.
// The balancer page unmounts when you visit /stats etc. — before the route
// split, tab switches kept picks-in-progress in memory, so this restores that
// behaviour. Session-scoped on purpose: a fresh tab/window starts clean.
//
// Values must round-trip through JSON; pass `revive`/`prepare` to fix up types
// that don't (Dates, Maps). Reads happen lazily in the initializer — safe here
// because the balancer renders a loading gate on first paint, so hydration
// never compares selection-dependent UI.
export function useSessionState<T>(
  key: string,
  initial: T,
  codec?: { revive?: (raw: unknown) => T; prepare?: (value: T) => unknown },
) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initial
    try {
      const stored = window.sessionStorage.getItem(key)
      if (stored === null) return initial
      const parsed = JSON.parse(stored)
      return codec?.revive ? codec.revive(parsed) : (parsed as T)
    } catch {
      return initial
    }
  })

  useEffect(() => {
    try {
      window.sessionStorage.setItem(key, JSON.stringify(codec?.prepare ? codec.prepare(value) : value))
    } catch {
      // Quota/serialization failures just lose persistence, never break the app.
    }
    // codec is intentionally not a dependency: treat it as static per call site.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, value])

  return [value, setValue] as const
}
