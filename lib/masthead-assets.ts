// Catalogue of the masthead's 3D logo assets — the converted JK2 main-menu
// emblem and the textures for its saber blade.
//
// Same job, and same security boundary, as PLAYER_MODELS in
// lib/player-models.ts and PROP_ASSETS in lib/prop-assets.ts: /api/model-url
// will only sign an object that appears here, so an id from a request can
// never be turned into an arbitrary path into the bucket.
//
// These are Raven/Activision assets (the emblem model and the diffuse/env
// textures from a Jedi Outcast install; the blade textures from its saber
// effects), so like the player models they are NOT in this repo — uploaded by
// scripts/upload-model-assets.mjs, served from the private bucket. The emblem
// was converted from its .md3 with a one-off script rather than the Blender
// pipeline in docs/jk2-model-conversion.md, which is for skeletal player
// models; this is a single static mesh.

export const MASTHEAD_LOGO_MODEL = "masthead-logo"
export const MASTHEAD_LOGO_DIFFUSE = "masthead-logo-diffuse"
export const MASTHEAD_LOGO_ENV = "masthead-logo-env"
export const MASTHEAD_SABER_CORE = "masthead-saber-core"
export const MASTHEAD_SABER_GLOW = "masthead-saber-glow"

/** Object name in the bucket for every asset the masthead logo needs. */
export const MASTHEAD_ASSETS: Record<string, string> = {
  [MASTHEAD_LOGO_MODEL]: "masthead/jk2logo.glb",
  [MASTHEAD_LOGO_DIFFUSE]: "masthead/logo-diffuse.jpg",
  [MASTHEAD_LOGO_ENV]: "masthead/logo-env.jpg",
  [MASTHEAD_SABER_CORE]: "masthead/saber-core.jpg",
  [MASTHEAD_SABER_GLOW]: "masthead/saber-glow.jpg",
}

/** All five ids, for the single useAssetUrls batch the masthead resolves. */
export const MASTHEAD_ASSET_IDS = Object.keys(MASTHEAD_ASSETS)

export function findMastheadAsset(id: string | null | undefined): string | null {
  if (!id) return null
  return MASTHEAD_ASSETS[id] ?? null
}
