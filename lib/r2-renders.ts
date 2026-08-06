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
 * object, with a one-day lifecycle rule on the bucket as a backstop for jobs
 * that die without cleaning up. YouTube is the storage; this is a staging area
 * that should sit near-empty.
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
  return getSignedUrl(client(), new GetObjectCommand({ Bucket: BUCKET, Key: key }), {
    expiresIn: expiresInSeconds,
  })
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
