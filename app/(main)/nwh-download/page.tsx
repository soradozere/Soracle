import type { Metadata } from "next"
import Link from "next/link"
import { Rocket, Download, Server } from "lucide-react"

export const metadata: Metadata = {
  title: "NWH Download — JK2 Capture the Flag",
  description: "Where to get NWH: the JK2 Launcher, direct client downloads, and the server package.",
}

// Hosted on R2 rather than committed to this (public) repo -- see
// scripts/upload-nwh-downloads.mjs. Re-run that script to push a new build.
const NWH_BASE = `${process.env.NEXT_PUBLIC_R2_DEMOS_BASE_URL}/nwh`

const CLIENT_DOWNLOADS = [
  { label: "Windows", href: `${NWH_BASE}/nwh_windows_x64.zip` },
  { label: "macOS", sub: "Apple Silicon", href: `${NWH_BASE}/NWH-macOS-arm64.zip` },
  { label: "macOS", sub: "Intel", href: `${NWH_BASE}/NWH-macOS-x86_64.zip` },
  { label: "Linux", href: `${NWH_BASE}/nwh_linux_x64.tar.gz` },
]

const cardClassName =
  "group flex flex-col items-center justify-center gap-2 rounded-lg border border-[#3d4855] bg-[#2a3441]/60 px-3 py-5 text-center transition-all hover:border-[#66fcf1] hover:shadow-[0_0_10px_rgba(102,252,241,0.3)]"

export default function NwhDownloadPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl relative z-10">
      <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-8">
        <h2 className="text-2xl font-bold text-[#66fcf1] mb-4">NWH Download</h2>
        <p className="mb-6 text-[#c5c6c7]">Get it through the JK2 Launcher, or download it directly.</p>

        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          <Link href="/launcher" className={cardClassName}>
            <Rocket className="w-5 h-5 text-[#66fcf1]" />
            <span className="text-sm font-bold text-[#e6edf3]">JK2 Launcher</span>
          </Link>

          {CLIENT_DOWNLOADS.map(({ label, sub, href }) =>
            href ? (
              <a key={`${label}-${sub ?? ""}`} href={href} className={cardClassName}>
                <Download className="w-5 h-5 text-[#66fcf1]" />
                <span className="text-sm font-bold text-[#e6edf3]">{label}</span>
                {sub && <span className="text-xs text-[#8892a0]">{sub}</span>}
              </a>
            ) : (
              <div
                key={`${label}-${sub ?? ""}`}
                className="flex flex-col items-center justify-center gap-2 rounded-lg border border-[#3d4855] bg-[#2a3441]/30 px-3 py-5 text-center opacity-60"
              >
                <Download className="w-5 h-5 text-[#8892a0]" />
                <span className="text-sm font-bold text-[#8892a0]">{label}</span>
                <span className="text-xs text-[#6b7a8a]">Coming soon</span>
              </div>
            ),
          )}
        </div>

        <h3 className="mt-8 mb-3 text-sm font-bold uppercase tracking-wide text-[#8892a0]">
          Running a server?
        </h3>
        <a href={`${NWH_BASE}/nwhserver-manualrepack.tar.gz`} className={`${cardClassName} sm:max-w-xs`}>
          <Server className="w-5 h-5 text-[#66fcf1]" />
          <span className="text-sm font-bold text-[#e6edf3]">Server package</span>
        </a>
      </div>
    </div>
  )
}
