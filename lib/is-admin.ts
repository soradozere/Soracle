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
