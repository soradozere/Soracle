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
 *   node scripts/glm-skins.mjs --assets <root> --model kyle --model reborn --write lib/model-skins.ts
 *
 * <root> is an extracted assets0.pk3 — the directory holding `models/`.
 *
 * `--write` regenerates the whole catalogue, so it needs every model listed in
 * one command — which is the honest shape for a generated file. Without it the
 * entries are printed for inspection and nothing is written.
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
  const opts = { out: DEFAULT_OUT, models: [] }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--assets") opts.assets = args[++i]
    else if (args[i] === "--model") opts.models.push(args[++i])
    else if (args[i] === "--out") opts.out = args[++i]
    else if (args[i] === "--write") opts.write = args[++i]
    else throw new Error(`unrecognised argument: ${args[i]}`)
  }
  if (!opts.assets || opts.models.length === 0) {
    throw new Error("usage: node scripts/glm-skins.mjs --assets <root> --model <name>... [--out dir] [--write path]")
  }
  return opts
}

/** Extracts one model's variants, writing its textures and returning its entries. */
function extractModel(assets, model, out) {
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

    // A surface the default skin doesn't have isn't in the exported mesh either,
    // so there's nothing to repaint. Usually that's Raven leaving dead lines
    // behind — desann's team skins name three surfaces his model doesn't
    // contain, one of them called `hips_fixing_basers_mistake` — but it's said
    // out loud rather than dropped, in case it ever isn't.
    const unknown = [...surfaces.keys()].filter((name) => !base.has(name))
    if (unknown.length > 0) {
      console.log(`  note  ${skin.padEnd(12)} names surfaces the model doesn't have: ${unknown.join(", ")}`)
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

  if (entries.length > 0) console.log(`\n→ ${resolve(out, model)}/<skin>/<n>.jpg\n`)
  return entries
}

/** The generated half of the catalogue, ready to write over lib/model-skins.ts. */
function renderCatalogue(byModel) {
  const lines = [
    "// GENERATED by scripts/glm-skins.mjs — do not edit by hand.",
    "//",
    "// One entry per model, listing the skins JK2 ships for it and which of its",
    "// surfaces each one repaints. See ModelSkin in lib/player-models.ts for what",
    "// the numbers mean and why they aren't filenames.",
    "//",
    "// Regenerate with every model named in one command:",
    "//   node scripts/glm-skins.mjs --assets <root> \\",
    ...[...byModel.keys()].map((model) => `//     --model ${model} \\`),
    "//     --write lib/model-skins.ts",
    "",
    'import type { ModelSkin } from "@/lib/player-models"',
    "",
    "export const MODEL_SKINS: Record<string, ModelSkin[]> = {",
  ]

  for (const [model, entries] of byModel) {
    lines.push(`  ${model}: [`)
    lines.push(`    { id: "${DEFAULT_SKIN}", label: "Default", textures: 0, surfaces: {} },`)
    for (const { skin, slots, assignment } of entries) {
      const pairs = Object.entries(assignment)
        .map(([surface, slot]) => `${surface}: ${slot}`)
        .join(", ")
      lines.push(`    {`)
      lines.push(`      id: "${skin}",`)
      lines.push(`      label: "${labelFor(skin)}",`)
      lines.push(`      textures: ${slots},`)
      lines.push(`      surfaces: { ${pairs} },`)
      lines.push(`    },`)
    }
    lines.push(`  ],`)
  }

  lines.push("}", "")
  return lines.join("\n")
}

function main() {
  const { assets, models, out, write } = parseArgs()

  const byModel = new Map()
  for (const model of models) {
    byModel.set(model, extractModel(assets, model, out))
  }

  const catalogue = renderCatalogue(byModel)
  if (!write) {
    console.log("Pass --write lib/model-skins.ts to save this:\n")
    console.log(catalogue)
    return
  }

  writeFileSync(resolve(write), catalogue)
  const skins = [...byModel.values()].reduce((n, entries) => n + entries.length, 0)
  console.log(`→ ${write}  ${byModel.size} models, ${skins} variant skins`)
  console.log("\nUpload with: node scripts/upload-model-assets.mjs")
}

try {
  main()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
