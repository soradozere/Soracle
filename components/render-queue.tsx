"use client"

import { useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Download, X, ExternalLink, AlertTriangle, Upload, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  approveRender,
  discardRender,
  markPublished,
  rejectRender,
} from "@/app/admin/renders/actions"
import { announceRenderQueueChanged } from "@/lib/render-queue-events"
import { Input } from "@/components/ui/input"

export interface RenderJob {
  id: string
  demoId: string
  demoTitle: string
  title: string
  description: string | null
  status:
    | "pending_render"
    | "rendering"
    | "pending_review"
    | "rejected"
    | "publishing"
    | "published"
    | "failed"
  error: string | null
  youtubeVideoId: string | null
  githubRunId: string | null
  camMode: string
  followClientId: number | null
  startMs: number
  endMs: number
  fps: number
  requester: string
  createdAt: string
  /** Signed and short-lived; only present while a job is awaiting review. */
  previewUrl: string | null
  /** Same object, signed to save rather than play. */
  downloadUrl: string | null
}

const STATUS_LABEL: Record<RenderJob["status"], string> = {
  pending_render: "Queued",
  rendering: "Rendering",
  pending_review: "Needs review",
  rejected: "Rejected",
  publishing: "Publishing",
  published: "Published",
  failed: "Failed",
}

const STATUS_CLASS: Record<RenderJob["status"], string> = {
  pending_render: "bg-muted text-muted-foreground",
  rendering: "bg-blue-500/15 text-blue-400",
  pending_review: "bg-amber-500/15 text-amber-400",
  rejected: "bg-muted text-muted-foreground",
  publishing: "bg-blue-500/15 text-blue-400",
  published: "bg-emerald-500/15 text-emerald-400",
  failed: "bg-destructive/15 text-destructive",
}

function duration(startMs: number, endMs: number): string {
  const s = Math.round((endMs - startMs) / 1000)
  return s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`
}

export function RenderQueue({ jobs, atCap }: { jobs: RenderJob[]; atCap: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [urls, setUrls] = useState<Record<string, string>>({})

  async function act(id: string, fn: (id: string) => Promise<{ success: boolean; error?: string }>) {
    setBusy(id)
    setErrors((e) => ({ ...e, [id]: "" }))
    const result = await fn(id)
    setBusy(null)
    if (!result.success) setErrors((e) => ({ ...e, [id]: result.error ?? "That didn't work." }))
    else {
      // The queue is a server component, but the masthead's badge is a client
      // one holding its count in state -- refreshing the page data alone leaves
      // it insisting work is waiting that has just been dealt with.
      announceRenderQueueChanged()
      router.refresh()
    }
  }

  if (jobs.length === 0) {
    return <p className="rounded-md border p-6 text-center text-sm text-muted-foreground">Nothing queued.</p>
  }

  return (
    <div className="space-y-3">
      {atCap && (
        <div className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
          <p className="text-sm">
            Six published today. Worth pacing the rest — the renders keep, and a channel that posts six at once
            tends to get seen less than one that posts steadily.
          </p>
        </div>
      )}

      {jobs.map((job) => (
        <div key={job.id} className="rounded-md border p-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h2 className="truncate font-medium">{job.title}</h2>
              <p className="mt-0.5 text-xs text-muted-foreground">
                from{" "}
                <Link href={`/demos/${job.demoId}`} className="underline hover:text-foreground">
                  {job.demoTitle}
                </Link>{" "}
                · {duration(job.startMs, job.endMs)} · {job.fps}fps · {job.camMode}
                {job.followClientId !== null && ` (client ${job.followClientId})`} · requested by {job.requester}
              </p>
            </div>
            <span className={`shrink-0 rounded px-2 py-0.5 text-xs ${STATUS_CLASS[job.status]}`}>
              {STATUS_LABEL[job.status]}
            </span>
          </div>

          {job.description && <p className="mt-2 text-sm text-muted-foreground">{job.description}</p>}

          {job.previewUrl && (
            <video
              controls
              preload="metadata"
              className="mt-3 w-full rounded-md bg-black"
              src={job.previewUrl}
            />
          )}

          {job.status === "pending_review" && !job.previewUrl && (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-sm">
              The mp4 is missing from storage. It may have passed its one-day expiry — reject this and render
              again.
            </p>
          )}

          {job.error && (
            <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2.5 text-xs">
              {job.error}
              {job.githubRunId && (
                <>
                  {" "}
                  <a
                    className="underline"
                    href={`https://github.com/soradozere/Soracle/actions/runs/${job.githubRunId}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Logs
                  </a>
                </>
              )}
            </p>
          )}

          {job.youtubeVideoId && (
            <a
              className="mt-3 inline-flex items-center gap-1.5 text-sm underline"
              href={`https://www.youtube.com/watch?v=${job.youtubeVideoId}`}
              target="_blank"
              rel="noreferrer"
            >
              Watch on YouTube <ExternalLink className="h-3 w-3" />
            </a>
          )}

          {errors[job.id] && <p className="mt-3 text-sm text-destructive">{errors[job.id]}</p>}

          {/* Terminal states only. A failed job counts toward the masthead
              badge so a broken pipeline cannot die quietly -- but until now
              nothing could clear one, so a single GitHub 503 at dispatch left a
              permanent notification with no way to acknowledge it. */}
          {(job.status === "rejected" || job.status === "failed") && (
            <div className="mt-3">
              <Button
                size="sm"
                variant="outline"
                disabled={busy === job.id}
                onClick={() => act(job.id, discardRender)}
              >
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete
              </Button>
            </div>
          )}

          {job.status === "pending_review" && (
            <div className="mt-3 space-y-3">
              <p className="text-xs text-muted-foreground">
                Uploads arrive <span className="font-medium">private</span> — YouTube forces that until the API
                project passes its compliance audit. Flip it to public in Studio.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" disabled={busy === job.id || atCap} onClick={() => act(job.id, approveRender)}>
                  <Upload className="mr-1.5 h-3.5 w-3.5" />
                  Approve &amp; upload
                </Button>
                {job.downloadUrl && (
                  <Button size="sm" variant="outline" asChild>
                    <a href={job.downloadUrl} download>
                      <Download className="mr-1.5 h-3.5 w-3.5" />
                      Download MP4
                    </a>
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy === job.id}
                  onClick={() => act(job.id, rejectRender)}
                >
                  <X className="mr-1.5 h-3.5 w-3.5" />
                  Reject
                </Button>
              </div>

              {/* The way out when the automatic upload will not work. Also
                  the only way to record a video published by hand, which is
                  otherwise invisible to the queue. */}
              <div className="flex gap-2">
                <Input
                  className="h-8 text-sm"
                  placeholder="Or paste a YouTube link you uploaded yourself"
                  value={urls[job.id] ?? ""}
                  onChange={(e) => setUrls((u) => ({ ...u, [job.id]: e.target.value }))}
                />
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy === job.id || !(urls[job.id] ?? "").trim()}
                  onClick={() => act(job.id, (id) => markPublished(id, urls[job.id] ?? ""))}
                >
                  Mark published
                </Button>
              </div>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
