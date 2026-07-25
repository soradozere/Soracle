#!/usr/bin/env node
/**
 * Bakes JK2's bolt points into a converted .glb.
 *
 * Ghoul2 doesn't attach a saber to a bone. It attaches it to a *bolt*: a
 * three-vertex "tag" surface in the .glm whose triangle defines an origin and an
 * orientation, skinned to the skeleton like any other geometry. `*r_hand` is the
 * one the saber hangs off; `*back` carries the flag; the `*hip_*` ring is where
 * holstered weapons and trip mines sit. There are ~46 of them on a stock player
 * model and they are the reason props line up in-game instead of floating near a
 * joint at a hand-tuned offset.
 *
 * Blender's glTF export drops them — a tag surface is a degenerate one-triangle
 * mesh with no material, so nothing survives the round trip. This script reads
 * them back out of the original .glm and writes them into the .glb as empty
 * nodes named `bolt_<tag>`, parented to the bone that drives them. The viewer
 * then attaches a prop by name and inherits the animated transform for free.
 *
 * Baking into the .glb rather than emitting a lookup table is deliberate: the
 * coordinates are Raven's, this repo is public, and the .glb is already served
 * from a private bucket. The bolt data travels with the asset it describes and
 * never lands in git.
 *
 * Usage:
 *   node scripts/glm-bolts.mjs <model.glm> <_humanoid.gla> <in.glb> --out <out.glb>
 *
 * See docs/jk2-model-conversion.md §7.
 */

import { readFileSync, writeFileSync } from "node:fs"

// ---------------------------------------------------------------------------
// Vector / matrix helpers. Matrices are column-major arrays of 16, matching
// both glTF's accessor layout and three's Matrix4.elements, so they can be
// passed between the two without transposing.
// ---------------------------------------------------------------------------

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const length = (a) => Math.hypot(a[0], a[1], a[2])

function normalize(a) {
  const l = length(a)
  if (l < 1e-9) throw new Error("cannot normalise a zero-length vector")
  return [a[0] / l, a[1] / l, a[2] / l]
}

function multiply(a, b) {
  const out = new Array(16)
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let sum = 0
      for (let k = 0; k < 4; k++) sum += a[k * 4 + r] * b[c * 4 + k]
      out[c * 4 + r] = sum
    }
  }
  return out
}

/** A rotation+translation matrix from three basis vectors and an origin. */
function fromBasis([x, y, z], origin) {
  // prettier-ignore
  return [
    x[0], x[1], x[2], 0,
    y[0], y[1], y[2], 0,
    z[0], z[1], z[2], 0,
    origin[0], origin[1], origin[2], 1,
  ]
}

/**
 * Splits a matrix into translation and rotation, discarding scale.
 *
 * The scale is thrown away on purpose. An inverse bind matrix carries whatever
 * scale the export baked in (10x, on the models we've converted), and a prop
 * that inherited it would come out the wrong size. The viewer normalises prop
 * scale against the bone at runtime, so only position and orientation need to
 * survive — and neither is affected by dropping a uniform scale.
 */
function decompose(m) {
  const scale = [
    length([m[0], m[1], m[2]]),
    length([m[4], m[5], m[6]]),
    length([m[8], m[9], m[10]]),
  ]
  const r = [
    m[0] / scale[0], m[1] / scale[0], m[2] / scale[0],
    m[4] / scale[1], m[5] / scale[1], m[6] / scale[1],
    m[8] / scale[2], m[9] / scale[2], m[10] / scale[2],
  ]
  // Standard matrix→quaternion, branching on the largest diagonal term to keep
  // the square root away from zero.
  const [m00, m01, m02, m10, m11, m12, m20, m21, m22] = r
  const trace = m00 + m11 + m22
  let q
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1)
    q = [(m12 - m21) * s, (m20 - m02) * s, (m01 - m10) * s, 0.25 / s]
  } else if (m00 > m11 && m00 > m22) {
    const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
    q = [0.25 * s, (m10 + m01) / s, (m20 + m02) / s, (m12 - m21) / s]
  } else if (m11 > m22) {
    const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
    q = [(m10 + m01) / s, 0.25 * s, (m21 + m12) / s, (m20 - m02) / s]
  } else {
    const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
    q = [(m20 + m02) / s, (m21 + m12) / s, 0.25 * s, (m01 - m10) / s]
  }
  const n = Math.hypot(...q)
  return { translation: [m[12], m[13], m[14]], rotation: q.map((v) => v / n) }
}

// ---------------------------------------------------------------------------
// Ghoul2 .glm — the model: surfaces, vertices, bone weights
// ---------------------------------------------------------------------------

/** Ghoul2 packs a vertex's weights and bone references into one 32-bit word. */
function unpackWeights(buf, vertOffset, boneRefs) {
  const packed = buf.readUInt32LE(vertOffset + 24)
  const count = (packed >>> 30) + 1
  const weights = []
  let assigned = 0
  for (let i = 0; i < count; i++) {
    // 5 bits per bone reference, low bits first.
    const ref = (packed >>> (5 * i)) & 31
    // 10-bit weights: 8 bits in the byte array, the top 2 packed above the
    // bone references. The last weight is whatever's left, so they sum to 1.
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

function readGlm(path) {
  const buf = readFileSync(path)
  const ident = buf.toString("ascii", 0, 4)
  const version = buf.readInt32LE(4)
  if (ident !== "2LGM") throw new Error(`${path}: not a Ghoul2 model (ident ${ident})`)
  if (version !== 6) throw new Error(`${path}: unsupported .glm version ${version}`)

  const numLODs = buf.readInt32LE(144)
  const ofsLODs = buf.readInt32LE(148)
  const numSurfaces = buf.readInt32LE(152)
  const ofsSurfHierarchy = buf.readInt32LE(156)

  // Surface hierarchy: fixed-size fields then a variable-length child list, so
  // it has to be walked rather than indexed.
  const names = []
  let p = ofsSurfHierarchy
  for (let i = 0; i < numSurfaces; i++) {
    names.push(buf.toString("ascii", p, p + 64).split("\0")[0])
    p += 144 + 4 * buf.readInt32LE(p + 140)
  }

  // LOD 0 is the full-detail mesh. Its surface offsets are relative to the
  // start of the offset table, which sits just past the LOD's own ofsEnd.
  const table = ofsLODs + 4
  const surfaces = []
  for (let i = 0; i < numSurfaces; i++) {
    const s = table + buf.readInt32LE(table + 4 * i)
    const numVerts = buf.readInt32LE(s + 12)
    const ofsVerts = buf.readInt32LE(s + 16)
    const numBoneRefs = buf.readInt32LE(s + 28)
    const ofsBoneRefs = buf.readInt32LE(s + 32)

    const boneRefs = []
    for (let k = 0; k < numBoneRefs; k++) boneRefs.push(buf.readInt32LE(s + ofsBoneRefs + 4 * k))

    const verts = []
    for (let k = 0; k < numVerts; k++) {
      const v = s + ofsVerts + 32 * k
      verts.push({
        // Vertex layout is normal, then position — not the other way round.
        co: [buf.readFloatLE(v + 12), buf.readFloatLE(v + 16), buf.readFloatLE(v + 20)],
        weights: unpackWeights(buf, v, boneRefs),
      })
    }
    surfaces.push({ name: names[i], verts })
  }

  return { numLODs, surfaces }
}

/** Bone names from the .gla, which is the only thing that knows what an index means. */
function readGlaBoneNames(path) {
  const buf = readFileSync(path)
  const ident = buf.toString("ascii", 0, 4)
  if (ident !== "2LGA") throw new Error(`${path}: not a Ghoul2 skeleton (ident ${ident})`)

  const numBones = buf.readInt32LE(84)
  // The offset table sits immediately after the 100-byte header, and its
  // entries are relative to the same point — not to the header's ofsSkel.
  const HEADER_SIZE = 100
  const names = []
  for (let i = 0; i < numBones; i++) {
    const off = HEADER_SIZE + buf.readInt32LE(HEADER_SIZE + 4 * i)
    names.push(buf.toString("ascii", off, off + 64).split("\0")[0])
  }
  return names
}

// ---------------------------------------------------------------------------
// glTF binary container
// ---------------------------------------------------------------------------

function readGlb(path) {
  const buf = readFileSync(path)
  if (buf.toString("ascii", 0, 4) !== "glTF") throw new Error(`${path}: not a .glb`)

  const chunks = []
  let p = 12
  while (p < buf.length) {
    const len = buf.readUInt32LE(p)
    const type = buf.readUInt32LE(p + 4)
    chunks.push({ type, data: buf.subarray(p + 8, p + 8 + len) })
    p += 8 + len
  }
  const jsonChunk = chunks.find((c) => c.type === 0x4e4f534a)
  if (!jsonChunk) throw new Error(`${path}: no JSON chunk`)
  return { json: JSON.parse(jsonChunk.data.toString("utf8")), chunks }
}

function writeGlb(path, json, chunks) {
  const encoded = Buffer.from(JSON.stringify(json), "utf8")
  // Every chunk must be 4-byte aligned. The spec asks for spaces in the JSON
  // chunk and zeroes in the binary one.
  const padded = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 0x20)])

  const parts = []
  let total = 12
  for (const chunk of chunks) {
    const data = chunk.type === 0x4e4f534a ? padded : chunk.data
    const header = Buffer.alloc(8)
    header.writeUInt32LE(data.length, 0)
    header.writeUInt32LE(chunk.type, 4)
    parts.push(header, data)
    total += 8 + data.length
  }

  const header = Buffer.alloc(12)
  header.write("glTF", 0, "ascii")
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(total, 8)
  writeFileSync(path, Buffer.concat([header, ...parts]))
  return total
}

function readMatrixAccessor(json, bin, index) {
  const accessor = json.accessors[index]
  if (accessor.type !== "MAT4" || accessor.componentType !== 5126) {
    throw new Error("inverse bind matrices must be float MAT4")
  }
  const view = json.bufferViews[accessor.bufferView]
  const stride = view.byteStride || 64
  const base = (view.byteOffset || 0) + (accessor.byteOffset || 0)

  const out = []
  for (let i = 0; i < accessor.count; i++) {
    const m = new Array(16)
    for (let k = 0; k < 16; k++) m[k] = bin.readFloatLE(base + i * stride + k * 4)
    out.push(m)
  }
  return out
}

// ---------------------------------------------------------------------------
// The conversion
// ---------------------------------------------------------------------------

/**
 * Quake is Z-up and X-forward; glTF is Y-up and Z-forward. Same handedness, so
 * this is a pure axis relabel with no mirroring — which matters, because a
 * mirrored basis would silently flip every bolt's roll.
 */
const quakeToGltf = ([x, y, z]) => [x, z, -y]

/**
 * Turns a tag triangle into an orientation.
 *
 * A tag encodes a full basis, the same way an MD3 tag does: the first edge is
 * *forward*, the triangle normal is *up*, and left follows from the two. A prop
 * is then aligned to that basis exactly as it sits in its own model space.
 *
 * The part that is easy to get wrong — and that I did get wrong — is which of
 * those three a blade runs along. It is **up**, the normal. The hilt MD3 is
 * modelled along Quake +Z with `tag_flash` at z=4.36, and Ghoul2 lines a
 * weapon's +Z up with the tag's up axis. Using the first edge instead puts the
 * blade along the forearm, which reads as "nearly right" from most angles and is
 * off by ninety degrees.
 *
 * Projecting the model's own vertices onto each candidate settles it outright:
 *
 *   axis            hand width   arm
 *   first edge         8.86      t ∈ [ 4.89, 14.97]  ← arm lies along it
 *   normal (up)        3.49      t ∈ [-1.71,  2.78]  ← arm crosses it
 *   third axis         5.06      t ∈ [-11.91, -1.79] ← arm lies along it
 *
 * Only the normal has the arm running *across* it, and only the normal meets the
 * hand at its narrow dimension — 3.49 units, with a 12.34-unit hilt crossing it
 * and standing proud at both ends. That is a fist round a hilt. The other two
 * are a blade lying along the arm.
 *
 * Sign: +up puts the emitter 2.5 units past the fingers and the pommel 6.4 below
 * them, which matches the game — a saber is gripped near the pommel with most of
 * the hilt above the fist.
 */
function boltBasis(v0, v1, v2) {
  const forward = normalize(sub(v1, v0))
  // Squared up through the normal because v2 - v0 is not perpendicular to the
  // first edge on most tags.
  const up = normalize(cross(forward, sub(v2, v0)))
  const left = cross(up, forward)

  // Columns map the prop's own axes onto the tag's. glTF Y is Quake Z, so the
  // prop's +Y (its blade) goes to up; glTF Z is -Quake Y, hence the negated
  // left. forward × up = -left, so the basis stays right-handed.
  return [forward, up, [-left[0], -left[1], -left[2]]]
}

function main() {
  const args = process.argv.slice(2)
  const outFlag = args.indexOf("--out")
  const out = outFlag === -1 ? null : args[outFlag + 1]
  const [glmPath, glaPath, glbPath] = args.filter(
    (_, i) => i !== outFlag && i !== outFlag + 1
  )

  if (!glmPath || !glaPath || !glbPath || !out) {
    console.error("usage: glm-bolts.mjs <model.glm> <skeleton.gla> <in.glb> --out <out.glb>")
    process.exit(1)
  }

  const glm = readGlm(glmPath)
  const boneNames = readGlaBoneNames(glaPath)
  const { json, chunks } = readGlb(glbPath)
  const bin = chunks.find((c) => c.type === 0x004e4942)?.data
  if (!bin) throw new Error(`${glbPath}: no binary chunk`)

  const skin = json.skins?.[0]
  if (!skin) throw new Error(`${glbPath}: no skin — is this a rigged model?`)
  const inverseBind = readMatrixAccessor(json, bin, skin.inverseBindMatrices)
  const jointByName = new Map(skin.joints.map((node, i) => [json.nodes[node].name, i]))

  // The .glm is in raw Quake units; the .glb is whatever scale the Blender
  // import used. Rather than hardcode that, derive it by comparing the two
  // bounding boxes — they describe the same vertices, so the ratio is exact.
  const glmBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (const surface of glm.surfaces) {
    for (const vert of surface.verts) {
      const p = quakeToGltf(vert.co)
      for (let i = 0; i < 3; i++) {
        glmBox.min[i] = Math.min(glmBox.min[i], p[i])
        glmBox.max[i] = Math.max(glmBox.max[i], p[i])
      }
    }
  }
  const glbBox = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity] }
  for (const mesh of json.meshes) {
    for (const prim of mesh.primitives) {
      const a = json.accessors[prim.attributes.POSITION]
      for (let i = 0; i < 3; i++) {
        glbBox.min[i] = Math.min(glbBox.min[i], a.min[i])
        glbBox.max[i] = Math.max(glbBox.max[i], a.max[i])
      }
    }
  }
  const ratios = [0, 1, 2].map((i) => (glbBox.max[i] - glbBox.min[i]) / (glmBox.max[i] - glmBox.min[i]))
  const scale = ratios[1]
  const spread = Math.max(...ratios) - Math.min(...ratios)
  if (spread > scale * 0.01) {
    throw new Error(
      `.glm and .glb disagree about axes — per-axis scales ${ratios.map((r) => r.toFixed(5)).join(", ")}. ` +
        `The .glb was probably exported from a different model, or with a non-uniform scale.`
    )
  }
  console.log(`scale: .glm → .glb is ${scale.toFixed(6)} (agrees across all three axes)`)

  // Anything already bolted gets replaced, so this is safe to re-run.
  const existing = new Set()
  json.nodes = json.nodes.filter((node) => {
    if (!node.name?.startsWith("bolt_")) return true
    existing.add(node.name)
    return false
  })
  if (existing.size > 0) {
    throw new Error(
      `${glbPath} already has ${existing.size} bolt nodes. Re-run against the original export instead — ` +
        `removing nodes would invalidate every index in the file.`
    )
  }

  const added = []
  const skipped = []

  for (const surface of glm.surfaces) {
    if (!surface.name.startsWith("*")) continue
    const tag = surface.name.slice(1)

    if (surface.verts.length !== 3) {
      skipped.push(`${tag} (${surface.verts.length} verts, expected 3)`)
      continue
    }

    // A tag is usually rigid to one bone. Where it isn't — the hip ring is
    // split evenly between pelvis and lower_lumbar — take the heaviest and
    // accept that the prop follows one of the two. At bind pose they coincide,
    // and the pair are always adjacent, so the drift under animation is small.
    const totals = new Map()
    for (const vert of surface.verts) {
      for (const { bone, weight } of vert.weights) {
        totals.set(bone, (totals.get(bone) ?? 0) + weight)
      }
    }
    const [boneIndex] = [...totals.entries()].sort((a, b) => b[1] - a[1])[0]
    const boneName = boneNames[boneIndex]
    const joint = jointByName.get(boneName)
    if (joint === undefined) {
      skipped.push(`${tag} (bone "${boneName}" is not in the .glb skin)`)
      continue
    }

    const [v0, v1, v2] = surface.verts.map((v) => quakeToGltf(v.co).map((c) => c * scale))
    const boltInModelSpace = fromBasis(boltBasis(v0, v1, v2), v0)

    // An inverse bind matrix maps mesh space into its bone's space, which is
    // exactly the frame a child node's transform is expressed in. So this puts
    // the bolt where it belongs relative to the bone, in any pose, with no
    // per-frame work at runtime.
    const { translation, rotation } = decompose(multiply(inverseBind[joint], boltInModelSpace))

    const index = json.nodes.length
    json.nodes.push({ name: `bolt_${tag}`, translation, rotation })
    const parent = json.nodes[skin.joints[joint]]
    parent.children = [...(parent.children ?? []), index]
    added.push({ tag, bone: boneName })
  }

  const bytes = writeGlb(out, json, chunks)

  console.log(`\nbolts: ${added.length}`)
  for (const { tag, bone } of added) console.log(`  ${tag.padEnd(18)} → ${bone}`)
  if (skipped.length > 0) {
    console.log(`\nskipped: ${skipped.length}`)
    for (const reason of skipped) console.log(`  ${reason}`)
  }
  console.log(`\nwrote ${out} (${(bytes / 1024).toFixed(1)} KB)`)
}

main()
