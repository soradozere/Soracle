"use server"

import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { AUTO_CALIBRATION_KEY } from "@/lib/calibration"

/*
 * Turn the seasonal tier auto-calibrator on or off.
 *
 * Full admins only. site_settings has no write policy at all — SELECT is public
 * and every write goes through the service-role client behind this check, the
 * same shape as the rest of the admin writes in this codebase.
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

export async function setAutoCalibration(enabled: boolean) {
  const authz = await requireAdmin()
  if (!authz.ok) return { success: false as const, error: authz.error }

  const service = createServiceClient()
  if (enabled) {
    const { error } = await service.from("site_settings").upsert(
      {
        key: AUTO_CALIBRATION_KEY,
        value: "on",
        updated_at: new Date().toISOString(),
        updated_by: authz.userId,
      },
      { onConflict: "key" },
    )
    if (error) return { success: false as const, error: error.message }
  } else {
    // Deleted, not set to NULL: an absent row is the documented "off/default"
    // state, and leaving an empty row behind would make the table ambiguous.
    const { error } = await service.from("site_settings").delete().eq("key", AUTO_CALIBRATION_KEY)
    if (error) return { success: false as const, error: error.message }
  }

  return { success: true as const, enabled }
}
