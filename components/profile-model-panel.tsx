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
 * The player's JK2 model, standing alongside their current-month stats.
 *
 * Deliberately unboxed — no card, no border, no background. It shares the This
 * Month panel with the stats rather than occupying one of its own, so the model
 * fills otherwise-empty space instead of adding height to the page. A panel of
 * its own left a lot of dead air, and putting it in the header pushed the whole
 * profile down.
 *
 * Portrait aspect: the canvas is tall and narrow so a standing figure fills it,
 * instead of being letterboxed by a wide container.
 *
 * Renders nothing when no model is set or the stored id isn't in the catalogue,
 * so retiring a model degrades quietly and the layout just closes up.
 */
export function ProfileModelFigure({
  modelId,
  // Centred when it stacks under the stats on narrow screens, flush right when
  // it sits beside them.
  className = "w-52 h-64 shrink-0 mx-auto lg:mx-0",
}: {
  modelId: string | null | undefined
  className?: string
}) {
  const model = findPlayerModel(modelId)
  const { url, error } = useModelUrl(model?.id)

  if (!model) return null

  return (
    <div className={`${className} relative`} title={`${model.label} — drag to turn, scroll to zoom`}>
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
