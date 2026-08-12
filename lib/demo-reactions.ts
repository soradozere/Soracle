/**
 * The six reactions a player can leave on a demo.
 *
 * Deliberately unordered: unlike the 1-5 stars these replaced, no reaction
 * outranks another, so there is no "highest rated" to sort by -- only how many
 * reactions a demo drew in total. Dislike sits in the same row as the rest
 * rather than being split out; it is a reaction, not a downvote, and nothing
 * subtracts it from anything.
 *
 * The ids are stored verbatim in demo_reactions.reaction and are pinned by a
 * CHECK constraint there (scripts/040_demo_reactions.sql) -- changing one means
 * a migration, not just an edit here.
 */
export const DEMO_REACTIONS = [
  { id: "like", emoji: "👍", label: "Like" },
  { id: "love", emoji: "❤️", label: "Love" },
  { id: "dislike", emoji: "👎", label: "Dislike" },
  { id: "funny", emoji: "😂", label: "Funny" },
  { id: "wow", emoji: "😮", label: "Wow" },
  { id: "mindblown", emoji: "🤯", label: "Mindblown" },
] as const

export type ReactionId = (typeof DEMO_REACTIONS)[number]["id"]

export const REACTION_IDS: readonly ReactionId[] = DEMO_REACTIONS.map((r) => r.id)

export function isReactionId(value: unknown): value is ReactionId {
  return typeof value === "string" && REACTION_IDS.includes(value as ReactionId)
}

export function reactionMeta(id: ReactionId) {
  return DEMO_REACTIONS.find((r) => r.id === id)!
}

/** Counts keyed by reaction id, zero-filled so callers never handle undefined. */
export type ReactionCounts = Record<ReactionId, number>

export const EMPTY_REACTION_COUNTS: ReactionCounts = Object.fromEntries(
  REACTION_IDS.map((id) => [id, 0]),
) as ReactionCounts
