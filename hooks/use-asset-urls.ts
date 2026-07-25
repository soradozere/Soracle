"use client"

import { useEffect, useState } from "react"

export type AssetUrlsState = {
  /** id → loadable URL, or null until every one has resolved. */
  urls: Record<string, string> | null
  loading: boolean
  error: string | null
}

/**
 * Resolves several asset ids to loadable URLs through /api/model-url.
 *
 * All-or-nothing on purpose. A saber needs its hilt and both blade textures, and
 * handing the renderer a half-resolved set would draw a hilt with an untextured
 * blade, or suspend forever on the missing one. Callers get a single object once
 * everything is ready.
 *
 * See useModelUrl for why these are fetched once and held rather than refreshed
 * against the signed URL's TTL.
 */
export function useAssetUrls(ids: string[] | null): AssetUrlsState {
  // Callers build these arrays inline, so a fresh identity every render would
  // restart the fetch on every render. Compare by content instead.
  const key = ids ? ids.join(",") : ""

  // The resolved set is tagged with the ids it was resolved FOR. Without that,
  // there is a render where a caller has already switched to a new set — a new
  // saber colour, say — but the effect hasn't run yet, so it reads the previous
  // set's map with the new set's keys and gets undefined for every one. Handing
  // that to a loader throws "Could not load undefined: undefined".
  const [state, setState] = useState<AssetUrlsState & { key: string }>({
    key,
    urls: null,
    loading: key.length > 0,
    error: null,
  })

  useEffect(() => {
    const wanted = key ? key.split(",") : []
    if (wanted.length === 0) {
      setState({ key, urls: null, loading: false, error: null })
      return
    }

    let cancelled = false
    setState({ key, urls: null, loading: true, error: null })

    Promise.all(
      wanted.map(async (id) => {
        const res = await fetch(`/api/model-url?id=${encodeURIComponent(id)}`)
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Failed to resolve ${id} (${res.status})`)
        return [id, data.url as string] as const
      }),
    )
      .then((pairs) => {
        if (cancelled) return
        setState({ key, urls: Object.fromEntries(pairs), loading: false, error: null })
      })
      .catch((err: Error) => {
        if (cancelled) return
        setState({ key, urls: null, loading: false, error: err.message })
      })

    return () => {
      cancelled = true
    }
  }, [key])

  // Report nothing until what we hold is what was actually asked for.
  if (state.key !== key) return { urls: null, loading: key.length > 0, error: null }
  return { urls: state.urls, loading: state.loading, error: state.error }
}
