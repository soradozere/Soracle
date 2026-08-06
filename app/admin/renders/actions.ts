"use server"

import { revalidatePath } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { deleteRender } from "@/lib/r2-renders"

type ActionResult = { success: true } | { success: false; error: string }

/**
 * YouTube's daily upload allowance, expressed in videos rather than quota units.
 *
 * The API grants 10,000 units a day and an upload costs about 1,600, so six is
 * roughly what fits. Counted here rather than discovered from a 403, because a
 * failed upload still spends the quota -- the seventh attempt would burn the
 * allowance and publish nothing.
 */
export const DAILY_PUBLISH_CAP = 6

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
 * Record that a render has been put on YouTube by hand.
 *
 * Uploading through the API is not available: a Cloud project created now has
 * not passed YouTube's compliance audit, so videos.insert would force every
 * upload to private, and an app in "Testing" is issued a refresh token that
 * expires weekly. Both are review processes measured in weeks. Rather than
 * wait on them, the render is downloaded and uploaded through YouTube Studio,
 * and this closes the loop so the row does not sit in review forever.
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
