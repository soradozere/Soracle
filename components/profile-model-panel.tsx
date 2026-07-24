"use client"

import dynamic from "next/dynamic"
import { useModelUrl } from "@/hooks/use-model-url"
import { findPlayerModel } from "@/lib/player-models"

// Client-only: WebGL can't prerender and r3f's reconciler throws during SSR.
// Legal here because this file is already a client component.
const ModelViewer = dynamic(() => import("@/components/model-viewer").then((m) => m.ModelViewer), {
  ssr: false,
  loading: () => <PanelShell />,
})

/**
 * The player's chosen JK2 model, floating on their profile.
 *
 * Deliberately its own slot rather than sharing the Spotlight, which is already
 * the player's video clip. Renders nothing at all when no model is set or the
 * stored id isn't in the catalogue, so retiring a model degrades quietly instead
 * of leaving a broken panel on someone's profile.
 */
export function ProfileModelPanel({ modelId, accent }: { modelId: string | null | undefined; accent?: string }) {
  const model = findPlayerModel(modelId)
  const { url, error } = useModelUrl(model?.id)

  if (!model) return null

  return (
    <div className="bg-[#1f2833]/60 backdrop-blur-md border border-[#3d4855] rounded-lg p-4">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-mono text-sm font-bold tracking-wide" style={{ color: accent ?? "#66fcf1" }}>
          MODEL
        </h3>
        <span className="text-xs text-[#8892a0]">{model.label}</span>
      </div>

      <div className="h-[320px] rounded-lg bg-[#0b0c10]/50 overflow-hidden flex items-center justify-center">
        {url ? (
          <ModelViewer
            src={url}
            autoRotate
            className="w-full h-full"
            // The profile is a showcase, not a toy — spin and zoom only, and the
            // viewer already pins vertical orbit off.
          />
        ) : error ? (
          <p className="text-xs text-[#8892a0] px-4 text-center">Model unavailable</p>
        ) : (
          <PanelShell />
        )}
      </div>

      <p className="mt-2 text-center text-xs text-[#8892a0]">Drag to turn · scroll to zoom</p>
    </div>
  )
}

function PanelShell() {
  return (
    <div className="w-full h-full flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-[#66fcf1] border-t-transparent rounded-full animate-spin" />
    </div>
  )
}
