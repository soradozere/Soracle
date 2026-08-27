"use client"

import dynamic from "next/dynamic"
import { useEffect, useState } from "react"
import { Pencil, RotateCw, Zap } from "lucide-react"
import { usePrefersReducedMotion } from "@/hooks/use-prefers-reduced-motion"
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
  skin,
  saber,
  mines,
  mineVariant,
  flag,
  flagVariant,
  animation,
  action,
  lightMode,
  onEdit,
  // Tall enough for a full-height figure, since the viewer's zoomed-out framing
  // fills the canvas exactly. Centred when it stacks underneath on narrow
  // screens. The narrow-screen cap has to be lifted at lg or it would win over
  // the wider desktop width.
  //
  // lg:flex-1 rather than a fixed width: the stats column next to this is
  // capped narrower than the row it sits in (its grid tops out at 28rem), so a
  // fixed-width figure left a dead gap between the two on anything wider than
  // ~950px. Growing into whatever's left also means MORE horizontal FOV (the
  // camera's vertical framing is aspect-independent — widening the box only
  // adds width, never changes how tightly the figure is framed top-to-bottom),
  // which is what was clipping a saber held out to the side. Bounded both ways
  // so it can't disappear on a cramped row or balloon on an ultrawide one.
  className = "w-full max-w-[300px] h-[420px] shrink-0 mx-auto lg:mx-0 lg:max-w-[560px] lg:min-w-[380px] lg:flex-1",
}: {
  modelId: string | null | undefined
  /** Skin id from the model's catalogue entry, or nothing for its default. */
  skin?: string | null
  /** Blade colour id, or null for an unarmed model. Ignored when `mines` is set —
   *  the saber and trip mines share one hand bolt, so only one can render. */
  saber?: string | null
  /** Carry a set of trip mines instead of a saber. */
  mines?: boolean
  /** Cosmetic variant of the mine (lib/prop-assets.ts MINE_VARIANTS), or nothing for the default. */
  mineVariant?: string | null
  /** CTF flag team to carry on the back, or nothing to carry none. */
  flag?: string | null
  /** Cosmetic variant of the flag (lib/prop-assets.ts FLAG_VARIANTS), or nothing for the default. */
  flagVariant?: string | null
  /** Idle clip to loop, or nothing for the model's own default idle. */
  animation?: string | null
  /** Specific one-shot clip the action button plays, or nothing for a random pick. */
  action?: string | null
  /** True when the equipped profile theme has mode: "light" — retunes the
   *  canvas lighting/shadow so a dark JK2 model doesn't look underlit against
   *  a bright ground. See ModelViewerProps.lightMode. */
  lightMode?: boolean
  /**
   * Renders a small edit icon alongside the rotate/action buttons when set.
   *
   * Optional because this figure is used elsewhere without an editable
   * loadout (nothing calls it that way today, but nothing should assume every
   * caller wants an edit affordance either).
   */
  onEdit?: () => void
  className?: string
}) {
  const model = findPlayerModel(modelId)
  const { url, error } = useModelUrl(model?.id)
  const reducedMotion = usePrefersReducedMotion()
  const [spin, setSpin] = useState(true)
  const [actionTrigger, setActionTrigger] = useState(0)

  // Stop the idle spin for anyone who has asked the OS for less movement. Left
  // as a toggle rather than a hard block so they can still opt back in.
  useEffect(() => {
    if (reducedMotion) setSpin(false)
  }, [reducedMotion])

  if (!model) return null

  return (
    <div className={`${className} relative group/model`}>
      <div className="w-full h-full" title={`${model.label} — drag to turn, scroll to zoom`}>
        {url ? (
          <ModelViewer
            src={url}
            modelId={model.id}
            skin={skin}
            animation={animation ?? undefined}
            autoRotate={spin}
            actionTrigger={actionTrigger}
            action={action ?? undefined}
            saber={saber}
            mines={mines}
            mineVariant={mineVariant}
            flag={flag}
            flagVariant={flagVariant}
            lightMode={lightMode}
            className="w-full h-full"
          />
        ) : error ? (
          <FigureShell muted />
        ) : (
          <FigureShell />
        )}
      </div>

      {/* Kept deliberately tiny and low-contrast: the model is the subject, and
          this sits inside a stats panel rather than a media player. */}
      {url && (
        <div className="absolute bottom-0 left-0 flex gap-1">
          <ModelButton
            label={spin ? "Stop rotating" : "Rotate automatically"}
            active={spin}
            onClick={() => setSpin((on) => !on)}
          >
            <RotateCw className="w-3 h-3" />
          </ModelButton>
          <ModelButton label="Play an action" onClick={() => setActionTrigger((n) => n + 1)}>
            <Zap className="w-3 h-3" />
          </ModelButton>
          {onEdit && (
            <ModelButton label="Edit loadout" onClick={onEdit}>
              <Pencil className="w-3 h-3" />
            </ModelButton>
          )}
        </div>
      )}
    </div>
  )
}

function ModelButton({
  label,
  active,
  onClick,
  children,
}: {
  label: string
  active?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={`w-6 h-6 rounded border flex items-center justify-center transition-colors ${
        active
          ? "border-[var(--pa60,#66fcf199)] text-[var(--pa,#66fcf1)] bg-[var(--pa10,#66fcf11a)]"
          : "border-[#3d4855] text-[#8892a0] hover:text-[#c5c6c7] hover:border-[#5a6673]"
      }`}
    >
      {children}
    </button>
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
