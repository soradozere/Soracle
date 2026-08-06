const OWNER = "soradozere"
const REPO = "Soracle"
const RENDER_WORKFLOW = "render-demo.yml"
const PUBLISH_WORKFLOW = "publish-youtube.yml"
const REF = "main"

export type DispatchResult = { ok: true } | { ok: false; error: string }

/**
 * Inputs for the render workflow.
 *
 * Every value here is a string because workflow_dispatch inputs are strings on
 * the wire regardless of how they are declared. Nothing secret goes in them --
 * they are visible to anyone who can see the Actions run. The job fetches what
 * it needs with its own secrets.
 */
export interface RenderJobInputs {
  job_id: string
  demo_key: string
  start_ms: string
  end_ms: string
  fps: string
  width: string
  height: string
  fov: string
  cam_mode: string
  follow_client_id: string
}

/**
 * Fire the render workflow for one queued job.
 *
 * Deliberately returns a result rather than throwing: the caller has just
 * written a queue row, and a dispatch that fails has to move that row to
 * `failed` rather than leave it at `pending_render` waiting for a run that was
 * never created. A row stuck at pending_render is indistinguishable from one
 * that is merely queued, which is precisely the state nobody notices.
 */
export interface PublishJobInputs {
  job_id: string
  r2_key: string
  title: string
  description: string
  /** private until YouTube's compliance audit passes on the API project. */
  privacy: "private" | "public" | "unlisted"
}

export async function dispatchRenderJob(inputs: RenderJobInputs): Promise<DispatchResult> {
  return dispatch(RENDER_WORKFLOW, inputs as unknown as Record<string, string>)
}

export async function dispatchPublishJob(inputs: PublishJobInputs): Promise<DispatchResult> {
  return dispatch(PUBLISH_WORKFLOW, inputs as unknown as Record<string, string>)
}

async function dispatch(workflow: string, inputs: Record<string, string>): Promise<DispatchResult> {
  const token = process.env.GITHUB_RENDER_PAT
  if (!token) {
    // Set on Production only, deliberately -- a preview deployment firing real
    // render jobs against the production repo would be a misfeature. Say that
    // plainly instead of letting it surface as a confusing 401.
    return { ok: false, error: "GITHUB_RENDER_PAT is not configured in this environment." }
  }

  let response: Response
  try {
    response = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${workflow}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: REF, inputs }),
      },
    )
  } catch (e) {
    return { ok: false, error: `Could not reach GitHub: ${e instanceof Error ? e.message : String(e)}` }
  }

  // 204 No Content is success here; the API returns no body and no run id.
  if (response.status === 204) return { ok: true }

  /*
   * Name the likely cause rather than echoing a bare status.
   *
   * The PAT is set to expire around August 2027, and an expired token fails
   * exactly like a revoked or mis-scoped one: a 401 with nothing useful in it.
   * When that day comes the symptom is "the render button stopped working",
   * which reads as a bug in this code unless the error says otherwise.
   */
  if (response.status === 401) {
    return { ok: false, error: "GitHub rejected the token (401) -- GITHUB_RENDER_PAT may have expired or been revoked." }
  }
  if (response.status === 403) {
    return { ok: false, error: "GitHub refused the dispatch (403) -- the token may lack Actions: read and write on this repo." }
  }
  if (response.status === 404) {
    return {
      ok: false,
      error: `GitHub returned 404 -- ${workflow} must exist on the ${REF} branch to be dispatchable, even when running from another ref.`,
    }
  }

  const body = await response.text().catch(() => "")
  return { ok: false, error: `GitHub dispatch failed (${response.status}): ${body.slice(0, 200)}` }
}
