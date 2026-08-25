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

// A player's role, if their player-login session has been promoted to
// captain/full_admin (scripts/044_add_player_admin_roles.sql). null if
// there's no player session, the fetch fails, or they're an unpromoted
// "player". Client-side helper, so it goes through the API route rather than
// querying player_credentials directly (which has no RLS and is
// service-role-only by design).
async function fetchPlayerRole(): Promise<"player" | "captain" | "full_admin" | null> {
  try {
    const res = await fetch("/api/player-auth/me")
    if (!res.ok) return null
    const data = await res.json()
    return data.playerId ? (data.role ?? "player") : null
  } catch {
    return null
  }
}

/**
 * Full-admin parity check that also recognizes a player login promoted to
 * full_admin, not just a Supabase Auth admin. Prefer this over checkIsAdmin()
 * for any UI gate on admin-only controls added after the roles feature
 * shipped, so promoted players see the same controls you do.
 */
export async function checkIsFullAdmin(): Promise<boolean> {
  if (await checkIsAdmin()) return true
  return (await fetchPlayerRole()) === "full_admin"
}

/**
 * checkCanLogMatches(), extended to also recognize a player login promoted to
 * captain or full_admin. Prefer this over checkCanLogMatches() for any new
 * match-management UI gate.
 */
export async function checkCanManage(): Promise<boolean> {
  if (await checkCanLogMatches()) return true
  const role = await fetchPlayerRole()
  return role === "captain" || role === "full_admin"
}
