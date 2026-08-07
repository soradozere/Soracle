import { unstable_cache } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createAnonClient } from "@/lib/supabase/anon"
import { normaliseTags, type DemoTagId } from "@/lib/demo-tags"
import { demoFileUrl } from "@/lib/r2"

export type Gametype = "CTF" | "FFA" | "TeamFFA"

export interface DemoPlayerTag {
  id: string
  name: string
  avatarUrl: string | null
}

export interface DemoListItem {
  id: string
  title: string
  description: string | null
  map: string
  gametype: Gametype
  recordedAt: string | null
  uploaderName: string | null
  uploaderPlayerId: string | null
  durationMs: number | null
  createdAt: string
  viewCount: number
  protagonist: DemoPlayerTag | null
  tags: DemoTagId[]
  avgRating: number | null
  ratingCount: number
  players: DemoPlayerTag[]
}

export interface DemoPlaylist {
  id: string
  slug: string
  title: string
  description: string | null
  demoCount: number
}

export interface DemoComment {
  id: string
  body: string
  createdAt: string
  author: DemoPlayerTag
}

export interface DemoMoment {
  id: string
  atMs: number
  label: string | null
  tag: string | null
}

export interface DemoDetail extends DemoListItem {
  demoUrl: string
  moments: DemoMoment[]
}

interface DemoRow {
  id: string
  title: string
  description: string | null
  map: string
  gametype: Gametype
  recorded_at: string | null
  uploader_player_id: string | null
  source: "player_upload" | "admin"
  file_path: string
  duration_ms: number | null
  created_at: string
  view_count: number
  protagonist_player_id: string | null
  tags: string[] | null
  announce_in_feed: boolean
}

// The three related tables (who's tagged, who uploaded it, its rating) are
// fetched as their own queries and merged here rather than as PostgREST
// embeds. demo_rating_summary is a view (no FK metadata for PostgREST to
// infer an embed from), so it needs its own query regardless -- doing all
// three the same way keeps this one code path instead of a mix of embedded
// and manual joins.
async function attachRelations(rows: DemoRow[]): Promise<DemoListItem[]> {
  if (rows.length === 0) return []
  const supabase = await createClient()

  const demoIds = rows.map((r) => r.id)
  // Uploaders and protagonists are both just players.id references, so one
  // lookup covers both -- with avatar_url included, since the protagonist
  // treatment on a card needs their picture, not just their name.
  const peopleIds = [
    ...new Set(
      rows.flatMap((r) => [r.uploader_player_id, r.protagonist_player_id]).filter((id): id is string => !!id),
    ),
  ]

  const [tagsResult, peopleResult, ratingsResult] = await Promise.all([
    supabase.from("demo_players").select("demo_id, player:players(id, name, avatar_url)").in("demo_id", demoIds),
    peopleIds.length
      ? supabase.from("players").select("id, name, avatar_url").in("id", peopleIds)
      : Promise.resolve({ data: [] as { id: string; name: string; avatar_url: string | null }[], error: null }),
    supabase.from("demo_rating_summary").select("demo_id, avg_rating, rating_count").in("demo_id", demoIds),
  ])

  const peopleById = new Map(
    (peopleResult.data ?? []).map((p) => [p.id as string, p as { id: string; name: string; avatar_url: string | null }]),
  )
  const ratingByDemoId = new Map(
    (ratingsResult.data ?? []).map((r) => [r.demo_id as string, r as { avg_rating: number; rating_count: number }]),
  )
  // Supabase's untyped client (no generated schema types in this project)
  // infers every embed as an array regardless of cardinality. demo_players.player_id
  // is a to-one FK, so this is really a single object per row at runtime --
  // hence the `unknown` layover before asserting the shape we actually get.
  const tagsByDemoId = new Map<string, DemoPlayerTag[]>()
  const tagRows = (tagsResult.data ?? []) as unknown as { demo_id: string; player: DemoPlayerTag | null }[]
  for (const row of tagRows) {
    if (!row.player) continue
    const list = tagsByDemoId.get(row.demo_id) ?? []
    list.push(row.player)
    tagsByDemoId.set(row.demo_id, list)
  }

  return rows.map((r) => {
    const rating = ratingByDemoId.get(r.id)
    const uploader = r.uploader_player_id ? peopleById.get(r.uploader_player_id) : undefined
    const protagonist = r.protagonist_player_id ? peopleById.get(r.protagonist_player_id) : undefined
    return {
      id: r.id,
      title: r.title,
      description: r.description,
      map: r.map,
      gametype: r.gametype,
      recordedAt: r.recorded_at,
      uploaderName: uploader?.name ?? null,
      uploaderPlayerId: r.uploader_player_id,
      durationMs: r.duration_ms,
      createdAt: r.created_at,
      viewCount: r.view_count,
      protagonist: protagonist
        ? { id: protagonist.id, name: protagonist.name, avatarUrl: protagonist.avatar_url }
        : null,
      // Normalised on the way out as well as the way in: a tag retired from
      // the vocabulary later shouldn't render as a mystery badge.
      tags: normaliseTags(r.tags ?? []),
      avgRating: rating ? Number(rating.avg_rating) : null,
      ratingCount: rating ? Number(rating.rating_count) : 0,
      players: tagsByDemoId.get(r.id) ?? [],
    }
  })
}

export async function listDemos(): Promise<DemoListItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("demos").select("*").order("created_at", { ascending: false })
  if (error || !data) return []
  return attachRelations(data as DemoRow[])
}

export async function getDemo(id: string): Promise<DemoDetail | null> {
  const supabase = await createClient()
  const { data, error } = await supabase.from("demos").select("*").eq("id", id).maybeSingle()
  if (error || !data) return null
  const row = data as DemoRow
  const [[withRelations], { data: moments }] = await Promise.all([
    attachRelations([row]),
    supabase.from("demo_moments").select("id, at_ms, label, tag").eq("demo_id", id).order("at_ms"),
  ])
  return {
    ...withRelations,
    demoUrl: demoFileUrl(row.file_path),
    moments: ((moments ?? []) as { id: string; at_ms: number; label: string | null; tag: string | null }[]).map(
      (m) => ({ id: m.id, atMs: m.at_ms, label: m.label, tag: m.tag }),
    ),
  }
}


/** Just the fields a social share card draws. */
export interface DemoCard {
  title: string
  map: string
  gametype: Gametype
  tags: DemoTagId[]
  protagonist: DemoPlayerTag | null
  players: DemoPlayerTag[]
}

/**
 * A demo's share card, read without a session.
 *
 * Everything else in this file goes through lib/supabase/server.ts, which reads
 * cookies -- and that opts the calling route out of static rendering entirely
 * (see lib/supabase/anon.ts). That is correct for the demo pages, which show an
 * edit affordance to whoever owns the recording. It is wrong for the OG image:
 * that card is identical for every viewer, and the things fetching it are
 * Discord and Twitter's crawlers, which have no session to carry.
 *
 * The PNG itself is kept out of the renderer by a Cache-Control header on the
 * route, not by anything here. What this buys is the two round-trips behind it:
 * on the misses that do reach the function -- a cold card, or a revalidation --
 * the read is served from the Data Cache rather than hitting Supabase again.
 * unstable_cache for the same reason the achievement pages use it (see
 * fetchHistoryRowsUncached in lib/achievements-server.ts): supabase-js issues a
 * plain uncached fetch, which counts as dynamic data and would otherwise leave
 * the render unable to be prerendered at all.
 */
async function fetchDemoCardUncached(id: string): Promise<DemoCard | null> {
  const supabase = createAnonClient()
  const { data, error } = await supabase
    .from("demos")
    .select("title, map, gametype, tags, protagonist_player_id")
    .eq("id", id)
    .maybeSingle()
  if (error || !data) return null
  const row = data as {
    title: string
    map: string
    gametype: Gametype
    tags: string[] | null
    protagonist_player_id: string | null
  }

  const [{ data: tagRows }, leadResult] = await Promise.all([
    supabase.from("demo_players").select("player:players(id, name, avatar_url)").eq("demo_id", id),
    row.protagonist_player_id
      ? supabase.from("players").select("id, name, avatar_url").eq("id", row.protagonist_player_id).maybeSingle()
      : Promise.resolve({ data: null }),
  ])

  // Same to-one-embed-typed-as-array caveat as attachRelations above.
  const embedded = (tagRows ?? []) as unknown as { player: DemoPlayerTag | null }[]
  const lead = leadResult.data as { id: string; name: string; avatar_url: string | null } | null

  return {
    title: row.title,
    map: row.map,
    gametype: row.gametype,
    tags: normaliseTags(row.tags ?? []),
    protagonist: lead ? { id: lead.id, name: lead.name, avatarUrl: lead.avatar_url } : null,
    players: embedded.filter((r) => r.player).map((r) => r.player!),
  }
}

// Keyed on the demo id, which unstable_cache folds into the key alongside the
// name below. Plain objects and arrays only -- a Map would come back as `{}`
// through the JSON round-trip, which is the trap documented in
// lib/achievements-server.ts.
export const getDemoCard = unstable_cache(fetchDemoCardUncached, ["demo-card"], { revalidate: 86400 })

export async function getOwnRating(demoId: string, playerId: string): Promise<number | null> {
  const supabase = await createClient()
  const { data } = await supabase
    .from("demo_ratings")
    .select("rating")
    .eq("demo_id", demoId)
    .eq("player_id", playerId)
    .maybeSingle()
  return data ? Number(data.rating) : null
}

export async function listPlaylists(): Promise<DemoPlaylist[]> {
  const supabase = await createClient()
  const [{ data: playlists, error }, { data: items }] = await Promise.all([
    supabase.from("demo_playlists").select("id, slug, title, description").order("created_at", { ascending: false }),
    supabase.from("demo_playlist_items").select("playlist_id"),
  ])
  if (error || !playlists) return []

  const counts = new Map<string, number>()
  for (const row of (items ?? []) as { playlist_id: string }[]) {
    counts.set(row.playlist_id, (counts.get(row.playlist_id) ?? 0) + 1)
  }
  return (playlists as { id: string; slug: string; title: string; description: string | null }[]).map((p) => ({
    ...p,
    demoCount: counts.get(p.id) ?? 0,
  }))
}

/** A playlist and its demos, in the order the curator put them. */
export async function getPlaylist(
  slug: string,
): Promise<{ playlist: DemoPlaylist; demos: DemoListItem[] } | null> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("demo_playlists")
    .select("id, slug, title, description")
    .eq("slug", slug)
    .maybeSingle()
  if (error || !data) return null
  const playlist = data as { id: string; slug: string; title: string; description: string | null }

  const { data: items } = await supabase
    .from("demo_playlist_items")
    .select("demo_id, position, added_at")
    .eq("playlist_id", playlist.id)
    .order("position")
    .order("added_at")
  const ordered = (items ?? []) as { demo_id: string }[]
  if (ordered.length === 0) {
    return { playlist: { ...playlist, demoCount: 0 }, demos: [] }
  }

  const ids = ordered.map((i) => i.demo_id)
  const { data: rows } = await supabase.from("demos").select("*").in("id", ids)
  const withRelations = await attachRelations((rows ?? []) as DemoRow[])

  // Re-impose the playlist's order: the `in` query comes back in whatever
  // order the table felt like, which is not the one that was curated.
  const byId = new Map(withRelations.map((d) => [d.id, d]))
  const demos = ids.map((id) => byId.get(id)).filter((d): d is DemoListItem => !!d)
  return { playlist: { ...playlist, demoCount: demos.length }, demos }
}

/** Which playlists a demo is already in -- for the admin's edit dialog. */
export async function playlistIdsForDemo(demoId: string): Promise<string[]> {
  const supabase = await createClient()
  const { data } = await supabase.from("demo_playlist_items").select("playlist_id").eq("demo_id", demoId)
  return ((data ?? []) as { playlist_id: string }[]).map((r) => r.playlist_id)
}

export async function listComments(demoId: string): Promise<DemoComment[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("demo_comments")
    .select("id, body, created_at, player:players(id, name, avatar_url)")
    .eq("demo_id", demoId)
    // Newest first: a demo picks up comments over time, and the recent reaction
    // is the one worth reading -- not whatever someone said the day it landed.
    .order("created_at", { ascending: false })
  if (error || !data) return []

  // Same to-one-embed-typed-as-array caveat as attachRelations above.
  const rows = data as unknown as {
    id: string
    body: string
    created_at: string
    player: { id: string; name: string; avatar_url: string | null } | null
  }[]
  return rows
    .filter((r) => r.player)
    .map((r) => ({
      id: r.id,
      body: r.body,
      createdAt: r.created_at,
      author: { id: r.player!.id, name: r.player!.name, avatarUrl: r.player!.avatar_url },
    }))
}

/**
 * Recent uploads for the homepage activity feed.
 *
 * Only demos flagged to announce themselves: the library was seeded in bulk
 * from a folder of old recordings, and none of those were news at the time
 * they landed (see 030_demo_comments_tags_feed.sql).
 */
export async function listFeedDemoUploads(limit = 15): Promise<
  { id: string; title: string; uploaderName: string | null; createdAt: string; gametype: Gametype }[]
> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("demos")
    .select("id, title, gametype, created_at, uploader_player_id")
    .eq("announce_in_feed", true)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error || !data) return []

  const rows = data as {
    id: string
    title: string
    gametype: Gametype
    created_at: string
    uploader_player_id: string | null
  }[]
  const uploaderIds = [...new Set(rows.map((r) => r.uploader_player_id).filter((id): id is string => !!id))]
  const { data: people } = uploaderIds.length
    ? await supabase.from("players").select("id, name").in("id", uploaderIds)
    : { data: [] as { id: string; name: string }[] }
  const nameById = new Map((people ?? []).map((p) => [p.id as string, p.name as string]))

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    gametype: r.gametype,
    createdAt: r.created_at,
    uploaderName: r.uploader_player_id ? (nameById.get(r.uploader_player_id) ?? null) : null,
  }))
}

/** Just enough of a demo to put its name on a button. */
export interface DemoLink {
  id: string
  title: string
}

/**
 * What the end-of-demo overlay offers: back to the one just above this in the
 * sidebar, and somewhere new to go.
 *
 * `previous` stays literal -- the newer demo immediately above this one in the
 * library's newest-first order, matching what clicking through the sidebar by
 * hand would land on. `next` is a random pick from everything else instead:
 * this is the moment someone decides whether to keep watching, and a random
 * clip is a better answer to "what else is there?" than the runner-up to
 * whichever demo happened to upload right after this one -- which for an
 * older demo is usually unrelated, and for the newest demo in the library
 * doesn't exist at all. PostgREST's `.order()` takes a column, not an
 * expression, so there's no `order by random()` to reach for here -- id/title
 * for the whole library (minus this one) is cheap at the library's current
 * size, and picking uniformly from an array is simpler than fighting the
 * query layer for something SQL would do in one line.
 */
export async function getAdjacentDemos(
  id: string,
  createdAt: string,
): Promise<{ previous: DemoLink | null; next: DemoLink | null }> {
  const supabase = await createClient()
  const [newer, others] = await Promise.all([
    supabase
      .from("demos")
      .select("id, title")
      .gt("created_at", createdAt)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase.from("demos").select("id, title").neq("id", id),
  ])
  const previous = newer.data ? { id: newer.data.id, title: newer.data.title } : null
  const pool = (others.data ?? []) as DemoLink[]
  const next = pool.length ? pool[Math.floor(Math.random() * pool.length)] : null
  return { previous, next }
}

export async function listOtherDemos(excludeId: string, limit = 12): Promise<DemoListItem[]> {
  const supabase = await createClient()
  const { data, error } = await supabase
    .from("demos")
    .select("*")
    .neq("id", excludeId)
    .order("created_at", { ascending: false })
    .limit(limit)
  if (error || !data) return []
  return attachRelations(data as DemoRow[])
}
