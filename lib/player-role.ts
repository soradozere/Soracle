import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"

// Admin-equivalent roles attached directly to a player's existing login
// (scripts/044_add_player_admin_roles.sql), as an alternative to creating a
// separate Supabase Auth account for someone who's already a player here.
// Checked only in the server-side helpers below -- never in RLS, since
// player_credentials has no RLS policies of its own (service-role only).
export type PlayerRole = "player" | "captain" | "full_admin"

export interface PromotedPlayer {
  id: string
  name: string
  role: PlayerRole
}

// Resolves the current request's player-login session, if any, to their id,
// name, and role. Server-only (reads the httpOnly session cookie).
export async function getPlayerSession(): Promise<PromotedPlayer | null> {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)
  if (!playerId) return null

  const supabase = createServiceClient()
  const { data: creds } = await supabase
    .from("player_credentials")
    .select("role")
    .eq("player_id", playerId)
    .maybeSingle()
  if (!creds) return null

  const { data: player } = await supabase.from("players").select("id, name").eq("id", playerId).maybeSingle()
  if (!player) return null

  return { id: player.id, name: player.name, role: (creds.role as PlayerRole) ?? "player" }
}

export type AdminAuthz =
  | { ok: true; userId: string | null; playerId: string | null }
  | { ok: false; error: string }

// Full-admin parity check for server actions/route handlers: a Supabase Auth
// admin (is_admin()), OR a player login promoted to full_admin. Exactly one
// of userId/playerId is set on success, so callers can attribute writes to
// the right identity -- a promoted player has no auth.users row to point a
// foreign key at.
export async function requireFullAdmin(): Promise<AdminAuthz> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (user) {
    const { data: isAdmin } = await supabase.rpc("is_admin")
    if (isAdmin === true) return { ok: true, userId: user.id, playerId: null }
  }

  const player = await getPlayerSession()
  if (player?.role === "full_admin") return { ok: true, userId: null, playerId: player.id }

  return { ok: false, error: "Not authorized" }
}

// Full-admin page guard: like requireFullAdmin(), but redirects on failure
// instead of returning an error. Distinguishes "no identity at all" (bounce to
// the Supabase login page, preserving today's behavior) from "signed in as
// something, just not a full admin" (bounce home -- /auth/login would be a
// dead end for a player-login visitor who isn't a Supabase Auth user at all).
export async function requireFullAdminPage(): Promise<{
  userId: string | null
  playerId: string | null
  label: string
}> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (user) {
    const { data: isAdmin } = await supabase.rpc("is_admin")
    if (isAdmin === true) return { userId: user.id, playerId: null, label: user.email ?? user.id }
    redirect("/")
  }

  const player = await getPlayerSession()
  if (player?.role === "full_admin") return { userId: null, playerId: player.id, label: player.name }
  if (player) redirect("/")

  redirect("/auth/login")
}
