import { createClient } from "@supabase/supabase-js"

// Service-role Supabase client for server-only code paths that have no user
// session and must bypass RLS — currently the bot-facing ingest endpoint, which
// authenticates with BOT_API_SECRET (not a Supabase auth user) yet needs to write
// to admin-only tables and the private pending-scoreboards bucket.
//
// NEVER import this from client components or anything reachable by the browser:
// the service-role key must stay server-side. Each call returns a fresh stateless
// client (no session persistence).
export function createServiceClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error("Supabase service-role client requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY")
  }
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } })
}
