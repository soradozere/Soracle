"use client"

import { useCallback, useState } from "react"
import dynamic from "next/dynamic"
import { Boxes, Monitor, Pause, Play, RotateCw, Smartphone } from "lucide-react"
import { usePrefersReducedMotion } from "@/components/model-viewer"
import { useModelUrl } from "@/hooks/use-model-url"
import { PLAYER_MODELS } from "@/lib/player-models"
import { SABER_COLOURS } from "@/lib/saber-colours"

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

// Real JK2 models come from the shared catalogue and resolve through
// /api/model-url (private bucket, signed URLs). The Khronos sample is committed
// to the repo and loaded straight from /public, so there's always a known-good
// asset to A/B a suspect conversion against even if storage is misconfigured.
const LAB_MODELS = [
  ...PLAYER_MODELS.map((m) => ({
    id: m.id,
    label: `${m.label} (JK2)`,
    /** null = resolve via the signed-URL API */
    staticSrc: null as string | null,
  })),
  // The same models straight off disk, bypassing storage. A conversion has to be
  // checked before it's uploaded — bolts baked in, scale right, animation
  // playing — and the bucket copy is the old one until someone replaces it.
  ...PLAYER_MODELS.map((m) => ({
    id: `${m.id}-local`,
    label: `${m.label} (local file)`,
    staticSrc: `/models/${m.file}`,
  })),
  { id: "fox", label: "Fox (sample)", staticSrc: "/models/fox.glb" },
]

// Two framings: the roomy lab view, and the size the widget would actually be
// on a profile page, which is the one that matters for the perf question.
const VIEWPORTS = {
  desktop: { label: "Profile panel", icon: Monitor, className: "aspect-video w-full" },
  mobile: { label: "Mobile card", icon: Smartphone, className: "aspect-square w-full max-w-[320px] mx-auto" },
} as const

type ViewportKey = keyof typeof VIEWPORTS

export function ModelLab() {
  const [modelId, setModelId] = useState(LAB_MODELS[0].id)
  const [clips, setClips] = useState<string[]>([])
  const [clip, setClip] = useState<string | undefined>(undefined)
  const [fps, setFps] = useState<number | null>(null)
  const [autoRotate, setAutoRotate] = useState(true)
  const [paused, setPaused] = useState(false)
  const [viewport, setViewport] = useState<ViewportKey>("desktop")
  const [saber, setSaber] = useState<string | null>("blue")

  const reducedMotion = usePrefersReducedMotion()
  const model = LAB_MODELS.find((m) => m.id === modelId) ?? LAB_MODELS[0]

  // Catalogue models resolve to a signed URL; the committed sample doesn't.
  const resolved = useModelUrl(model.staticSrc ? null : model.id)
  const src = model.staticSrc ?? resolved.url

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
        <div
          className={`${viewportClass} rounded-lg border border-[#3d4855] bg-[#0b0c10]/60 overflow-hidden flex items-center justify-center`}
        >
          {src ? (
            <ModelViewer
              key={src}
              src={src}
              animation={clip}
              autoRotate={autoRotate}
              paused={effectivePaused}
              saber={saber}
              onClipsLoaded={handleClips}
              onFps={handleFps}
              className="w-full h-full"
            />
          ) : resolved.error ? (
            <p className="text-sm text-[#e74c3c] px-4 text-center">{resolved.error}</p>
          ) : (
            <div className="w-10 h-10 border-4 border-[#66fcf1] border-t-transparent rounded-full animate-spin" />
          )}
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
          {/* Which path the asset came down — "local" means the private bucket
              isn't set up (or is failing) and we fell back to /public. */}
          {!model.staticSrc && resolved.source && (
            <span className="text-[#8892a0]">
              Source{" "}
              <span className={`font-mono font-bold ${resolved.source === "storage" ? "text-[#27ae60]" : "text-[#f39c12]"}`}>
                {resolved.source === "storage" ? "signed URL" : "local /public"}
              </span>
            </span>
          )}
        </div>

        {/* ---- Controls ---- */}
        <div className="mt-4 pt-4 border-t border-[#3d4855] flex flex-wrap gap-2">
          {LAB_MODELS.map((m) => (
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

          <button onClick={() => setSaber(null)} className={controlClass(saber === null)}>
            No saber
          </button>
          {SABER_COLOURS.map((colour) => (
            <button
              key={colour.id}
              onClick={() => setSaber(colour.id)}
              className={controlClass(saber === colour.id)}
            >
              <span className="w-3 h-3 rounded-full" style={{ background: colour.glow }} />
              {colour.label}
            </button>
          ))}
        </div>

        {resolved.source === "local" && (
          <p className="mt-4 text-xs text-[#f39c12]">
            Served from <code>/public</code> — the private <code>models</code> bucket isn&apos;t reachable
            {resolved.reason ? ` (${resolved.reason})` : ""}. Fine locally; in production this 404s, because
            converted JK2 models are gitignored.
          </p>
        )}

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
