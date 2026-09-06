import { NextResponse } from "next/server"
import { getFeaturedVideo } from "@/lib/youtube-feed"

export const revalidate = 3600

// JSON twin of the homepage's HomeVideoPanel, for the JK2 Launcher's Home
// screen. getFeaturedVideo() is already cached internally (see
// lib/youtube-feed.ts), so this is just a thin wrapper.
export async function GET() {
  const featured = await getFeaturedVideo()
  return NextResponse.json(featured)
}
