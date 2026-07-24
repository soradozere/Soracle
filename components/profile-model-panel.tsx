"use client"

import dynamic from "next/dynamic"
import { useModelUrl } from "@/hooks/use-model-url"
import { findPlayerModel } from "@/lib/player-models"

// Client-only: WebGL can't prerender and r3f's reconciler throws during SSR.
// Legal here because this file is already a client component.
const ModelViewer = dynamic(() => import("@/components/model-viewer").then((m) => m.ModelViewer), {
  ssr: false,
  loading: () => <FigureShell />,
})

/**
 * The player's JK2 model, standing in the profile header where the avatar tile
 * would otherwise be.
 *
 * Deliberately unboxed — no card, no border, no background. It reads as a figure
 * standing on the page rather than a widget embedded in it, which is the whole
 * point; in a bordered panel a vertical character in a wide box just looks small
 * and stranded.
 *
 * Portrait aspect for the same reason: the canvas is tall and narrow so the
 * figure fills it, instead of being letterboxed by a wide container.
 *
 * Renders nothing when no model is set or the stored id isn't in the catalogue,
 * so retiring a model degrades quietly and the caller falls back to the avatar.
 */
export function ProfileModelFigure({ modelId }: { modelId: string | null | undefined }) {
  const model = findPlayerModel(modelId)
  const { url, error } = useModelUrl(model?.id)

  if (!model) return null

  return (
    <div
      className="w-full sm:w-44 h-64 sm:h-72 shrink-0 relative"
      title={`${model.label} — drag to turn, scroll to zoom`}
    >
      {url ? (
        <ModelViewer src={url} autoRotate className="w-full h-full" />
      ) : error ? (
        <FigureShell muted />
      ) : (
        <FigureShell />
      )}
    </div>
  )
}

function FigureShell({ muted }: { muted?: boolean }) {
  return (
    <div className="w-full h-full flex items-center justify-center">
      {muted ? null : (
        <div className="w-7 h-7 border-4 border-[var(--pa40,#66fcf166)] border-t-transparent rounded-full animate-spin" />
      )}
    </div>
  )
}
