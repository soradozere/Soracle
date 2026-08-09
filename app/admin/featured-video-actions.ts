"use server"

import { updateTag } from "next/cache"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { FEATURED_VIDEO_KEY, FEATURED_VIDEO_TAG, getFeaturedVideo, parseVideoId } from "@/lib/youtube-feed"

/*
 * Pin or unpin the homepage's featured video.
 *
 * Full admins only. site_settings has no write policy at all -- SELECT is public
 * and every write goes through the service-role client behind this check, the same
 * shape as the rest of the admin writes in this codebase.
 */
async function requireAdmin(): Promise<{ ok: true; userId: string } | { ok: false; error: string }> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: "Not signed in" }
  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (isAdmin !== true) return { ok: false, error: "Admins only" }
  return { ok: true, userId: user.id }
}

export async function setFeaturedVideo(input: string) {
  const authz = await requireAdmin()
  if (!authz.ok) return { success: false as const, error: authz.error }

  // Reject anything we can't turn into an id, rather than storing junk that
  // renders as a broken player on the homepage.
  const videoId = parseVideoId(input)
  if (!videoId) {
    return { success: false as const, error: "That doesn't look like a YouTube link or video id" }
  }

  const { error } = await createServiceClient()
    .from("site_settings")
    .upsert(
      { key: FEATURED_VIDEO_KEY, value: videoId, updated_at: new Date().toISOString(), updated_by: authz.userId },
      { onConflict: "key" },
    )
  if (error) return { success: false as const, error: error.message }

  // updateTag rather than revalidateTag: the admin screen re-reads the value in
  // this same request to show what it just saved.
  updateTag(FEATURED_VIDEO_TAG)
  return { success: true as const, videoId }
}

export async function clearFeaturedVideo() {
  const authz = await requireAdmin()
  if (!authz.ok) return { success: false as const, error: authz.error }

  // Deleted, not set to NULL: an absent row is the documented "automatic" state,
  // and leaving an empty row behind would make the table ambiguous.
  const { error } = await createServiceClient().from("site_settings").delete().eq("key", FEATURED_VIDEO_KEY)
  if (error) return { success: false as const, error: error.message }

  updateTag(FEATURED_VIDEO_TAG)
  return { success: true as const }
}

/** What the homepage would show right now, for the admin panel to display. */
export async function readFeaturedVideo() {
  const authz = await requireAdmin()
  if (!authz.ok) return { success: false as const, error: authz.error }
  return { success: true as const, data: await getFeaturedVideo() }
}
