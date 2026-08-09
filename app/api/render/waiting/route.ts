import { NextResponse } from "next/server"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"

/*
 * How many render jobs are waiting on a human, for the masthead's notification
 * count (components/account-menu.tsx).
 *
 * Admin-only and behind the same auth check the /admin/renders page uses -- the
 * queue's size is not public information, and this route reads with the service
 * client, so the gate has to happen here rather than being left to RLS.
 *
 * `pending_review` is the state that actually needs someone; `failed` is
 * included because a failed job otherwise dies silently -- nothing else on the
 * site ever mentions it, which is how a lapsed credential went unnoticed once
 * already (see RENDER-PIPELINE-OPS.md).
 *
 * Dynamic and uncached: a count that is minutes stale is worse than no count,
 * and this is one small aggregate query per masthead mount for admins only.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

export async function GET() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) return NextResponse.json({ waiting: 0 }, { status: 401 })

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (isAdmin !== true) return NextResponse.json({ waiting: 0 }, { status: 403 })

  const db = createServiceClient()
  const { count, error: countError } = await db
    .from("youtube_render_queue")
    .select("id", { count: "exact", head: true })
    .in("status", ["pending_review", "failed"])

  if (countError) return NextResponse.json({ waiting: 0 }, { status: 500 })

  return NextResponse.json({ waiting: count ?? 0 })
}
