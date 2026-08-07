/**
 * Rendered mp4s awaiting review, in their own R2 bucket.
 *
 * A separate bucket from jk2demos rather than a renders/ prefix inside it,
 * because R2 API tokens scope per bucket and not per prefix: a prefix would
 * have meant handing the CI runner write access to the entire demo library to
 * upload one video. Splitting them keeps a leaked render credential unable to
 * touch a single demo.
 *
 * Deliberately not sharing lib/r2.ts's client. That one holds credentials for
 * the library; this holds credentials for renders, and the whole point is that
 * they are different keys with different reach.
 *
 * Contents are disposable by design -- publish and reject each delete their
 * object, with a two-day lifecycle rule on the bucket as a backstop for jobs
 * that die without cleaning up. YouTube is the storage; this is a staging area
 * that should sit near-empty.
 *
 * That rule is unprefixed, which is safe only because this bucket holds nothing
 * but unreviewed renders. The same rule on jk2demos once destroyed 13 demos;
 * any rule there must be scoped to a prefix.
 *
 * The two days are also a review deadline, not just cleanup: a render nobody
 * approves in that window is collected, and the row is left in pending_review
 * pointing at an object that no longer exists. Approve then fails -- see
 * app/admin/renders/actions.ts, which reads the object back to upload it -- and
 * the only way forward is to reject it and render again.
 */
import { S3Client, DeleteObjectCommand, HeadObjectCommand, GetObjectCommand } from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

const BUCKET = "jk2renders"

function client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_RENDERS_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_RENDERS_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "R2_ACCOUNT_ID, R2_RENDERS_ACCESS_KEY_ID and R2_RENDERS_SECRET_ACCESS_KEY must all be set",
    )
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

/**
 * A short-lived URL for the review player.
 *
 * The bucket has no public URL and should not get one: nothing in it has been
 * approved yet, and an unreviewed render is exactly the thing that must not be
 * shareable. An hour outlives any realistic review sitting.
 */
export async function signedRenderUrl(key: string, expiresInSeconds = 3600): Promise<string> {
  return getSignedUrl(
    client(),
    // ResponseContentType overrides whatever is stored on the object. Without
    // it a render uploaded as application/octet-stream is refused by the video
    // element -- "No video with supported format and MIME type found" -- even
    // though the file itself is a perfectly good h264 mp4. Forcing it here also
    // repairs renders already sitting in the bucket, rather than only ones
    // uploaded after the workflow was fixed.
    new GetObjectCommand({ Bucket: BUCKET, Key: key, ResponseContentType: "video/mp4" }),
    { expiresIn: expiresInSeconds },
  )
}

/**
 * A signed URL that saves rather than plays.
 *
 * ResponseContentDisposition is set server-side because the download attribute
 * on an anchor is ignored cross-origin -- without it the browser navigates to
 * the video and plays it, and "save as" gives you a UUID with no extension.
 * The filename is the video's title so the file is recognisable in Downloads
 * when it comes to uploading it.
 */
export async function downloadRenderUrl(
  key: string,
  filename: string,
  expiresInSeconds = 3600,
): Promise<string> {
  // Quotes would terminate the header value early, and titles are free text.
  const safe = filename.replace(/["\\]/g, "").slice(0, 120) || "render"
  return getSignedUrl(
    client(),
    new GetObjectCommand({
      Bucket: BUCKET,
      Key: key,
      ResponseContentDisposition: `attachment; filename="${safe}.mp4"`,
    }),
    { expiresIn: expiresInSeconds },
  )
}

export async function deleteRender(key: string): Promise<void> {
  await client().send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }))
}

/** Size in bytes, or null when the object is gone. */
export async function headRender(key: string): Promise<number | null> {
  try {
    const r = await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }))
    return r.ContentLength ?? null
  } catch {
    return null
  }
}
