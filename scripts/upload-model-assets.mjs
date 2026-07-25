#!/usr/bin/env node
/**
 * Uploads converted JK2 assets to the private Supabase Storage bucket.
 *
 * The .glb files and saber textures are Raven/Activision material and this repo
 * is public, so they're gitignored and live in storage instead — see
 * lib/player-models.ts for why that list is a whitelist and not a path.
 *
 * Reads credentials from .env.local. The service-role key is required (the anon
 * key can't write to a private bucket) and never leaves this script.
 *
 * Usage:
 *   node scripts/upload-model-assets.mjs                # everything below
 *   node scripts/upload-model-assets.mjs kyle.glb       # just one object
 */

import { readFileSync, existsSync } from "node:fs"
import { resolve, extname } from "node:path"
import { createClient } from "@supabase/supabase-js"

const BUCKET = "models"

/**
 * Object name in the bucket → path under public/. They match today, but the
 * mapping is explicit so a rename on either side is a deliberate edit rather
 * than a silent 404.
 */
const ASSETS = [
  ["kyle.glb", "public/models/kyle.glb"],
  ["saber-hilt.glb", "public/models/saber-hilt.glb"],
  ...["blue", "green", "red", "purple", "orange", "yellow"].flatMap((colour) => [
    [`saber/${colour}_line.jpg`, `public/models/saber/${colour}_line.jpg`],
    [`saber/${colour}_glow.jpg`, `public/models/saber/${colour}_glow.jpg`],
  ]),
  // Bolt-on props. Textures are embedded in the .glb by md3-to-gltf.mjs, so
  // unlike the saber these are one object each.
  ["props/trip-mine.glb", "public/models/props/trip-mine.glb"],
  ["props/flag-red.glb", "public/models/props/flag-red.glb"],
  ["props/flag-blue.glb", "public/models/props/flag-blue.glb"],
]

const CONTENT_TYPES = {
  ".glb": "model/gltf-binary",
  ".jpg": "image/jpeg",
  ".png": "image/png",
}

function loadEnv() {
  const path = resolve(process.cwd(), ".env.local")
  if (!existsSync(path)) throw new Error("no .env.local — run this from the repo root")

  const env = {}
  for (const line of readFileSync(path, "utf8").split("\n")) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/)
    if (match) env[match[1]] = match[2].trim().replace(/^["']|["']$/g, "")
  }
  return env
}

async function main() {
  const env = loadEnv()
  const url = env.NEXT_PUBLIC_SUPABASE_URL
  const key = env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error("NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set")

  const only = process.argv.slice(2)
  const wanted = only.length > 0 ? ASSETS.filter(([name]) => only.includes(name)) : ASSETS
  if (wanted.length === 0) throw new Error(`nothing matched: ${only.join(", ")}`)

  const supabase = createClient(url, key, { auth: { persistSession: false } })

  // The bucket only accepts types on its allowlist, which is what stops it
  // becoming general-purpose file storage. Widen it to cover what we're about
  // to send rather than leaving the list to drift out of step with ASSETS —
  // and only ever by adding, so the restriction stays meaningful.
  const needed = [...new Set(wanted.map(([, local]) => CONTENT_TYPES[extname(local)]).filter(Boolean))]
  const { data: bucket } = await supabase.storage.getBucket(BUCKET)
  // getBucket answers in snake_case while updateBucket expects camelCase. Read
  // the wrong one and `allowed` comes back empty, so the "append" below turns
  // into a replace and silently drops whatever the bucket already permitted.
  const allowed = bucket?.allowed_mime_types ?? bucket?.allowedMimeTypes ?? []
  const missing = needed.filter((type) => !allowed.includes(type))

  if (missing.length > 0) {
    const { error } = await supabase.storage.updateBucket(BUCKET, {
      allowedMimeTypes: [...allowed, ...missing],
    })
    if (error) throw new Error(`couldn't allow ${missing.join(", ")}: ${error.message}`)
    console.log(`allowed additional types: ${missing.join(", ")}\n`)
  }

  let uploaded = 0
  for (const [name, local] of wanted) {
    const path = resolve(process.cwd(), local)
    if (!existsSync(path)) {
      console.log(`  SKIP  ${name.padEnd(24)} (${local} not present)`)
      continue
    }

    const body = readFileSync(path)
    const { error } = await supabase.storage.from(BUCKET).upload(name, body, {
      contentType: CONTENT_TYPES[extname(path)] ?? "application/octet-stream",
      // These are replacements for assets already in use, not new objects.
      upsert: true,
    })

    if (error) {
      console.error(`  FAIL  ${name.padEnd(24)} ${error.message}`)
      process.exitCode = 1
      continue
    }

    console.log(`  ok    ${name.padEnd(24)} ${(body.length / 1024).toFixed(1)} KB`)
    uploaded++
  }

  console.log(`\n${uploaded}/${wanted.length} uploaded to ${BUCKET}/`)
}

main().catch((err) => {
  console.error(err.message)
  process.exit(1)
})
