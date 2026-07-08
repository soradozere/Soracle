import { computeMatchUnlocks, type Unlock } from "@/lib/achievements-server"
import { colorInt, displayName, imageUrl, ordinal, profileUrl } from "@/lib/achievement-format"

// Posts an achievement-unlock ping to a Discord channel webhook when a match is
// approved. Deliberately best-effort: any failure (no webhook configured, Discord
// down, compute error) is swallowed so it can never break match approval. The
// webhook is bound to a single channel, so pings only ever land there.

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
    description: `${u.view.condition}\n**${ordinal(u.n)}** player to unlock this`,
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

  // One unlock → the personal copy; several → one combined message, an embed each.
  let content: string
  if (unlocks.length === 1) {
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
