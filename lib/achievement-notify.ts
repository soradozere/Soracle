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

// Compute what a match unlocked and post one combined message. No-op when there
// are no unlocks or no webhook configured.
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

  // A one-of-one outranks everything, and computeMatchUnlocks sorts rarest first, so
  // if one was claimed it leads the message even when other crests unlocked alongside.
  const headline = unlocks[0]

  // One unlock → the personal copy; several → one combined message, an embed each.
  let content: string
  if (isOneOfOne(headline)) {
    content =
      `Stop everything. **${headline.playerName}** just claimed **${displayName(headline.view)}** ` +
      `— a one-of-one. Nobody else will ever hold it.\n\n` +
      `See it at ${profileUrl(headline.playerName)}`
  } else if (unlocks.length === 1) {
    const u = unlocks[0]
    content =
      `Good shit, **${u.playerName}**. You just unlocked **${displayName(u.view)}**, ` +
      `making you the **${ordinal(u.n)}** player to do so. Keep grinding, bro.\n\n` +
      `Check out your full profile at ${profileUrl(u.playerName)}`
  } else {
    content = "**Achievements unlocked this game** 🎖️ — keep grinding, boys."
  }

  const body = {
    username: "JK2 Matchmaker",
    content,
    embeds: unlocks.slice(0, 10).map(embedFor),
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
