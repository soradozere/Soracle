"use server"

import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { dispatchRenderJob } from "@/lib/github-dispatch"
import { resolveEditor } from "./actions"

type ActionResult = { success: true; id: string } | { success: false; error: string }

const CAM_MODES = ["follow", "chase", "free"] as const
type CamMode = (typeof CAM_MODES)[number]

/*
 * Render settings are chosen from clip length, not asked for.
 *
 * Disk stopped being the constraint once chunked capture landed; wall clock is
 * the one that bites. Measured on a runner: llvmpipe renders ~38 frames/sec at
 * 720p, and cost scales with pixel count.
 *
 * 1440p rather than 1080p wherever it fits, because YouTube allocates bitrate
 * by resolution -- a 1440p upload gets a noticeably fatter encode and looks
 * better even watched at 1080p. Our own source is already well above what
 * YouTube keeps, so the graininess comes from their encoder, not ours, and
 * resolution is the lever that actually moves it.
 *
 * Against GitHub's six-hour job limit that gives, in preference order:
 *
 *   1440p60   6.3x realtime   good to ~48 min of footage
 *   1440p30   3.1x realtime   good to ~1.5h
 *   1080p30   1.8x realtime   good to ~2.7h
 *
 * A long match dropping to 30fps and 1080p beats one that runs out of clock at
 * hour six with nothing to show.
 */
const RENDER_FPS_720P = 38.2
const JOB_LIMIT_MS = 6 * 60 * 60 * 1000
/** Headroom for the build, asset staging, encode and upload around the render. */
const SAFETY = 0.8

interface RenderSettings {
  fps: 30 | 60
  width: number
  height: number
}

const SETTINGS_LADDER: RenderSettings[] = [
  { fps: 60, width: 2560, height: 1440 },
  { fps: 30, width: 2560, height: 1440 },
  { fps: 30, width: 1920, height: 1080 },
]

function chooseSettings(durationMs: number): RenderSettings | null {
  const budget = JOB_LIMIT_MS * SAFETY
  for (const s of SETTINGS_LADDER) {
    const pixelRatio = (s.width * s.height) / (1280 * 720)
    const throughput = RENDER_FPS_720P / pixelRatio
    const estimateMs = (durationMs / 1000) * s.fps * (1000 / throughput)
    if (estimateMs <= budget) return s
  }
  return null
}

/** Matches the web viewer's FIXED_FOV so a render looks like the site does. */
const RENDER_FOV = 120

export interface RenderRequestParams {
  title: string
  description?: string
  protagonistPlayerId?: string | null
  camMode: CamMode
  /** Real engine client number, never a re-based index into a player list. */
  followClientId?: number | null
  startMs: number
  endMs: number
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

  // Capture always starts at the demo's beginning, so the cost is driven by
  // endMs rather than by the length of the segment being kept.
  const settings = chooseSettings(endMs)
  if (!settings) {
    const hours = (endMs / 3600000).toFixed(1)
    return {
      success: false,
      error: `That's ${hours} hours in. Rendering that far exceeds the six-hour limit on a job even at 30fps, so it would fail partway through rather than finish. Pick a segment nearer the start of the demo.`,
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
  /*
   * Null is a real choice, not a missing one.
   *
   * The viewer has three states, and only two of them name a player: free
   * camera, following a specific client, and the recorder's own view -- which
   * is what a demo shows by default and what most people will render. That
   * last one is cg_demoFollow -1, and requiring a client number here rejected
   * it outright with "choose which player the camera should follow", which is
   * both wrong and impossible to act on.
   *
   * So only the range is checked, and only when a number was given.
   */
  const followClientId = params.followClientId ?? null
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
      fps: settings.fps,
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
    fps: String(settings.fps),
    width: String(settings.width),
    height: String(settings.height),
    fov: String(RENDER_FOV),
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
