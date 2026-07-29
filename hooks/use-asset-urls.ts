"use client"

import { useEffect, useState } from "react"

export type AssetUrlsState = {
  /** id → loadable URL, or null until every one has resolved. */
  urls: Record<string, string> | null
  loading: boolean
  error: string | null
}

/**
 * One flush per tick, not one request per id.
 *
 * A dressed profile mounts several of these hooks in the same commit — skin
 * textures, saber hilt, blade pair, mines, flag — and each id as its own
 * request meant ~10 serverless invocations, each doing its own storage
 * round trip, before the first prop could draw. Everything that asks within
 * the same tick is collected here and resolved by a single `?ids=` request,
 * which the route answers with one createSignedUrls call.
 *
 * Deliberately NOT a cache: entries live only until the flush. A cache of
 * signed URLs would need TTL bookkeeping to avoid handing a component a URL
 * that expired while the page sat open — batching only what's simultaneous
 * sidesteps the whole problem.
 */
type Waiter = { resolve: (url: string) => void; reject: (err: Error) => void }
let queue: Map<string, Waiter[]> | null = null

function resolveAssetUrl(id: string): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!queue) {
      queue = new Map()
      setTimeout(flushQueue, 0)
    }
    const waiters = queue.get(id) ?? []
    waiters.push({ resolve, reject })
    queue.set(id, waiters)
  })
}

async function flushQueue() {
  const batch = queue
  queue = null
  if (!batch) return

  try {
    const ids = [...batch.keys()]
    const res = await fetch(`/api/model-url?ids=${ids.map(encodeURIComponent).join(",")}`)
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.error || `Failed to resolve assets (${res.status})`)

    const urls = data.urls as Record<string, string>
    for (const [id, waiters] of batch) {
      const url = urls[id]
      if (url) for (const w of waiters) w.resolve(url)
      else for (const w of waiters) w.reject(new Error(`No URL for ${id}`))
    }
  } catch (err) {
    const error = err instanceof Error ? err : new Error("Failed to resolve assets")
    for (const waiters of batch.values()) for (const w of waiters) w.reject(error)
  }
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

    Promise.all(wanted.map(async (id) => [id, await resolveAssetUrl(id)] as const))
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
