/**
 * Highlight tags for demos.
 *
 * A fixed vocabulary, stored as slugs in demos.tags (see
 * 030_demo_comments_tags_feed.sql). Fixed rather than free-form because the
 * point of these is filtering: "show me every DBS clip" only works if everyone
 * spells DBS the same way.
 */

export type DemoTagId =
  | "dbs"
  | "dfa"
  | "mines"
  | "doom"
  | "cap"
  | "hero"
  | "funny"
  | "fails"
  | "full-match"

export interface DemoTag {
  id: DemoTagId
  label: string
  /** Technique, moment or format -- only used to colour the badges. */
  kind: "technique" | "moment" | "format"
}

export const DEMO_TAGS: DemoTag[] = [
  { id: "dbs", label: "DBS", kind: "technique" },
  { id: "dfa", label: "DFA", kind: "technique" },
  { id: "mines", label: "Mines", kind: "technique" },
  { id: "doom", label: "Doom", kind: "technique" },
  { id: "cap", label: "Cap", kind: "moment" },
  { id: "hero", label: "Hero", kind: "moment" },
  { id: "funny", label: "Funny", kind: "moment" },
  { id: "fails", label: "Fails", kind: "moment" },
  { id: "full-match", label: "Full Match", kind: "format" },
]

const BY_ID = new Map(DEMO_TAGS.map((t) => [t.id, t]))

export function demoTag(id: string): DemoTag | undefined {
  return BY_ID.get(id as DemoTagId)
}

export function demoTagLabel(id: string): string {
  return BY_ID.get(id as DemoTagId)?.label ?? id
}

/** Drops anything not in the vocabulary, and de-duplicates. */
export function normaliseTags(raw: string[]): DemoTagId[] {
  const seen = new Set<DemoTagId>()
  for (const value of raw) {
    const tag = BY_ID.get(value as DemoTagId)
    if (tag) seen.add(tag.id)
  }
  // Sorted by the canonical order, so two demos with the same tags always
  // render them in the same sequence.
  return DEMO_TAGS.filter((t) => seen.has(t.id)).map((t) => t.id)
}

export function demoTagClasses(id: string): string {
  switch (BY_ID.get(id as DemoTagId)?.kind) {
    case "technique":
      return "bg-emerald-500/15 text-emerald-400 border-emerald-500/30"
    case "moment":
      return "bg-amber-500/15 text-amber-400 border-amber-500/30"
    default:
      return "bg-slate-500/15 text-slate-300 border-slate-500/30"
  }
}
