import { SABER_COLOURS } from "@/lib/saber-colours"

// Catalogue of the shared prop assets the 3D viewer can request — the saber
// hilt and its blade textures.
//
// Same job, and same security boundary, as PLAYER_MODELS in lib/player-models.ts:
// /api/model-url will only sign an object that appears here, so an id from a
// request or from the database can never be turned into a path into the bucket.
// Ids are derived from SABER_COLOURS rather than typed out, which means a colour
// can't be added to the picker without its files becoming resolvable, or removed
// while leaving a dangling entry behind.
//
// These are Raven/Activision assets, so like the player models they are NOT in
// this repo — they're converted with docs/jk2-model-conversion.md, uploaded by
// scripts/upload-model-assets.mjs, and served from the private bucket.

/** The converted `w_saber.md3` hilt, shared by every blade colour. */
export const SABER_HILT_ASSET = "saber-hilt"

/** Object name in the bucket for every prop the viewer may ask for. */
export const PROP_ASSETS: Record<string, string> = {
  [SABER_HILT_ASSET]: "saber-hilt.glb",
  ...Object.fromEntries(
    SABER_COLOURS.flatMap((colour) => [
      [saberTextureAsset(colour.id, "line"), `saber/${colour.id}_line.jpg`],
      [saberTextureAsset(colour.id, "glow"), `saber/${colour.id}_glow.jpg`],
    ]),
  ),
}

/**
 * Asset id for one of a blade's two textures.
 *
 * JK2 draws a blade as two camera-facing quads: `line` is the bright core,
 * `glow` the wide halo around it.
 */
export function saberTextureAsset(colourId: string, kind: "line" | "glow"): string {
  return `saber-${colourId}-${kind}`
}

/** The three assets needed to draw one saber. */
export function saberAssetIds(colourId: string): string[] {
  return [SABER_HILT_ASSET, saberTextureAsset(colourId, "line"), saberTextureAsset(colourId, "glow")]
}

export function findPropAsset(id: string | null | undefined): string | null {
  if (!id) return null
  return PROP_ASSETS[id] ?? null
}
