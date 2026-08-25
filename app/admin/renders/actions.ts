"use server"

import { revalidatePath } from "next/cache"
import { createServiceClient } from "@/lib/supabase/admin"
import { requireFullAdmin } from "@/lib/player-role"
import { deleteRender } from "@/lib/r2-renders"
import { dispatchPublishJob } from "@/lib/github-dispatch"
import { DAILY_PUBLISH_CAP } from "@/lib/render-limits"
import { buildYoutubeTitle, buildYoutubeDescription } from "@/lib/youtube-metadata"

type ActionResult = { success: true } | { success: false; error: string }

async function requireAdmin(): Promise<boolean> {
  return (await requireFullAdmin()).ok
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
 * Clear a job that is finished with, so it stops asking for attention.
 *
 * Only `rejected` and `failed`, because those are the two terminal states
 * nothing will ever move again. Everything else is either in flight or is the
 * record of a published video, and deleting those would lose real history.
 *
 * `failed` is the one that actually needed this. A failed job counts toward the
 * masthead's notification -- deliberately, so a broken pipeline cannot die
 * quietly, which is how a lapsed credential once went unnoticed. But nothing
 * could clear one: `rejectRender` only accepts `pending_review`, so a job that
 * failed at dispatch (a GitHub 503 is enough) left a permanent badge with no
 * way to dismiss it. Being told about a failure and being unable to acknowledge
 * it is worse than not being told, because the next real failure is invisible
 * inside a count that was already non-zero.
 */
export async function discardRender(id: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { success: false, error: "Not authorized." }

  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from("youtube_render_queue")
    .select("id, status, render_r2_key")
    .eq("id", id)
    .maybeSingle()
  if (!row) return { success: false, error: "That job no longer exists." }
  if (row.status !== "rejected" && row.status !== "failed") {
    return {
      success: false,
      error: `Only a rejected or failed job can be deleted (this one is ${row.status}).`,
    }
  }

  // A rejected job has already had its mp4 removed, but a failed one may not
  // have. Best effort for the same reason rejectRender is: the row must still
  // go, or a transient R2 error puts the job right back where it was.
  if (row.render_r2_key) {
    await deleteRender(row.render_r2_key as string).catch(() => {})
  }

  const { error } = await supabase
    .from("youtube_render_queue")
    .delete()
    .eq("id", id)
    .in("status", ["rejected", "failed"])
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
    .select("id, status, render_r2_key, title, description, demo_id")
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

  /*
   * The uploader's title and description are what they typed; this is how it
   * reads on YouTube. Built at publish time rather than stored, so changing the
   * house style never means re-rendering anything.
   */
  const { data: demo } = await supabase
    .from("demos")
    .select("id, map, gametype, recorded_at, protagonist_player_id")
    .eq("id", row.demo_id as string)
    .maybeSingle()

  const { data: tagged } = await supabase
    .from("demo_players")
    .select("players(name)")
    .eq("demo_id", row.demo_id as string)

  let protagonistName: string | null = null
  if (demo?.protagonist_player_id) {
    const { data: p } = await supabase
      .from("players")
      .select("name")
      .eq("id", demo.protagonist_player_id as string)
      .maybeSingle()
    protagonistName = (p?.name as string | null) ?? null
  }

  const meta = {
    title: row.title as string,
    description: row.description as string | null,
    map: (demo?.map as string | null) ?? null,
    gametype: (demo?.gametype as string | null) ?? null,
    recordedAt: (demo?.recorded_at as string | null) ?? null,
    protagonistName,
    playerNames: ((tagged ?? []) as { players: { name: string } | null }[])
      .map((t) => t.players?.name)
      .filter((n): n is string => !!n),
  }

  const dispatch = await dispatchPublishJob({
    job_id: id,
    r2_key: row.render_r2_key as string,
    title: buildYoutubeTitle(meta),
    description: buildYoutubeDescription(meta),
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
