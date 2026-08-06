"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { deleteRender } from "@/lib/r2-renders"
import { dispatchPublishJob } from "@/lib/github-dispatch"
import { DAILY_PUBLISH_CAP } from "@/lib/render-limits"

type ActionResult = { success: true } | { success: false; error: string }


async function requireAdmin(): Promise<boolean> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return false
  const { data: isAdmin } = await supabase.rpc("is_admin")
  return isAdmin === true
}

/** How many have gone out today, against the cap. */
export async function publishedToday(): Promise<number> {
  const supabase = createServiceClient()
  const since = new Date()
  since.setUTCHours(0, 0, 0, 0)
  const { count } = await supabase
    .from("youtube_render_queue")
    .select("id", { count: "exact", head: true })
    .eq("status", "published")
    .gte("updated_at", since.toISOString())
  return count ?? 0
}

/**
 * Turn a render down.
 *
 * Deletes the mp4 in the same action rather than leaving it for the lifecycle
 * rule: rejection is a decision that the file should not exist, and the backstop
 * is for jobs that died, not for ones a person has already ruled on.
 */
export async function rejectRender(id: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { success: false, error: "Not authorized." }

  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from("youtube_render_queue")
    .select("id, status, render_r2_key")
    .eq("id", id)
    .maybeSingle()
  if (!row) return { success: false, error: "That job no longer exists." }
  if (row.status !== "pending_review") {
    return { success: false, error: `Can only reject a job awaiting review (this one is ${row.status}).` }
  }

  if (row.render_r2_key) {
    // Not fatal: the row must still move, or a transient R2 error leaves a
    // render stuck in review forever. The lifecycle rule collects the object.
    await deleteRender(row.render_r2_key as string).catch(() => {})
  }

  const { error } = await supabase
    .from("youtube_render_queue")
    .update({ status: "rejected", render_r2_key: null })
    .eq("id", id)
    .eq("status", "pending_review")
  if (error) return { success: false, error: error.message }

  revalidatePath("/admin/renders")
  return { success: true }
}

/**
 * Approve, and hand the upload to a runner.
 *
 * The upload does not happen here. A full match is gigabytes, and a serverless
 * function would hit its execution limit part way through -- so the row moves to
 * `publishing`, a workflow does the resumable upload from local disk, and the
 * callback records the video id.
 *
 * Videos arrive **private**. A Cloud project that has not passed YouTube's
 * compliance audit has every upload forced private regardless of what is asked
 * for, so asking for public would just make the result a surprise. Flip it in
 * Studio; when the audit clears, change the privacy input here and that step
 * disappears.
 */
export async function approveRender(id: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { success: false, error: "Not authorized." }

  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from("youtube_render_queue")
    .select("id, status, render_r2_key, title, description")
    .eq("id", id)
    .maybeSingle()
  if (!row) return { success: false, error: "That job no longer exists." }
  if (row.status !== "pending_review") {
    return { success: false, error: `Can only approve a job awaiting review (this one is ${row.status}).` }
  }
  if (!row.render_r2_key) {
    return { success: false, error: "There is no rendered file to upload -- it may have expired. Render it again." }
  }

  const today = await publishedToday()
  if (today >= DAILY_PUBLISH_CAP) {
    return {
      success: false,
      error: `${today} videos have gone out today, which is the daily cap. This one keeps until tomorrow.`,
    }
  }

  // Claimed before dispatch, and only from pending_review, so two clicks a
  // moment apart cannot both fire an upload of the same video.
  const { data: claimed } = await supabase
    .from("youtube_render_queue")
    .update({ status: "publishing", error: null })
    .eq("id", id)
    .eq("status", "pending_review")
    .select("id")
    .maybeSingle()
  if (!claimed) return { success: false, error: "Someone just acted on this one." }

  const dispatch = await dispatchPublishJob({
    job_id: id,
    r2_key: row.render_r2_key as string,
    title: row.title as string,
    description: (row.description as string | null) ?? "",
    privacy: "private",
  })

  if (!dispatch.ok) {
    // Back to review rather than failed: the render is fine, only the handoff
    // broke, and it should stay approvable once that is fixed.
    await supabase
      .from("youtube_render_queue")
      .update({ status: "pending_review", error: dispatch.error })
      .eq("id", id)
      .eq("status", "publishing")
    return { success: false, error: dispatch.error }
  }

  revalidatePath("/admin/renders")
  return { success: true }
}

/**
 * Record that a render has been put on YouTube by hand.
 *
 * Kept alongside approveRender as the way out when the automatic upload will
 * not work -- a revoked token, a YouTube outage, or a file large enough to be
 * worth uploading by hand. Download the mp4, put it up yourself, paste the
 * link back.
 *
 * Takes the URL rather than assuming one: it is the only way back from a
 * published video to the demo it came from.
 */
export async function markPublished(id: string, youtubeUrl: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { success: false, error: "Not authorized." }

  // Accept a full watch URL, a share link or a bare id -- whatever is on the
  // clipboard after publishing.
  const videoId =
    youtubeUrl.match(/(?:v=|youtu\.be\/|shorts\/|embed\/)([A-Za-z0-9_-]{11})/)?.[1] ??
    (/^[A-Za-z0-9_-]{11}$/.test(youtubeUrl.trim()) ? youtubeUrl.trim() : null)
  if (!videoId) {
    return { success: false, error: "That doesn't look like a YouTube link or video id." }
  }

  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from("youtube_render_queue")
    .select("id, status, render_r2_key")
    .eq("id", id)
    .maybeSingle()
  if (!row) return { success: false, error: "That job no longer exists." }
  if (row.status !== "pending_review") {
    return { success: false, error: `Can only publish a job awaiting review (this one is ${row.status}).` }
  }

  // The video is on YouTube now, so the staging copy has done its job. Deleted
  // here rather than left to the lifecycle rule for the same reason as reject:
  // the backstop is for jobs that died, not decisions already made.
  if (row.render_r2_key) {
    await deleteRender(row.render_r2_key as string).catch(() => {})
  }

  const { error } = await supabase
    .from("youtube_render_queue")
    .update({ status: "published", youtube_video_id: videoId, render_r2_key: null })
    .eq("id", id)
    .eq("status", "pending_review")
  if (error) return { success: false, error: error.message }

  revalidatePath("/admin/renders")
  return { success: true }
}
