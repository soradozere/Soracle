import { createClient } from "@/lib/supabase/client"

/**
 * Whether the currently signed-in user is an admin, per the server-side `admins`
 * allowlist (enforced by RLS — see scripts/008_restrict_writes_to_admins.sql).
 *
 * This is the source of truth the UI should gate on. It calls the `is_admin()` SQL
 * function, which returns true only for users in the allowlist. A signed-in user who
 * isn't an admin returns false, so admin-only controls stay hidden rather than showing
 * and then failing with an RLS error on write.
 */
export async function checkIsAdmin(): Promise<boolean> {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return false

    const { data, error } = await supabase.rpc("is_admin")
    if (error) return false
    return data === true
  } catch {
    return false
  }
}

/**
 * Whether the current user may manage matches — a full admin OR a scoped "match
 * admin" (e.g. a captain), per scripts/013_create_match_admins.sql. Gates the Match
 * History tab's approval bin, "Log a Match" button, and match edit/delete controls.
 * Full admin powers (roster, tiers, settings, the /admin panel) still use
 * checkIsAdmin().
 */
export async function checkCanLogMatches(): Promise<boolean> {
  try {
    const supabase = createClient()
    const {
      data: { user },
    } = await supabase.auth.getUser()
    if (!user) return false

    const { data, error } = await supabase.rpc("can_log_matches")
    if (!error) return data === true

    // Fallback if can_log_matches() isn't present yet (migration 013 not applied):
    // keep full admins working so the UI doesn't disappear before the migration.
    const { data: isAdmin } = await supabase.rpc("is_admin")
    return isAdmin === true
  } catch {
    return false
  }
}
