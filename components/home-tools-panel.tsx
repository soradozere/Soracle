import { Download, PenLine, Archive, Boxes, ExternalLink } from "lucide-react"

const TOOLS = [
  {
    label: "NWH Download",
    href: "https://jk2t.ddns.net/#nwh",
    icon: Download,
  },
  {
    label: "Name Editor",
    href: "https://jk2t.ddns.net/jk2-name-editor/",
    icon: PenLine,
  },
  {
    label: "Demo Archive",
    href: "https://archive.org/download/democuts",
    icon: Archive,
  },
  {
    label: "Monolith Mod Manager",
    href: "https://github.com/fl4te/monolith/releases/",
    icon: Boxes,
  },
]

export function HomeToolsPanel() {
  return (
    <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {TOOLS.map(({ label, href, icon: Icon }) => (
          <a
            key={label}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="group flex flex-col items-center justify-center gap-2 rounded-lg border border-[#3d4855] bg-[#2a3441]/60 px-3 py-5 text-center transition-all hover:border-[#66fcf1] hover:shadow-[0_0_10px_rgba(102,252,241,0.3)]"
          >
            <Icon className="w-5 h-5 text-[#66fcf1]" />
            <span className="text-sm font-bold text-[#e6edf3] flex items-center gap-1">
              {label}
              <ExternalLink className="w-3 h-3 text-[#8892a0] opacity-0 group-hover:opacity-100 transition-opacity" />
            </span>
          </a>
        ))}
      </div>
      <p className="mt-4 text-center text-xs text-[#8892a0]">Thanks to Flate, Tom, Bucky and Silver btw</p>
    </div>
  )
}
