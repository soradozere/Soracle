// Catalogue of JK2 player models available to the 3D profile viewer.
//
// This list is the security boundary for model asset access. /api/model-url will
// only mint a signed URL for a `file` that appears here, so neither a crafted
// request nor a bad value in players.model can be turned into a reference to
// some other object in the storage bucket. Adding a model means adding a row
// here — there is deliberately no way to request an arbitrary path.
//
// Converted with docs/jk2-model-conversion.md. The .glb files are NOT in this
// repo: they're Raven/Activision assets and this repo is public, so they live in
// a private Supabase Storage bucket instead (see MODEL_BUCKET below).

export const MODEL_BUCKET = "models"

/** How long a minted signed URL stays valid. Long enough to load, short enough
 *  that a scraped link is worthless within the hour. */
export const MODEL_URL_TTL_SECONDS = 600

export type PlayerModel = {
  /** Stored in players.model and used in API requests. */
  id: string
  /** Shown in the profile editor's picker. */
  label: string
  /** Object name inside the storage bucket. */
  file: string
  /** Roughly how the model reads, for the picker. */
  blurb?: string
}

export const PLAYER_MODELS: PlayerModel[] = [
  {
    id: "kyle",
    label: "Kyle Katarn",
    file: "kyle.glb",
    blurb: "The stock JK2 protagonist",
  },
]

export function findPlayerModel(id: string | null | undefined): PlayerModel | null {
  if (!id) return null
  return PLAYER_MODELS.find((m) => m.id === id) ?? null
}

/** Whether a stored value still corresponds to a model we ship. Retiring a model
 *  should leave old profiles rendering nothing, not erroring. */
export function isKnownModel(id: string | null | undefined): boolean {
  return findPlayerModel(id) !== null
}
