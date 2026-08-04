/**
 * Ranking demos against what someone typed.
 *
 * Lives here rather than in the library component so it can be tested on its
 * own: importing the component drags in React and the whole UI kit for what is
 * really a comparison between strings.
 *
 * Structurally typed on purpose -- it needs a title, a map, an uploader and
 * some names, and nothing else about a demo. That keeps it independent of
 * whatever DemoListItem grows into.
 */

export interface RankableDemo {
  title: string
  map: string
  uploaderName: string | null
  players: { name: string }[]
  protagonist: { name: string } | null
}

/**
 * How closely a demo answers what was typed. Higher wins, 0 is no match.
 *
 * Typing a player's name is the common case, and it can mean four different
 * things at once: the demo is *about* them, they were merely in it, their name
 * is in the title, or they uploaded it. Those are wildly different answers to
 * the same question, and a flat date order buries the first under the rest --
 * searching a player returned their headline clips mixed into everything they
 * happened to press upload on.
 */
export function matchRank(demo: RankableDemo, query: string): number {
  const needle = query.trim().toLowerCase()
  if (!needle) return 0
  const has = (s: string | null | undefined) => !!s && s.toLowerCase().includes(needle)

  // The demo is about them.
  if (has(demo.protagonist?.name)) return 4
  // They are in it, but it is not their clip.
  if (demo.players.some((p) => has(p.name))) return 3
  // Their name is on it as a title or a map: a weaker claim than being in the
  // match, a stronger one than having pressed upload.
  if (has(demo.title) || has(demo.map)) return 2
  // They put it here. Says nothing about whether they are in it.
  if (has(demo.uploaderName)) return 1
  return 0
}
