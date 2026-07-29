/**
 * Animation clips a player can pick for their 3D model — an idle pose to stand
 * in, and an action to play on demand.
 *
 * Same shape and same role as SABER_COLOURS in lib/saber-colours.ts: a
 * catalogue id, never a raw clip name typed in by a caller, so a crafted value
 * can only ever be one of these or nothing.
 *
 * FLAT, not per-model, because every model on the roster today is grafted from
 * one donor (see docs/jk2-model-conversion.md §7.8) and so shares exactly one
 * clip set — `idle, dfa, backstab, taunt, idle-unarmed, hand-chop`. That stops
 * being true the day a model ships its own animation (roadmap step 3, split-file
 * architecture), and THIS FILE is where that per-model catalogue has to move to
 * — not a note to remember, a fact about what breaks first.
 */

export type AnimationClip = {
  /** The actual clip name embedded in every model's .glb. */
  id: string
  label: string
}

export const IDLE_ANIMATIONS: AnimationClip[] = [
  { id: "idle", label: "Standard" },
  { id: "idle-unarmed", label: "Unarmed" },
]

export const ACTION_ANIMATIONS: AnimationClip[] = [
  { id: "dfa", label: "Yellow DFA" },
  { id: "backstab", label: "DBS" },
  { id: "taunt", label: "Taunt" },
  { id: "hand-chop", label: "Hand chop" },
]

export function findIdleAnimation(id: string | null | undefined): AnimationClip | null {
  if (!id) return null
  return IDLE_ANIMATIONS.find((clip) => clip.id === id) ?? null
}

export function findActionAnimation(id: string | null | undefined): AnimationClip | null {
  if (!id) return null
  return ACTION_ANIMATIONS.find((clip) => clip.id === id) ?? null
}

export function isKnownIdleAnimation(id: string): boolean {
  return IDLE_ANIMATIONS.some((clip) => clip.id === id)
}

export function isKnownActionAnimation(id: string): boolean {
  return ACTION_ANIMATIONS.some((clip) => clip.id === id)
}
