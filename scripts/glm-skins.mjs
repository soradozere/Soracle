#!/usr/bin/env node
/**
 * Extracts a JK2 model's skin variants — the textures that differ from its
 * default — and prints the catalogue entry to paste into lib/player-models.ts.
 *
 * A JK2 model ships one mesh and several `.skin` files, each a plain list of
 * `surface,texturepath` lines. Kyle's red team skin is his default with three
 * images swapped; reborn's seven variants are the same 18 surfaces pointed at
 * seven different sets. So a skin is never new geometry, and shipping one as a
 * whole second `.glb` would send the same 1.4 MB of mesh down the wire again for
 * the sake of ~240 KB of JPEG.
 *
 * This writes ONLY the differing images, because Blender already embedded the
 * default set in the model's own `.glb`. What comes out is a handful of numbered
 * files the viewer overlays on top at runtime.
 *
 * The numbering is deliberate. Naming these after their source files would put
 * Raven's filenames in a public repo's catalogue for no benefit; a slot index
 * says everything the viewer needs and nothing else. Same reasoning as
 * scripts/glm-bolts.mjs baking coordinates into the `.glb` rather than a table.
 *
 * Usage:
 *   node scripts/glm-skins.mjs --assets <root> --model kyle
 *   node scripts/glm-skins.mjs --assets <root> --model reborn --out public/models/skins
 *
 * <root> is an extracted assets0.pk3 — the directory holding `models/`.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync } from "node:fs"
import { resolve, join, extname, basename } from "node:path"

const DEFAULT_SKIN = "default"
const DEFAULT_OUT = "public/models/skins"

/** Extensions to try for a shader path, best first. */
const TEXTURE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".tga"]

/**
 * A surface whose name ends in `_off` is off — that's how Ghoul2 stores the
 * pieces a model isn't currently showing (the caps that seal a limb's socket
 * when the limb is blown away, mostly). `*`-prefixed ones are bolt tags, not
 * geometry. Neither is ever drawn, so neither can carry a skin.
 *
 * This is the same rule that reduces Kyle's 82 surfaces to the 19 meshes in his
 * exported `.glb`, and it has to agree with that export or a skin would name
 * surfaces the viewer can't find.
 */
function isVisibleSurface(name) {
  return !name.startsWith("*") && !name.endsWith("_off")
}

/** `surface → shader path` for the visible surfaces of one `.skin` file. */
function readSkin(path) {
  const surfaces = new Map()
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim()
    if (!line) continue
    const comma = line.indexOf(",")
    if (comma < 0) continue
    const surface = line.slice(0, comma).trim()
    const shader = line.slice(comma + 1).trim()
    if (!shader || !isVisibleSurface(surface)) continue
    surfaces.set(surface, shader)
  }
  return surfaces
}

/**
 * Finds the image a shader path refers to.
 *
 * JK2's `.skin` files name `.tga` almost everywhere while the assets shipped as
 * `.jpg` — a Quake 3 convention the engine resolves at load time — so the
 * extension in the file is a hint, not an answer.
 */
function resolveTexture(assetsRoot, shader) {
  const stem = shader.replace(/\.[^./]+$/, "")
  for (const ext of TEXTURE_EXTENSIONS) {
    const candidate = resolve(assetsRoot, stem + ext)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Title-cased fallback label; the team colours get named as such. */
function labelFor(skin) {
  if (skin === "red") return "Red team"
  if (skin === "blue") return "Blue team"
  return skin.replace(/_/g, " ").replace(/\b[a-z]/g, (c) => c.toUpperCase())
}

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = { out: DEFAULT_OUT }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--assets") opts.assets = args[++i]
    else if (args[i] === "--model") opts.model = args[++i]
    else if (args[i] === "--out") opts.out = args[++i]
    else throw new Error(`unrecognised argument: ${args[i]}`)
  }
  if (!opts.assets || !opts.model) {
    throw new Error("usage: node scripts/glm-skins.mjs --assets <root> --model <name> [--out dir]")
  }
  return opts
}

function main() {
  const { assets, model, out } = parseArgs()

  const modelDir = resolve(assets, "models/players", model)
  if (!existsSync(modelDir)) throw new Error(`no such model: ${modelDir}`)

  const defaultPath = join(modelDir, `model_${DEFAULT_SKIN}.skin`)
  if (!existsSync(defaultPath)) throw new Error(`${model} has no model_${DEFAULT_SKIN}.skin to diff against`)
  const base = readSkin(defaultPath)

  const variants = readdirSync(modelDir)
    .filter((f) => f.startsWith("model_") && f.endsWith(".skin"))
    .map((f) => f.slice("model_".length, -".skin".length))
    .filter((skin) => skin !== DEFAULT_SKIN)
    .sort()

  console.log(`${model}: ${base.size} visible surfaces, ${variants.length} variant skin(s)\n`)

  const entries = []
  for (const skin of variants) {
    const surfaces = readSkin(join(modelDir, `model_${skin}.skin`))

    // `clear` is JK2's built-in "draw nothing" shader, and a skin that applies it
    // to a visible surface is hiding part of the body on purpose. In practice
    // that means the first-person leg skins (kyle's model_fpls), which blank the
    // head and collar so you don't see your own chin down the camera. Those
    // aren't player skins and would render as a decapitated figure.
    const cleared = [...surfaces].filter(([, shader]) => shader === "clear").map(([name]) => name)
    if (cleared.length > 0) {
      console.log(`  skip  ${skin.padEnd(12)} hides ${cleared.length} surface(s) — a first-person skin, not a player one`)
      continue
    }

    // Anything the default doesn't have can't be swapped: the `.glb` has no such
    // mesh to point at. Worth saying out loud rather than dropping.
    const unknown = [...surfaces.keys()].filter((name) => !base.has(name))
    if (unknown.length > 0) {
      console.log(`  note  ${skin.padEnd(12)} names surfaces the default doesn't: ${unknown.join(", ")}`)
    }

    // Slots are assigned in first-appearance order, so the numbering is stable
    // for a given pair of files and a re-run doesn't reshuffle a live catalogue.
    const slots = new Map()
    const assignment = {}
    for (const [surface, shader] of surfaces) {
      if (!base.has(surface) || base.get(surface) === shader) continue
      if (!slots.has(shader)) slots.set(shader, slots.size)
      assignment[surface] = slots.get(shader)
    }

    if (slots.size === 0) {
      console.log(`  skip  ${skin.padEnd(12)} identical to default`)
      continue
    }

    const dir = resolve(out, model, skin)
    mkdirSync(dir, { recursive: true })

    let bytes = 0
    for (const [shader, slot] of slots) {
      const source = resolveTexture(assets, shader)
      if (!source) throw new Error(`${model}/${skin}: no image found for "${shader}"`)

      // Copied byte for byte, not re-encoded. A TGA would need converting first
      // and there's no point guessing at quality settings on someone's behalf —
      // failing here is better than silently shipping a recompressed texture.
      if (extname(source).toLowerCase() !== ".jpg" && extname(source).toLowerCase() !== ".jpeg") {
        throw new Error(`${model}/${skin}: ${basename(source)} is not a JPEG — convert it first`)
      }

      const data = readFileSync(source)
      writeFileSync(join(dir, `${slot}.jpg`), data)
      bytes += data.length
    }

    const surfaceCount = Object.keys(assignment).length
    console.log(
      `  ok    ${skin.padEnd(12)} ${slots.size} texture(s), ${surfaceCount} surface(s), ${(bytes / 1024).toFixed(1)} KB`,
    )
    entries.push({ skin, slots: slots.size, assignment })
  }

  if (entries.length === 0) {
    console.log("\nnothing to write")
    return
  }

  console.log(`\n→ ${resolve(out, model)}/<skin>/<n>.jpg`)
  console.log("\nPaste into PLAYER_MODELS in lib/player-models.ts:\n")
  console.log("    skins: [")
  console.log(`      { id: "${DEFAULT_SKIN}", label: "Default", textures: 0, surfaces: {} },`)
  for (const { skin, slots, assignment } of entries) {
    const pairs = Object.entries(assignment)
      .map(([surface, slot]) => `${surface}: ${slot}`)
      .join(", ")
    console.log(`      {`)
    console.log(`        id: "${skin}",`)
    console.log(`        label: "${labelFor(skin)}",`)
    console.log(`        textures: ${slots},`)
    console.log(`        surfaces: { ${pairs} },`)
    console.log(`      },`)
  }
  console.log("    ],")

  console.log("\nAnd into ASSETS in scripts/upload-model-assets.mjs:\n")
  for (const { skin, slots } of entries) {
    for (let n = 0; n < slots; n++) {
      const object = `skins/${model}/${skin}/${n}.jpg`
      console.log(`  ["${object}", "${join(out, model, skin, `${n}.jpg`)}"],`)
    }
  }
}

try {
  main()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
