// The demos we've seeded the library with came from a spectator client that
// names its recordings "<timestamp>__<player>__<tag>__<map>_<score>.dm_15" --
// fine as a filename, useless as a title. This is what stands between that
// habit and the library: it rejects anything that still looks like a raw
// capture name rather than something a person typed, so every listing reads
// the same way regardless of who uploaded it or what tool they used.

const TIMESTAMP_PREFIX = /^\d{4}-\d{2}-\d{2}[_ -]/
const COLOUR_CODE = /\^(?:[0-9]|[xX][0-9a-fA-F]{3,6}|Y[0-9a-fA-F]{8})/
const DEMO_EXTENSION = /\.dm_\d+$/i

export function titleIssue(raw: string): string | null {
  const title = raw.trim()
  if (title.length < 3) return "Title is too short."
  if (title.length > 80) return "Title is too long (80 characters max)."
  if (DEMO_EXTENSION.test(title)) return "That's the filename -- give the demo an actual title."
  if (TIMESTAMP_PREFIX.test(title)) return "Looks like a raw capture name (starts with a timestamp). Give it a real title."
  if (COLOUR_CODE.test(title)) return "Title contains in-game colour codes -- please type a plain name."
  // A typed title is almost always more than one word; a raw capture name
  // strings its parts together with __ instead of spaces.
  if (!title.includes(" ") && title.length > 15) return "That looks like a filename, not a title -- try a short descriptive name."
  return null
}
