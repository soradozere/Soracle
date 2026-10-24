import type { Metadata } from "next"
import Link from "next/link"
import { Rocket, Download, Server, Boxes, ExternalLink } from "lucide-react"

export const metadata: Metadata = {
  title: "NWH Download — JK2 Capture the Flag",
  description: "Where to get NWH: the JK2 Launcher, client builds, the server module, and the SDK.",
}

const LINKS = [
  {
    label: "JK2 Launcher",
    href: "/launcher",
    icon: Rocket,
  },
  {
    label: "Client builds (macOS / Windows / Linux)",
    href: "https://github.com/soradozere/nwh/actions",
    icon: Download,
  },
  {
    label: "Server module (vvv-nwh)",
    href: "https://github.com/soradozere/vvv-nwh",
    icon: Server,
  },
  {
    label: "SDK (nwh-mvsdk)",
    href: "https://github.com/soradozere/nwh-mvsdk",
    icon: Boxes,
  },
]

export default function NwhDownloadPage() {
  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl relative z-10">
      <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-8">
        <h2 className="text-2xl font-bold text-[#66fcf1] mb-4">NWH Download</h2>
        <p className="mb-6 text-[#c5c6c7]">
          Get it through the JK2 Launcher, or build it yourself: client builds run on every push
          via GitHub Actions, and the server module and SDK source are in their own repositories.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {LINKS.map(({ label, href, icon: Icon }) => {
            const external = href.startsWith("http")
            const className =
              "group flex flex-col items-center justify-center gap-2 rounded-lg border border-[#3d4855] bg-[#2a3441]/60 px-3 py-5 text-center transition-all hover:border-[#66fcf1] hover:shadow-[0_0_10px_rgba(102,252,241,0.3)]"
            const content = (
              <>
                <Icon className="w-5 h-5 text-[#66fcf1]" />
                <span className="text-sm font-bold text-[#e6edf3] flex items-center gap-1">
                  {label}
                  {external && (
                    <ExternalLink className="w-3 h-3 text-[#8892a0] opacity-0 group-hover:opacity-100 transition-opacity" />
                  )}
                </span>
              </>
            )
            return external ? (
              <a key={href} href={href} target="_blank" rel="noopener noreferrer" className={className}>
                {content}
              </a>
            ) : (
              <Link key={href} href={href} className={className}>
                {content}
              </Link>
            )
          })}
        </div>

        <p className="mt-6 text-sm text-text-dim">
          The GitHub repos above are private — you'll need access to open them.
        </p>
      </div>
    </div>
  )
}
