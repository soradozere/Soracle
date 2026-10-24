#!/usr/bin/env node
/**
 * Uploads NWH install files to the jk2demos R2 bucket, under nwh/ -- the
 * same bucket and credentials the demo library uses (see lib/r2.ts), just
 * its own prefix to keep the two apart. These are NWH's own client/server
 * packages, not raw JK2 game data, so they don't carry the copyright
 * concerns public/models/README.md documents for player models.
 *
 * Usage:
 *   node scripts/upload-nwh-downloads.mjs <file> [<file> ...]
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve, basename, extname } from "node:path"
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3"

const BUCKET = "jk2demos"
const PREFIX = "nwh/"

const CONTENT_TYPES = {
  ".zip": "application/zip",
  ".gz": "application/gzip",
}

function loadEnv() {
  const path = resolve(process.cwd(), ".env.local")
  if (!existsSync(path)) throw new Error("no .env.local -- run this from the repo root")

  const env = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "")
  }
  return env
}

async function main() {
  const env = loadEnv()
  const accountId = env.R2_ACCOUNT_ID
  const accessKeyId = env.R2_ACCESS_KEY_ID
  const secretAccessKey = env.R2_SECRET_ACCESS_KEY
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY must be set")
  }

  const files = process.argv.slice(2)
  if (files.length === 0) {
    throw new Error("Usage: node scripts/upload-nwh-downloads.mjs <file> [<file> ...]")
  }

  const client = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  })

  for (const path of files) {
    const name = basename(path)
    const body = readFileSync(path)
    const contentType = CONTENT_TYPES[extname(name).toLowerCase()] ?? "application/octet-stream"
    await client.send(
      new PutObjectCommand({
        Bucket: BUCKET,
        Key: PREFIX + name,
        Body: body,
        ContentType: contentType,
        CacheControl: "public, max-age=31536000, immutable",
      }),
    )
    console.log(`✓ ${name} (${(body.length / 1_000_000).toFixed(1)} MB) -> ${BUCKET}/${PREFIX}${name}`)
  }
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
