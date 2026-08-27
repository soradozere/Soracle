"use server"

import { createServiceClient } from "@/lib/supabase/admin"
import { requireFullAdmin } from "@/lib/player-role"
import { recordTitleChangeSafely } from "@/lib/titles-server"

// Full-admin roster writes, moved server-side so a player login promoted to
// full_admin (scripts/044_add_player_admin_roles.sql) can use them too --
// they have no Supabase Auth session, so the `players`/`tier_changes` RLS
// policies (is_admin()-gated, scripts/008_restrict_writes_to_admins.sql)
// would otherwise reject them outright. Same shape as the rest of the admin
// writes in this codebase: authorize here, then write with the service-role
// client.

export interface PlayerInput {
  name: string
  tier_value: number
  mic: boolean
  capper_rating: number
  chase_rating: number
  camp_rating: number
  cleaner_rating: number
  support_rating: number
  tooltip: string | null
  manually_inactive: boolean
  discord_ids: string[]
}

type ActionResult<T> = { success: true; data: T } | { success: false; error: string }

export async function createPlayer(input: PlayerInput): Promise<ActionResult<Record<string, unknown>>> {
  const authz = await requireFullAdmin()
  if (!authz.ok) return { success: false, error: authz.error }

  const { data, error } = await createServiceClient().from("players").insert(input).select().single()
  if (error) return { success: false, error: error.message }
  return { success: true, data }
}

export async function updatePlayerRecord(
  playerId: string,
  input: PlayerInput,
  tierChange: { previousTier: number; newTier: number } | null,
): Promise<ActionResult<null>> {
  const authz = await requireFullAdmin()
  if (!authz.ok) return { success: false, error: authz.error }

  const supabase = createServiceClient()
  const { error } = await supabase.from("players").update(input).eq("id", playerId)
  if (error) return { success: false, error: error.message }

  if (tierChange) {
    await supabase.from("tier_changes").insert({
      player_id: playerId,
      player_name: input.name,
      previous_tier: tierChange.previousTier,
      new_tier: tierChange.newTier,
    })
  }

  return { success: true, data: null }
}

export async function deletePlayerRecord(playerId: string): Promise<ActionResult<null>> {
  const authz = await requireFullAdmin()
  if (!authz.ok) return { success: false, error: authz.error }

  const { error } = await createServiceClient().from("players").delete().eq("id", playerId)
  if (error) return { success: false, error: error.message }
  return { success: true, data: null }
}

export interface AdminProfileFields {
  tooltip: string | null
  avatar_url: string | null
  spotlight_url: string | null
  title: string | null
  profile_theme: string | null
  model: string | null
  saber: string | null
  skin: string | null
  idle_animation: string | null
  action_animation: string | null
  // Not entitlement-checked here, same as model/saber/skin above — full admin
  // access means full admin access. /api/player-profile is what re-validates
  // flag_variant/mine_variant against the player's own earned crests.
  flag: string | null
  flag_variant: string | null
  mine_variant: string | null
}

// Admin-edited profile fields (including the slogan, which is admin-only —
// see EditProfileDialog/EditLoadoutDialog in components/player-profile.tsx).
// Distinct from /api/player-profile, which is the player's own self-service
// path and re-validates their title/theme entitlement instead of trusting
// full-admin access.
export async function updatePlayerProfileAsAdmin(
  playerId: string,
  fields: AdminProfileFields,
): Promise<ActionResult<null>> {
  const authz = await requireFullAdmin()
  if (!authz.ok) return { success: false, error: authz.error }

  const supabase = createServiceClient()

  // The title before the write, for the changelog below. This path and
  // /api/player-profile are the ONLY two writers of players.title -- if a third
  // ever appears it needs this too, or the bot's title ping silently misses it.
  const { data: before } = await supabase.from("players").select("name, title").eq("id", playerId).maybeSingle()

  const { error } = await supabase.from("players").update(fields).eq("id", playerId)
  if (error) return { success: false, error: error.message }

  // Best-effort, after the write, and a no-op unless the title actually moved --
  // same contract as the self-service path. See scripts/046.
  await recordTitleChangeSafely(supabase, playerId, before?.name ?? "", before?.title ?? null, fields.title)

  return { success: true, data: null }
}

// Hides a tier-change entry from the changelog (components/tier-changelog.tsx).
export async function hideTierChange(id: string): Promise<ActionResult<null>> {
  const authz = await requireFullAdmin()
  if (!authz.ok) return { success: false, error: authz.error }

  const { error } = await createServiceClient().from("tier_changes").update({ hidden: true }).eq("id", id)
  if (error) return { success: false, error: error.message }
  return { success: true, data: null }
}
