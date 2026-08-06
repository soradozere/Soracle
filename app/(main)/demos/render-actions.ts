"use server"

import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { dispatchRenderJob } from "@/lib/github-dispatch"
import { resolveEditor } from "./actions"

type ActionResult = { success: true; id: string } | { success: false; error: string }

const CAM_MODES = ["follow", "chase", "free"] as const
type CamMode = (typeof CAM_MODES)[number]

/**
 * Lengths that chunked capture does not exist for yet.
 *
 * There is no policy ceiling -- clips run from ~30s highlights to full ~2h
 * matches by design. This is a *capability* limit: the engine writes MJPEG at
 * roughly 4.3 MB/s, so an hour at 60fps is ~31GB against a runner's ~14GB of
 * free disk, and the job dies partway through with a disk error that looks
 * like anything but the real cause.
 *
 * Chunked capture (stopvideo/video per segment, transcode and delete each
 * chunk, concat at the end) removes this entirely and is step 5. Until then,
 * refuse the job up front with a message that says why, rather than letting
 * someone queue a two-hour render that fails forty minutes in.
 */
const CHUNKING_LANDED = false
const MAX_UNCHUNKED_MS = 10 * 60 * 1000

export interface RenderRequestParams {
  title: string
  description?: string
  protagonistPlayerId?: string | null
  camMode: CamMode
  /** Real engine client number, never a re-based index into a player list. */
  followClientId?: number | null
  startMs: number
  endMs: number
  fps?: 30 | 60
}

/**
 * Queue a demo segment for rendering and publishing.
 *
 * Authorization reuses resolveEditor, so "may this person render this demo" has
 * the same answer as "may this person edit it" -- the uploader or an admin, and
 * per-demo rather than a blanket role.
 */
export async function requestRender(demoId: string, params: RenderRequestParams): Promise<ActionResult> {
  const editor = await resolveEditor(demoId)
  if (!editor.ok) return { success: false, error: editor.error }

  const title = params.title?.trim() ?? ""
  if (title.length < 3) return { success: false, error: "Give the video a title of at least 3 characters." }

  if (!CAM_MODES.includes(params.camMode)) {
    return { success: false, error: "Pick a camera mode." }
  }

  const startMs = Math.round(params.startMs)
  const endMs = Math.round(params.endMs)
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || startMs < 0 || endMs <= startMs) {
    return { success: false, error: "That segment doesn't make sense." }
  }

  if (!CHUNKING_LANDED && endMs - startMs > MAX_UNCHUNKED_MS) {
    const minutes = Math.round((endMs - startMs) / 60000)
    return {
      success: false,
      error: `That segment is ${minutes} minutes. Renders longer than 10 minutes need chunked capture, which isn't built yet -- it would run out of disk partway through. Trim it down for now.`,
    }
  }

  /*
   * A follow target is required unless the camera follows nobody.
   *
   * Not validated against the demo's actual roster here: client numbers are
   * whatever the recording says, they are not contiguous from zero (the four
   * players in the demo used to prove this pipeline sat at slots 4-7), and the
   * server has no cheap way to read them. The dialog supplies them from the
   * viewer, which does know. A wrong number renders a silent fallback rather
   * than an error, which is one of the things review exists to catch.
   */
  const followClientId = params.followClientId ?? null
  if (params.camMode !== "free" && followClientId === null) {
    return { success: false, error: "Choose which player the camera should follow." }
  }
  if (followClientId !== null && (!Number.isInteger(followClientId) || followClientId < 0 || followClientId > 31)) {
    return { success: false, error: "That isn't a valid player slot." }
  }

  const supabase = createServiceClient()

  const { data: demo } = await supabase
    .from("demos")
    .select("id, file_path, duration_ms")
    .eq("id", demoId)
    .maybeSingle()
  if (!demo) return { success: false, error: "That demo no longer exists." }

  /*
   * Who asked.
   *
   * Read from the player cookie rather than from resolveEditor, which reports
   * *whether* the caller is an admin but not who they are -- requireAdmin
   * discards the Supabase user, and nothing maps that user to a players row.
   * An admin who also holds a player session is credited as that player, which
   * is the more useful of the two truths.
   */
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)

  const { data: row, error } = await supabase
    .from("youtube_render_queue")
    .insert({
      demo_id: demoId,
      requested_by: playerId,
      requested_source: playerId ? "player" : "admin",
      title,
      description: params.description?.trim() || null,
      protagonist_player_id: params.protagonistPlayerId || null,
      cam_mode: params.camMode,
      follow_client_id: followClientId,
      start_ms: startMs,
      end_ms: endMs,
      fps: params.fps ?? 60,
    })
    .select("id")
    .single()

  if (error) {
    // 23505 is the partial unique index: one in-flight render per demo. The
    // app checks for this too, but two clicks a few milliseconds apart both
    // pass that check, and only the index stops the second.
    if (error.code === "23505") {
      return { success: false, error: "This demo already has a render in progress." }
    }
    return { success: false, error: error.message }
  }

  const jobId = row.id as string

  const dispatch = await dispatchRenderJob({
    job_id: jobId,
    demo_key: demo.file_path as string,
    start_ms: String(startMs),
    end_ms: String(endMs),
    fps: String(params.fps ?? 60),
    cam_mode: params.camMode,
    follow_client_id: followClientId === null ? "" : String(followClientId),
  })

  if (!dispatch.ok) {
    /*
     * Fail the row rather than leaving it queued for nothing.
     *
     * Without this the row sits at pending_render looking exactly like a job
     * that is simply waiting its turn, and the only way to discover otherwise
     * is to go looking in Actions for a run that does not exist.
     */
    await supabase
      .from("youtube_render_queue")
      .update({ status: "failed", error: dispatch.error })
      .eq("id", jobId)
    return { success: false, error: dispatch.error }
  }

  return { success: true, id: jobId }
}
