import { SABER_COLOURS } from "@/lib/saber-colours"
import { findAchievementDef } from "@/lib/achievement-meta"

// Catalogue of the shared prop assets the 3D viewer can request — the saber
// hilt and its blade textures, the CTF flags, and the trip mine.
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

/** The converted `laser_trap.md3`, carried in the right hand. */
export const MINES_ASSET = "trip-mine"

/** CTF teams whose flag a model can carry, in the order they're offered. */
export const FLAG_TEAMS = ["red", "blue"] as const
export type FlagTeam = (typeof FLAG_TEAMS)[number]

/**
 * Cosmetic variants of the carried flag, beyond the default cloth.
 *
 * "transparent" is a genuine alpha-blended banner — a runtime opacity tweak
 * (see FLAG_OPACITY and Md3Prop's `opacity` prop), not a separately converted
 * asset: it reuses the default team .glb as-is. zzz_transparent_flags.pk3's
 * OWN shader effect turned out to be additive glow rather than real
 * transparency once seen in the viewer, which read as "just brighter," not
 * what the name promises — so this variant is hand-authored to actually look
 * see-through instead of a literal port of that shader. "nightmare" IS a
 * separately converted asset: the black-silhouette + glowing-outline
 * treatment shared with the Nightmare mine, baked at conversion time because
 * it needs a real second material (see docs/jk2-model-conversion.md).
 */
export const FLAG_VARIANTS = ["default", "transparent", "nightmare"] as const
export type FlagVariant = (typeof FLAG_VARIANTS)[number]

/** Opacity Md3Prop should render a flag variant at. 1 = fully opaque (default glTF behaviour). */
export const FLAG_OPACITY: Record<FlagVariant, number> = { default: 1, transparent: 0.45, nightmare: 1 }

/** Trip mine cosmetic variants, parallel to FLAG_VARIANTS. */
export const MINE_VARIANTS = ["default", "nightmare"] as const
export type MineVariant = (typeof MINE_VARIANTS)[number]

/** Object name in the bucket for every prop the viewer may ask for. */
export const PROP_ASSETS: Record<string, string> = {
  [SABER_HILT_ASSET]: "saber-hilt.glb",
  ...Object.fromEntries(MINE_VARIANTS.map((variant) => [mineAsset(variant), `props/${mineFile(variant)}`])),
  ...Object.fromEntries(
    FLAG_TEAMS.flatMap((team) =>
      // "transparent" has no asset of its own — see FLAG_VARIANTS — so it's
      // deliberately excluded here rather than pointing at a duplicate file.
      FLAG_VARIANTS.filter((v) => v !== "transparent").map((variant) => [
        flagAsset(team, variant),
        `props/${flagFile(team, variant)}`,
      ]),
    ),
  ),
  ...Object.fromEntries(
    SABER_COLOURS.flatMap((colour) => [
      [saberTextureAsset(colour.id, "line"), `saber/${colour.id}_line.jpg`],
      [saberTextureAsset(colour.id, "glow"), `saber/${colour.id}_glow.jpg`],
    ]),
  ),
}

function flagFile(team: string, variant: FlagVariant): string {
  return variant === "default" || variant === "transparent" ? `flag-${team}.glb` : `flag-${team}-${variant}.glb`
}

function mineFile(variant: MineVariant): string {
  return variant === "default" ? "trip-mine.glb" : `trip-mine-${variant}.glb`
}

/**
 * Asset id for a team's flag, optionally in one of FLAG_VARIANTS.
 *
 * "transparent" resolves to the SAME id as "default" — it's the same .glb
 * rendered at reduced opacity, not a different file. Callers that need to
 * distinguish the two for rendering purposes (Md3Prop's `opacity` prop) use
 * the variant directly, via FLAG_OPACITY, alongside this id.
 */
export function flagAsset(team: string, variant: FlagVariant = "default"): string {
  return variant === "default" || variant === "transparent" ? `flag-${team}` : `flag-${team}-${variant}`
}

/** The flag asset for a team id (and optional variant), or null if either is unrecognised. */
export function findFlagAsset(team: string | null | undefined, variant?: string | null): string | null {
  if (!team || !(FLAG_TEAMS as readonly string[]).includes(team)) return null
  const resolvedVariant = (FLAG_VARIANTS as readonly string[]).includes(variant ?? "")
    ? (variant as FlagVariant)
    : "default"
  return flagAsset(team, resolvedVariant)
}

/** The opacity to render a flag variant at, for a variant id that may be unrecognised. */
export function findFlagOpacity(variant?: string | null): number {
  return FLAG_OPACITY[(variant ?? "default") as FlagVariant] ?? 1
}

/** Asset id for the trip mine, optionally in one of MINE_VARIANTS. */
export function mineAsset(variant: MineVariant = "default"): string {
  return variant === "default" ? MINES_ASSET : `${MINES_ASSET}-${variant}`
}

/** The mine asset for a variant id, or the default mine if unrecognised. */
export function findMineAsset(variant?: string | null): string {
  return (MINE_VARIANTS as readonly string[]).includes(variant ?? "") ? mineAsset(variant as MineVariant) : mineAsset()
}

// --- Achievement gating -----------------------------------------------------
//
// Same shape as UnlockCondition/unlockedThemes in lib/titles.ts (crest id +
// minimum 1-based rank), kept separate rather than imported because these are
// prop-specific and titles.ts is themes-only — no reason for the two to share
// a module just because the check is identical. "default" is never gated:
// every model/skin/saber is free to everyone today, and the base flag/mine
// stay that way too. Only the NEW variants are gated, per Sora's explicit ask.

/** Crest id + minimum rank that unlocks a flag variant, or null if it's free. */
export const FLAG_VARIANT_UNLOCK: Record<FlagVariant, { crest: string; tier: number } | null> = {
  default: null,
  transparent: { crest: "cap-god", tier: 1 }, // "Cap Initiate"
  nightmare: { crest: "efficient-capper", tier: 3 }, // "Precision Capper"
}

/** Crest id + minimum rank that unlocks a mine variant, or null if it's free. */
export const MINE_VARIANT_UNLOCK: Record<MineVariant, { crest: string; tier: number } | null> = {
  default: null,
  nightmare: { crest: "swat-support", tier: 3 }, // "Minewhore"
}

/**
 * The flag variants a player is entitled to, from the ranks they've earned per
 * crest (achievement id → highest earned rank, 1-based — same map shape
 * unlockedThemes takes).
 */
export function unlockedFlagVariants(earnedCrestRanks: Map<string, number>): FlagVariant[] {
  return FLAG_VARIANTS.filter((v) => {
    const c = FLAG_VARIANT_UNLOCK[v]
    return !c || (earnedCrestRanks.get(c.crest) ?? 0) >= c.tier
  })
}

/** The mine variants a player is entitled to, same reasoning as unlockedFlagVariants. */
export function unlockedMineVariants(earnedCrestRanks: Map<string, number>): MineVariant[] {
  return MINE_VARIANTS.filter((v) => {
    const c = MINE_VARIANT_UNLOCK[v]
    return !c || (earnedCrestRanks.get(c.crest) ?? 0) >= c.tier
  })
}

/**
 * The name of the rank that unlocks a flag variant, for a "you need to earn X"
 * notice on a locked one — e.g. "Precision Capper", not "efficient-capper".
 * Null for a free variant (nothing to report).
 */
export function flagVariantRequirementLabel(variant: FlagVariant): string | null {
  return requirementLabel(FLAG_VARIANT_UNLOCK[variant])
}

/** Same as flagVariantRequirementLabel, for a mine variant. */
export function mineVariantRequirementLabel(variant: MineVariant): string | null {
  return requirementLabel(MINE_VARIANT_UNLOCK[variant])
}

function requirementLabel(condition: { crest: string; tier: number } | null): string | null {
  if (!condition) return null
  const def = findAchievementDef(condition.crest)
  if (!def) return null
  return def.ranks?.[condition.tier - 1]?.title ?? def.title
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
