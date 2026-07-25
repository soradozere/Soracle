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
 *   node scripts/md3-to-gltf.mjs <input.md3> <output.glb> [--texture path]
 *
 * The texture is resolved from the surface's shader name, trying the extensions
 * JK2 actually ships (the shader usually says .tga while the file on disk is a
 * .jpg), or forced with --texture.
 *
 * Tags are preserved as empty nodes. That matters: `tag_flash` is where the
 * blade emerges, so the viewer can read the blade origin out of the model
 * instead of anyone guessing at an offset.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs"
import { dirname, resolve, basename, extname } from "node:path"

const MD3_IDENT = "IDP3"
const MD3_VERSION = 15
/** MD3 stores vertex positions as shorts in 1/64th units. */
const XYZ_SCALE = 1 / 64

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

function buildGlb(model, textures) {
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
  const materialByShader = new Map()
  if (textures.size > 0) {
    json.images = []
    json.samplers = [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }]
    json.textures = []
    for (const [shader, texture] of textures) {
      json.images.push({ bufferView: pushView(texture.data), mimeType: texture.mimeType })
      json.textures.push({ sampler: 0, source: json.images.length - 1 })
      json.materials.push({
        name: basename(texture.path).replace(/\.[^.]+$/, ""),
        pbrMetallicRoughness: {
          baseColorTexture: { index: json.textures.length - 1 },
          // JK2 has no PBR: flat diffuse, so no specular sheen. Same reasoning as
          // the player-model viewer, which forces this at load time.
          metallicFactor: 0,
          roughnessFactor: 1,
        },
      })
      materialByShader.set(shader, json.materials.length - 1)
    }
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
  const excluded = new Set()
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--texture") override = args[++i]
    else if (args[i] === "--exclude") excluded.add(args[++i])
    else if (args[i] === "--assets") assetsRoot = args[++i]
    else positional.push(args[i])
  }
  const [input, output] = positional

  if (!input || !output) {
    console.error(
      "usage: node scripts/md3-to-gltf.mjs <input.md3> <output.glb> [--assets root] [--texture path] [--exclude surface]...",
    )
    process.exit(1)
  }

  const model = parseMd3(readFileSync(input))
  console.log(`${model.name}`)
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
  const textures = new Map()
  for (const surface of model.surfaces) {
    if (textures.has(surface.shader)) continue
    const texture = resolveTexture(input, surface.shader, override, assetsRoot)
    if (!texture) {
      console.warn(`  ! no texture for "${surface.name}" (shader "${surface.shader}")`)
      continue
    }
    textures.set(surface.shader, texture)
    console.log(`  texture ${basename(texture.path)} (${(texture.data.length / 1024).toFixed(1)} KB)`)
  }
  if (textures.size === 0) console.warn("  ! no textures found — writing an untextured mesh")

  const glb = buildGlb(model, textures)
  writeFileSync(output, glb)
  console.log(`\n→ ${output}  ${(glb.length / 1024).toFixed(1)} KB, ${verts} verts, ${tris} tris`)
}

main()
