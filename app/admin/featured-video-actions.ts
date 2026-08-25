"use server"

import { updateTag } from "next/cache"
import { createServiceClient } from "@/lib/supabase/admin"
import { requireFullAdmin } from "@/lib/player-role"
import { FEATURED_VIDEO_KEY, FEATURED_VIDEO_TAG, getFeaturedVideo, parseVideoId } from "@/lib/youtube-feed"

/*
 * Pin or unpin the homepage's featured video.
 *
 * Full admins only. site_settings has no write policy at all -- SELECT is public
 * and every write goes through the service-role client behind this check, the same
 * shape as the rest of the admin writes in this codebase.
 */

export async function setFeaturedVideo(input: string) {
  const authz = await requireFullAdmin()
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
      {
        key: FEATURED_VIDEO_KEY,
        value: videoId,
        updated_at: new Date().toISOString(),
        updated_by: authz.userId ?? authz.playerId,
      },
      { onConflict: "key" },
    )
  if (error) return { success: false as const, error: error.message }

  // updateTag rather than revalidateTag: the admin screen re-reads the value in
  // this same request to show what it just saved.
  updateTag(FEATURED_VIDEO_TAG)
  return { success: true as const, videoId }
}

export async function clearFeaturedVideo() {
  const authz = await requireFullAdmin()
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
  const authz = await requireFullAdmin()
  if (!authz.ok) return { success: false as const, error: authz.error }
  return { success: true as const, data: await getFeaturedVideo() }
}
