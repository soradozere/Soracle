"use client"

import { useEffect, useState } from "react"
import { Download } from "lucide-react"
import type { LauncherPlatform } from "@/lib/launcher-release"

export interface DownloadOption {
  platform: LauncherPlatform
  label: string
  detail: string
}

// Best guess from the browser, only ever used to decide which button leads -
// every platform stays one click away underneath. Server-rendered with no
// guess (Windows first), then corrected on mount, so there's no mismatch.
function detectPlatform(): LauncherPlatform | null {
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const hint = `${nav.userAgentData?.platform ?? ""} ${navigator.userAgent}`.toLowerCase()
  // Phones and tablets can't run it at all, so don't pretend otherwise.
  if (/android|iphone|ipad/.test(hint)) return null
  if (hint.includes("mac")) return "mac"
  if (hint.includes("win")) return "windows"
  if (hint.includes("linux") || hint.includes("x11")) return "linux"
  return null
}

export function LauncherDownloadButtons({ options }: { options: DownloadOption[] }) {
  const [detected, setDetected] = useState<LauncherPlatform | null>(null)
  useEffect(() => setDetected(detectPlatform()), [])

  const lead = options.find((o) => o.platform === detected) ?? null
  const rest = options.filter((o) => o !== lead)

  return (
    <div className="flex flex-col items-center gap-4">
      {lead && (
        <a
          href={`/download/${lead.platform}`}
          className="inline-flex items-center gap-3 rounded-lg bg-[#66fcf1] px-7 py-3.5 font-bold text-[#0b0c10] shadow-[0_0_24px_rgba(102,252,241,0.35)] transition hover:brightness-110"
        >
          <Download className="h-5 w-5" aria-hidden />
          <span>
            Download for {lead.label}
            <span className="block text-xs font-medium opacity-70">{lead.detail}</span>
          </span>
        </a>
      )}
      <div className="flex flex-wrap justify-center gap-3">
        {rest.map((o) => (
          <a
            key={o.platform}
            href={`/download/${o.platform}`}
            className="inline-flex items-center gap-2 rounded-lg border border-[#3d4855] bg-[#1f2833]/60 px-4 py-2.5 text-sm text-[#c5c6c7] transition hover:border-[#66fcf1]/60 hover:text-white"
          >
            <Download className="h-4 w-4" aria-hidden />
            <span>
              {o.label} <span className="text-[#8892a0]">· {o.detail}</span>
            </span>
          </a>
        ))}
      </div>
    </div>
  )
}
