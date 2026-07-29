#!/usr/bin/env node
/**
 * Builds a playable `.glb` for a JK2 player model without opening Blender, by
 * grafting its mesh onto a model we've already exported.
 *
 * Every humanoid player model on the disc — 30 of them — declares the SAME
 * skeleton: `models/players/_humanoid/_humanoid`, 72 bones, identical names and
 * identical base pose. So the expensive half of a conversion is the same file
 * every time. Kyle has already been through Blender; his `.glb` carries that
 * skeleton, its inverse bind matrices and four animation clips. This takes all
 * of that verbatim and swaps in another model's geometry.
 *
 * That leaves only the `.glm` to read, which is the half we already understand:
 * md3-to-gltf.mjs parses Ghoul2 surfaces and glm-bolts.mjs unpacks its vertex
 * weights. What it deliberately does NOT do is decode `_humanoid.gla` — the
 * compressed quaternion bone frames are the fiddly part, and the donor's clips
 * are the same animation data anyway.
 *
 * Bolts are NOT written here: a different model has its own tag positions, so
 * run glm-bolts.mjs on the output afterwards (docs §7). This script drops the
 * donor's bolts rather than leaving Kyle's hands attached to someone else.
 *
 * Usage:
 *   node scripts/glm-graft.mjs --assets <root> --model reborn
 *   node scripts/glm-graft.mjs --assets <root> --model desann --donor kyle --out public/models/desann.glb
 *
 * <root> is an extracted assets0.pk3 — the directory holding `models/`.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { resolve, join } from "node:path"
import { readShaderScripts, analyseShader } from "./jk2-shaders.mjs"

const GLM_IDENT = "2LGM"
const GLM_VERSION = 6
const GLA_IDENT = "2LGA"
/** mdxmVertex_t: normal, position, then the packed weight word and its bytes. */
const GLM_VERTEX_SIZE = 32

const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

/**
 * Multiplier for a `glow`-equivalent stage's emissive contribution, via
 * `KHR_materials_emissive_strength` — glTF's base `emissiveFactor` is capped
 * at 1.0 per channel, which reads as a faint tint rather than something that
 * glows. Picked by eye against a real gameplay screenshot of Andromeda's arm
 * (Sam: "the glowing, translucent arm is really the sell for this skin").
 */
const EMISSIVE_STRENGTH = 4

const COMPONENT_SIZES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
const TYPE_COUNTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 }

const NUL = String.fromCharCode(0)
const readString = (buf, offset, length) => buf.toString("latin1", offset, offset + length).split(NUL)[0]

/**
 * Quake is Z-up with +X forward and +Y left; glTF is Y-up with -Z forward.
 * Mapping (x, y, z) to (x, z, -y) is a pure relabel — determinant +1, so no
 * mirroring — which is why the winding below has to be determined rather than
 * assumed to flip.
 */
const quakeToGltf = (x, y, z) => [x, z, -y]

// ---------------------------------------------------------------------------
// Ghoul2 .glm
// ---------------------------------------------------------------------------

/**
 * Ghoul2 packs a vertex's weights and bone references into one 32-bit word.
 *
 * Transcribed from glm-bolts.mjs, which has been reading these correctly since
 * the bolts landed. Two bits of count, five bits per bone reference, and 10-bit
 * weights split across two places — eight low bits in the trailing byte array
 * and the top two packed above the references.
 */
function unpackWeights(buf, vertOffset, boneRefs) {
  const packed = buf.readUInt32LE(vertOffset + 24)
  const count = (packed >>> 30) + 1
  const weights = []
  let assigned = 0
  for (let i = 0; i < count; i++) {
    const ref = (packed >>> (5 * i)) & 31
    // The last weight is whatever's left over, so the set always sums to 1.
    let weight
    if (i === count - 1) {
      weight = 1 - assigned
    } else {
      const high = (packed >>> (20 + i * 2)) & 3
      weight = (buf.readUInt8(vertOffset + 28 + i) | (high << 8)) / 1023
      assigned += weight
    }
    weights.push({ bone: boneRefs[ref], weight })
  }
  return weights
}

/** LOD 0 of a Ghoul2 model: geometry, weights, and the names to filter it by. */
function readGlm(path) {
  const buf = readFileSync(path)
  const ident = buf.toString("latin1", 0, 4)
  if (ident !== GLM_IDENT) throw new Error(`${path}: not a Ghoul2 model (ident "${ident}")`)
  const version = buf.readInt32LE(4)
  if (version !== GLM_VERSION) throw new Error(`${path}: unsupported .glm version ${version}`)

  const animName = readString(buf, 72, 64)
  const numBones = buf.readInt32LE(140)
  const ofsLODs = buf.readInt32LE(148)
  const numSurfaces = buf.readInt32LE(152)
  const ofsSurfHierarchy = buf.readInt32LE(156)

  // Names and shaders live in the hierarchy, whose entries end in a
  // variable-length child list — so it's walked, not indexed.
  const meta = []
  let p = ofsSurfHierarchy
  for (let i = 0; i < numSurfaces; i++) {
    meta.push({ name: readString(buf, p, 64), shader: readString(buf, p + 68, 64) })
    p += 144 + 4 * buf.readInt32LE(p + 140)
  }

  // LOD 0 is the full-detail mesh. Its surface offsets are relative to the start
  // of the offset table, which sits just past the LOD's own ofsEnd.
  const table = ofsLODs + 4
  const surfaces = []
  for (let i = 0; i < numSurfaces; i++) {
    const s = table + buf.readInt32LE(table + 4 * i)
    const { name, shader } = meta[i]

    const numVerts = buf.readInt32LE(s + 12)
    const ofsVerts = buf.readInt32LE(s + 16)
    const numTriangles = buf.readInt32LE(s + 20)
    const ofsTriangles = buf.readInt32LE(s + 24)
    const numBoneRefs = buf.readInt32LE(s + 28)
    const ofsBoneRefs = buf.readInt32LE(s + 32)

    const boneRefs = []
    for (let k = 0; k < numBoneRefs; k++) boneRefs.push(buf.readInt32LE(s + ofsBoneRefs + 4 * k))

    const verts = []
    for (let k = 0; k < numVerts; k++) {
      const v = s + ofsVerts + k * GLM_VERTEX_SIZE
      verts.push({
        // The NORMAL comes first and the position second. Reading them the
        // intuitive way round gives a model that looks vaguely right and is
        // subtly inside out.
        normal: [buf.readFloatLE(v), buf.readFloatLE(v + 4), buf.readFloatLE(v + 8)],
        co: [buf.readFloatLE(v + 12), buf.readFloatLE(v + 16), buf.readFloatLE(v + 20)],
        weights: unpackWeights(buf, v, boneRefs),
      })
    }

    // Texture coordinates are a separate array immediately after the vertices,
    // rather than interleaved with them as MD3 does it.
    const uvBase = s + ofsVerts + numVerts * GLM_VERTEX_SIZE
    const uvs = []
    for (let k = 0; k < numVerts; k++) {
      uvs.push([buf.readFloatLE(uvBase + k * 8), buf.readFloatLE(uvBase + k * 8 + 4)])
    }

    const triangles = []
    for (let t = 0; t < numTriangles; t++) {
      const to = s + ofsTriangles + t * 12
      triangles.push([buf.readInt32LE(to), buf.readInt32LE(to + 4), buf.readInt32LE(to + 8)])
    }

    surfaces.push({ name, shader, verts, uvs, triangles })
  }

  return { animName, numBones, surfaces }
}

/** Bone names from the .gla, which is the only thing that knows what an index means. */
function readGlaBoneNames(path) {
  const buf = readFileSync(path)
  if (buf.toString("latin1", 0, 4) !== GLA_IDENT) throw new Error(`${path}: not a Ghoul2 skeleton`)
  const numBones = buf.readInt32LE(84)
  // The offset table sits immediately after the 100-byte header, and its entries
  // are relative to the same point — not to the header's ofsSkel.
  const HEADER_SIZE = 100
  const names = []
  for (let i = 0; i < numBones; i++) {
    const off = HEADER_SIZE + buf.readInt32LE(HEADER_SIZE + 4 * i)
    names.push(readString(buf, off, 64))
  }
  return names
}

// ---------------------------------------------------------------------------
// .skin — which surfaces are drawn, and with what
// ---------------------------------------------------------------------------

/**
 * `surface → shader path` for the surfaces a model actually draws.
 *
 * The same rule as scripts/glm-skins.mjs and as the Blender recipe in §3.5: an
 * `_off` surface is one Ghoul2 isn't showing (the caps that seal a limb socket),
 * and a `*` surface is a bolt tag rather than geometry. Applying it to Kyle
 * leaves 19 surfaces, which is exactly the 19 meshes in his export — that
 * agreement is the check that this rule is the right one.
 *
 * A shader value of literally `*off` is a third, distinct way a `.skin` can
 * hide a surface — not a naming convention on the surface itself but the
 * shader assignment saying "don't draw this". Bones' six hat surfaces are
 * `*off` in every skin he ships, which is why none of them should render by
 * default.
 */
function readSkin(path) {
  const surfaces = new Map()
  for (const raw of readFileSync(path, "utf8").split("\n")) {
    const line = raw.trim()
    const comma = line.indexOf(",")
    if (!line || comma < 0) continue
    const surface = line.slice(0, comma).trim()
    const shader = line.slice(comma + 1).trim()
    if (!shader || surface.startsWith("*") || surface.endsWith("_off") || shader === "*off") continue
    surfaces.set(surface, shader)
  }
  return surfaces
}

/**
 * Finds the image a shader path refers to. JK2's files name `.tga` almost
 * everywhere while the assets shipped as `.jpg`, a Quake 3 convention the engine
 * resolves at load time — so the extension in the file is a hint, not an answer.
 *
 * Checked against every root in order, so a `--assets-fallback` can supply a
 * texture the main extract is missing (JK2's own `.jpg` conversion for that
 * asset didn't ship — jan's and jedi's heads are the two on this disc) without
 * writing anything into the original assets. The fallback has to be a JPEG
 * already; converting a `.tga` here would mean guessing at quality settings the
 * game never made — do that once, by hand, into a throwaway root that mirrors
 * the real tree, the same way docs/jk2-model-conversion.md §7.5 does for props.
 */
function resolveTexture(assetsRoots, shader, { preferAlpha = false } = {}) {
  const stem = shader.replace(/\.[^./]+$/, "")
  // JPEG has no alpha channel, so a surface that's alpha-tested (see
  // analyseShader's alphaCutout) has to be sourced from a PNG or its cutout
  // regions render fully opaque instead of vanishing — this is exactly what
  // silently broke Bones the first time this model was converted.
  const order = preferAlpha ? [".png", ".jpg", ".jpeg"] : [".jpg", ".jpeg", ".png"]
  for (const root of assetsRoots) {
    for (const ext of order) {
      const candidate = resolve(root, stem + ext)
      if (existsSync(candidate)) return { path: candidate, mimeType: ext === ".png" ? "image/png" : "image/jpeg" }
    }
  }
  return null
}

// ---------------------------------------------------------------------------
// glTF binary container
// ---------------------------------------------------------------------------

function readGlb(path) {
  const buf = readFileSync(path)
  if (buf.toString("latin1", 0, 4) !== "glTF") throw new Error(`${path}: not a .glb`)

  let json = null
  let bin = null
  let p = 12
  while (p < buf.length) {
    const len = buf.readUInt32LE(p)
    const type = buf.readUInt32LE(p + 4)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === JSON_CHUNK) json = JSON.parse(data.toString("utf8"))
    else if (type === BIN_CHUNK) bin = data
    p += 8 + len
  }
  if (!json) throw new Error(`${path}: no JSON chunk`)
  if (!bin) throw new Error(`${path}: no binary chunk`)
  return { json, bin }
}

function writeGlb(path, json, bin) {
  const encoded = Buffer.from(JSON.stringify(json), "utf8")
  // Every chunk is 4-byte aligned; the spec asks for spaces in the JSON chunk
  // and zeroes in the binary one.
  const jsonPadded = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 0x20)])
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)])

  const chunk = (data, type) => {
    const header = Buffer.alloc(8)
    header.writeUInt32LE(data.length, 0)
    header.writeUInt32LE(type, 4)
    return [header, data]
  }

  const parts = [...chunk(jsonPadded, JSON_CHUNK), ...chunk(binPadded, BIN_CHUNK)]
  const total = 12 + parts.reduce((n, part) => n + part.length, 0)
  const header = Buffer.alloc(12)
  header.write("glTF", 0, "ascii")
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  writeFileSync(path, Buffer.concat([header, ...parts]))
  return total
}

/**
 * Accumulates the output binary chunk, handing back bufferView indices.
 *
 * The output is built from scratch rather than appended to the donor's, so
 * Kyle's own mesh and textures don't ride along as dead weight — on his file
 * that's 494 KB of the 1.4 MB.
 */
function createBin() {
  const parts = []
  const views = []
  let offset = 0

  return {
    views,
    /** Copies bytes in and returns the new bufferView index. */
    add(data, target) {
      // Accessor byteOffsets must be multiples of their component size, and 4
      // covers every type we write.
      const pad = (4 - (offset % 4)) % 4
      if (pad > 0) {
        parts.push(Buffer.alloc(pad, 0))
        offset += pad
      }
      const view = { buffer: 0, byteOffset: offset, byteLength: data.length }
      if (target !== undefined) view.target = target
      views.push(view)
      parts.push(data)
      offset += data.length
      return views.length - 1
    },
    build() {
      return Buffer.concat(parts)
    },
  }
}

// ---------------------------------------------------------------------------

function parseArgs() {
  const args = process.argv.slice(2)
  const opts = { donor: "kyle" }
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--assets") opts.assets = args[++i]
    else if (args[i] === "--assets-fallback") (opts.assetsFallback ??= []).push(args[++i])
    else if (args[i] === "--model") opts.model = args[++i]
    else if (args[i] === "--donor") opts.donor = args[++i]
    else if (args[i] === "--donor-glb") opts.donorGlb = args[++i]
    else if (args[i] === "--out") opts.out = args[++i]
    else throw new Error(`unrecognised argument: ${args[i]}`)
  }
  if (!opts.assets || !opts.model) {
    throw new Error(
      "usage: node scripts/glm-graft.mjs --assets <root> --model <name> " +
        "[--donor kyle] [--donor-glb path] [--assets-fallback root]... [--out path]",
    )
  }
  opts.assetsFallback ??= []
  opts.donorGlb ??= `public/models/${opts.donor}.glb`
  opts.out ??= `public/models/${opts.model}.glb`
  return opts
}

/** Bounding box of the visible surfaces of a `.glm`, in glTF axes. */
function glmBounds(glm, visible) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const surface of glm.surfaces) {
    if (!visible.has(surface.name)) continue
    for (const vert of surface.verts) {
      const p = quakeToGltf(...vert.co)
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], p[i])
        max[i] = Math.max(max[i], p[i])
      }
    }
  }
  return { min, max }
}

/** Bounding box of a `.glb`'s meshes, straight from the accessors' own min/max. */
function glbBounds(json) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const mesh of json.meshes ?? []) {
    for (const prim of mesh.primitives) {
      const a = json.accessors[prim.attributes.POSITION]
      for (let i = 0; i < 3; i++) {
        min[i] = Math.min(min[i], a.min[i])
        max[i] = Math.max(max[i], a.max[i])
      }
    }
  }
  return { min, max }
}

/**
 * Works out which way round the triangles go, rather than assuming.
 *
 * The axis relabel is a rotation, not a mirror, so it doesn't flip faces on its
 * own — but Ghoul2's winding convention still has to be established, and getting
 * it wrong gives a model that renders inside out. Since these materials are
 * exported double-sided that wouldn't even show as holes: it shows as lighting
 * that's subtly inverted everywhere, which is exactly the kind of thing nobody
 * spots until it's uploaded.
 *
 * Each triangle already carries the answer. Its vertices have normals, and a
 * face wound counter-clockwise about those normals has cross(v1-v0, v2-v0)
 * pointing the same way. Count the agreements PER SURFACE and take each
 * surface's own verdict.
 *
 * Per surface, not whole-model, and the story is horseton: 505 forward vs
 * 1731 reversed globally, well under the old whole-model 90% bar. The messy
 * votes turned out not to be mixed winding at all — every one of its ten
 * surfaces still votes the same way — but smoothed vertex normals on rounded
 * organic shapes leaning away from their faces' planes, which makes the dot
 * test misfire triangle by triangle (62–83% agreement within a surface, all
 * agreeing on the answer). Base-game models sit at 94–100% per surface, so
 * the per-surface majority reproduces every previous verdict exactly; the
 * hard refusal now only fires when a surface is a near coin flip, which is
 * what actually-misread geometry looks like.
 */
function decideWinding(surfaces) {
  let flipped = 0
  let lowest = { agreement: 1, name: null }
  for (const surface of surfaces) {
    let forward = 0
    let reversed = 0
    for (const [a, b, c] of surface.triangles) {
      const p0 = surface.positions[a]
      const e1 = [surface.positions[b][0] - p0[0], surface.positions[b][1] - p0[1], surface.positions[b][2] - p0[2]]
      const e2 = [surface.positions[c][0] - p0[0], surface.positions[c][1] - p0[1], surface.positions[c][2] - p0[2]]
      const face = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ]
      const n = surface.normals[a]
      const dot = face[0] * n[0] + face[1] * n[1] + face[2] * n[2]
      if (dot > 0) forward++
      else if (dot < 0) reversed++
    }

    const total = forward + reversed
    const agreement = Math.max(forward, reversed) / (total || 1)
    if (agreement < 0.55) {
      throw new Error(
        `"${surface.name}" triangle winding is a coin flip (${forward} forward, ${reversed} reversed) — ` +
          "the normals or the vertex order have been read wrong",
      )
    }
    surface.reversed = reversed > forward
    if (surface.reversed) flipped++
    if (agreement < lowest.agreement) lowest = { agreement, name: surface.name }
  }
  return { flipped, total: surfaces.length, lowest }
}

function main() {
  const { assets, assetsFallback, model, donor, donorGlb, out } = parseArgs()
  const textureRoots = [assets, ...assetsFallback]
  const shaderScripts = readShaderScripts(textureRoots)

  const playersDir = resolve(assets, "models/players")
  const glmPath = join(playersDir, model, "model.glm")
  const skinPath = join(playersDir, model, "model_default.skin")
  const donorGlmPath = join(playersDir, donor, "model.glm")
  const donorSkinPath = join(playersDir, donor, "model_default.skin")

  for (const [label, path] of [
    ["model", glmPath],
    ["default skin", skinPath],
    ["donor model", donorGlmPath],
    ["donor .glb", donorGlb],
  ]) {
    if (!existsSync(path)) throw new Error(`no ${label} at ${path}`)
  }

  const glm = readGlm(glmPath)
  const { json: donorJson, bin: donorBin } = readGlb(donorGlb)

  // --- the four things that have to agree before any of this is safe --------

  const skin = donorJson.skins?.[0]
  if (!skin) throw new Error(`${donorGlb}: no skin — the donor has to be a rigged model`)

  const donorGlm = readGlm(donorGlmPath)
  if (glm.animName !== donorGlm.animName) {
    throw new Error(
      `${model} uses ${glm.animName} but ${donor} uses ${donorGlm.animName} — ` +
        "a model can only be grafted onto a donor with the same skeleton",
    )
  }
  if (glm.numBones !== donorGlm.numBones) {
    throw new Error(`${model} has ${glm.numBones} bones, ${donor} has ${donorGlm.numBones}`)
  }

  const glaPath = resolve(assets, `${glm.animName}.gla`)
  if (!existsSync(glaPath)) throw new Error(`no skeleton at ${glaPath}`)
  const boneNames = readGlaBoneNames(glaPath)

  // Bone index → joint index. The two orders do NOT match — the .gla's third
  // bone is `Motion` where the .glb's is `lfemurX` — so this is by name or it
  // is wrong, and wrong here means limbs driven by the wrong joints.
  const jointOfName = new Map(skin.joints.map((node, i) => [donorJson.nodes[node].name, i]))
  const jointOfBone = boneNames.map((name) => {
    const joint = jointOfName.get(name)
    if (joint === undefined) throw new Error(`${donor}'s .glb has no joint named "${name}"`)
    return joint
  })

  const visible = readSkin(skinPath)
  const donorVisible = new Set(readSkin(donorSkinPath).keys())

  // The .glm is in raw Quake units and the .glb is at whatever scale the Blender
  // import used. Derive it by comparing the donor's two files — they describe the
  // same vertices, so the ratio is exact — rather than hardcoding 0.1 and hoping
  // the next export agrees.
  const a = glmBounds(donorGlm, donorVisible)
  const b = glbBounds(donorJson)
  const ratios = [0, 1, 2].map((i) => (b.max[i] - b.min[i]) / (a.max[i] - a.min[i]))
  const scale = ratios[1]
  const spread = Math.max(...ratios) - Math.min(...ratios)
  if (!(scale > 0) || spread > scale * 0.01) {
    throw new Error(
      `${donor}'s .glm and .glb disagree about axes — per-axis scales ${ratios.map((r) => r.toFixed(5)).join(", ")}`,
    )
  }

  console.log(`${model}: grafting onto ${donor}`)
  console.log(`  skeleton ${glm.animName}, ${glm.numBones} bones, all matched by name`)
  console.log(`  scale .glm → .glb is ${scale.toFixed(6)} (agrees across all three axes)`)

  // --- geometry ------------------------------------------------------------

  const surfaces = []
  for (const source of glm.surfaces) {
    if (!visible.has(source.name)) continue

    const positions = []
    const normals = []
    const joints = []
    const weights = []
    for (const vert of source.verts) {
      const [px, py, pz] = quakeToGltf(...vert.co)
      positions.push([px * scale, py * scale, pz * scale])

      const [nx, ny, nz] = quakeToGltf(...vert.normal)
      const length = Math.hypot(nx, ny, nz) || 1
      normals.push([nx / length, ny / length, nz / length])

      // glTF wants exactly four influences per vertex; Ghoul2 stores one to
      // four. The spare slots are joint 0 at weight 0, which contributes
      // nothing.
      const packed = [0, 0, 0, 0]
      const packedWeights = [0, 0, 0, 0]
      vert.weights.slice(0, 4).forEach((w, i) => {
        packed[i] = jointOfBone[w.bone]
        packedWeights[i] = w.weight
      })
      joints.push(packed)
      weights.push(packedWeights)
    }

    surfaces.push({
      name: source.name,
      shader: visible.get(source.name),
      positions,
      normals,
      uvs: source.uvs,
      joints,
      weights,
      triangles: source.triangles,
    })
  }

  if (surfaces.length === 0) throw new Error(`${model}: no visible surfaces — is model_default.skin right?`)

  const winding = decideWinding(surfaces)
  console.log(
    `  winding: ${winding.flipped}/${winding.total} surfaces reversed ` +
      `(lowest agreement ${(winding.lowest.agreement * 100).toFixed(1)}% on "${winding.lowest.name}")`,
  )

  // --- textures ------------------------------------------------------------

  const images = []
  const imageOfShader = new Map()
  const glowImageOfShader = new Map()
  const effectsOfShader = new Map()
  for (const surface of surfaces) {
    if (imageOfShader.has(surface.shader)) continue

    const stem = surface.shader.replace(/\.[^./]+$/, "").toLowerCase()
    const block = shaderScripts.get(stem)
    const effects = block
      ? analyseShader(block)
      : { alphaCutout: false, translucent: false, reflective: false, additive: false, glow: null }
    effectsOfShader.set(surface.shader, effects)

    const texture = resolveTexture(textureRoots, surface.shader, {
      preferAlpha: effects.alphaCutout || effects.translucent,
    })
    if (!texture) {
      console.warn(`  ! no image for "${surface.name}" (shader "${surface.shader}") — it'll render untextured`)
      imageOfShader.set(surface.shader, null)
    } else {
      imageOfShader.set(surface.shader, images.length)
      images.push({ shader: surface.shader, ...texture, data: readFileSync(texture.path) })
    }

    if (effects.glow) {
      const glowTexture = resolveTexture(textureRoots, effects.glow)
      if (!glowTexture) {
        console.warn(`  ! no glow image for "${surface.name}" (shader "${effects.glow}") — glow will be skipped`)
        glowImageOfShader.set(surface.shader, null)
      } else {
        glowImageOfShader.set(surface.shader, images.length)
        images.push({ shader: effects.glow, ...glowTexture, data: readFileSync(glowTexture.path) })
      }
    }
  }
  console.log(`  ${surfaces.length} surfaces, ${images.length} textures`)

  // --- rebuild the file ----------------------------------------------------

  const bin = createBin()
  const accessors = []

  // Blender shares one input accessor between every sampler in a clip — 216 of
  // them on Kyle — so copying per reference rather than per accessor would carry
  // the same keyframe times across hundreds of times over.
  const copied = new Map()

  /** Copies one of the donor's accessors across, keeping only the bytes it uses. */
  const copyAccessor = (index) => {
    if (copied.has(index)) return copied.get(index)
    const accessor = donorJson.accessors[index]
    const view = donorJson.bufferViews[accessor.bufferView]
    const elementSize = COMPONENT_SIZES[accessor.componentType] * TYPE_COUNTS[accessor.type]
    if (view.byteStride !== undefined && view.byteStride !== elementSize) {
      throw new Error(`accessor ${index} is interleaved (stride ${view.byteStride}) — not handled`)
    }
    const start = (view.byteOffset ?? 0) + (accessor.byteOffset ?? 0)
    const bufferView = bin.add(donorBin.subarray(start, start + accessor.count * elementSize))
    accessors.push({
      bufferView,
      componentType: accessor.componentType,
      count: accessor.count,
      type: accessor.type,
      ...(accessor.min ? { min: accessor.min } : {}),
      ...(accessor.max ? { max: accessor.max } : {}),
    })
    copied.set(index, accessors.length - 1)
    return accessors.length - 1
  }

  /** Writes a freshly built attribute and returns its accessor index. */
  const addAccessor = (data, componentType, type, count, target, bounds) => {
    const bufferView = bin.add(data, target)
    accessors.push({ bufferView, componentType, count, type, ...(bounds ?? {}) })
    return accessors.length - 1
  }

  const ARRAY_BUFFER = 34962
  const ELEMENT_ARRAY_BUFFER = 34963

  const meshes = []
  const materials = []
  const materialOfShader = new Map()

  for (const surface of surfaces) {
    const count = surface.positions.length

    const position = Buffer.alloc(count * 12)
    const normal = Buffer.alloc(count * 12)
    const uv = Buffer.alloc(count * 8)
    const joint = Buffer.alloc(count * 4)
    const weight = Buffer.alloc(count * 16)

    const min = [Infinity, Infinity, Infinity]
    const max = [-Infinity, -Infinity, -Infinity]
    for (let i = 0; i < count; i++) {
      for (let k = 0; k < 3; k++) {
        const value = surface.positions[i][k]
        position.writeFloatLE(value, i * 12 + k * 4)
        normal.writeFloatLE(surface.normals[i][k], i * 12 + k * 4)
        min[k] = Math.min(min[k], value)
        max[k] = Math.max(max[k], value)
      }
      uv.writeFloatLE(surface.uvs[i][0], i * 8)
      uv.writeFloatLE(surface.uvs[i][1], i * 8 + 4)
      for (let k = 0; k < 4; k++) {
        joint.writeUInt8(surface.joints[i][k], i * 4 + k)
        weight.writeFloatLE(surface.weights[i][k], i * 16 + k * 4)
      }
    }

    // 16-bit indices are enough — Ghoul2 caps a surface at 1000 vertices, and
    // the largest on the disc is nowhere near that.
    if (count > 65535) throw new Error(`surface "${surface.name}" has ${count} vertices, too many for 16-bit indices`)
    const indices = Buffer.alloc(surface.triangles.length * 6)
    surface.triangles.forEach((tri, t) => {
      const order = surface.reversed ? [tri[0], tri[2], tri[1]] : tri
      for (let k = 0; k < 3; k++) indices.writeUInt16LE(order[k], t * 6 + k * 2)
    })

    let material = materialOfShader.get(surface.shader)
    if (material === undefined) {
      const image = imageOfShader.get(surface.shader)
      const effects = effectsOfShader.get(surface.shader)
      const glowImage = glowImageOfShader.get(surface.shader)

      materials.push({
        // Named with the JK2 shader path, the same as Blender writes it. The
        // skin system in components/model-skin.tsx keys off mesh names rather
        // than these, but keeping them identical means a grafted model and an
        // exported one are diffable.
        name: surface.shader,
        doubleSided: true,
        pbrMetallicRoughness: {
          ...(image === null ? {} : { baseColorTexture: { index: image } }),
          // A `tcGen environment` surface (chrome, water) gets a modest fixed
          // shine instead of full flat-diffuse — not a real scrolling
          // reflection, just enough that it doesn't read as chalk-flat next to
          // everything else. lib/three-materials.ts skips flattening it away.
          metallicFactor: effects?.reflective ? 0.4 : 0,
          // Flattened to 1 at load by lib/three-materials.ts either way (unless
          // reflective); written here so the file looks right on its own in
          // any other viewer.
          roughnessFactor: effects?.reflective ? 0.35 : 1,
        },
        ...(effects?.translucent
          ? { alphaMode: "BLEND" }
          : effects?.alphaCutout
            ? { alphaMode: "MASK", alphaCutoff: 0.5 }
            : {}),
        ...(glowImage !== undefined && glowImage !== null
          ? {
              emissiveFactor: [1, 1, 1],
              emissiveTexture: { index: glowImage },
              // glTF's base emissiveFactor is clamped to [0,1] per channel —
              // nowhere near bright enough to read as "glowing" rather than
              // "lightly tinted". This extension is a real multiplier three.js
              // (and any other compliant loader) applies on top, which is what
              // actually pushes JK2's additive shimmer into looking like the
              // in-game effect under the renderer's ACES tone mapping.
              extensions: { KHR_materials_emissive_strength: { emissiveStrength: EMISSIVE_STRENGTH } },
            }
          : {}),
        // GLTFLoader copies `extras` onto the resulting THREE.Material's
        // userData, and Material.copy() (what .clone() calls) deep-copies
        // userData too — so this survives into the skin system's per-skin
        // material clones with no changes needed there.
        ...(effects?.reflective ? { extras: { reflective: true } } : {}),
      })
      material = materials.length - 1
      materialOfShader.set(surface.shader, material)
    }

    meshes.push({
      // `<surface>_0` — surface plus LOD, matching what Blender emits and what
      // the skin system and §3.5's cull both assume.
      name: `${surface.name}_0`,
      primitives: [
        {
          attributes: {
            POSITION: addAccessor(position, 5126, "VEC3", count, ARRAY_BUFFER, { min, max }),
            NORMAL: addAccessor(normal, 5126, "VEC3", count, ARRAY_BUFFER),
            TEXCOORD_0: addAccessor(uv, 5126, "VEC2", count, ARRAY_BUFFER),
            JOINTS_0: addAccessor(joint, 5121, "VEC4", count, ARRAY_BUFFER),
            WEIGHTS_0: addAccessor(weight, 5126, "VEC4", count, ARRAY_BUFFER),
          },
          indices: addAccessor(indices, 5123, "SCALAR", surface.triangles.length * 3, ELEMENT_ARRAY_BUFFER),
          material,
        },
      ],
    })
  }

  // --- nodes ---------------------------------------------------------------

  const parentOf = new Map()
  donorJson.nodes.forEach((node, i) => (node.children ?? []).forEach((child) => parentOf.set(child, i)))

  // Keep the joints and everything above them, which is the skeleton and the
  // scene root. Drop the donor's mesh nodes, the Ghoul2 surface hierarchy they
  // hung in, and its bolts — a different model's tags sit in different places,
  // so grafting Kyle's would put someone else's hands on this one. Run
  // glm-bolts.mjs on the output to put the right ones back.
  const keep = new Set()
  for (const joint of skin.joints) {
    for (let i = joint; i !== undefined; i = parentOf.get(i)) {
      if (keep.has(i)) break
      keep.add(i)
    }
  }
  for (const root of donorJson.scenes[donorJson.scene ?? 0].nodes) keep.add(root)

  // ...plus the node the meshes hang off, so the new ones inherit exactly the
  // transform chain the old ones did. three.js binds a skinned mesh using its
  // world matrix, which the glTF spec says to ignore — so this is not somewhere
  // to be clever.
  const firstMesh = donorJson.nodes.findIndex((node) => node.mesh !== undefined)
  if (firstMesh === -1) throw new Error(`${donorGlb}: no mesh nodes to graft onto`)
  let meshHost = firstMesh
  while (parentOf.has(meshHost) && !keep.has(parentOf.get(meshHost))) meshHost = parentOf.get(meshHost)
  if (parentOf.get(meshHost) === undefined) throw new Error(`${donorGlb}: mesh nodes aren't under the scene root`)
  keep.add(meshHost)

  const remap = new Map()
  const nodes = []
  donorJson.nodes.forEach((node, i) => {
    if (!keep.has(i)) return
    remap.set(i, nodes.length)
    nodes.push({ ...node })
  })

  for (const node of nodes) {
    if (!node.children) continue
    const children = node.children.filter((child) => keep.has(child)).map((child) => remap.get(child))
    if (children.length > 0) node.children = children
    else delete node.children
  }

  // The new meshes, all directly under the host: a skinned mesh is posed
  // entirely by its joints, so the Ghoul2 surface tree buys nothing here.
  const host = nodes[remap.get(meshHost)]
  host.children = meshes.map((mesh, i) => {
    nodes.push({ name: mesh.name, mesh: i, skin: 0 })
    return nodes.length - 1
  })

  // --- animations and the bind pose ---------------------------------------

  const animations = (donorJson.animations ?? []).map((animation) => ({
    name: animation.name,
    samplers: animation.samplers.map((sampler) => ({
      input: copyAccessor(sampler.input),
      output: copyAccessor(sampler.output),
      ...(sampler.interpolation ? { interpolation: sampler.interpolation } : {}),
    })),
    // Every target is a joint, and joints are all kept — but check rather than
    // assume, because a dropped target would silently stop animating a limb.
    channels: animation.channels.map((channel) => {
      const node = remap.get(channel.target.node)
      if (node === undefined) throw new Error(`animation "${animation.name}" targets a node that wasn't kept`)
      return { sampler: channel.sampler, target: { node, path: channel.target.path } }
    }),
  }))

  const inverseBindMatrices = copyAccessor(skin.inverseBindMatrices)

  const usesEmissiveStrength = materials.some((m) => m.extensions?.KHR_materials_emissive_strength)

  const json = {
    asset: { version: "2.0", generator: `glm-graft.mjs (${model} on ${donor})` },
    ...(usesEmissiveStrength ? { extensionsUsed: ["KHR_materials_emissive_strength"] } : {}),
    scene: 0,
    scenes: [{ nodes: donorJson.scenes[donorJson.scene ?? 0].nodes.map((i) => remap.get(i)) }],
    nodes,
    meshes,
    materials,
    ...(images.length > 0
      ? {
          images: images.map((image) => ({
            name: image.shader.replace(/^.*\//, "").replace(/\.[^.]+$/, ""),
            mimeType: image.mimeType,
            bufferView: bin.add(image.data),
          })),
          textures: images.map((_, i) => ({ sampler: 0, source: i })),
          samplers: [{ magFilter: 9729, minFilter: 9987 }],
        }
      : {}),
    skins: [
      {
        inverseBindMatrices,
        joints: skin.joints.map((i) => remap.get(i)),
        ...(skin.skeleton !== undefined ? { skeleton: remap.get(skin.skeleton) } : {}),
      },
    ],
    ...(animations.length > 0 ? { animations } : {}),
    accessors,
    bufferViews: bin.views,
    buffers: [{ byteLength: 0 }],
  }

  const binary = bin.build()
  json.buffers[0].byteLength = binary.length

  const bytes = writeGlb(out, json, binary)
  const verts = surfaces.reduce((n, s) => n + s.positions.length, 0)
  const tris = surfaces.reduce((n, s) => n + s.triangles.length, 0)
  console.log(`  clips: ${animations.map((a) => a.name).join(", ") || "none"}`)
  console.log(`\n→ ${out}  ${(bytes / 1024).toFixed(1)} KB, ${verts} verts, ${tris} tris`)
  console.log(`\nNow bake this model's own bolts in:`)
  console.log(`  node scripts/glm-bolts.mjs "${glmPath}" "${glaPath}" ${out} --out ${out}`)
}

try {
  main()
} catch (err) {
  console.error(err.message)
  process.exit(1)
}
