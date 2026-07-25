#!/usr/bin/env node
/**
 * Merges the animations from several .glb exports into one file.
 *
 * Getting several JK2 animations into a single .glb from Blender means importing
 * each frame range onto the same armature and stashing each one as its own
 * Action before importing the next — every import writes keyframes at frames
 * 0..N-1 into the *active* Action, so a second import lands on top of the first
 * unless you stash. That's fiddly, easy to get wrong, and gives no feedback
 * until you're staring at the exported file.
 *
 * This is the other way round: export one animation per .glb, which is the thing
 * Blender does without any ceremony, then merge them here. Same result, and a
 * mistake costs one re-export rather than a whole session.
 *
 * Channels are retargeted to the base file's nodes BY NAME, so the exports don't
 * have to agree on node ordering — Blender's doesn't between runs. Anything
 * targeting a node the base file hasn't got is dropped with a warning rather
 * than silently producing a file that animates nothing.
 *
 * Clip names drive the viewer: the one matching /idle/ becomes the loop, and
 * everything else becomes a one-shot for the action button. Names come from each
 * file's own animation, or from `--name` when it's the usual unhelpful
 * `skeleton_rootAction`.
 *
 * Usage:
 *   node scripts/glb-merge-anims.mjs base.glb --name idle \
 *     extra.glb --name gesture \
 *     --out public/models/kyle.glb
 *
 * Run this BEFORE glm-bolts.mjs — that one wants a fresh export, and this
 * produces one.
 */

import { readFileSync, writeFileSync } from "node:fs"
import { basename } from "node:path"

const JSON_CHUNK = 0x4e4f534a
const BIN_CHUNK = 0x004e4942

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

  const json = chunks.find((c) => c.type === JSON_CHUNK)
  const bin = chunks.find((c) => c.type === BIN_CHUNK)
  if (!json) throw new Error(`${path}: no JSON chunk`)
  if (!bin) throw new Error(`${path}: no binary chunk`)
  return { json: JSON.parse(json.data.toString("utf8")), bin: bin.data }
}

function writeGlb(path, json, bin) {
  const encoded = Buffer.from(JSON.stringify(json), "utf8")
  // Chunks must be 4-byte aligned: spaces in the JSON chunk, zeroes in the binary one.
  const jsonPadded = Buffer.concat([encoded, Buffer.alloc((4 - (encoded.length % 4)) % 4, 0x20)])
  const binPadded = Buffer.concat([bin, Buffer.alloc((4 - (bin.length % 4)) % 4, 0)])

  const header = Buffer.alloc(12)
  header.write("glTF", 0, "ascii")
  header.writeUInt32LE(2, 4)
  header.writeUInt32LE(12 + 8 + jsonPadded.length + 8 + binPadded.length, 8)

  const jsonHeader = Buffer.alloc(8)
  jsonHeader.writeUInt32LE(jsonPadded.length, 0)
  jsonHeader.writeUInt32LE(JSON_CHUNK, 4)

  const binHeader = Buffer.alloc(8)
  binHeader.writeUInt32LE(binPadded.length, 0)
  binHeader.writeUInt32LE(BIN_CHUNK, 4)

  const out = Buffer.concat([header, jsonHeader, jsonPadded, binHeader, binPadded])
  writeFileSync(path, out)
  return out.length
}

/** The bytes an accessor actually reads, de-interleaved into a tight block. */
function accessorBytes(json, bin, index) {
  const accessor = json.accessors[index]
  const COMPONENT_SIZE = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }
  const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 }

  const size = COMPONENT_SIZE[accessor.componentType] * COMPONENTS[accessor.type]
  const view = json.bufferViews[accessor.bufferView]
  const start = (view.byteOffset || 0) + (accessor.byteOffset || 0)

  // Animation data is normally tightly packed, but honour a stride if present
  // rather than assuming — a strided copy read as tight is silent corruption.
  const stride = view.byteStride || size
  if (stride === size) return Buffer.from(bin.subarray(start, start + accessor.count * size))

  const out = Buffer.alloc(accessor.count * size)
  for (let i = 0; i < accessor.count; i++) {
    bin.copy(out, i * size, start + i * stride, start + i * stride + size)
  }
  return out
}

function main() {
  const argv = process.argv.slice(2)
  const sources = []
  let out = null

  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--out") {
      out = argv[++i]
    } else if (argv[i] === "--name") {
      if (sources.length === 0) throw new Error("--name must follow a .glb")
      sources[sources.length - 1].name = argv[++i]
    } else {
      sources.push({ path: argv[i], name: null })
    }
  }

  if (sources.length < 2 || !out) {
    console.error("usage: glb-merge-anims.mjs base.glb [--name x] extra.glb [--name y] ... --out merged.glb")
    process.exit(1)
  }

  const base = readGlb(sources[0].path)
  const json = base.json
  const parts = [base.bin]
  let binLength = base.bin.length

  // Node lookup by name — the only stable identity across separate exports.
  const nodeByName = new Map()
  json.nodes.forEach((node, i) => {
    if (node.name) nodeByName.set(node.name, i)
  })

  json.animations = json.animations ?? []
  if (sources[0].name && json.animations[0]) json.animations[0].name = sources[0].name
  console.log(`base ${basename(sources[0].path)}: ${json.animations.map((a) => a.name).join(", ") || "no animations"}`)

  for (const source of sources.slice(1)) {
    const extra = readGlb(source.path)
    if (!extra.json.animations?.length) {
      console.log(`  ${basename(source.path)}: no animations, skipped`)
      continue
    }

    for (const animation of extra.json.animations) {
      // Copy each sampler's input/output into our buffer, building new
      // bufferViews and accessors as we go.
      const samplers = animation.samplers.map((sampler) => {
        const copy = {}
        for (const key of ["input", "output"]) {
          const src = extra.json.accessors[sampler[key]]
          const bytes = accessorBytes(extra.json, extra.bin, sampler[key])

          // Every bufferView must start 4-byte aligned.
          const pad = (4 - (binLength % 4)) % 4
          if (pad > 0) {
            parts.push(Buffer.alloc(pad, 0))
            binLength += pad
          }

          json.bufferViews.push({ buffer: 0, byteOffset: binLength, byteLength: bytes.length })
          parts.push(bytes)
          binLength += bytes.length

          json.accessors.push({
            bufferView: json.bufferViews.length - 1,
            componentType: src.componentType,
            count: src.count,
            type: src.type,
            // Keyframe times are range-queried by the sampler, so glTF requires
            // min/max on the input accessor.
            ...(src.min ? { min: src.min } : {}),
            ...(src.max ? { max: src.max } : {}),
          })
          copy[key] = json.accessors.length - 1
        }
        copy.interpolation = sampler.interpolation ?? "LINEAR"
        return copy
      })

      const channels = []
      const missing = new Set()
      for (const channel of animation.channels) {
        const name = extra.json.nodes[channel.target.node]?.name
        const target = name ? nodeByName.get(name) : undefined
        if (target === undefined) {
          if (name) missing.add(name)
          continue
        }
        channels.push({
          sampler: channel.sampler,
          target: { node: target, path: channel.target.path },
        })
      }

      const name = source.name ?? animation.name
      json.animations.push({ name, samplers, channels })
      console.log(
        `  + ${name.padEnd(20)} ${channels.length} channels from ${basename(source.path)}` +
          (missing.size > 0 ? `  (dropped ${missing.size} unknown nodes: ${[...missing].slice(0, 3).join(", ")}…)` : ""),
      )
    }
  }

  const merged = Buffer.concat(parts)
  json.buffers[0] = { byteLength: merged.length }

  const bytes = writeGlb(out, json, merged)
  console.log(`\n${json.animations.length} clips → ${out} (${(bytes / 1024).toFixed(1)} KB)`)

  const idle = json.animations.filter((a) => /idle/i.test(a.name))
  if (idle.length === 0) {
    console.log(`\nNote: no clip matches /idle/, so the viewer will loop "${json.animations[0].name}".`)
  } else if (idle.length > 1) {
    console.log(`\nNote: ${idle.length} clips match /idle/ — the viewer loops the first and one-shots the rest.`)
  }
}

main()
