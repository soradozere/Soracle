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

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { resolve, extname, join } from "node:path"
import { createClient } from "@supabase/supabase-js"

const BUCKET = "models"

/**
 * Every skin texture under a directory, as paths relative to it.
 *
 * Almost always `.jpg` — PNG only shows up for a slot that has to keep an
 * alpha channel a JPEG can't hold (see lib/player-models.ts's `ModelSkin.
 * formats`; Bones' red/blue skins are the first ones that need it).
 */
function walkSkinTextures(root, prefix = "") {
  if (!existsSync(root)) return []
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const path = join(root, entry.name)
    if (entry.isDirectory()) return walkSkinTextures(path, join(prefix, entry.name))
    return entry.name.endsWith(".jpg") || entry.name.endsWith(".png") ? [join(prefix, entry.name)] : []
  })
}

/**
 * Object name in the bucket → path under public/. They match today, but the
 * mapping is explicit so a rename on either side is a deliberate edit rather
 * than a silent 404.
 */
const ASSETS = [
  // Player models. Kyle came through Blender; the rest were grafted onto his
  // skeleton by scripts/glm-graft.mjs. Listed rather than globbed, so uploading
  // a model is as deliberate as adding it to PLAYER_MODELS.
  ["kyle.glb", "public/models/kyle.glb"],
  ["reborn.glb", "public/models/reborn.glb"],
  ["shadowtrooper.glb", "public/models/shadowtrooper.glb"],
  ["tavion.glb", "public/models/tavion.glb"],
  ["desann.glb", "public/models/desann.glb"],
  ["luke.glb", "public/models/luke.glb"],
  ["jan.glb", "public/models/jan.glb"],
  ["lando.glb", "public/models/lando.glb"],
  ["jedi.glb", "public/models/jedi.glb"],
  ["stormtrooper.glb", "public/models/stormtrooper.glb"],
  ["swamptrooper.glb", "public/models/swamptrooper.glb"],
  ["imperial.glb", "public/models/imperial.glb"],
  ["rebel.glb", "public/models/rebel.glb"],
  ["jeditrainer.glb", "public/models/jeditrainer.glb"],
  // Fan-made additions — same grafting pipeline, see lib/player-models.ts.
  ["andromeda.glb", "public/models/andromeda.glb"],
  ["bones.glb", "public/models/bones.glb"],
  ["horseton.glb", "public/models/horseton.glb"],
  ["zarah.glb", "public/models/zarah.glb"],
  ["zarah-winged.glb", "public/models/zarah-winged.glb"],
  ["otso.glb", "public/models/otso.glb"],
  ["rayman.glb", "public/models/rayman.glb"],
  ["eternal.glb", "public/models/eternal.glb"],
  ["cal-kestis.glb", "public/models/cal-kestis.glb"],
  ["jedi-zf.glb", "public/models/jedi-zf.glb"],
  ["jskellington.glb", "public/models/jskellington.glb"],
  ["swoledor.glb", "public/models/swoledor.glb"],
  ["batman-beyond.glb", "public/models/batman-beyond.glb"],
  // Stock JK2, converted later than the rest of the base roster above.
  ["rodian.glb", "public/models/rodian.glb"],
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
  // Nightmare variants (lib/prop-assets.ts FLAG_VARIANTS/MINE_VARIANTS) — the
  // "transparent" flag skin needs no object of its own; it's the default
  // flag-{team}.glb above rendered at reduced opacity at runtime.
  ["props/flag-red-nightmare.glb", "public/models/props/flag-red-nightmare.glb"],
  ["props/flag-blue-nightmare.glb", "public/models/props/flag-blue-nightmare.glb"],
  ["props/trip-mine-nightmare.glb", "public/models/props/trip-mine-nightmare.glb"],
  // The masthead's rotating logo. Not a player model or an equippable prop —
  // page chrome that happens to be a 3D asset — so it gets its own catalogue
  // (lib/masthead-assets.ts) rather than living in PLAYER_MODELS or
  // PROP_ASSETS.
  ["masthead/jk2logo.glb", "public/models/masthead/jk2logo.glb"],
  ["masthead/logo-diffuse.jpg", "public/models/masthead/logo-diffuse.jpg"],
  ["masthead/logo-env.jpg", "public/models/masthead/logo-env.jpg"],
  ["masthead/saber-core.jpg", "public/models/masthead/saber-core.jpg"],
  ["masthead/saber-glow.jpg", "public/models/masthead/saber-glow.jpg"],
  // Skin variants: only the textures that differ from the model's default, which
  // is already embedded in its .glb.
  //
  // Scanned rather than listed, because these are generated — 72 files across
  // five models, and scripts/glm-skins.mjs decides how many. Enumerating them
  // here would be a second copy of that decision, out of date the moment a model
  // is added. Uploading one that isn't in the catalogue costs a few KB and
  // nothing else: /api/model-url only ever signs ids it can find in
  // lib/player-models.ts, so the read side stays the boundary it was.
  ...walkSkinTextures(resolve(process.cwd(), "public/models/skins")).map((relative) => [
    `skins/${relative}`,
    `public/models/skins/${relative}`,
  ]),
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
