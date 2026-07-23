"use client"

import { useEffect, useState } from "react"

// Same /api/player-auth/me check as HomeProfileButton and PlayerNavButton —
// only knowable client-side, so "Welcome back" renders immediately and the
// ", Name" suffix pops in once the session check resolves.
export function HomeGreetingName() {
  const [name, setName] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    fetch("/api/player-auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (active) setName(data.playerId ? data.name : null)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])

  if (!name) return null
  return <>, {name}</>
}
