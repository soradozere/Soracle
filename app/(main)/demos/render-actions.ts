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
 * Two limits, both checked, and time is the one that bites. Measured on a
 * runner: llvmpipe renders ~38 frames/sec at 720p and cost scales with pixel
 * count, against a six-hour job limit. Disk is the other -- chunking bounds the
 * raw capture but nothing bounds the encoded pieces, which all have to survive
 * until the concat -- and on the measured numbers it never binds first.
 *
 * 1440p rather than 1080p wherever it fits, because YouTube allocates bitrate
 * by resolution -- a 1440p upload gets a noticeably fatter encode and looks
 * better even watched at 1080p. Our own source is already well above what
 * YouTube keeps, so the graininess comes from their encoder, not ours, and
 * resolution is the lever that actually moves it.
 *
 * Taking the tighter of the two, in preference order:
 *
 *   1440p60   46 min of footage   (time; disk would allow 52)
 *   1440p30   92 min              (time; disk 104)
 *   1080p30   2.7h                (time; disk 3.1h)
 *
 * A long match dropping to 30fps and 1080p beats one that runs out of clock at
 * hour six with nothing to show.
 */
const RENDER_FPS_720P = 38.2
const JOB_LIMIT_MS = 6 * 60 * 60 * 1000
/** Headroom for the build, asset staging, encode and upload around the render. */
const SAFETY = 0.8

/**
 * Free disk on a runner, and what a second of footage costs there at its peak.
 *
 * Both measured rather than guessed. A runner reports 86GB free (`df` in the
 * render workflow, kept there so this can be checked again); 80 is the working
 * figure.
 *
 * The cost is not just the chunks. They all have to survive until the end,
 * because the concat needs them -- and the concat then writes a second copy of
 * the lot before the final encode, so peak disk is roughly twice the chunks
 * plus the result. Measured across two 1440p60 renders: 6.7 + 6.5 + 3.6, and
 * 9.2 + 9.0 + 3.6 MB per second of footage. Taking the worse gives 22, and it
 * scales with pixels and frame rate, which is how x264 behaves at fixed
 * quality.
 *
 * At those numbers disk never actually binds first -- the six-hour job limit
 * does, at every rung. Worth keeping anyway: it was binding at the figures this
 * started with, and the two move independently.
 */
const RUNNER_DISK_BYTES = 80 * 1024 * 1024 * 1024
const BYTES_PER_SECOND_1440P60 = 22_000_000

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
  const seconds = durationMs / 1000
  for (const s of SETTINGS_LADDER) {
    const pixelRatio = (s.width * s.height) / (1280 * 720)
    const throughput = RENDER_FPS_720P / pixelRatio
    const estimateMs = seconds * s.fps * (1000 / throughput)
    if (estimateMs > JOB_LIMIT_MS * SAFETY) continue

    const scale = ((s.width * s.height) / (2560 * 1440)) * (s.fps / 60)
    if (seconds * BYTES_PER_SECOND_1440P60 * scale > RUNNER_DISK_BYTES * SAFETY) continue

    return s
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
  // The common cause of a zero here is a demo the library never recorded a
  // duration for -- the dialog sends 0..0 and there is nothing to render. Say
  // that rather than the generic message, which sent people looking in the
  // wrong place.
  if (!Number.isFinite(endMs) || endMs <= 0) {
    return {
      success: false,
      error: "This demo's length isn't recorded yet. Play it through to the end once, then queue the render.",
    }
  }
  if (!Number.isFinite(startMs) || startMs < 0 || endMs <= startMs) {
    return { success: false, error: "That segment doesn't make sense." }
  }

  // The segment, not how far into the demo it sits. The renderer seeks to the
  // start rather than playing up to it, so a clip costs the same whether it is
  // at the beginning of a match or an hour in.
  const settings = chooseSettings(endMs - startMs)
  if (!settings) {
    const hours = ((endMs - startMs) / 3600000).toFixed(1)
    return {
      success: false,
      error: `That clip is ${hours} hours long. Even at 30fps and 1080p a render that long runs out of time or disk partway through rather than finishing. Pick a shorter segment.`,
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
