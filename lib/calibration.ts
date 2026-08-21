import type { SupabaseClient } from "@supabase/supabase-js"

/*
 * Auto-calibration switch.
 *
 * The seasonal tier calibrator (adjusts player tiers from match results as games
 * are played) is gated behind this site_settings flag so admins can turn it on
 * and off from the admin panel without a deploy. The engine itself must check
 * this key before making any change; while the row is absent the tier list only
 * moves when an admin edits it by hand.
 *
 * Row absent = OFF (the table's documented default state). Value "on" = ON.
 */
export const AUTO_CALIBRATION_KEY = "auto_calibration"

/** Whether auto-calibration is switched on. Takes the caller's Supabase client
 * (server, browser, or service-role — SELECT on site_settings is public). */
export async function readAutoCalibrationEnabled(supabase: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("site_settings")
      .select("value")
      .eq("key", AUTO_CALIBRATION_KEY)
      .maybeSingle()
    if (error) return false
    return data?.value === "on"
  } catch {
    // An unreadable flag must fail CLOSED: silently calibrating tiers when the
    // switch can't be read is worse than skipping a run.
    return false
  }
}
