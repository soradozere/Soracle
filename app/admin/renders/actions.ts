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
 * Approve, and publish.
 *
 * The upload itself is step 8 and does not exist yet. Rather than let approval
 * quietly do nothing -- which would look identical to a publish that worked --
 * this refuses until the YouTube side is wired, and says so.
 */
export async function approveRender(id: string): Promise<ActionResult> {
  if (!(await requireAdmin())) return { success: false, error: "Not authorized." }

  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from("youtube_render_queue")
    .select("id, status")
    .eq("id", id)
    .maybeSingle()
  if (!row) return { success: false, error: "That job no longer exists." }
  if (row.status !== "pending_review") {
    return { success: false, error: `Can only approve a job awaiting review (this one is ${row.status}).` }
  }

  const today = await publishedToday()
  if (today >= DAILY_PUBLISH_CAP) {
    return {
      success: false,
      error: `${today} videos have gone out today, which is the daily cap. This will keep until tomorrow.`,
    }
  }

  return {
    success: false,
    error: "Publishing to YouTube isn't connected yet. The render is fine and will keep until it is.",
  }
}
