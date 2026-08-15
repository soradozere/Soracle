import type { Metadata } from "next"
import { cookies } from "next/headers"
import { createServiceClient } from "@/lib/supabase/admin"
import { verifySessionValue, PLAYER_SESSION_COOKIE } from "@/lib/player-auth"
import { LiveViewer } from "@/components/live-viewer"

export const metadata: Metadata = {
  title: "Live — JK2 Capture the Flag",
  description: "Watch the match live in your browser. Your own camera, your own POV.",
}

// Login required to watch, so the page needs to know who you are before it
// renders. The token itself is minted per-session by /api/live/token; this only
// decides whether to show the player or a sign-in prompt.
export default async function LivePage() {
  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)

  let playerName: string | null = null
  if (playerId) {
    const supabase = createServiceClient()
    const { data } = await supabase.from("players").select("name").eq("id", playerId).maybeSingle()
    playerName = data?.name ?? null
  }

  return <LiveViewer signedIn={!!playerId} playerName={playerName} />
}
