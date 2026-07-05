import { PlayerProfileRoute } from "@/components/player-profile-route"

// Shareable player profile URL, e.g. /player/shax. All data is public-readable
// (players / matches / match_stats / player_aliases select-all RLS policies), so
// there is no auth gate — mirrors the public balancer page.
export default async function PlayerPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  return <PlayerProfileRoute slug={slug} />
}
