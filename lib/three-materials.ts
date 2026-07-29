import { EquirectangularReflectionMapping, MeshStandardMaterial, type Material } from "three"

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
 *
 * One scoped exception: a surface grafted from a JK2 shader with `tcGen
 * environment` (chrome, water — see scripts/glm-graft.mjs's `analyseShader`)
 * gets a real, if modest, shine baked into its glTF material, marked via
 * `extras.reflective` so it survives here as `userData.reflective`. Flattening
 * it too would erase the one thing that surface was converted to show.
 */
export function flattenToDiffuse(material: Material) {
  if (!(material instanceof MeshStandardMaterial)) return
  if (material.userData?.reflective) return
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

/**
 * EXPERIMENTAL — quick test of real environment-mapped reflection for a
 * `tcGen environment` surface, in place of the static roughness/metalness
 * shine `flattenToDiffuse` leaves it with.
 *
 * JK2's `tcGen environment` computes texture coordinates from the camera's
 * reflection vector every frame — a real reflection that sweeps across the
 * surface as the view changes. What scripts/glm-graft.mjs bakes into the
 * glTF is the same image sampled with the mesh's OWN uv0, a fixed decal that
 * only lights up wherever that image's bright spots happen to land on that
 * UV island. Reusing the surface's own emissive texture (the same water5
 * image, already embedded) as a real `envMap` gets three.js to sample it by
 * reflection vector instead, which is the actual technique JK2 uses.
 *
 * Only touches a material that both a) is marked reflective and b) already
 * carries an emissive texture — chrome-only surfaces with no glow stage
 * (Bones' chrome2) have no embedded image to reuse and are left untouched.
 */
export function applyReflectiveEnvMap(material: Material) {
  if (!(material instanceof MeshStandardMaterial)) return
  if (!material.userData?.reflective || !material.emissiveMap) return
  if (material.envMap) return // already wired — e.g. a skin-swap clone that copied it
  const envMap = material.emissiveMap.clone()
  envMap.mapping = EquirectangularReflectionMapping
  envMap.needsUpdate = true
  material.envMap = envMap
  material.envMapIntensity = 1.5
  material.needsUpdate = true
}

export function applyReflectiveEnvMaps(material: Material | Material[]) {
  if (Array.isArray(material)) {
    for (const entry of material) applyReflectiveEnvMap(entry)
  } else {
    applyReflectiveEnvMap(material)
  }
}
