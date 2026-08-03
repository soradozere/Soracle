/**
 * Demo file storage, on Cloudflare R2 rather than Supabase Storage.
 *
 * R2 charges nothing for egress; Supabase's free/Pro bandwidth allowances do,
 * and a demo library's whole traffic pattern is repeated downloads of a few
 * large files -- exactly the shape that makes egress the number to watch.
 *
 * Shares the jk2demos bucket with the browser engine build (see
 * tools/deploy-engine-r2.sh), under a demos/ prefix to keep the two apart.
 * `file_path` in the demos table stays a bare filename, same as it always
 * was under Supabase Storage -- this file is the only place that knows the
 * prefix, the same way "which bucket" used to be implicit in the Supabase
 * client call.
 */
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  CopyObjectCommand,
  HeadObjectCommand,
} from "@aws-sdk/client-s3"
import { getSignedUrl } from "@aws-sdk/s3-request-presigner"

// One bucket, shared with the engine build (tools/deploy-engine-r2.sh) -- not
// configuration that differs per environment, so a constant here rather than
// an env var, same as "demos" was a hardcoded bucket name under Supabase.
const BUCKET = "jk2demos"
const PREFIX = "demos/"

function client(): S3Client {
  const accountId = process.env.R2_ACCOUNT_ID
  const accessKeyId = process.env.R2_ACCESS_KEY_ID
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must all be set")
  }
  return new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })
}

export async function uploadDemoFile(fileName: string, bytes: Uint8Array): Promise<void> {
  await client().send(
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: PREFIX + fileName,
      Body: bytes,
      ContentType: "application/octet-stream",
      CacheControl: "public, max-age=31536000, immutable",
    }),
  )
}

/**
 * A short-lived URL the browser PUTs the demo to directly.
 *
 * The file never passes through the Next server, which is the whole point:
 * Vercel rejects request bodies over ~4.5MB before our code runs, so a
 * server-action upload can never carry a real match. The signature covers
 * Content-Length and Content-Type, so the URL is only good for a file of
 * exactly the size the caller declared -- and the recorded size is verified
 * against the stored object (headDemoFile) before anything enters the
 * database, so a lie here buys nothing.
 */
export async function createDemoUploadUrl(fileName: string, sizeBytes: number): Promise<string> {
  return getSignedUrl(
    client(),
    new PutObjectCommand({
      Bucket: BUCKET,
      Key: PREFIX + fileName,
      ContentLength: sizeBytes,
      ContentType: "application/octet-stream",
      CacheControl: "public, max-age=31536000, immutable",
    }),
    { expiresIn: 60 * 15 },
  )
}

/** Size of a stored demo in bytes, or null if it was never uploaded. */
export async function headDemoFile(fileName: string): Promise<number | null> {
  try {
    const res = await client().send(new HeadObjectCommand({ Bucket: BUCKET, Key: PREFIX + fileName }))
    return res.ContentLength ?? 0
  } catch {
    return null
  }
}

/**
 * Delete via the trash: R2 holds the only copy of anything players upload,
 * so a straight delete makes an admin misclick permanent. The object is
 * copied under trash/ first -- server-side, no download -- and the copy is
 * swept by hand someday, or never; it costs nothing to keep.
 */
export async function deleteDemoFile(fileName: string): Promise<void> {
  const c = client()
  try {
    await c.send(
      new CopyObjectCommand({
        Bucket: BUCKET,
        CopySource: encodeURIComponent(`${BUCKET}/${PREFIX}${fileName}`),
        Key: `trash/${fileName}`,
      }),
    )
  } catch {
    // Nothing to copy is fine -- deleting a row whose file already vanished
    // should still remove the row, and the delete below is a no-op then too.
  }
  await c.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: PREFIX + fileName }))
}

/** Public URL a browser fetches the demo from directly -- no credentials involved. */
export function demoFileUrl(fileName: string): string {
  const base = process.env.NEXT_PUBLIC_R2_DEMOS_BASE_URL
  if (!base) throw new Error("NEXT_PUBLIC_R2_DEMOS_BASE_URL is not configured")
  return `${base}/${PREFIX}${fileName}`
}
