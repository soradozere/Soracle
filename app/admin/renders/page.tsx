import { redirect } from "next/navigation"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { signedRenderUrl, downloadRenderUrl } from "@/lib/r2-renders"
import { RenderQueue, type RenderJob } from "@/components/render-queue"
import { DAILY_PUBLISH_CAP, publishedToday } from "./actions"

/*
 * Fully dynamic, and deliberately so.
 *
 * This page has exactly one reader, holds signed URLs that expire, and shows a
 * queue whose whole purpose is to be current. Adding a revalidate window would
 * regenerate it on a timer for no benefit -- and after the Fluid CPU incident
 * on 5 August, another statically-generated route with a revalidate window is
 * precisely what this codebase does not need.
 */
export const dynamic = "force-dynamic"
export const revalidate = 0

export default async function AdminRendersPage() {
  const supabase = await createClient()
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()
  if (error || !user) redirect("/auth/login")

  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (isAdmin !== true) redirect("/")

  const db = createServiceClient()
  const { data: rows } = await db
    .from("youtube_render_queue")
    .select(
      "id, demo_id, title, description, status, error, render_r2_key, youtube_video_id, github_run_id, cam_mode, follow_client_id, start_ms, end_ms, fps, requested_by, requested_source, created_at, updated_at",
    )
    .order("created_at", { ascending: false })
    .limit(50)

  // Names for the requester column. requested_by is null whenever an admin
  // made the request -- see requested_source, which distinguishes that from
  // data we simply lost.
  const playerIds = [...new Set((rows ?? []).map((r) => r.requested_by).filter(Boolean))] as string[]
  const { data: players } = playerIds.length
    ? await db.from("players").select("id, name").in("id", playerIds)
    : { data: [] as { id: string; name: string }[] }
  const nameById = new Map((players ?? []).map((p) => [p.id, p.name]))

  const demoIds = [...new Set((rows ?? []).map((r) => r.demo_id))] as string[]
  const { data: demos } = demoIds.length
    ? await db.from("demos").select("id, title").in("id", demoIds)
    : { data: [] as { id: string; title: string }[] }
  const demoById = new Map((demos ?? []).map((d) => [d.id, d.title]))

  /*
   * Sign only what will actually be watched.
   *
   * Every signed URL is an S3 request, and rows that are rendering, failed or
   * already published have nothing to preview -- signing all fifty would be
   * fifty round trips to show at most a handful of players.
   */
  const jobs: RenderJob[] = await Promise.all(
    (rows ?? []).map(async (r) => ({
      id: r.id as string,
      demoId: r.demo_id as string,
      demoTitle: demoById.get(r.demo_id as string) ?? "(demo deleted)",
      title: r.title as string,
      description: (r.description as string | null) ?? null,
      status: r.status as RenderJob["status"],
      error: (r.error as string | null) ?? null,
      youtubeVideoId: (r.youtube_video_id as string | null) ?? null,
      githubRunId: r.github_run_id ? String(r.github_run_id) : null,
      camMode: r.cam_mode as string,
      followClientId: (r.follow_client_id as number | null) ?? null,
      startMs: r.start_ms as number,
      endMs: r.end_ms as number,
      fps: r.fps as number,
      requester:
        r.requested_source === "admin"
          ? "an admin"
          : (nameById.get(r.requested_by as string) ?? "unknown player"),
      createdAt: r.created_at as string,
      previewUrl:
        r.status === "pending_review" && r.render_r2_key
          ? await signedRenderUrl(r.render_r2_key as string).catch(() => null)
          : null,
      downloadUrl:
        r.status === "pending_review" && r.render_r2_key
          ? await downloadRenderUrl(r.render_r2_key as string, r.title as string).catch(() => null)
          : null,
    })),
  )

  const today = await publishedToday()

  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <div className="mb-6 flex items-center justify-between">
        <div>
          <Link
            href="/admin"
            className="mb-2 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            Admin
          </Link>
          <h1 className="text-2xl font-semibold">Render queue</h1>
          <p className="text-sm text-muted-foreground">
            Nothing reaches YouTube without being watched here first.
          </p>
        </div>
        <div className="text-right text-sm">
          <div className="tabular-nums">
            {today} / {DAILY_PUBLISH_CAP}
          </div>
          <div className="text-xs text-muted-foreground">published today</div>
        </div>
      </div>

      <RenderQueue jobs={jobs} atCap={today >= DAILY_PUBLISH_CAP} />
    </div>
  )
}
