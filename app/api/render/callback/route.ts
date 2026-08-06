import { NextResponse } from "next/server"
import { requireBearer } from "@/lib/bearer-auth"
import { createServiceClient } from "@/lib/supabase/admin"
import { deleteRender } from "@/lib/r2-renders"

/*
 * Where a render job reports back from.
 *
 * Called by the GitHub Actions runner, never by a browser. Same timing-safe
 * Bearer scheme as the bot endpoints, on its own secret: the bot and a public
 * repo's CI runners are different trust domains, so RENDER_CALLBACK_SECRET can
 * be rotated without touching the Discord bot.
 *
 * Dynamic and uncached -- it writes on every call.
 */
export const dynamic = "force-dynamic"

/**
 * Which transitions a runner is allowed to make.
 *
 * A job may only move a row forward from a state it could plausibly have been
 * observing. Without this, a late callback from an abandoned run can overwrite
 * a row an admin has already rejected, or resurrect a failed job -- the kind of
 * bug that only appears when two runs exist for one row, which is exactly when
 * it is hardest to reason about.
 *
 * `published` is reachable only from `publishing`, and only a run that Soracle
 * dispatched can be in that state. This was previously excluded on the grounds
 * that publishing belonged to Soracle rather than the runner -- that changed
 * when the upload moved to Actions, because a full match is gigabytes and a
 * serverless function cannot stream that within its execution limit.
 *
 * Note what is still absent: nothing can reach `pending_review` from
 * `publishing`, so a stray callback cannot walk an approved video back into the
 * queue, and nothing can reach `published` from `pending_review` -- approval
 * has to go through Soracle, which is where the daily cap is counted.
 */
const ALLOWED: Record<string, string[]> = {
  rendering: ["pending_render"],
  pending_review: ["rendering"],
  published: ["publishing"],
  failed: ["pending_render", "rendering", "publishing"],
}

interface CallbackBody {
  job_id?: string
  status?: string
  error?: string
  render_r2_key?: string
  github_run_id?: number | string
  youtube_video_id?: string
}

export async function POST(request: Request) {
  const unauthorized = requireBearer(request, process.env.RENDER_CALLBACK_SECRET)
  if (unauthorized) return unauthorized

  let body: CallbackBody
  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 })
  }

  const jobId = body.job_id
  const status = body.status
  if (!jobId || !status) {
    return NextResponse.json({ error: "job_id and status are required" }, { status: 400 })
  }
  if (!(status in ALLOWED)) {
    return NextResponse.json({ error: `status must be one of ${Object.keys(ALLOWED).join(", ")}` }, { status: 400 })
  }

  const supabase = createServiceClient()
  const { data: row } = await supabase
    .from("youtube_render_queue")
    .select("id, status, render_r2_key")
    .eq("id", jobId)
    .maybeSingle()

  if (!row) return NextResponse.json({ error: "unknown job" }, { status: 404 })

  const from = row.status as string
  const existingKey = (row.render_r2_key as string | null) ?? null
  if (!ALLOWED[status].includes(from)) {
    /*
     * 409 rather than an error: the job did nothing wrong, it is just late or
     * duplicated, and a runner that treats this as a failure would retry into
     * the same wall. Reported so a stale callback is visible rather than silent.
     */
    return NextResponse.json(
      { error: `cannot move ${from} -> ${status}`, ignored: true },
      { status: 409 },
    )
  }

  const update: Record<string, unknown> = { status }
  if (body.error !== undefined) update.error = String(body.error).slice(0, 2000)
  if (body.render_r2_key !== undefined) update.render_r2_key = String(body.render_r2_key)
  if (body.youtube_video_id !== undefined) {
    update.youtube_video_id = String(body.youtube_video_id).slice(0, 32)
  }
  if (body.github_run_id !== undefined) {
    // bigint: Actions run ids are already past the int4 ceiling.
    const runId = Number(body.github_run_id)
    if (Number.isFinite(runId)) update.github_run_id = runId
  }

  /*
   * Re-assert the expected current status in the write itself.
   *
   * The check above is a read, and two callbacks arriving together can both
   * pass it before either writes. Scoping the update to the status we read
   * makes the second one a no-op instead of a second transition.
   */
  const { data: updated, error } = await supabase
    .from("youtube_render_queue")
    .update(update)
    .eq("id", jobId)
    .eq("status", from)
    .select("id, status")
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!updated) {
    return NextResponse.json({ error: "status changed under us", ignored: true }, { status: 409 })
  }

  /*
   * Once it is on YouTube, the staging copy has done its job.
   *
   * The manual path already did this; the automated one did not, so every
   * publish left its mp4 behind. YouTube is the storage -- this bucket is a
   * staging area that should sit near-empty, and the lifecycle rule is a
   * backstop for jobs that died rather than a substitute for tidying up after
   * ones that worked.
   *
   * Deliberately after the status write and not fatal: the video is already
   * published, so an R2 hiccup must not turn a successful publish into a
   * failure. A key left behind is collected by the lifecycle rule.
   */
  if (status === "published" && existingKey) {
    await deleteRender(existingKey).catch(() => {})
    // Supabase returns errors in the result rather than throwing, so there is
    // nothing to catch here -- and a failure to null the column is cosmetic
    // next to a video that is already live.
    await supabase.from("youtube_render_queue").update({ render_r2_key: null }).eq("id", jobId)
  }

  return NextResponse.json({ ok: true, id: updated.id, status: updated.status })
}
