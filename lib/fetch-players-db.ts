import { createClient } from "@/lib/supabase/client"
import type { Player } from "./types"

// Number of days of inactivity before a player is considered inactive
const INACTIVE_THRESHOLD_DAYS = 27

/**
 * Check if a player is considered inactive
 * A player is inactive if:
 * 1. They are manually marked inactive, OR
 * 2. They haven't played a match in the last 27 days
 */
export function isPlayerInactive(player: Player): boolean {
  // Manually inactive takes priority
  if (player.manually_inactive) {
    return true
  }
  
  // If no last_match_at, they've never played - not considered inactive
  if (!player.last_match_at) {
    return false
  }
  
  const lastMatchDate = new Date(player.last_match_at)
  const thresholdDate = new Date()
  thresholdDate.setDate(thresholdDate.getDate() - INACTIVE_THRESHOLD_DAYS)
  
  return lastMatchDate < thresholdDate
}

export async function fetchPlayersFromDB(): Promise<Player[]> {
  try {
    const supabase = createClient()

    const { data, error } = await supabase.from("players").select("*").order("name")

    if (error) {
      console.error("Failed to fetch players from database:", error)
      return []
    }

    // Transform database format to app format
    return (data || []).map((dbPlayer) => ({
      name: dbPlayer.name,
      tierValue: dbPlayer.tier_value,
      mic: dbPlayer.mic,
      roles: {
        Capper: dbPlayer.capper_rating,
        Chase: dbPlayer.chase_rating,
        Camp: dbPlayer.camp_rating,
        Cleaner: dbPlayer.cleaner_rating,
        Support: dbPlayer.support_rating,
      },
      tooltip: dbPlayer.tooltip || undefined,
      is_active: dbPlayer.is_active ?? true,
      last_match_at: dbPlayer.last_match_at ?? null,
      manually_inactive: dbPlayer.manually_inactive ?? false,
      discord_ids: dbPlayer.discord_ids ?? [],
    }))
  } catch (error) {
    console.error("Failed to fetch players from database:", error)
    return []
  }
}
