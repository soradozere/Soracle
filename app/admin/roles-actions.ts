"use server"

import { createServiceClient } from "@/lib/supabase/admin"
import { requireFullAdmin, type PlayerRole } from "@/lib/player-role"

export interface PlayerRoleRow {
  id: string
  name: string
  role: PlayerRole
  hasLogin: boolean
}

type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

// Every player, with their role (default "player") and whether they have a
// login yet — a role can't be granted without one. Backs the panel's Roles
// section: the promoted-players list and the "promote a player" picker.
export async function listPlayersWithRoles(): Promise<ActionResult<PlayerRoleRow[]>> {
  const authz = await requireFullAdmin()
  if (!authz.ok) return { success: false, error: authz.error }

  const supabase = createServiceClient()
  const { data: players, error } = await supabase.from("players").select("id, name").order("name")
  if (error) return { success: false, error: error.message }

  const { data: creds, error: credsError } = await supabase.from("player_credentials").select("player_id, role")
  if (credsError) return { success: false, error: credsError.message }
  const credsById = new Map((creds ?? []).map((c) => [c.player_id as string, c.role as PlayerRole]))

  const data: PlayerRoleRow[] = (players ?? []).map((p) => ({
    id: p.id as string,
    name: p.name as string,
    role: credsById.get(p.id as string) ?? "player",
    hasLogin: credsById.has(p.id as string),
  }))

  return { success: true, data }
}

export async function setPlayerRole(playerId: string, role: PlayerRole): Promise<ActionResult<null>> {
  const authz = await requireFullAdmin()
  if (!authz.ok) return { success: false, error: authz.error }

  const supabase = createServiceClient()

  const { data: creds } = await supabase
    .from("player_credentials")
    .select("role")
    .eq("player_id", playerId)
    .maybeSingle()
  if (!creds) {
    return {
      success: false,
      error: "This player doesn't have a login yet — generate one first (the key icon in Player Management).",
    }
  }

  // Guard against locking everyone out: don't allow removing the very last
  // full_admin, counting both promoted players and the Supabase Auth admins
  // table (scripts/008_restrict_writes_to_admins.sql) — your own account and
  // any other Supabase-based admin aren't affected by this feature at all,
  // but still count toward "is there at least one full admin left".
  if (creds.role === "full_admin" && role !== "full_admin") {
    const [playerFullAdmins, supabaseAdmins] = await Promise.all([
      supabase.from("player_credentials").select("player_id", { count: "exact", head: true }).eq("role", "full_admin"),
      supabase.from("admins").select("user_id", { count: "exact", head: true }),
    ])
    const total = (playerFullAdmins.count ?? 0) + (supabaseAdmins.count ?? 0)
    if (total <= 1) {
      return { success: false, error: "Can't remove the last Full Admin." }
    }
  }

  const { error } = await supabase.from("player_credentials").update({ role }).eq("player_id", playerId)
  if (error) return { success: false, error: error.message }
  return { success: true, data: null }
}
