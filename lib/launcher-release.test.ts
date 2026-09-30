import { describe, expect, it } from "vitest"
import { pickLauncherRelease, type GitHubRelease } from "@/lib/launcher-release"

const asset = (name: string, size = 1) => ({
  name,
  browser_download_url: `https://example.test/${name}`,
  size,
})

// The real asset list from v0.1.0, minus sizes.
const v010: GitHubRelease = {
  tag_name: "v0.1.0",
  draft: false,
  published_at: "2026-09-13T19:27:24Z",
  html_url: "https://github.com/soradozere/soracle-launcher/releases/tag/v0.1.0",
  assets: [
    "JK2Launcher-0.1.0-1.x86_64.rpm",
    "JK2Launcher-0.1.0-1.x86_64.rpm.sig",
    "JK2Launcher_0.1.0_aarch64.app.tar.gz",
    "JK2Launcher_0.1.0_aarch64.app.tar.gz.sig",
    "JK2Launcher_0.1.0_aarch64.dmg",
    "JK2Launcher_0.1.0_amd64.AppImage",
    "JK2Launcher_0.1.0_amd64.AppImage.sig",
    "JK2Launcher_0.1.0_amd64.deb",
    "JK2Launcher_0.1.0_amd64.deb.sig",
    "JK2Launcher_0.1.0_x64-setup.exe",
    "JK2Launcher_0.1.0_x64-setup.exe.sig",
    "JK2Launcher_0.1.0_x64_en-US.msi",
    "JK2Launcher_0.1.0_x64_en-US.msi.sig",
    "latest.json",
  ].map((n) => asset(n)),
}

describe("pickLauncherRelease", () => {
  it("picks one installer per platform and never a .sig", () => {
    const picked = pickLauncherRelease([v010])!
    expect(picked.version).toBe("0.1.0")
    expect(picked.primary.windows?.name).toBe("JK2Launcher_0.1.0_x64-setup.exe")
    expect(picked.primary.mac?.name).toBe("JK2Launcher_0.1.0_aarch64.dmg")
    expect(picked.primary.linux?.name).toBe("JK2Launcher_0.1.0_amd64.AppImage")
    expect(picked.linuxExtras.map((a) => a.name)).toEqual([
      "JK2Launcher-0.1.0-1.x86_64.rpm",
      "JK2Launcher_0.1.0_amd64.deb",
    ])
  })

  it("skips drafts, whose download links 404 for the public", () => {
    const draft = { ...v010, tag_name: "v0.1.1", draft: true, published_at: null }
    expect(pickLauncherRelease([draft, v010])?.version).toBe("0.1.0")
  })

  it("returns null when there's nothing public yet", () => {
    expect(pickLauncherRelease([])).toBeNull()
    expect(pickLauncherRelease([{ ...v010, draft: true }])).toBeNull()
  })

  it("leaves a platform out rather than guessing when its build is missing", () => {
    const noMac = { ...v010, assets: v010.assets.filter((a) => !a.name.endsWith(".dmg")) }
    expect(pickLauncherRelease([noMac])?.primary.mac).toBeUndefined()
  })
})
