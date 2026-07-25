import { MeshStandardMaterial, type Material } from "three"

/**
 * Kills the specular sheen on a converted JK2 material.
 *
 * Blender's glTF export writes Principled's default roughness of 0.5, which puts
 * a wet-looking highlight across the whole model; JK2's renderer is flat diffuse
 * with no specular at all. Forcing roughness to 1 gets us back to the in-game
 * look, and doing it in code rather than in Blender means it holds for every
 * model without anyone remembering to set it.
 *
 * Shared because it has to hold for anything that ends up on a mesh: the model
 * itself, the converted props, and the materials the skin system clones. A clone
 * made before the model's own pass would otherwise arrive glossy.
 */
export function flattenToDiffuse(material: Material) {
  if (!(material instanceof MeshStandardMaterial)) return
  material.roughness = 1
  material.metalness = 0
  material.needsUpdate = true
}

/** Applies flattenToDiffuse to whatever a mesh's `material` slot holds. */
export function flattenMeshMaterials(material: Material | Material[]) {
  if (Array.isArray(material)) {
    for (const entry of material) flattenToDiffuse(entry)
  } else {
    flattenToDiffuse(material)
  }
}
