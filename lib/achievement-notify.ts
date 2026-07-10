import { computeMatchUnlocks, type Unlock } from "@/lib/achievements-server"
import { colorInt, displayName, imageUrl, ordinal, profileUrl } from "@/lib/achievement-format"

// Posts an achievement-unlock ping to a Discord channel webhook when a match is
// approved. Deliberately best-effort: any failure (no webhook configured, Discord
// down, compute error) is swallowed so it can never break match approval. The
// webhook is bound to a single channel, so pings only ever land there.

const isOneOfOne = (u: Unlock) => u.view.rarity === "oneofone"

// Tiered conditions are generic ("Base cleans in a single match") — the number that
// defines the rank lives in earnedRequirement ("80+"). Lead with it so the ping says
// what was actually done. Untiered conditions already spell out their own number
// ("Score 2000+ in a single match") and have no earnedRequirement.
const conditionWithNumber = (u: Unlock) =>
  u.view.earnedRequirement ? `**${u.view.earnedRequirement}** · ${u.view.condition}` : u.view.condition

function embedFor(u: Unlock) {
  return {
    author: { name: u.playerName },
    title: displayName(u.view),
    // Discord MERGES embeds that share a `url` (it's how the 4-image trick works),
    // so two unlocks by the same player in one message would collapse into one and
    // the second would silently vanish. Interlude unlocking 1500 Club and Batcher
    // III in the same game showed only 1500 Club. The query param keeps every link
    // pointing at the profile while making each embed's url distinct.
    url: `${profileUrl(u.playerName)}?ach=${u.view.id}`,
    // "1st player to unlock this" is true of a one-of-one and completely misses the
    // point — there will never be a second.
    description: isOneOfOne(u)
      ? `${u.view.condition}\n**The only player who will ever hold this**`
      : `${conditionWithNumber(u)}\n**${ordinal(u.n)}** player to unlock this`,
    color: colorInt(u.view),
    thumbnail: { url: imageUrl(u.view) },
  }
}

// Pick a random entry so the same kind of unlock reads differently each time.
const pick = <T>(arr: T[]): T => arr[Math.floor(Math.random() * arr.length)]

// One player, one ordinary crest. The profile link is appended when sending.
const SINGLE_MESSAGES: ((u: Unlock) => string)[] = [
  (u) => `Good shit, **${u.playerName}**. **${displayName(u.view)}** unlocked — **${ordinal(u.n)}** player ever to pull it off. Keep grinding.`,
  (u) => `**${u.playerName}** just bagged **${displayName(u.view)}** 🎖️ — only the **${ordinal(u.n)}** to ever do it. Respect.`,
  (u) => `New crest on the shelf for **${u.playerName}**: **${displayName(u.view)}**. That's **${ordinal(u.n)}** all-time. Certified.`,
  (u) => `The Force is strong with **${u.playerName}** — **${displayName(u.view)}** unlocked, **${ordinal(u.n)}** player to earn it.`,
  (u) => `**${u.playerName}** clocked **${displayName(u.view)}**. **${ordinal(u.n)}** in the history books. Get in.`,
  (u) => `Achievement get! **${u.playerName}** earns **${displayName(u.view)}** — **${ordinal(u.n)}** to ever manage it.`,
  (u) => `Big moves from **${u.playerName}** — **${displayName(u.view)}** unlocked, only the **${ordinal(u.n)}** to do so. Keep cooking.`,
]

// Several crests in one game. The embeds list who did what; this is just the header.
const MULTI_MESSAGES: ((n: number) => string)[] = [
  (n) => `**${n} achievements** dropped this game 🎖️ — busy night, boys.`,
  (n) => `Big game — **${n}** crests unlocked. Full breakdown below.`,
  (n) => `The trophy cabinet took a beating this match. **${n}** unlocks 👇`,
  (n) => `**Achievements unlocked this game** 🎖️ — ${n} of 'em. Salute the grind.`,
  (n) => `That's what I'm on about — **${n} achievements** in one game. Look at these:`,
  (n) => `Loot drop 🎖️ **${n}** crests earned this match. Who's cooking?`,
  (n) => `The board's moving — **${n}** unlocks this game. Salute 'em all 👇`,
]

// A one-of-one: momentous, gets its own message. Profile link appended when sending.
const ONE_OF_ONE_MESSAGES: ((u: Unlock) => string)[] = [
  (u) => `Stop everything. **${u.playerName}** just claimed **${displayName(u.view)}** — a one-of-one. Nobody else will ever hold it.`,
  (u) => `🏆 **ONE OF ONE** 🏆\n**${u.playerName}** is now the sole owner of **${displayName(u.view)}**, forever. No one can take it, no one can match it.`,
  (u) => `History just happened. **${u.playerName}** locked in **${displayName(u.view)}** — the only one that will ever exist. Bow down.`,
  (u) => `There is exactly one **${displayName(u.view)}**, and it belongs to **${u.playerName}**. Permanently. 🥇`,
  (u) => `A one-of-one has been claimed. **${u.playerName}** — **${displayName(u.view)}** — and that door is now shut to everyone else, forever.`,
  (u) => `Etch it in stone: **${u.playerName}** owns **${displayName(u.view)}**. The first and last player to ever hold it.`,
  (u) => `🔒 Claimed for all time. **${u.playerName}** takes **${displayName(u.view)}** — a one-of-one no one else will ever wear.`,
]

// POST one message (content + up to 10 embeds) to the webhook. Best-effort: any
// failure is logged and swallowed so it can never break match approval, and one
// failed send never stops the others.
async function postWebhook(
  webhook: string,
  content: string,
  embeds: ReturnType<typeof embedFor>[],
  matchId: string,
): Promise<void> {
  const body = {
    username: "JK2 Matchmaker",
    content,
    embeds: embeds.slice(0, 10),
    allowed_mentions: { parse: [] as string[] },
  }
  try {
    const res = await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
    if (!res.ok) {
      console.warn(`Achievement webhook POST failed (${res.status}): ${await res.text()}`)
    }
  } catch (err) {
    console.warn(`Achievement webhook POST threw for match ${matchId}:`, err)
  }
}

interface OutgoingMessage {
  content: string
  embeds: ReturnType<typeof embedFor>[]
}

// Plan the messages a set of unlocks produces: one spotlight message per one-of-one,
// then a single combined message for the ordinary unlocks (the personal copy when
// there's just one, a group header otherwise). Pure apart from the random copy pick,
// so the split is unit-testable without touching Discord.
export function planUnlockMessages(unlocks: Unlock[]): OutgoingMessage[] {
  const messages: OutgoingMessage[] = []
  const oneOfOnes = unlocks.filter(isOneOfOne)
  const rest = unlocks.filter((u) => !isOneOfOne(u))

  // Each one-of-one, its own spotlight — listed first so they lead the channel.
  for (const u of oneOfOnes) {
    messages.push({
      content: `${pick(ONE_OF_ONE_MESSAGES)(u)}\n\n${profileUrl(u.playerName)}`,
      embeds: [embedFor(u)],
    })
  }
  // The ordinary unlocks: one player → personal copy, several → a combined header.
  if (rest.length === 1) {
    const u = rest[0]
    messages.push({ content: `${pick(SINGLE_MESSAGES)(u)}\n\n${profileUrl(u.playerName)}`, embeds: [embedFor(u)] })
  } else if (rest.length > 1) {
    messages.push({ content: pick(MULTI_MESSAGES)(rest.length), embeds: rest.map(embedFor) })
  }
  return messages
}

// Compute what a match unlocked and post it — each planned message as its own Discord
// message. No-op when there are no unlocks or no webhook configured.
export async function notifyAchievementUnlocks(matchId: string): Promise<void> {
  const webhook = process.env.ACHIEVEMENT_WEBHOOK_URL
  if (!webhook) return

  let unlocks: Unlock[]
  try {
    unlocks = await computeMatchUnlocks(matchId)
  } catch (err) {
    console.warn(`Achievement unlock compute failed for match ${matchId}:`, err)
    return
  }
  if (!unlocks.length) return

  for (const msg of planUnlockMessages(unlocks)) {
    await postWebhook(webhook, msg.content, msg.embeds, matchId)
  }
}
