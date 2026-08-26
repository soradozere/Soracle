import { NextResponse } from "next/server"
import { requireBearer } from "@/lib/bearer-auth"
import { createClient } from "@/lib/supabase/server"
import { mapDbPlayer } from "@/lib/fetch-players-db"
import type { NwhMapping, PlayerAlias } from "@/lib/name-match"
import type { Player } from "@/lib/types"

/**
 * Auth gate for bot-facing API routes: requires `Authorization: Bearer <BOT_API_SECRET>`.
 * Returns a 401 response to send back, or null when the request is authorized.
 * Fails closed (401) when BOT_API_SECRET is not configured.
 */
export function requireBotAuth(request: Request): NextResponse | null {
  return requireBearer(request, process.env.BOT_API_SECRET)
}

/**
 * Server-side counterpart of fetchPlayersFromDB (which uses the browser client):
 * same query shape and row mapping, on the server Supabase client. Reads work
 * without a user session via the players_select_all RLS policy. Throws on query
 * failure — unlike fetchPlayersFromDB's empty-array fallback — so routes return
 * a 500 instead of treating every Discord ID as unlinked.
 */
export async function fetchPlayersForBot(): Promise<Player[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("players").select("*").order("name")

  if (error) {
    throw new Error(`Failed to fetch players from database: ${error.message}`)
  }

  return (data || []).map(mapDbPlayer)
}

/**
 * Known player aliases for server-side name resolution (the bot ingest endpoint).
 * Public-readable via the player_aliases_select_all RLS policy, so the anon-backed
 * server client suffices. Throws on query failure.
 */
export async function fetchAliasesForBot(): Promise<PlayerAlias[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("player_aliases").select("player_id, alias")

  if (error) {
    throw new Error(`Failed to fetch player aliases from database: ${error.message}`)
  }

  return data ?? []
}

/**
 * Confirmed nwh_id -> player_id mappings for server-side name resolution (the
 * bot ingest endpoint). Public-readable via the player_nwh_ids_select_all RLS
 * policy, so the anon-backed server client suffices. Throws on query failure.
 */
export async function fetchNwhIdsForBot(): Promise<NwhMapping[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("player_nwh_ids").select("player_id, nwh_id")

  if (error) {
    throw new Error(`Failed to fetch nwh ids from database: ${error.message}`)
  }

  return data ?? []
}

/**
 * Parses the `?since=<ISO timestamp>` window shared by the changelog endpoints
 * (tier-changelog, title-changelog), which the bot polls on a timer.
 *
 * Omitted means "no lower bound" — the first poll of a fresh bot, before it has
 * a high-water mark to send. Anything unparseable is a 400 rather than a silent
 * fall-through to the unbounded read: a poller with a broken clock or a
 * mis-encoded param would otherwise re-announce the entire history on every
 * tick, and the whole point of these endpoints is to ping people exactly once.
 *
 * Returns the caller's string VERBATIM (or null for no bound), or a 400 to send back.
 *
 * Verbatim is load-bearing. An earlier version returned `new Date(raw).toISOString()`,
 * which looks like harmless normalization and is in fact a re-announce bug: Postgres
 * timestamptz keeps MICROseconds, a JS Date keeps MILLIseconds. Round-tripping
 * "…41.054038+00:00" through Date yields "…41.054Z", which is strictly EARLIER than
 * the row it came from — so `> since` matched that row again, the poller was handed
 * back its own cursor row on every tick, and the same player got pinged forever.
 * Date is used here only to answer "is this a timestamp at all"; the value handed to
 * PostgREST is the caller's own, compared by Postgres at full precision.
 */
export function parseSinceParam(request: Request): { since: string | null } | NextResponse {
  const raw = new URL(request.url).searchParams.get("since")
  if (!raw) return { since: null }

  if (Number.isNaN(new Date(raw).getTime())) {
    return NextResponse.json({ error: "invalid `since` — expected an ISO timestamp" }, { status: 400 })
  }
  return { since: raw }
}

/**
 * A timestamptz from PostgREST, rendered so a bot can echo it straight back as
 * `?since=` without encoding it.
 *
 * PostgREST hands back "2026-08-26T18:17:41.054038+00:00". That '+' is a SPACE in a
 * query string, so a poller that reuses the value unencoded — the obvious thing to
 * write — gets a permanent 400 rather than a working cursor. Swapping the UTC offset
 * for 'Z' is a pure notation change that keeps every microsecond, so the cursor stays
 * exact (see parseSinceParam) while becoming URL-safe. It also matches the 'Z'-suffixed
 * shape the bot's spec asked for.
 */
export function toIsoUtc(timestamp: string): string {
  if (timestamp.endsWith("Z")) return timestamp
  if (timestamp.endsWith("+00:00")) return `${timestamp.slice(0, -"+00:00".length)}Z`
  // A non-UTC offset shouldn't occur (Supabase serves UTC), but if it ever did,
  // correctness beats precision: convert properly and accept millisecond truncation.
  return new Date(timestamp).toISOString()
}
