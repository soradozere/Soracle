/**
 * The servers `/live` can watch, for the page's benefit only.
 *
 * This is presentation, not permission. The engine carries its own compiled
 * allowlist and the bridge independently verifies that a token was minted for
 * the index it is being presented with -- so an entry here that the other two
 * do not agree with simply fails to connect, rather than reaching anything it
 * should not.
 *
 * It exists separately because the page needs to answer "is anything on?"
 * *before* it downloads a 125MB engine, and the engine's allowlist is only
 * readable once that engine is running. `index` must match the engine's
 * ordering and the bridge's `--server-index`.
 *
 * Adding a server also needs: a bridge process pointed at it, a route to reach
 * that bridge over TLS, and a line in the engine's `jkd_servers[]` (which means
 * a rebuild). See project notes before assuming this file is the whole job.
 */
export interface LiveServer {
  index: number
  name: string
  /** Where the bridge reports what is happening. Public, unauthenticated. */
  statusUrl: string
}

export const LIVE_SERVERS: LiveServer[] = [
  {
    index: 0,
    name: "NA East",
    statusUrl:
      process.env.NEXT_PUBLIC_LIVE_STATUS_URL ?? "https://34-182-186-217.sslip.io/status",
  },
]

/** What a bridge's /status endpoint returns. */
export interface LiveStatus {
  online: boolean
  viewers: number
  players: number
  clients: number
  map: string | null
  hostname: string | null
  gametype: string | null
}

/**
 * A one-line summary of a server's state, for a picker row or a header.
 *
 * Deliberately says "Nothing live right now" for both a quiet server and an
 * unreachable one: to someone deciding whether to watch, those are the same
 * answer, and the difference is ours to worry about rather than theirs.
 */
export function describeLiveStatus(status: LiveStatus | null): string {
  if (!status || !status.online) return "Nothing live right now"
  return [
    status.map ?? "unknown map",
    `${status.players} playing`,
    status.viewers > 0 && `${status.viewers} watching`,
  ]
    .filter(Boolean)
    .join(" · ")
}
