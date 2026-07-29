"use client"

import { useEffect, useState } from "react"

export type ModelUrlState = {
  /** Resolved URL to hand to the viewer, or null while loading / on failure. */
  url: string | null
  loading: boolean
  /** "storage" = signed Supabase URL, "local" = /public fallback (bucket not set up). */
  source: "storage" | "local" | null
  /** Why the fallback was taken, when source is "local". */
  reason: string | null
  error: string | null
}

/**
 * Resolves a model id to a loadable URL via /api/model-url.
 *
 * Fetched once per id and then held: signed URLs are unique per request, and
 * three's GLTF loader caches by URL, so re-resolving the same model would
 * re-download the whole .glb every time. The URL outlives its cached lifetime
 * in the loader either way — a page that stays open past the TTL keeps working
 * because the asset is already in memory.
 */
export function useModelUrl(modelId: string | null | undefined): ModelUrlState {
  const [state, setState] = useState<ModelUrlState>({
    url: null,
    loading: !!modelId,
    source: null,
    reason: null,
    error: null,
  })

  useEffect(() => {
    if (!modelId) {
      setState({ url: null, loading: false, source: null, reason: null, error: null })
      return
    }

    let cancelled = false
    setState({ url: null, loading: true, source: null, reason: null, error: null })

    fetch(`/api/model-url?id=${encodeURIComponent(modelId)}`)
      .then(async (res) => {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || `Failed to resolve model (${res.status})`)
        return data as { url: string; source: "storage" | "local"; reason?: string }
      })
      .then((data) => {
        if (cancelled) return
        setState({ url: data.url, loading: false, source: data.source, reason: data.reason ?? null, error: null })
      })
      .catch((err: Error) => {
        if (cancelled) return
        setState({ url: null, loading: false, source: null, reason: null, error: err.message })
      })

    return () => {
      cancelled = true
    }
  }, [modelId])

  return state
}
