"use client"

import { useCallback, useState } from "react"
import dynamic from "next/dynamic"
import { Boxes, Monitor, Pause, Play, RotateCw, Smartphone } from "lucide-react"
import { usePrefersReducedMotion } from "@/components/model-viewer"

// The canvas is client-only: WebGL can't prerender, and r3f's reconciler throws
// if it runs during SSR. This file is already a client component, so `ssr: false`
// is legal here (it wouldn't be in a server component).
const ModelViewer = dynamic(() => import("@/components/model-viewer").then((m) => m.ModelViewer), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-10 h-10 border-4 border-[#66fcf1] border-t-transparent rounded-full animate-spin" />
    </div>
  ),
})

// Models available to the harness. JK2 conversions get listed alongside the
// Khronos sample so a suspect conversion can be A/B'd against a known-good asset.
const MODELS = [
  {
    id: "kyle",
    label: "Kyle (JK2)",
    src: "/models/kyle.glb",
    note: "835 KB · 19 surfaces · 2,761 tris · 72 bones · BOTH_STAND1IDLE1 (150 frames).",
  },
  {
    id: "fox",
    label: "Fox (sample)",
    src: "/models/fox.glb",
    note: "Khronos reference model — 159 KB, 3 clips. Scaffolding for comparison against the JK2 conversion.",
  },
]

// Two framings: the roomy lab view, and the size the widget would actually be
// on a profile page, which is the one that matters for the perf question.
const VIEWPORTS = {
  desktop: { label: "Profile panel", icon: Monitor, className: "aspect-video w-full" },
  mobile: { label: "Mobile card", icon: Smartphone, className: "aspect-square w-full max-w-[320px] mx-auto" },
} as const

type ViewportKey = keyof typeof VIEWPORTS

export function ModelLab() {
  const [modelId, setModelId] = useState(MODELS[0].id)
  const [clips, setClips] = useState<string[]>([])
  const [clip, setClip] = useState<string | undefined>(undefined)
  const [fps, setFps] = useState<number | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)
  const [paused, setPaused] = useState(false)
  const [viewport, setViewport] = useState<ViewportKey>("desktop")

  const reducedMotion = usePrefersReducedMotion()
  const model = MODELS.find((m) => m.id === modelId) ?? MODELS[0]

  // Stable identities — Model re-runs its play effect whenever these change.
  const handleClips = useCallback((names: string[]) => {
    setClips(names)
    setClip((current) => (current && names.includes(current) ? current : names[0]))
  }, [])
  const handleFps = useCallback((next: number) => setFps(next), [])

  const effectivePaused = paused || reducedMotion
  const { className: viewportClass } = VIEWPORTS[viewport]

  return (
    <div className="max-w-5xl mx-auto">
      <div className="mb-6">
        <h1 className="font-mono text-2xl font-bold text-[#e6edf3] flex items-center gap-2">
          <Boxes className="w-6 h-6 text-[#66fcf1]" />
          Model Lab
        </h1>
        <p className="mt-1 text-sm text-[#8892a0]">
          Test harness for the animated player model viewer. Not linked from the nav.
        </p>
      </div>

      <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-5">
        {/* ---- Canvas ---- */}
        <div className={`${viewportClass} rounded-lg border border-[#3d4855] bg-[#0b0c10]/60 overflow-hidden`}>
          <ModelViewer
            key={model.src}
            src={model.src}
            animation={clip}
            autoRotate={autoRotate}
            paused={effectivePaused}
            onClipsLoaded={handleClips}
            onFps={handleFps}
            className="w-full h-full"
          />
        </div>

        {/* ---- Readouts ---- */}
        <div className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm">
          <span className="text-[#8892a0]">
            FPS{" "}
            <span className={`font-mono font-bold ${fpsColour(fps, effectivePaused)}`}>
              {effectivePaused ? "paused" : (fps ?? "—")}
            </span>
          </span>
          <span className="text-[#8892a0]">
            Clips <span className="font-mono text-[#e6edf3]">{clips.length || "—"}</span>
          </span>
          <span className="text-[#8892a0]">
            Model <span className="font-mono text-[#e6edf3]">{model.id}</span>
          </span>
        </div>

        {/* ---- Controls ---- */}
        <div className="mt-4 pt-4 border-t border-[#3d4855] flex flex-wrap gap-2">
          {MODELS.map((m) => (
            <button key={m.id} onClick={() => setModelId(m.id)} className={controlClass(m.id === modelId)}>
              {m.label}
            </button>
          ))}

          <button onClick={() => setPaused((p) => !p)} className={controlClass(paused)}>
            {paused ? <Play className="w-4 h-4" /> : <Pause className="w-4 h-4" />}
            {paused ? "Play" : "Pause"}
          </button>

          <button onClick={() => setAutoRotate((r) => !r)} className={controlClass(autoRotate)}>
            <RotateCw className="w-4 h-4" />
            Auto-rotate
          </button>

          {(Object.keys(VIEWPORTS) as ViewportKey[]).map((key) => {
            const { label, icon: Icon } = VIEWPORTS[key]
            return (
              <button key={key} onClick={() => setViewport(key)} className={controlClass(viewport === key)}>
                <Icon className="w-4 h-4" />
                {label}
              </button>
            )
          })}

          {clips.map((name) => (
            <button key={name} onClick={() => setClip(name)} className={controlClass(clip === name)}>
              {name}
            </button>
          ))}
        </div>

        <p className="mt-4 text-xs text-[#8892a0]">{model.note}</p>

        {reducedMotion && (
          <p className="mt-2 text-xs text-[#f39c12]">
            Your OS has “reduce motion” on, so the animation is held still — that's the intended behaviour, not a bug.
          </p>
        )}
      </div>
    </div>
  )
}

function controlClass(active: boolean) {
  return [
    "px-3 py-1.5 rounded-md text-sm font-medium transition-all flex items-center gap-1.5 border",
    active
      ? "bg-[#66fcf1] text-[#0b0c10] font-bold border-[#66fcf1] shadow-[0_0_10px_rgba(102,252,241,0.35)]"
      : "bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border-[#3d4855]",
  ].join(" ")
}

// 55+ reads as smooth, 30-55 is watchable, below 30 is a problem worth seeing
// at a glance while testing on a real phone.
function fpsColour(fps: number | null, paused: boolean) {
  if (paused || fps === null) return "text-[#8892a0]"
  if (fps >= 55) return "text-[#27ae60]"
  if (fps >= 30) return "text-[#f39c12]"
  return "text-[#e74c3c]"
}
