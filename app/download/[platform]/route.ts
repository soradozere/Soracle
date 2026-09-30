import { NextResponse } from "next/server"
import {
  LAUNCHER_PLATFORMS,
  LAUNCHER_RELEASES_URL,
  getLauncherRelease,
  type LauncherPlatform,
} from "@/lib/launcher-release"

// jk2ctf.com/download/windows (or mac, linux): a short, permanent link that
// always hands out the newest launcher build - safe to paste in Discord and
// forget, since it never names a version. Redirects to the file on GitHub
// (see lib/launcher-release.ts for why it lives there), or to the releases
// page if GitHub can't be reached or that build is missing.
export async function GET(request: Request, { params }: { params: Promise<{ platform: string }> }) {
  const { platform } = await params
  if (!LAUNCHER_PLATFORMS.includes(platform as LauncherPlatform)) {
    return NextResponse.redirect(new URL("/launcher", request.url))
  }

  const release = await getLauncherRelease()
  const asset = release?.primary[platform as LauncherPlatform]
  // 302, not 308: the target changes with every release, so nothing
  // should remember it.
  return NextResponse.redirect(asset?.url ?? release?.pageUrl ?? LAUNCHER_RELEASES_URL, 302)
}
