"use server"

import { createServiceClient } from "@/lib/supabase/admin"
import { requireFullAdmin } from "@/lib/player-role"
import { AUTO_CALIBRATION_KEY } from "@/lib/calibration"

/*
 * Turn the seasonal tier auto-calibrator on or off.
 *
 * Full admins only. site_settings has no write policy at all — SELECT is public
 * and every write goes through the service-role client behind this check, the
 * same shape as the rest of the admin writes in this codebase.
 */

export async function setAutoCalibration(enabled: boolean) {
  const authz = await requireFullAdmin()
  if (!authz.ok) return { success: false as const, error: authz.error }

  const service = createServiceClient()
  if (enabled) {
    const { error } = await service.from("site_settings").upsert(
      {
        key: AUTO_CALIBRATION_KEY,
        value: "on",
        updated_at: new Date().toISOString(),
        updated_by: authz.userId ?? authz.playerId,
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
