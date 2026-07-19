import { createClient as createSupabaseClient } from "@supabase/supabase-js"

// A cookie-free anon client, for public data that is identical for every visitor.
//
// lib/supabase/server.ts reads cookies to carry the caller's session, which opts
// the whole route out of static rendering — a page using it is re-rendered on
// every request no matter what `revalidate` says. The achievement pages read only
// select-all-RLS tables (matches / match_stats / players) and show the same thing
// to everyone, so they don't need a session and shouldn't pay for one.
//
// Do NOT use this where the answer depends on who is asking, or anywhere a write
// needs to be attributed — it is anonymous by construction.
export function createAnonClient() {
  return createSupabaseClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}
