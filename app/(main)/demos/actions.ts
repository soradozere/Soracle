"use server"

import { cookies } from "next/headers"
import type { DemoMoment } from "@/lib/demos-server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { titleIssue } from "@/lib/demo-title"
import { normaliseTags } from "@/lib/demo-tags"
import { maskSlurs } from "@/lib/profanity"
import { createDemoUploadUrl, deleteDemoFile, headDemoFile } from "@/lib/r2"

const GAMETYPES = ["CTF", "FFA", "TeamFFA"] as const

/**
 * A .dm_15's size is not a fixed rate -- a dense two-minute highlight clip
 * (lots of combat, lots of entity deltas every frame) measures in at roughly
 * 30-35KB/s across the demos already here, while a quiet stretch of a full
 * match can be under 2KB/s. So this is a policy line, not a precise duration
 * bound.
 *
 * It was 5MB, on the reasoning that a full match had no business here and the
 * library was for highlights. Raised to 100MB because the thing that made a
 * long upload a dead end no longer holds: trimming works on player-recorded
 * demos as of engine 20260805-0954, and an uploader can cut their own demo
 * (see resolveEditor). "Post the whole match, then trim the bit worth
 * watching" is now a real workflow rather than a request for an admin.
 *
 * Storage is not what this limit protects. The whole library is under 20MB
 * against a 10GB free tier; the binding cost is that the viewer downloads a
 * demo in full before playback starts -- there is no range streaming -- so a
 * 100MB upload is a 100MB wait for every single person who watches it. That
 * is the reason to keep a ceiling at all, and the reason the trim prompt
 * matters more than the number does.
 *
 * Admins keep a higher ceiling for the deliberately special recording.
 */
const MAX_DEMO_BYTES_PLAYER = 100 * 1024 * 1024
const MAX_DEMO_BYTES_ADMIN = 150 * 1024 * 1024

type ActionResult = { success: true; id: string } | { success: false; error: string }

// Either a logged-in player (their own soracle_player cookie) or a Supabase
// Auth admin may publish a demo. Whoever it is, the actual write always goes
// through the service-role client -- players were never granted a direct
// RLS insert policy on demos (see 027_create_demos_tables.sql), so this
// function is the only door in, and it's the one place that has to agree on
// who's allowed through it.
async function resolveUploader(): Promise<
  { ok: true; playerId: string | null; source: "player_upload" | "admin" } | { ok: false; error: string }
> {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (playerId) return { ok: true, playerId, source: "player_upload" }

  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "You need to be logged in to upload a demo." }
  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (!isAdmin) return { ok: false, error: "Not authorized." }
  return { ok: true, playerId: null, source: "admin" }
}

type BeginUploadResult =
  | { success: true; url: string; storagePath: string }
  | { success: false; error: string }

/**
 * First half of an upload: authorise it and hand back a signed PUT URL.
 *
 * The browser sends the file straight to R2 -- it cannot go through this
 * server, because Vercel rejects request bodies over ~4.5MB before our code
 * ever runs, which would silently cap every real match. The URL is signed
 * over the declared byte size, so it can only carry a file of exactly that
 * size, and finishDemoUpload re-checks what actually landed before anything
 * reaches the database.
 */
export async function beginDemoUpload(fileName: string, sizeBytes: number): Promise<BeginUploadResult> {
  const auth = await resolveUploader()
  if (!auth.ok) return { success: false, error: auth.error }

  if (!/\.dm_15$/i.test(fileName)) {
    return { success: false, error: "Only JK2 .dm_15 demos are supported (not JKA's .dm_25/.dm_26)." }
  }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return { success: false, error: "Choose a demo file." }
  }
  const maxBytes = auth.source === "admin" ? MAX_DEMO_BYTES_ADMIN : MAX_DEMO_BYTES_PLAYER
  if (sizeBytes > maxBytes) {
    const capMB = Math.round(maxBytes / (1024 * 1024))
    return {
      success: false,
      error:
        auth.source === "admin"
          ? "File is too large for a demo recording."
          : `Demos are capped at ${capMB}MB for regular uploads. Ask an admin to publish anything longer.`,
    }
  }

  const storagePath = `${crypto.randomUUID()}.dm_15`
  try {
    const url = await createDemoUploadUrl(storagePath, sizeBytes)
    return { success: true, url, storagePath }
  } catch (e) {
    return { success: false, error: `Could not start the upload: ${e instanceof Error ? e.message : "unknown error"}` }
  }
}

// What beginDemoUpload hands out, and the only shape finishDemoUpload will
// accept back -- anything else could point a new row at somebody else's file.
const STORAGE_PATH_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.dm_15$/

/**
 * Second half: the file is in R2, now check it and record the metadata.
 *
 * Trust nothing from the first half. The caller is re-authorised, the stored
 * object is measured with a HEAD rather than believing the declared size, and
 * the path must be a fresh UUID name that no existing demo already claims --
 * otherwise two rows could share one file, and deleting either would tear the
 * file out from under the other.
 */
export async function finishDemoUpload(storagePath: string, formData: FormData): Promise<ActionResult> {
  const auth = await resolveUploader()
  if (!auth.ok) return { success: false, error: auth.error }

  if (!STORAGE_PATH_RE.test(storagePath)) return { success: false, error: "Malformed upload reference." }

  const title = String(formData.get("title") ?? "").trim()
  const map = String(formData.get("map") ?? "").trim()
  const gametype = String(formData.get("gametype") ?? "")
  const recordedAt = String(formData.get("recordedAt") ?? "").trim() || null
  const taggedPlayerIds = formData.getAll("playerIds").map(String).filter(Boolean)
  const tags = normaliseTags(formData.getAll("tags").map(String))
  const onBehalfOf = String(formData.get("onBehalfOf") ?? "").trim() || null

  // Only the admin path can credit an upload to someone else; a player
  // session already carries its own identity via resolveUploader().
  const uploaderPlayerId = auth.source === "admin" ? onBehalfOf : auth.playerId

  const badTitle = titleIssue(title)
  if (badTitle) return { success: false, error: badTitle }
  // Map is not asked for: the recording carries its own \mapname\, and the
  // viewer reports it the first time anyone watches (see reportDemoMap).
  if (!GAMETYPES.includes(gametype as (typeof GAMETYPES)[number])) {
    return { success: false, error: "Gametype must be CTF, FFA, or TeamFFA." }
  }

  const storedBytes = await headDemoFile(storagePath)
  if (storedBytes === null || storedBytes === 0) {
    return { success: false, error: "The file never finished uploading. Try again." }
  }
  const maxBytes = auth.source === "admin" ? MAX_DEMO_BYTES_ADMIN : MAX_DEMO_BYTES_PLAYER
  if (storedBytes > maxBytes) {
    await deleteDemoFile(storagePath).catch(() => {})
    return { success: false, error: "File is too large for a demo recording." }
  }

  const supabase = createServiceClient()
  const { data: taken } = await supabase.from("demos").select("id").eq("file_path", storagePath).maybeSingle()
  if (taken) return { success: false, error: "That upload was already published." }

  const { data: inserted, error: insertError } = await supabase
    .from("demos")
    .insert({
      title,
      map,
      gametype,
      recorded_at: recordedAt,
      uploader_player_id: uploaderPlayerId,
      source: auth.source,
      tags,
      file_path: storagePath,
      file_size_bytes: storedBytes,
    })
    .select("id")
    .single()

  if (insertError || !inserted) {
    await deleteDemoFile(storagePath).catch(() => {})
    return { success: false, error: insertError?.message ?? "Could not save the demo." }
  }

  if (taggedPlayerIds.length > 0) {
    await supabase.from("demo_players").insert(taggedPlayerIds.map((player_id) => ({ demo_id: inserted.id, player_id })))
  }

  return { success: true, id: inserted.id as string }
}

async function requireAdmin(): Promise<{ ok: true } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not authorized." }
  const { data: isAdmin } = await supabase.rpc("is_admin")
  return isAdmin ? { ok: true } : { ok: false, error: "Not authorized." }
}

/**
 * Who may change a demo: an admin, or the player who uploaded that specific
 * demo. Nobody else, and never somebody else's upload.
 *
 * Uploaders get it because the alternative is asking an admin to fix every
 * typo in a title. They are deliberately not given everything an admin has --
 * see updateDemo, where the fields that decide what a demo *is* to the rest of
 * the site stay admin-only.
 *
 * The ownership test below is the whole security boundary for the player path,
 * and it is per-demo rather than a blanket "is an uploader" role: holding a
 * player session says nothing about *this* recording. It also settles demos
 * with no uploader on record (uploader_player_id null, true of the early
 * admin-seeded library) -- null never equals a session id, so those stay
 * admin-only rather than becoming unowned and claimable.
 *
 * Gates deletion too, not just edits, so there is one answer to "may this
 * person change this demo" rather than several that can drift apart.
 */
export async function resolveEditor(
  demoId: string,
): Promise<{ ok: true; isAdmin: boolean } | { ok: false; error: string }> {
  const admin = await requireAdmin()
  if (admin.ok) return { ok: true, isAdmin: true }

  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) return { ok: false, error: "Not authorized." }

  const supabase = createServiceClient()
  const { data: demo } = await supabase
    .from("demos")
    .select("uploader_player_id")
    .eq("id", demoId)
    .maybeSingle()
  if (!demo || demo.uploader_player_id !== playerId) {
    // "edit" would read oddly on a rejected delete, and this now guards both.
    return { ok: false, error: "You can only change demos you uploaded." }
  }
  return { ok: true, isAdmin: false }
}

// Correct a title, retag players, fix the map/gametype, credit a different
// uploader, or add a description -- the metadata entered once at upload time
// that occasionally needs a fix afterwards. Open to the uploader as well as to
// admins, minus the two fields below that decide what a demo is to everyone else.
export async function updateDemo(demoId: string, formData: FormData): Promise<ActionResult> {
  const editor = await resolveEditor(demoId)
  if (!editor.ok) return { success: false, error: editor.error }

  const title = String(formData.get("title") ?? "").trim()
  const map = String(formData.get("map") ?? "").trim()
  const gametype = String(formData.get("gametype") ?? "")
  const recordedAt = String(formData.get("recordedAt") ?? "").trim() || null
  const description = String(formData.get("description") ?? "").trim() || null
  const rawUploaderPlayerId = String(formData.get("uploaderPlayerId") ?? "").trim()
  const uploaderPlayerId = rawUploaderPlayerId && rawUploaderPlayerId !== "__none__" ? rawUploaderPlayerId : null
  const rawProtagonistPlayerId = String(formData.get("protagonistPlayerId") ?? "").trim()
  const protagonistPlayerId = rawProtagonistPlayerId && rawProtagonistPlayerId !== "__none__" ? rawProtagonistPlayerId : null
  const taggedPlayerIds = formData.getAll("playerIds").map(String).filter(Boolean)
  const tags = normaliseTags(formData.getAll("tags").map(String))

  const badTitle = titleIssue(title)
  if (badTitle) return { success: false, error: badTitle }
  if (!map) return { success: false, error: "Map is required." }
  if (!GAMETYPES.includes(gametype as (typeof GAMETYPES)[number])) {
    return { success: false, error: "Gametype must be CTF, FFA, or TeamFFA." }
  }

  const supabase = createServiceClient()
  // Crediting the upload to someone else stays with admins -- that decides
  // whose library a demo shows up in. Naming the protagonist does not: it is
  // a statement about the recording, the uploader is usually in it, and they
  // are the one who knows whose clip it is.
  const adminOnly = editor.isAdmin ? { uploader_player_id: uploaderPlayerId } : {}
  const { error: updateError } = await supabase
    .from("demos")
    .update({
      title,
      map,
      gametype,
      recorded_at: recordedAt,
      description,
      tags,
      protagonist_player_id: protagonistPlayerId,
      ...adminOnly,
    })
    .eq("id", demoId)
  if (updateError) return { success: false, error: updateError.message }

  // Replace the tag set wholesale rather than diffing -- simpler, and the
  // full list always comes from the edit form's own checkbox state anyway.
  const { error: clearError } = await supabase.from("demo_players").delete().eq("demo_id", demoId)
  if (clearError) return { success: false, error: clearError.message }
  if (taggedPlayerIds.length > 0) {
    const { error: tagError } = await supabase
      .from("demo_players")
      .insert(taggedPlayerIds.map((player_id) => ({ demo_id: demoId, player_id })))
    if (tagError) return { success: false, error: tagError.message }
  }

  return { success: true, id: demoId }
}

/**
 * Remove a demo entirely -- an admin, or the player who uploaded it.
 *
 * Uploaders were held back from this at first, on the reasoning that taking a
 * recording out of the library was a bigger call than fixing its title. That
 * was the wrong line to draw: it is their recording, and someone who wants a
 * clip of theirs gone should not have to ask. Same gate as every other edit
 * (resolveEditor), so there is one answer to "may this person change this
 * demo" rather than two that can drift apart.
 *
 * Worth knowing what goes with it: ratings, tags and comments cascade through
 * the foreign keys (027, 030), and comments can be other people's. The .dm_15
 * does not cascade -- storage has no such relationship to the table -- so it
 * is removed first: an orphaned row with no file plays as a broken page,
 * whereas an orphaned file is invisible and can be swept up later. That
 * removal goes through the trash prefix (deleteDemoFile copies before it
 * deletes), so the recording itself survives its 7-day lifecycle window even
 * though the row is gone immediately.
 */
export async function deleteDemo(demoId: string): Promise<ActionResult> {
  const editor = await resolveEditor(demoId)
  if (!editor.ok) return { success: false, error: editor.error }

  const supabase = createServiceClient()
  const { data: demo, error: lookupError } = await supabase
    .from("demos")
    .select("file_path")
    .eq("id", demoId)
    .maybeSingle()
  if (lookupError) return { success: false, error: lookupError.message }
  if (!demo) return { success: false, error: "That demo no longer exists." }

  try {
    await deleteDemoFile(demo.file_path as string)
  } catch (e) {
    return { success: false, error: `Could not remove the file: ${e instanceof Error ? e.message : "unknown error"}` }
  }

  const { error: deleteError } = await supabase.from("demos").delete().eq("id", demoId)
  if (deleteError) return { success: false, error: deleteError.message }

  return { success: true, id: demoId }
}

/**
 * Slug for a playlist title.
 *
 * Generated once at creation and never regenerated: the slug is the public
 * URL, and re-deriving it from an edited title would silently break every
 * link anyone had already shared.
 */
function slugify(title: string): string {
  return title
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // drop the accents NFKD just split off
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
}

export async function createPlaylist(title: string, description: string): Promise<ActionResult> {
  const admin = await requireAdmin()
  if (!admin.ok) return { success: false, error: admin.error }

  const name = title.trim()
  if (name.length < 3) return { success: false, error: "Give the playlist a name of at least 3 characters." }
  const base = slugify(name)
  if (!base) return { success: false, error: "That name has no letters or numbers to build a link from." }

  const supabase = createServiceClient()
  // Two "July Highlights" in different years is a fair thing to want, so a
  // collision gets a suffix rather than a rejection.
  let slug = base
  for (let n = 2; n < 50; n++) {
    const { data: taken } = await supabase.from("demo_playlists").select("id").eq("slug", slug).maybeSingle()
    if (!taken) break
    slug = `${base}-${n}`
  }

  const { data, error } = await supabase
    .from("demo_playlists")
    .insert({ slug, title: name, description: description.trim() || null })
    .select("id")
    .single()
  if (error || !data) return { success: false, error: error?.message ?? "Could not create that playlist." }
  return { success: true, id: data.id as string }
}

export async function deletePlaylist(playlistId: string): Promise<ActionResult> {
  const admin = await requireAdmin()
  if (!admin.ok) return { success: false, error: admin.error }

  // Only the collection goes; its demos are referenced, not owned.
  const supabase = createServiceClient()
  const { error } = await supabase.from("demo_playlists").delete().eq("id", playlistId)
  if (error) return { success: false, error: error.message }
  return { success: true, id: playlistId }
}

/**
 * Set the full list of playlists a demo belongs to.
 *
 * Replaces rather than diffs, matching how player tags are handled in
 * updateDemo -- the form always submits the complete checkbox state, so a
 * diff would be reconstructing information the caller already sent.
 * New memberships land at the end of their playlist.
 */
export async function setDemoPlaylists(demoId: string, playlistIds: string[]): Promise<ActionResult> {
  const admin = await requireAdmin()
  if (!admin.ok) return { success: false, error: admin.error }

  const supabase = createServiceClient()
  const wanted = [...new Set(playlistIds.filter(Boolean))]

  const { data: existing } = await supabase
    .from("demo_playlist_items")
    .select("playlist_id")
    .eq("demo_id", demoId)
  const had = new Set(((existing ?? []) as { playlist_id: string }[]).map((r) => r.playlist_id))

  const removed = [...had].filter((id) => !wanted.includes(id))
  if (removed.length > 0) {
    const { error } = await supabase
      .from("demo_playlist_items")
      .delete()
      .eq("demo_id", demoId)
      .in("playlist_id", removed)
    if (error) return { success: false, error: error.message }
  }

  const added = wanted.filter((id) => !had.has(id))
  for (const playlistId of added) {
    // Append: read the current tail rather than assuming a count, since
    // positions can have gaps once things have been removed.
    const { data: last } = await supabase
      .from("demo_playlist_items")
      .select("position")
      .eq("playlist_id", playlistId)
      .order("position", { ascending: false })
      .limit(1)
      .maybeSingle()
    const position = ((last?.position as number | undefined) ?? -1) + 1
    const { error } = await supabase
      .from("demo_playlist_items")
      .insert({ playlist_id: playlistId, demo_id: demoId, position })
    if (error) return { success: false, error: error.message }
  }

  return { success: true, id: demoId }
}

/**
 * Mark a moment the instant it happens, saved on its own rather than staged
 * behind the rest of the edit form -- a moment marked mid-watch shouldn't be
 * lost because some unrelated field on the form didn't validate. Open to
 * whoever may edit the demo -- the uploader cut the clip, so they are the one
 * who knows where the moment is.
 */
export async function addDemoMoment(
  demoId: string,
  atMs: number,
  label: string,
): Promise<ActionResult & { moment?: DemoMoment }> {
  const editor = await resolveEditor(demoId)
  if (!editor.ok) return { success: false, error: editor.error }
  if (!Number.isFinite(atMs) || atMs < 0) return { success: false, error: "Invalid timestamp." }

  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)

  const supabase = createServiceClient()
  const { count } = await supabase
    .from("demo_moments")
    .select("id", { count: "exact", head: true })
    .eq("demo_id", demoId)
  if ((count ?? 0) >= 40) return { success: false, error: "This demo already has 40 moments -- remove one first." }

  const { data, error } = await supabase
    .from("demo_moments")
    .insert({
      demo_id: demoId,
      at_ms: Math.round(atMs),
      label: maskSlurs(label ?? "").trim().slice(0, 60) || null,
      created_by: playerId,
    })
    .select("id, at_ms, label, tag")
    .single()
  if (error) return { success: false, error: error.message }

  return {
    success: true,
    id: demoId,
    moment: { id: data.id as string, atMs: data.at_ms as number, label: data.label as string | null, tag: data.tag as string | null },
  }
}

/**
 * First half of trimming: hand back somewhere to put the cut.
 *
 * The trimmed bytes come out of the engine in the browser, so they take the
 * same presigned route as an upload rather than passing through the server.
 * A new key rather than the existing one: the swap only happens once the file
 * is verifiably in place, so a failure here leaves the demo exactly as it was.
 */
export async function beginDemoTrim(demoId: string, sizeBytes: number): Promise<BeginUploadResult> {
  const editor = await resolveEditor(demoId)
  if (!editor.ok) return { success: false, error: editor.error }
  if (!Number.isInteger(sizeBytes) || sizeBytes <= 0) return { success: false, error: "Nothing to save." }
  // A cut is by definition shorter than what it came from, so the player cap is
  // the wrong test here -- an admin's long recording would fail to trim.
  if (sizeBytes > MAX_DEMO_BYTES_ADMIN) return { success: false, error: "Trimmed file is implausibly large." }

  const storagePath = `${crypto.randomUUID()}.dm_15`
  try {
    const url = await createDemoUploadUrl(storagePath, sizeBytes)
    return { success: true, url, storagePath }
  } catch (e) {
    return { success: false, error: `Could not start the trim: ${e instanceof Error ? e.message : "unknown error"}` }
  }
}

/**
 * Second half: point the demo at the cut, and move everything that was hung off
 * the old timeline onto the new one.
 *
 * Moments are the reason this is not just a file swap. They are stored as
 * milliseconds from the first frame, and the first frame has just moved, so
 * every one of them shifts by the in-point and any that fell outside the window
 * no longer refer to anything.
 *
 * The old file goes to the trash prefix rather than being deleted outright
 * (deleteDemoFile copies first), because this is the one action here that
 * destroys something a person cannot make again.
 */
export async function finishDemoTrim(
  demoId: string,
  storagePath: string,
  startMs: number,
  endMs: number,
): Promise<ActionResult> {
  const editor = await resolveEditor(demoId)
  if (!editor.ok) return { success: false, error: editor.error }
  if (!STORAGE_PATH_RE.test(storagePath)) return { success: false, error: "Malformed trim reference." }
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs || startMs < 0) {
    return { success: false, error: "Invalid trim range." }
  }

  // Confirm the browser's upload actually landed before anything is changed.
  const storedBytes = await headDemoFile(storagePath)
  if (storedBytes === null) return { success: false, error: "The trimmed file never arrived." }
  if (storedBytes < 32) {
    await deleteDemoFile(storagePath).catch(() => {})
    return { success: false, error: "The trimmed file is empty." }
  }

  const supabase = createServiceClient()
  const { data: demo } = await supabase
    .from("demos")
    .select("file_path, duration_ms")
    .eq("id", demoId)
    .maybeSingle()
  if (!demo) return { success: false, error: "Demo not found." }
  const oldPath = demo.file_path as string
  const oldDurationMs = demo.duration_ms as number | null

  const durationMs = Math.round(endMs - startMs)
  const { error } = await supabase
    .from("demos")
    .update({
      file_path: storagePath,
      duration_ms: durationMs,
      // The size travels with the file. Leaving it behind left every trimmed
      // demo claiming the length of the recording it replaced -- a 30-second
      // clip filed as 84MB -- which nothing reads today and everything would
      // read wrong the day something does. storedBytes is the figure the HEAD
      // above already confirmed against R2.
      file_size_bytes: storedBytes,
    })
    .eq("id", demoId)
  if (error) {
    await deleteDemoFile(storagePath).catch(() => {})
    return { success: false, error: error.message }
  }

  // Rebase the moments onto the cut, and drop the ones it no longer contains.
  const { data: moments } = await supabase.from("demo_moments").select("id, at_ms").eq("demo_id", demoId)
  for (const m of (moments ?? []) as { id: string; at_ms: number }[]) {
    if (m.at_ms < startMs || m.at_ms > endMs) {
      await supabase.from("demo_moments").delete().eq("id", m.id)
    } else {
      await supabase.from("demo_moments").update({ at_ms: Math.round(m.at_ms - startMs) }).eq("id", m.id)
    }
  }

  /*
   * Record what was replaced before letting the file go.
   *
   * The original lands in trash/, which expires after a week -- so without a
   * row here, spotting a bad cut on day three means guessing which anonymous
   * UUID to restore, and after day seven there is nothing left to guess at.
   * Written before the delete so a trim is never untraceable, and deliberately
   * not fatal: losing the audit line is not a reason to fail a cut that has
   * already happened.
   */
  const cookieStore = await cookies()
  const trimmedBy = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  await supabase
    .from("demo_trims")
    .insert({
      demo_id: demoId,
      old_file_path: oldPath,
      new_file_path: storagePath,
      start_ms: Math.round(startMs),
      end_ms: Math.round(endMs),
      old_duration_ms: oldDurationMs,
      trimmed_by: trimmedBy,
    })
    .then(undefined, () => {})

  // Only once the row points somewhere else. Copies to trash/ on the way out.
  if (oldPath && oldPath !== storagePath) await deleteDemoFile(oldPath).catch(() => {})

  return { success: true, id: demoId }
}

/** Undo a moment. Same immediacy as adding one -- no form to re-save. */
export async function removeDemoMoment(demoId: string, momentId: string): Promise<ActionResult> {
  const editor = await resolveEditor(demoId)
  if (!editor.ok) return { success: false, error: editor.error }

  const supabase = createServiceClient()
  const { error } = await supabase.from("demo_moments").delete().eq("id", momentId).eq("demo_id", demoId)
  if (error) return { success: false, error: error.message }
  return { success: true, id: demoId }
}

/**
 * Record the map a demo is on, as the engine read it out of the recording.
 *
 * Nobody should have to type this in: the .dm_15 states its own map in
 * CS_SERVERINFO, and the viewer has that string the moment playback starts.
 * The catch is that the caller is an anonymous page, so this only ever fills
 * a blank -- it cannot overwrite a map that is already recorded, which makes
 * the worst case "the first person to watch a new upload got it right", not
 * "anyone can rewrite any demo's map".
 */
export async function reportDemoMap(demoId: string, map: string): Promise<void> {
  const name = map.trim().toLowerCase()
  // Map names are filesystem-shaped: letters, digits, underscores.
  if (!/^[a-z0-9_]{3,64}$/.test(name)) return

  const supabase = createServiceClient()
  const { data: demo } = await supabase.from("demos").select("map").eq("id", demoId).maybeSingle()
  if (!demo || (demo.map as string | null)?.trim()) return
  await supabase.from("demos").update({ map: name }).eq("id", demoId)
}

const VIEWER_COOKIE = "soracle_viewer"

/**
 * Record that someone watched this demo.
 *
 * Called when playback actually starts, not when the page renders -- the old
 * behaviour counted every refresh and every crawler, which is how twenty demos
 * came to have several hundred "views" between them.
 *
 * The cookie holds an opaque random id and nothing else. It exists to tell one
 * browser from another for a day, which is the entire requirement; there is no
 * IP, no fingerprint, and nothing to tie it back to a person.
 */
export async function recordDemoView(demoId: string): Promise<void> {
  const cookieStore = await cookies()
  let viewerKey = cookieStore.get(VIEWER_COOKIE)?.value
  if (!viewerKey || viewerKey.length < 8) {
    viewerKey = crypto.randomUUID()
    cookieStore.set(VIEWER_COOKIE, viewerKey, {
      httpOnly: true,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      maxAge: 60 * 60 * 24 * 365,
      path: "/",
    })
  }

  // Fire and forget: a view that fails to record is not worth surfacing to
  // someone who just wanted to watch a demo.
  const supabase = createServiceClient()
  await supabase.rpc("record_demo_view", { p_demo_id: demoId, p_viewer_key: viewerKey })
}

const MAX_COMMENT_LENGTH = 2000

export async function addComment(demoId: string, body: string): Promise<ActionResult> {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) return { success: false, error: "Log in to comment." }

  const text = body.trim()
  if (!text) return { success: false, error: "Write something first." }
  if (text.length > MAX_COMMENT_LENGTH) {
    return { success: false, error: `Comments are capped at ${MAX_COMMENT_LENGTH} characters.` }
  }

  const supabase = createServiceClient()
  const { data, error } = await supabase
    .from("demo_comments")
    .insert({ demo_id: demoId, player_id: playerId, body: maskSlurs(text) })
    .select("id")
    .single()
  if (error || !data) return { success: false, error: error?.message ?? "Could not post that comment." }
  return { success: true, id: data.id as string }
}

// Authors can take back their own; admins can remove anyone's.
export async function deleteComment(commentId: string): Promise<ActionResult> {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  const admin = await requireAdmin()
  if (!playerId && !admin.ok) return { success: false, error: "Not authorized." }

  const supabase = createServiceClient()
  const query = supabase.from("demo_comments").delete().eq("id", commentId)
  // A player session only ever deletes rows it owns, enforced in the filter
  // rather than by reading the row first -- one round trip, and no window
  // between the check and the delete.
  const { error } = admin.ok ? await query : await query.eq("player_id", playerId!)
  if (error) return { success: false, error: error.message }
  return { success: true, id: commentId }
}

export async function rateDemo(demoId: string, rating: number): Promise<ActionResult> {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) return { success: false, error: "Log in to rate a demo." }
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return { success: false, error: "Rating must be between 1 and 5." }
  }

  const supabase = createServiceClient()
  const { error } = await supabase
    .from("demo_ratings")
    .upsert({ demo_id: demoId, player_id: playerId, rating }, { onConflict: "demo_id,player_id" })
  if (error) return { success: false, error: error.message }
  return { success: true, id: demoId }
}
