/**
 * Blade colours a player can pick.
 *
 * Same shape and same role as PLAYER_MODELS in lib/player-models.ts: this
 * catalogue is the boundary. An id that isn't listed here never reaches the
 * database or the viewer, so a crafted value can't turn into a colour, a URL or
 * anything else.
 *
 * Each blade is drawn twice — a near-white core inside a saturated glow — which
 * is how JK2's own blades read: the colour lives in the halo, not the centre.
 * `glow` doubles as the colour of the light the blade throws onto the model.
 */
export type SaberColour = {
  id: string
  label: string
  /** The hot centre of the blade. Barely tinted, deliberately. */
  core: string
  /** The halo around it, and the light it casts. */
  glow: string
}

export const SABER_COLOURS: SaberColour[] = [
  { id: "blue", label: "Blue", core: "#dfeaff", glow: "#3b7dff" },
  { id: "green", label: "Green", core: "#dfffe6", glow: "#2fd94f" },
  { id: "red", label: "Red", core: "#ffdfdf", glow: "#ff2f2f" },
  { id: "purple", label: "Purple", core: "#f2dfff", glow: "#a44bff" },
  { id: "orange", label: "Orange", core: "#ffe9d2", glow: "#ff8c1a" },
  { id: "yellow", label: "Yellow", core: "#fff9d2", glow: "#ffd21a" },
]

export function findSaberColour(id: string | null | undefined): SaberColour | null {
  if (!id) return null
  return SABER_COLOURS.find((colour) => colour.id === id) ?? null
}

export function isKnownSaberColour(id: string): boolean {
  return SABER_COLOURS.some((colour) => colour.id === id)
}

/**
 * The saber and trip mines bolt to the same `*r_hand` point, so a profile can
 * only ever equip one — stored in the same `players.saber` column as a real
 * colour id, rather than a second field that could disagree with this one.
 */
export const MINES_HAND_SLOT = "mines"

/** A saber colour, or the mines sentinel — everything `players.saber` may hold. */
export function isKnownHandSlot(id: string): boolean {
  return id === MINES_HAND_SLOT || isKnownSaberColour(id)
}
