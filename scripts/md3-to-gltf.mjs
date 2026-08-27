#!/usr/bin/env node
/**
 * Converts a Quake 3 / JK2 MD3 model to a self-contained .glb.
 *
 * MD3 is the format JK2 uses for static props — weapons, ammo, debris. Unlike
 * the animated Ghoul2 (.glm) player models, which need Blender and the mrwonko
 * addon (see docs/jk2-model-conversion.md), MD3 is simple enough to read
 * directly: one surface list, one frame for a static prop, no skeleton.
 *
 * So saber hilts need no Blender session at all.
 *
 * Usage:
 *   node scripts/md3-to-gltf.mjs <input.md3> <output.glb> [--assets root] [--texture path]
 *
 * The texture is resolved from the surface's shader name, trying the extensions
 * JK2 actually ships (the shader usually says .tga while the file on disk is a
 * .jpg), or forced with --texture.
 *
 * With --assets, a surface's shader name is also looked up against any real JK2
 * `.shader` script under that root (see scripts/jk2-shaders.mjs) — the same
 * pass scripts/glm-graft.mjs makes for player models. Every prop converted
 * before the Nightmare variants had no custom shader at all, so this is a
 * no-op for them; it only matters for a shader whose surface has no ordinary
 * image (a flat-colour `rgbGen const` base, or an additive glow layer with no
 * base texture of its own).
 *
 * Tags are preserved as empty nodes. That matters: `tag_flash` is where the
 * blade emerges, so the viewer can read the blade origin out of the model
 * instead of anyone guessing at an offset.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, resolve, basename, extname } from "node:path"
import { readShaderScripts, analyseShader } from "./jk2-shaders.mjs"

/**
 * glTF's base `emissiveFactor` is clamped to [0,1] per channel — nowhere near
 * bright enough to read as "glowing" under the viewer's ACES tone mapping.
 * This extension is a real multiplier three.js applies on top. Same value as
 * glm-graft.mjs's EMISSIVE_STRENGTH; not shared as a constant because the two
 * scripts don't share any module besides jk2-shaders.mjs, and this one number
 * isn't worth a coupling for.
 */
const EMISSIVE_STRENGTH = 4

const MD3_IDENT = "IDP3"
const MD3_VERSION = 15
/** MD3 stores vertex positions as shorts in 1/64th units. */
const XYZ_SCALE = 1 / 64

const GLM_IDENT = "2LGM"
const GLM_VERSION = 6
/** mdxmVertex_t: normal (12), position (12), packed weights (4), byte weights (4). */
const GLM_VERTEX_SIZE = 32

// ---------------------------------------------------------------------------
// MD3 parsing
// ---------------------------------------------------------------------------

function readString(buf, offset, length) {
  const end = buf.indexOf(0, offset)
  const stop = end === -1 || end > offset + length ? offset + length : end
  return buf.toString("latin1", offset, stop)
}

function parseMd3(buf) {
  const ident = buf.toString("latin1", 0, 4)
  const version = buf.readInt32LE(4)
  if (ident !== MD3_IDENT) throw new Error(`Not an MD3 (ident "${ident}", expected "${MD3_IDENT}")`)
  if (version !== MD3_VERSION) throw new Error(`Unsupported MD3 version ${version}, expected ${MD3_VERSION}`)

  const model = {
    name: readString(buf, 8, 64),
    numFrames: buf.readInt32LE(76),
    numTags: buf.readInt32LE(80),
    numSurfaces: buf.readInt32LE(84),
    ofsFrames: buf.readInt32LE(92),
    ofsTags: buf.readInt32LE(96),
    ofsSurfaces: buf.readInt32LE(100),
    tags: [],
    surfaces: [],
  }

  // Tags: name[64], origin vec3, axis 3x vec3 = 112 bytes.
  for (let i = 0; i < model.numTags; i++) {
    const o = model.ofsTags + i * 112
    model.tags.push({
      name: readString(buf, o, 64),
      origin: [buf.readFloatLE(o + 64), buf.readFloatLE(o + 68), buf.readFloatLE(o + 72)],
    })
  }

  // Surfaces. Header is 108 bytes: ident[4], name[64], then ten int32s. Every
  // offset inside a surface is relative to the START of that surface, not the
  // file — getting that wrong is the classic way to read garbage.
  let o = model.ofsSurfaces
  for (let i = 0; i < model.numSurfaces; i++) {
    const surface = {
      name: readString(buf, o + 4, 64),
      numShaders: buf.readInt32LE(o + 76),
      numVerts: buf.readInt32LE(o + 80),
      numTriangles: buf.readInt32LE(o + 84),
      ofsTriangles: buf.readInt32LE(o + 88),
      ofsShaders: buf.readInt32LE(o + 92),
      ofsSt: buf.readInt32LE(o + 96),
      ofsXyzNormals: buf.readInt32LE(o + 100),
      ofsEnd: buf.readInt32LE(o + 104),
    }

    surface.shader = surface.numShaders > 0 ? readString(buf, o + surface.ofsShaders, 64) : ""

    surface.indices = new Uint16Array(surface.numTriangles * 3)
    for (let t = 0; t < surface.numTriangles; t++) {
      const to = o + surface.ofsTriangles + t * 12
      // Reversed winding: the Z-up to Y-up conversion below mirrors one axis,
      // which flips every face. Swapping two indices flips them back.
      surface.indices[t * 3 + 0] = buf.readInt32LE(to)
      surface.indices[t * 3 + 1] = buf.readInt32LE(to + 8)
      surface.indices[t * 3 + 2] = buf.readInt32LE(to + 4)
    }

    surface.positions = new Float32Array(surface.numVerts * 3)
    surface.normals = new Float32Array(surface.numVerts * 3)
    for (let v = 0; v < surface.numVerts; v++) {
      // Only frame 0: these are static props.
      const vo = o + surface.ofsXyzNormals + v * 8
      const x = buf.readInt16LE(vo) * XYZ_SCALE
      const y = buf.readInt16LE(vo + 2) * XYZ_SCALE
      const z = buf.readInt16LE(vo + 4) * XYZ_SCALE
      const [gx, gy, gz] = quakeToGltf(x, y, z)
      surface.positions[v * 3 + 0] = gx
      surface.positions[v * 3 + 1] = gy
      surface.positions[v * 3 + 2] = gz

      // Normals are packed into 16 bits as a lat/lng pair on the unit sphere.
      const packed = buf.readUInt16LE(vo + 6)
      const lat = (((packed >> 8) & 0xff) * 2 * Math.PI) / 256
      const lng = ((packed & 0xff) * 2 * Math.PI) / 256
      const [nx, ny, nz] = quakeToGltf(
        Math.cos(lat) * Math.sin(lng),
        Math.sin(lat) * Math.sin(lng),
        Math.cos(lng)
      )
      surface.normals[v * 3 + 0] = nx
      surface.normals[v * 3 + 1] = ny
      surface.normals[v * 3 + 2] = nz
    }

    surface.uvs = new Float32Array(surface.numVerts * 2)
    for (let v = 0; v < surface.numVerts; v++) {
      const so = o + surface.ofsSt + v * 8
      surface.uvs[v * 2 + 0] = buf.readFloatLE(so)
      surface.uvs[v * 2 + 1] = buf.readFloatLE(so + 4)
    }

    model.surfaces.push(surface)
    o += surface.ofsEnd
  }

  return model
}

// ---------------------------------------------------------------------------
// Ghoul2 (.glm) parsing — static models only
// ---------------------------------------------------------------------------

/**
 * Reads LOD0 of a Ghoul2 `.glm` into the same shape as parseMd3.
 *
 * Only for models with no real skeleton — `animName` of `*default` and a single
 * bone, which is what JK2 uses for the WORN weapon models. Every vertex is then
 * rigidly bound to that one bone, so its stored position is already the final
 * position and no skinning is needed. Animated player `.glm`s carry per-vertex
 * weights against a separate `.gla` and still need the Blender route; this
 * refuses them rather than silently emitting a bind-pose puddle.
 *
 * Worth having because the worn weapon models exist ONLY as `.glm`. The MD3s in
 * the same folder are the first-person view model, the pickup, and LOD variants
 * — see docs/jk2-model-conversion.md §7.5.
 */
/** Origin and [forward, left, up] basis encoded by a 3-vertex `*` tag surface. */
function tagFrame(v0, v1, v2) {
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
  const cross = (a, b) => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ]
  const norm = (a) => {
    const l = Math.hypot(a[0], a[1], a[2])
    return [a[0] / l, a[1] / l, a[2] / l]
  }
  const forward = norm(sub(v1, v0))
  // Squared up through the normal: v2 - v0 isn't perpendicular to the first edge.
  const up = norm(cross(forward, sub(v2, v0)))
  const left = cross(up, forward)
  return { origin: v0, forward, left, up }
}

/** Expresses a point in the tag's frame: R^T (p - origin), Quake axes throughout. */
function intoFrame(frame, p, isDirection) {
  const d = isDirection ? p : [p[0] - frame.origin[0], p[1] - frame.origin[1], p[2] - frame.origin[2]]
  const dot = (a) => a[0] * d[0] + a[1] * d[1] + a[2] * d[2]
  return [dot(frame.forward), dot(frame.left), dot(frame.up)]
}

function parseGlm(buf, mountTag) {
  const ident = buf.toString("latin1", 0, 4)
  const version = buf.readInt32LE(4)
  if (ident !== GLM_IDENT) throw new Error(`Not a Ghoul2 model (ident "${ident}")`)
  if (version !== GLM_VERSION) throw new Error(`Unsupported .glm version ${version}, expected ${GLM_VERSION}`)

  const animName = readString(buf, 72, 64)
  const numBones = buf.readInt32LE(140)
  if (numBones > 1 || (animName && animName !== "*default")) {
    throw new Error(
      `${animName || "this model"} is a skinned Ghoul2 model (${numBones} bones) — ` +
        "it needs the Blender route in docs/jk2-model-conversion.md, not this converter",
    )
  }

  const ofsLODs = buf.readInt32LE(148)
  const numSurfaces = buf.readInt32LE(152)
  const ofsSurfHierarchy = buf.readInt32LE(156)

  // The hierarchy carries the names and shaders. Each entry ends in a
  // variable-length child list, so it has to be walked rather than indexed.
  const meta = []
  let p = ofsSurfHierarchy
  for (let i = 0; i < numSurfaces; i++) {
    meta.push({ name: readString(buf, p, 64), shader: readString(buf, p + 68, 64) })
    p += 144 + 4 * buf.readInt32LE(p + 140)
  }

  const model = { name: readString(buf, 8, 64), numFrames: 1, numTags: 0, tags: [], surfaces: [] }

  // LOD 0 is the full-detail mesh. Its surface offsets are relative to the start
  // of the offset table, which sits just past the LOD's own ofsEnd.
  const table = ofsLODs + 4
  const surfaceAt = (i) => table + buf.readInt32LE(table + 4 * i)
  const vertexAt = (s, k) => {
    const o = s + buf.readInt32LE(s + 16) + k * GLM_VERTEX_SIZE
    return [buf.readFloatLE(o + 12), buf.readFloatLE(o + 16), buf.readFloatLE(o + 20)]
  }

  // Resolve the mount tag first — the geometry pass needs it.
  //
  // Ghoul2 does NOT attach a weapon by its origin: it hangs the weapon model off
  // the player by aligning the weapon's own `*weapon` tag with the hand bolt. On
  // laser_trap_w.glm that tag's up points along -Z and its forward is rotated
  // ~136°, so ignoring it puts the mine in the fist backwards. It went unnoticed
  // on the saber because saber_w's tag_parent is at the origin with identity
  // axes, so origin-mounting happened to be right and proved nothing.
  let mount = null
  if (mountTag) {
    const want = mountTag.startsWith("*") ? mountTag : `*${mountTag}`
    const i = meta.findIndex((m) => m.name === want)
    if (i === -1) {
      const tags = meta.filter((m) => m.name.startsWith("*")).map((m) => m.name)
      throw new Error(`no ${want} tag in this model (has: ${tags.join(", ") || "none"})`)
    }
    const s = surfaceAt(i)
    mount = tagFrame(vertexAt(s, 0), vertexAt(s, 1), vertexAt(s, 2))
    console.log(`  mounting on ${want} (origin ${mount.origin.map((n) => n.toFixed(2)).join(", ")})`)
  }

  for (let i = 0; i < numSurfaces; i++) {
    const s = surfaceAt(i)
    const { name, shader } = meta[i]

    // `*`-prefixed surfaces are bolt tags: three vertices encoding a transform,
    // not geometry. glm-bolts.mjs is what reads those; drawn here they'd be
    // stray triangles floating in the model.
    if (name.startsWith("*")) continue

    const numVerts = buf.readInt32LE(s + 12)
    const ofsVerts = buf.readInt32LE(s + 16)
    const numTriangles = buf.readInt32LE(s + 20)
    const ofsTriangles = buf.readInt32LE(s + 24)

    const surface = { name, shader, numVerts, numTriangles }

    surface.indices = new Uint16Array(numTriangles * 3)
    for (let t = 0; t < numTriangles; t++) {
      const to = s + ofsTriangles + t * 12
      // Same reversed winding as the MD3 path, for the same reason: the axis
      // conversion mirrors one axis and flips every face.
      surface.indices[t * 3 + 0] = buf.readInt32LE(to)
      surface.indices[t * 3 + 1] = buf.readInt32LE(to + 8)
      surface.indices[t * 3 + 2] = buf.readInt32LE(to + 4)
    }

    surface.positions = new Float32Array(numVerts * 3)
    surface.normals = new Float32Array(numVerts * 3)
    for (let v = 0; v < numVerts; v++) {
      // mdxmVertex_t is 32 bytes and the NORMAL comes first, then the position.
      // Reading them the intuitive way round is the classic way to get a model
      // that looks vaguely right and is subtly inside out.
      const vo = s + ofsVerts + v * GLM_VERTEX_SIZE

      // Into the mount's frame FIRST, while still in Quake axes, then convert.
      // Doing it the other way round would need the basis converted too, for
      // the same answer and more chances to get a sign wrong.
      let normal = [buf.readFloatLE(vo), buf.readFloatLE(vo + 4), buf.readFloatLE(vo + 8)]
      let position = [buf.readFloatLE(vo + 12), buf.readFloatLE(vo + 16), buf.readFloatLE(vo + 20)]
      if (mount) {
        normal = intoFrame(mount, normal, true)
        position = intoFrame(mount, position, false)
      }

      const [nx, ny, nz] = quakeToGltf(normal[0], normal[1], normal[2])
      surface.normals[v * 3 + 0] = nx
      surface.normals[v * 3 + 1] = ny
      surface.normals[v * 3 + 2] = nz

      const [gx, gy, gz] = quakeToGltf(position[0], position[1], position[2])
      surface.positions[v * 3 + 0] = gx
      surface.positions[v * 3 + 1] = gy
      surface.positions[v * 3 + 2] = gz
    }

    // Texture coordinates are a separate array sitting immediately after the
    // vertices, rather than interleaved with them as MD3 does it.
    const ofsUvs = ofsVerts + numVerts * GLM_VERTEX_SIZE
    surface.uvs = new Float32Array(numVerts * 2)
    for (let v = 0; v < numVerts; v++) {
      const uo = s + ofsUvs + v * 8
      surface.uvs[v * 2 + 0] = buf.readFloatLE(uo)
      surface.uvs[v * 2 + 1] = buf.readFloatLE(uo + 4)
    }

    model.surfaces.push(surface)
  }

  model.numSurfaces = model.surfaces.length
  return model
}

/**
 * Quake is Z-up with +X forward and +Y left; glTF is Y-up with -Z forward.
 * Mapping (x, y, z) to (x, z, -y) keeps the handedness and puts Quake's up axis
 * on glTF's, which is why a saber hilt comes out pointing along +Y.
 */
function quakeToGltf(x, y, z) {
  return [x, z, -y]
}

// ---------------------------------------------------------------------------
// glTF writing
// ---------------------------------------------------------------------------

function alignTo4(n) {
  return (n + 3) & ~3
}

function buildGlb(model, surfaceInfo) {
  const json = {
    asset: { version: "2.0", generator: "soracle md3-to-gltf" },
    scenes: [{ nodes: [] }],
    scene: 0,
    nodes: [],
    meshes: [],
    materials: [],
    accessors: [],
    bufferViews: [],
    buffers: [],
  }

  const chunks = []
  let byteOffset = 0

  const pushView = (data, target) => {
    const padded = Buffer.alloc(alignTo4(data.byteLength))
    Buffer.from(data.buffer, data.byteOffset, data.byteLength).copy(padded)
    chunks.push(padded)
    const view = { buffer: 0, byteOffset, byteLength: data.byteLength }
    if (target) view.target = target
    json.bufferViews.push(view)
    byteOffset += padded.byteLength
    return json.bufferViews.length - 1
  }

  const minMax = (arr, components) => {
    const min = new Array(components).fill(Infinity)
    const max = new Array(components).fill(-Infinity)
    for (let i = 0; i < arr.length; i += components) {
      for (let c = 0; c < components; c++) {
        min[c] = Math.min(min[c], arr[i + c])
        max[c] = Math.max(max[c], arr[i + c])
      }
    }
    return { min, max }
  }

  // One material per distinct shader. A single-texture model gets exactly one,
  // as before; a flag gets two, because its cloth and its pole are different
  // images and sharing a material would paint the pole with the banner.
  //
  // A shader with no ordinary texture can still need a material: the Nightmare
  // variants' black base layer is `rgbGen const` with no image at all, and
  // their glow outline layer has no base texture of its own either — its only
  // content is the additive layer baked as emissive. `pushImage` de-dupes by
  // path so a glow texture reused across shaders (or matching a shader's own
  // primary texture, not the case today but cheap to guard) isn't embedded
  // twice.
  const imageIndexByPath = new Map()
  const pushImage = (texture) => {
    const existing = imageIndexByPath.get(texture.path)
    if (existing !== undefined) return existing
    json.images = json.images ?? []
    json.samplers = json.samplers ?? [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
    json.textures = json.textures ?? []
    json.images.push({ bufferView: pushView(texture.data), mimeType: texture.mimeType })
    json.textures.push({ sampler: 0, source: json.images.length - 1 })
    const index = json.textures.length - 1
    imageIndexByPath.set(texture.path, index)
    return index
  }

  const materialByShader = new Map()
  for (const [shader, info] of surfaceInfo) {
    const { texture, additiveTexture, effects } = info
    const hasBase = Boolean(texture) || Boolean(effects.flatColor)
    if (!hasBase && !additiveTexture) continue // nothing to draw — matches the old "no material" fallback

    json.materials.push({
      name: texture ? basename(texture.path).replace(/\.[^.]+$/, "") : shader,
      pbrMetallicRoughness: {
        // flatColor wins over an incidentally-resolved texture, not the other
        // way round: `rgbGen const` on a real stage means JK2 ignores whatever
        // image that stage's `map` names (typically the literal $whiteimage,
        // but not always — a shader can be authored under the SAME name as a
        // real texture file purely to retarget an existing surface, which is
        // exactly how the flag's own "transparent"/"nightmare" variants are
        // built: a custom shader block keyed to the STOCK banner's own shader
        // name, so the pole — a different shader entirely — is untouched).
        ...(effects.flatColor
          ? { baseColorFactor: [...effects.flatColor, 1] }
          : texture
            ? { baseColorTexture: { index: pushImage(texture) } }
            // Additive-only surface (the glow outline layers): JK2 draws no
            // opaque base at all here, just the additive stage. glTF has no
            // "additive, no base" material, so an opaque black base plus the
            // emissive layer below approximates it — nothing shows except
            // wherever the glow does.
            : { baseColorFactor: [0, 0, 0, 1] }),
        // JK2 has no PBR: flat diffuse, so no specular sheen. Same reasoning as
        // the player-model viewer, which forces this at load time.
        metallicFactor: 0,
        roughnessFactor: 1,
      },
      ...(effects.translucent
        ? { alphaMode: "BLEND" }
        : effects.alphaCutout
          ? { alphaMode: "MASK", alphaCutoff: 0.5 }
          : {}),
      ...(additiveTexture
        ? {
            emissiveFactor: [1, 1, 1],
            emissiveTexture: { index: pushImage(additiveTexture) },
            // A static bake of what JK2 animates (tcMod turb/scroll/rotate,
            // rgbGen wave) — one frame of the glow, not the real motion. See
            // jk2-shaders.mjs's `additiveMap` doc comment.
            extensions: { KHR_materials_emissive_strength: { emissiveStrength: EMISSIVE_STRENGTH } },
          }
        : {}),
    })
    materialByShader.set(shader, json.materials.length - 1)
  }

  if (json.materials.some((m) => m.extensions?.KHR_materials_emissive_strength)) {
    json.extensionsUsed = ["KHR_materials_emissive_strength"]
  }

  for (const surface of model.surfaces) {
    const posView = pushView(surface.positions, 34962)
    const normView = pushView(surface.normals, 34962)
    const uvView = pushView(surface.uvs, 34962)
    const idxView = pushView(surface.indices, 34963)

    const posBounds = minMax(surface.positions, 3)
    const base = json.accessors.length
    json.accessors.push(
      {
        bufferView: posView,
        componentType: 5126,
        count: surface.numVerts,
        type: "VEC3",
        min: posBounds.min,
        max: posBounds.max,
      },
      { bufferView: normView, componentType: 5126, count: surface.numVerts, type: "VEC3" },
      { bufferView: uvView, componentType: 5126, count: surface.numVerts, type: "VEC2" },
      { bufferView: idxView, componentType: 5123, count: surface.indices.length, type: "SCALAR" }
    )

    const primitive = {
      attributes: { POSITION: base, NORMAL: base + 1, TEXCOORD_0: base + 2 },
      indices: base + 3,
    }
    const material = materialByShader.get(surface.shader)
    if (material !== undefined) primitive.material = material

    json.meshes.push({ name: surface.name || "surface", primitives: [primitive] })
    json.nodes.push({ name: surface.name || "surface", mesh: json.meshes.length - 1 })
    json.scenes[0].nodes.push(json.nodes.length - 1)
  }

  // Tags become empty nodes. tag_flash is the blade origin — the whole reason
  // to keep them.
  for (const tag of model.tags) {
    const [x, y, z] = quakeToGltf(...tag.origin)
    json.nodes.push({ name: tag.name, translation: [x, y, z] })
    json.scenes[0].nodes.push(json.nodes.length - 1)
  }

  const binary = Buffer.concat(chunks)
  json.buffers.push({ byteLength: binary.byteLength })

  const jsonBuf = Buffer.from(JSON.stringify(json), "utf8")
  const jsonPadded = Buffer.alloc(alignTo4(jsonBuf.byteLength), 0x20)
  jsonBuf.copy(jsonPadded)
  const binPadded = Buffer.alloc(alignTo4(binary.byteLength))
  binary.copy(binPadded)

  const header = Buffer.alloc(12)
  header.write("glTF", 0, "latin1")
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonPadded.length, 0)
  jsonHeader.write("JSON", 4, "latin1")

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binPadded.length, 0)
  binHeader.write("BIN\0", 4, "latin1")

  return Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded])
}

// ---------------------------------------------------------------------------

function resolveTexture(md3Path, shaderName, override, assetsRoot) {
  const candidates = []
  if (override) {
    candidates.push(override)
  } else if (shaderName) {
    // JK2's shader strings are full paths relative to the assets root, and
    // routinely name a .tga that actually shipped as a .jpg. A model's textures
    // are often nowhere near it — the CTF flags live in models/flags/ but point
    // at models/map_objects/mp/ — so resolve against the root when we have one,
    // and fall back to the sibling directory for a single-model extraction.
    const stem = shaderName.replace(/\.[^./]+$/, "")
    const roots = []
    if (assetsRoot) roots.push(resolve(assetsRoot, stem))
    roots.push(resolve(dirname(md3Path), basename(stem)))
    for (const base of roots) {
      for (const ext of [".jpg", ".tga", ".png", ".jpeg"]) candidates.push(base + ext)
    }
  }

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue
    const ext = extname(candidate).toLowerCase()
    if (ext === ".tga") {
      console.warn(`  ! ${basename(candidate)} is TGA, which glTF can't embed — convert it to PNG/JPG first`)
      continue
    }
    return {
      data: readFileSync(candidate),
      mimeType: ext === ".png" ? "image/png" : "image/jpeg",
      path: candidate,
    }
  }
  return null
}

function main() {
  // Flags take a value; --exclude may be repeated.
  const args = process.argv.slice(2)
  const positional = []
  let override = null
  let assetsRoot = null
  let mountTag = null
  const excluded = new Set()
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--texture") override = args[++i]
    else if (args[i] === "--exclude") excluded.add(args[++i])
    else if (args[i] === "--assets") assetsRoot = args[++i]
    else if (args[i] === "--mount") mountTag = args[++i]
    else positional.push(args[i])
  }
  const [input, output] = positional

  if (!input || !output) {
    console.error(
      "usage: node scripts/md3-to-gltf.mjs <input.md3|.glm> <output.glb> [--assets root] [--texture path] [--exclude surface]... [--mount tag]",
    )
    process.exit(1)
  }

  // Dispatch on the magic rather than the extension: same pipeline either way
  // once the surfaces are read, and a mislabelled file should fail loudly.
  const buf = readFileSync(input)
  const magic = buf.toString("latin1", 0, 4)
  const model = magic === GLM_IDENT ? parseGlm(buf, mountTag) : parseMd3(buf)
  console.log(`${model.name}  [${magic === GLM_IDENT ? "Ghoul2" : "MD3"}]`)
  console.log(`  frames ${model.numFrames}  tags ${model.numTags}  surfaces ${model.numSurfaces}`)

  // JK2 bundles pieces we don't want into some models — laser_trap.md3 carries a
  // gloved hand, which on a player who already has hands is one hand too many.
  if (excluded.size > 0) {
    const before = model.surfaces.length
    model.surfaces = model.surfaces.filter((s) => !excluded.has(s.name))
    console.log(`  excluded ${before - model.surfaces.length} surface(s): ${[...excluded].join(", ")}`)
  }

  let tris = 0
  let verts = 0
  for (const s of model.surfaces) {
    console.log(`  surface "${s.name}" — ${s.numVerts} verts, ${s.numTriangles} tris, shader "${s.shader}"`)
    tris += s.numTriangles
    verts += s.numVerts
  }
  for (const t of model.tags) {
    console.log(`  tag "${t.name}" at [${t.origin.map((v) => v.toFixed(2)).join(", ")}]`)
  }

  // Resolved per distinct shader, so a model whose surfaces use different images
  // keeps them. --texture overrides everything, for the single-texture case.
  //
  // Shader scripts are the exception, not the rule: none of the base-game
  // models converted before the Nightmare variants shipped a custom one, so
  // for them `shaderScripts` stays empty and `effects` is all-false — nothing
  // downstream changes. See jk2-shaders.mjs.
  const shaderScripts = assetsRoot ? readShaderScripts([assetsRoot]) : new Map()
  const surfaceInfo = new Map()
  for (const surface of model.surfaces) {
    if (surfaceInfo.has(surface.shader)) continue

    const stem = surface.shader.replace(/\.[^./]+$/, "").toLowerCase()
    const block = shaderScripts.get(stem)
    const effects = block
      ? analyseShader(block)
      : {
          alphaCutout: false,
          translucent: false,
          reflective: false,
          additive: false,
          glow: null,
          additiveMap: null,
          flatColor: null,
        }

    const texture = resolveTexture(input, surface.shader, override, assetsRoot)
    if (texture) {
      console.log(`  texture ${basename(texture.path)} (${(texture.data.length / 1024).toFixed(1)} KB)`)
    } else if (!effects.flatColor) {
      console.warn(`  ! no texture for "${surface.name}" (shader "${surface.shader}")`)
    }

    let additiveTexture = null
    if (effects.additiveMap) {
      additiveTexture = resolveTexture(input, effects.additiveMap, null, assetsRoot)
      if (!additiveTexture) {
        console.warn(
          `  ! no glow image for "${surface.name}" (shader "${effects.additiveMap}") — glow will be skipped`,
        )
      } else {
        console.log(`  glow texture ${basename(additiveTexture.path)} (${(additiveTexture.data.length / 1024).toFixed(1)} KB)`)
      }
    }

    surfaceInfo.set(surface.shader, { texture, additiveTexture, effects })
  }
  if ([...surfaceInfo.values()].every((info) => !info.texture && !info.effects.flatColor && !info.additiveTexture)) {
    console.warn("  ! no textures found — writing an untextured mesh")
  }

  const glb = buildGlb(model, surfaceInfo)
  writeFileSync(output, glb)
  console.log(`\n→ ${output}  ${(glb.length / 1024).toFixed(1)} KB, ${verts} verts, ${tris} tris`)
}

main()
