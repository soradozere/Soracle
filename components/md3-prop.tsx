"use client"

import { useLayoutEffect, useMemo } from "react"
import { useGLTF } from "@react-three/drei"
import { DoubleSide, type Material, type Mesh, type Object3D } from "three"
import { flattenMeshMaterials } from "@/lib/three-materials"

/** Every model is rescaled to this height by <Model>; see model-viewer.tsx. */
const TARGET_HEIGHT = 2
/** A JK2 player is 64 Quake units tall, and MD3 props are in raw Quake units. */
const QUAKE_UNITS_PER_PLAYER = 64

/**
 * Converts a converted MD3's units to the viewer's normalised ones.
 *
 * Shared with components/saber.tsx so a hilt, a flag and a trip mine are all
 * sized by the same rule. Anything else means props that look right next to each
 * other in the game and wrong next to each other here.
 */
export const MD3_SCALE = TARGET_HEIGHT / QUAKE_UNITS_PER_PLAYER

/**
 * A converted JK2 prop, drawn at game scale in its own coordinate space.
 *
 * Deliberately does nothing about placement. scripts/md3-to-gltf.mjs keeps the
 * MD3's own origin and axes, and scripts/glm-bolts.mjs bakes each bolt with the
 * orientation Ghoul2 gives it, so parenting one of these to a bolt reproduces
 * exactly what the engine does — the flag lands across the back at the game's
 * angle because both halves came out of the game's own files, not because
 * anyone tuned an offset. A prop that needs tuning to sit right is a sign the
 * conversion is wrong, not that the number needs nudging.
 *
 * `scale` is the one exception, and it is NOT a fudge factor — it's for a scale
 * the engine applies at render time that the model file has no way to record.
 * See CARRIED_FLAG_SCALE in model-viewer.tsx for the only current case. Reach
 * for it only with evidence that the game itself does the same; a prop that
 * merely *looks* wrong is a conversion bug, and scaling it hides that.
 *
 * The scene is cloned because drei caches one object per URL: two viewers on a
 * page would otherwise be moving the same nodes around.
 */
export function Md3Prop({
  src,
  scale = 1,
  doubleSided = false,
  opacity = 1,
}: {
  src: string
  scale?: number
  /**
   * For a prop thin enough that the camera can end up looking at its back —
   * the carried flag is the only current case. JK2's own banner shader almost
   * certainly disables culling for exactly this reason (a flapping flag has
   * no fixed "front"); Blender's glTF export has no equivalent flag and
   * defaults every material to single-sided, so a flag viewed from the
   * player's front — looking at the back of the same plane that reads fine
   * from behind — renders as nothing at all. A hilt or a mine has real
   * volume, so this has never come up for them.
   */
  doubleSided?: boolean
  /**
   * The other genuine exception alongside `scale` and `doubleSided`: the
   * flag's "transparent" cosmetic (see FLAG_OPACITY in lib/prop-assets.ts) is
   * a real alpha-blended look, applied here at runtime rather than baked into
   * a converted asset because it isn't one — there's no separate .glb for it,
   * just the default flag rendered at reduced opacity.
   */
  opacity?: number
}) {
  const { scene } = useGLTF(src)
  const model = useMemo(() => scene.clone(true), [scene])

  // Flat diffuse, same as the player models — see flattenToDiffuse.
  useLayoutEffect(() => {
    model.traverse((obj: Object3D) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      flattenMeshMaterials(mesh.material)
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const material of materials as Material[]) {
        if (doubleSided) material.side = DoubleSide
        if (opacity < 1) {
          material.transparent = true
          material.opacity = opacity
        }
      }
    })
  }, [model, doubleSided, opacity])

  return <primitive object={model} scale={MD3_SCALE * scale} />
}
