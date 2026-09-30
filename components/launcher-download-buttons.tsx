import { Download } from "lucide-react"
import type { LauncherPlatform } from "@/lib/launcher-release"

export interface DownloadOption {
  platform: LauncherPlatform
  label: string
  detail: string
}

// All three platforms as equals - no guessing the visitor's OS and promoting
// one, so nobody is steered to the wrong build.
export function LauncherDownloadButtons({ options }: { options: DownloadOption[] }) {
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      {options.map((o) => (
        <a
          key={o.platform}
          href={`/download/${o.platform}`}
          className="flex items-center justify-center gap-3 rounded-lg bg-[#66fcf1] px-5 py-3.5 font-bold text-[#0b0c10] shadow-[0_0_18px_rgba(102,252,241,0.25)] transition hover:brightness-110"
        >
          <Download className="h-5 w-5 shrink-0" aria-hidden />
          <span className="text-left">
            {o.label}
            <span className="block text-xs font-medium opacity-70">{o.detail}</span>
          </span>
        </a>
      ))}
    </div>
  )
}
