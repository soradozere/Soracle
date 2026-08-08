/**
 * The site's own public origin, in one place.
 *
 * Three separate files used to carry their own copy of the domain -- the OG
 * metadataBase, the YouTube description footer, and the achievement/profile
 * links the Discord bot posts. Moving to jk2ctf.com meant finding all three,
 * and the one that gets missed is never the one that breaks loudly: a stale
 * metadataBase still renders a card, it just points somewhere else.
 *
 * Read from the environment so the next move is a Vercel setting rather than a
 * commit, with the current domain as the fallback -- a missing env var should
 * degrade to "correct today", not to a broken URL.
 *
 * NEXT_PUBLIC_* is inlined at build time, so changing the variable needs a
 * redeploy WITHOUT the build cache to take effect (same trap as
 * NEXT_PUBLIC_DEMO_ENGINE_URL -- see next.config.mjs).
 */
export const SITE_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://jk2ctf.com").replace(/\/+$/, "")
