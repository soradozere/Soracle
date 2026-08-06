/**
 * Title and description for a published render.
 *
 * Built here rather than stored on the queue row, so changing the house style
 * never means re-rendering anything -- the row keeps what the uploader typed
 * and this decides how it reads on YouTube.
 *
 * Shape follows what established JK2 channels do (the Freedom Defrag channel
 * is the reference): a human title, then a consistent structured block. That
 * consistency is a feature rather than a spam risk -- the descriptions differ
 * per demo because the players, map and date do.
 *
 * Two deliberate choices about YouTube's ranking behaviour, both from its own
 * guidance rather than folklore:
 *
 *   - The first 100-160 characters are all most people see before "Show more",
 *     so the opening line carries who, where and what rather than a link.
 *   - Three hashtags. YouTube recommends two or three; more starts to look
 *     like stuffing, and past fifteen it ignores them entirely.
 *
 * Deliberately absent: repeated keywords, tag walls, and anything that reads
 * as written for a crawler. Those are what actually trip spam detection.
 */

const TITLE_LIMIT = 100
const DESCRIPTION_LIMIT = 5000
export const SITE_URL = "https://jk2ctf.vercel.app"

export interface DemoMetadata {
  demoId: string
  /** What the uploader called the video. */
  title: string
  /** Their own words, if they wrote any. */
  description?: string | null
  map?: string | null
  gametype?: string | null
  /** ISO date the demo was recorded. */
  recordedAt?: string | null
  protagonistName?: string | null
  playerNames?: string[]
}

const GAMETYPE_LABEL: Record<string, string> = {
  CTF: "Capture the Flag",
  FFA: "Free for All",
  TeamFFA: "Team Free for All",
}

/**
 * Year comes from when the demo was *recorded*, not from today.
 *
 * A 2025 clip uploaded now is a 2025 clip, and dating it 2026 would be wrong
 * in a way that compounds as the archive grows. Falls back to the current year
 * only when the demo has no recorded date, which is true of much of the early
 * library.
 */
function seasonYear(recordedAt?: string | null): number {
  const parsed = recordedAt ? new Date(recordedAt) : null
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed.getUTCFullYear() : new Date().getUTCFullYear()
}

export function buildYoutubeTitle(meta: DemoMetadata): string {
  const suffix = ` | Jedi Knight II CTF ${seasonYear(meta.recordedAt)}`
  const room = TITLE_LIMIT - suffix.length
  const base = (meta.title || "JK2 CTF").trim()
  // Truncate the uploader's words, never the suffix -- a title ending in
  // "Jedi Knight II CT" would look broken and lose the game match.
  const trimmed = base.length > room ? base.slice(0, room - 1).trimEnd() + "…" : base
  return trimmed + suffix
}

function formatDate(recordedAt?: string | null): string | null {
  if (!recordedAt) return null
  const d = new Date(recordedAt)
  if (Number.isNaN(d.getTime())) return null
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })
}

export function buildYoutubeDescription(meta: DemoMetadata): string {
  const gametype = meta.gametype ? (GAMETYPE_LABEL[meta.gametype] ?? meta.gametype) : null
  const date = formatDate(meta.recordedAt)
  const players = (meta.playerNames ?? []).filter(Boolean)

  /*
   * The opening line is the whole SEO budget: it is what shows in search and
   * above the fold. Who, where, and what game -- naming the game in full is
   * also what lets YouTube attach its "Games" panel, which is free reach and
   * the reason established JK2 channels get one.
   */
  const opener = [
    meta.protagonistName ? `${meta.protagonistName} on ${meta.map ?? "JK2"}` : (meta.map ?? "JK2 CTF"),
    gametype ? `${gametype} in Star Wars: Jedi Knight II - Jedi Outcast` : "Star Wars: Jedi Knight II - Jedi Outcast",
  ].join(" — ")

  const facts: string[] = []
  if (meta.protagonistName) facts.push(`Player: ${meta.protagonistName}`)
  if (players.length) facts.push(`In this demo: ${players.join(", ")}`)
  if (meta.map) facts.push(`Map: ${meta.map}`)
  if (gametype) facts.push(`Gametype: ${gametype}`)
  if (date) facts.push(`Recorded: ${date}`)
  facts.push("Game: Star Wars: Jedi Knight II - Jedi Outcast (2002)")

  const own = meta.description?.trim()

  const parts = [
    opener + ".",
    own || null,
    facts.join("\n"),
    `Watch this demo in your browser, with free camera and playback controls:\n${SITE_URL}/demos/${meta.demoId}`,
    `Community demos, stats and match history:\n${SITE_URL}`,
    "#JediKnight2 #JediOutcast #JK2",
  ].filter(Boolean)

  const out = parts.join("\n\n")
  return out.length > DESCRIPTION_LIMIT ? out.slice(0, DESCRIPTION_LIMIT - 1) + "…" : out
}
