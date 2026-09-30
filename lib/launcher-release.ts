import { unstable_cache } from "next/cache"

/*
 * The JK2 Launcher's current downloads, for /launcher and /download/[platform].
 *
 * The files stay on GitHub Releases, where the launcher's release workflow
 * already puts them and where its auto-updater reads from. Copying 10-90MB
 * builds into this site on every release would mean one more manual step to
 * forget, and serving them from Vercel would spend bandwidth on something
 * GitHub hosts for free. /download/[platform] redirects straight to the file,
 * so from a visitor's side it's a jk2ctf.com link that just downloads.
 */
export const LAUNCHER_REPO = "soradozere/soracle-launcher"
export const LAUNCHER_RELEASES_URL = `https://github.com/${LAUNCHER_REPO}/releases`

export type LauncherPlatform = "windows" | "mac" | "linux"
export const LAUNCHER_PLATFORMS: LauncherPlatform[] = ["windows", "mac", "linux"]

export interface LauncherAsset {
  name: string
  url: string
  size: number
}

export interface LauncherRelease {
  version: string
  published: string | null
  pageUrl: string
  /** The one file each platform's download button hands out. */
  primary: Partial<Record<LauncherPlatform, LauncherAsset>>
  /** Linux's other packages (.deb/.rpm) for people who'd rather not use the AppImage. */
  linuxExtras: LauncherAsset[]
}

interface GitHubAsset {
  name: string
  browser_download_url: string
  size: number
}

export interface GitHubRelease {
  tag_name: string
  draft: boolean
  published_at: string | null
  html_url: string
  assets: GitHubAsset[]
}

// Tauri's own file naming: JK2Launcher_0.1.0_x64-setup.exe,
// JK2Launcher_0.1.0_aarch64.dmg, JK2Launcher_0.1.0_amd64.AppImage. The .sig
// files beside each are for the updater, never for people.
const PRIMARY_PATTERN: Record<LauncherPlatform, RegExp> = {
  windows: /_x64-setup\.exe$/,
  mac: /\.dmg$/,
  linux: /\.AppImage$/,
}
const LINUX_EXTRAS = /\.(deb|rpm)$/

function toAsset(a: GitHubAsset): LauncherAsset {
  return { name: a.name, url: a.browser_download_url, size: a.size }
}

/**
 * Picks the newest release a visitor should get. Drafts are skipped (they're
 * invisible to the public and their download links 404); pre-releases are
 * not, since the launcher's early builds went out as pre-releases and there
 * would otherwise be nothing to offer. GitHub lists newest first.
 */
export function pickLauncherRelease(releases: GitHubRelease[]): LauncherRelease | null {
  const release = releases.find((r) => !r.draft)
  if (!release) return null

  const primary: LauncherRelease["primary"] = {}
  for (const platform of LAUNCHER_PLATFORMS) {
    const asset = release.assets.find((a) => PRIMARY_PATTERN[platform].test(a.name))
    if (asset) primary[platform] = toAsset(asset)
  }

  return {
    version: release.tag_name.replace(/^v/, ""),
    published: release.published_at,
    pageUrl: release.html_url,
    primary,
    linuxExtras: release.assets.filter((a) => LINUX_EXTRAS.test(a.name)).map(toAsset),
  }
}

async function fetchLauncherReleaseUncached(): Promise<LauncherRelease | null> {
  // Unauthenticated on purpose: it's a public repo, and GitHub's 60
  // requests/hour per IP is plenty behind the cache below.
  const res = await fetch(`https://api.github.com/repos/${LAUNCHER_REPO}/releases?per_page=10`, {
    signal: AbortSignal.timeout(10_000),
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  })
  // Thrown rather than returned as null so unstable_cache keeps serving the
  // last good answer instead of caching the failure for the whole window.
  if (!res.ok) throw new Error(`GitHub releases returned ${res.status}`)
  return pickLauncherRelease((await res.json()) as GitHubRelease[])
}

const cachedLauncherRelease = unstable_cache(fetchLauncherReleaseUncached, ["launcher-release"], {
  revalidate: 600,
})

/** Null when GitHub can't be reached and nothing is cached yet - callers fall back to the releases page. */
export async function getLauncherRelease(): Promise<LauncherRelease | null> {
  try {
    return await cachedLauncherRelease()
  } catch {
    return null
  }
}

export function formatSize(bytes: number): string {
  return `${Math.round(bytes / 1_000_000)} MB`
}
