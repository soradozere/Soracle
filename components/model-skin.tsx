"use client"

import { useLayoutEffect } from "react"
import { useLoader } from "@react-three/fiber"
import {
  AdditiveBlending,
  MeshStandardMaterial,
  RepeatWrapping,
  SRGBColorSpace,
  TextureLoader,
  type Group,
  type Material,
  type Mesh,
  type Texture,
} from "three"
import type { ModelSkin } from "@/lib/player-models"
import { flattenToDiffuse } from "@/lib/three-materials"

/**
 * Repaints a loaded model into one of its JK2 skins.
 *
 * A skin is never new geometry — see the note on ModelSkin — so this loads the
 * handful of textures that differ from the default and points the affected
 * surfaces at them. Everything else keeps the images Blender embedded in the
 * `.glb`, which is why a team skin costs ~170 KB instead of another 1.4 MB.
 *
 * Mounted inside its OWN Suspense boundary, like every prop, for the reason
 * spelled out in model-viewer.tsx: sharing the figure's boundary would drop the
 * model to the fallback while a texture downloads, remount it, and re-run the
 * fit. Switching skins should never resize the figure.
 */

/**
 * Blender names each exported surface `<surface>_<lod>`, and only LOD 0 survives
 * the cull described in docs/jk2-model-conversion.md §3.5. The `.skin` files name
 * the bare surface, so the two need reconciling somewhere; here is the one place.
 */
const LOD_SUFFIX = "_0"

/**
 * Makes a runtime-loaded texture behave like one glTF embedded.
 *
 * Two of these are wrong by default and both fail quietly. `TextureLoader` hands
 * back `flipY = true` and a linear colour space, because that's right for a
 * texture you authored for WebGL; glTF specifies the opposite on both counts.
 * Get the first wrong and the swapped surfaces render upside-down — which on a
 * torso wrap reads as a garbled texture rather than an obvious flip. Get the
 * second wrong and they're washed out next to the surfaces you didn't swap,
 * which reads as a lighting bug.
 *
 * The rest is copied off the texture being replaced, so a skin can't
 * accidentally sample differently from the default it's standing in for.
 */
function matchGltfTexture(texture: Texture, reference: Texture | null) {
  texture.flipY = false
  texture.colorSpace = SRGBColorSpace
  texture.wrapS = reference?.wrapS ?? RepeatWrapping
  texture.wrapT = reference?.wrapT ?? RepeatWrapping
  if (reference) {
    texture.magFilter = reference.magFilter
    texture.minFilter = reference.minFilter
    texture.anisotropy = reference.anisotropy
  }
  texture.needsUpdate = true
}

export function ModelSkinOverride({ scene, skin, urls }: { scene: Group; skin: ModelSkin; urls: string[] }) {
  // Suspends until every texture is in. useLoader caches by URL, and the URLs
  // are held stable by useAssetUrls for as long as this skin is selected.
  const textures = useLoader(TextureLoader, urls)

  useLayoutEffect(() => {
    // What each mesh had before we touched it, so the model can be handed back
    // in the state we found it — a skin is an overlay, not an edit.
    const originals = new Map<Mesh, Material | Material[]>()
    const clones: Material[] = []

    // One clone per (original material, slot) pair rather than per mesh. Kyle's
    // red skin repaints eight surfaces that all shared one torso material, and
    // eight identical materials would be eight draw calls where one will do.
    const replacements = new Map<string, Material>()

    scene.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh || Array.isArray(mesh.material)) return

      const surface = mesh.name.endsWith(LOD_SUFFIX) ? mesh.name.slice(0, -LOD_SUFFIX.length) : mesh.name
      const slot = skin.surfaces[surface]
      if (slot === undefined) return

      const texture = textures[slot]
      if (!texture) return

      const key = `${mesh.material.uuid}:${slot}`
      let replacement = replacements.get(key)
      if (!replacement) {
        replacement = mesh.material.clone()
        if (replacement instanceof MeshStandardMaterial) {
          matchGltfTexture(texture, replacement.map ?? replacement.emissiveMap)
          if (skin.additive?.includes(slot)) {
            // JK2 draws this surface as pure additive energy — framebuffer plus
            // texture, no opaque base (see ModelSkin.additive). The three.js
            // shape of that: black diffuse so scene lights contribute nothing,
            // the texture on emissive so it's self-lit, additive blending with
            // no depth write so whatever is behind stays visible through the
            // dark parts. This is what makes Andromeda's team-skin arm read as
            // a translucent glowing limb rather than a dark painted sleeve.
            replacement.map = null
            replacement.color.set(0x000000)
            replacement.emissive.set(0xffffff)
            replacement.emissiveMap = texture
            replacement.emissiveIntensity = 4
            replacement.blending = AdditiveBlending
            replacement.transparent = true
            replacement.depthWrite = false
            // The clone may have inherited the viewer's env-map shimmer from
            // the material it came from (the default hand's, say — see
            // applyReflectiveEnvMap). This treatment replaces that outright
            // rather than stacking on top of it.
            replacement.envMap = null
            delete replacement.userData.reflective
          } else {
            replacement.map = texture
          }
        }
        // The model's own pass may not have reached this clone: React runs a
        // child's layout effects before a parent's effects, so on a first load
        // that already has a skin selected, this material is made here and fixed
        // nowhere. Cheaper to state the rule than to depend on the ordering.
        flattenToDiffuse(replacement)
        replacements.set(key, replacement)
        clones.push(replacement)
      }

      originals.set(mesh, mesh.material)
      mesh.material = replacement
    })

    return () => {
      for (const [mesh, material] of originals) mesh.material = material
      // The clones are ours to free. The textures are NOT — useLoader holds them
      // in a cache keyed by URL, and disposing one would leave the next mount
      // handed a texture with no GPU resources behind it.
      for (const clone of clones) clone.dispose()
    }
  }, [scene, skin, textures])

  return null
}
