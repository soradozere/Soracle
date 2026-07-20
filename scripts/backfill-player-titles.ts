import { createClient } from "@supabase/supabase-js"
import { SEASONS } from "../lib/titles"
import { recordSeasonalTitles } from "../lib/titles-server"

// One-shot backfill: bank every seasonal title already earned, for every season
// in the catalogue. Normally recording happens as matches land, but the feature
// arrived mid-season — this captures what was earned before the hook existed.
//
// Idempotent (the upsert ignores duplicates), so re-running it is always safe.
//
// Usage:  set -a && . ./.env.local && set +a && npx tsx scripts/backfill-player-titles.ts

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in the environment")
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } })

  const keys = Object.keys(SEASONS).sort()
  if (!keys.length) {
    console.log("No seasons in the catalogue — nothing to backfill.")
    return
  }

  for (const seasonKey of keys) {
    const season = SEASONS[seasonKey]
    // Any date inside the month resolves to that season.
    const written = await recordSeasonalTitles(supabase, `${seasonKey}-15T00:00:00.000Z`)
    console.log(`${seasonKey} (${season.name}): ${written} title row(s) evaluated`)
  }

  const { count } = await supabase.from("player_titles").select("*", { count: "exact", head: true })
  console.log(`player_titles now holds ${count ?? 0} row(s).`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
