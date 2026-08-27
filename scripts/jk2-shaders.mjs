/**
 * The Quake3 shader-script subset our converters understand.
 *
 * Shared between scripts/glm-graft.mjs (which bakes these effects into a
 * model's default materials) and scripts/glm-skins.mjs (which flags the same
 * effects on the skin variants that swap surfaces onto other shaders). One
 * definition on purpose: what a skin says about a shader has to agree with
 * what the graft would have said about the same shader, or the two halves of
 * the pipeline drift apart one regex at a time.
 */

import { readFileSync, existsSync, readdirSync } from "node:fs"
import { resolve, join } from "node:path"

/**
 * Every shader script under `<root>/shaders`, keyed by its lowercased name —
 * the same string a `.skin` line's shader path resolves to once its
 * extension is stripped. Quake3 shader scripts are `name { stage {...} stage
 * {...} }` blocks; brace-matched here rather than line-parsed because stages
 * nest one level inside the outer block.
 *
 * None of the base-game models converted before this shipped a custom shader
 * — their `.skin` shader values are plain image paths with no matching block
 * here — so for them this map stays empty and nothing downstream changes.
 */
export function readShaderScripts(assetsRoots) {
  const shaders = new Map()
  for (const root of assetsRoots) {
    const dir = resolve(root, "shaders")
    if (!existsSync(dir)) continue

    const files = []
    const walk = (d) => {
      for (const entry of readdirSync(d, { withFileTypes: true })) {
        const path = join(d, entry.name)
        if (entry.isDirectory()) walk(path)
        else if (entry.name.toLowerCase().endsWith(".shader")) files.push(path)
      }
    }
    walk(dir)

    for (const file of files) {
      const text = readFileSync(file, "utf8").replace(/\/\/.*$/gm, "")
      const blockStart = /([^\s{}]+)\s*\{/g
      let match
      while ((match = blockStart.exec(text))) {
        let depth = 1
        let j = blockStart.lastIndex
        while (j < text.length && depth > 0) {
          if (text[j] === "{") depth++
          else if (text[j] === "}") depth--
          j++
        }
        shaders.set(match[1].toLowerCase(), text.slice(blockStart.lastIndex, j - 1))
        blockStart.lastIndex = j
      }
    }
  }
  return shaders
}

/**
 * The subset of Quake3 shader-stage directives with a real glTF equivalent:
 * `alphaFunc` anywhere in the block (alpha-cutout), `blendFunc GL_ONE
 * GL_ONE_MINUS_SRC_ALPHA` (soft-edged translucency — Rodian's fins — a
 * different technique from cutout's hard on/off), an additive `tcGen
 * environment` stage (its own `map` becomes an emissive texture — see below
 * for which stages qualify), and `tcGen environment` generally (environment-
 * mapped shine — approximated, see lib/three-materials.ts). Everything else
 * in these blocks — tcMod scroll/turb, specular passes, `detail` — is real
 * per-frame or per-view behaviour glTF has no field for, and is silently
 * dropped the same as every other flattened-to-diffuse material on this
 * roster already drops JK2's lighting model.
 *
 * JK2's own `glow` keyword routes a stage through a separate bloom render
 * pass, which we have no equivalent for anyway — so rather than requiring it
 * literally, any ADDITIVE `tcGen environment` stage (`blendFunc GL_ONE
 * GL_ONE` or `GL_SRC_ALPHA GL_ONE`) is treated as emissive, with one
 * exception: `rgbGen entity` ties a stage's colour to the renderer's
 * per-entity/team colour, Quake3's idiom for a chrome-style world reflection
 * (Bones' chrome2 overlay) rather than a self-lit effect, so that one stays
 * shine-only. Andromeda's face/l_hand/head/torso(red|blue)/legs(red|blue)
 * stages are the motivating case: none of them carry the literal `glow`
 * keyword (only mouth_eyes does) but all read, in game, as the same
 * colourful energy shimmer — confirmed against a real gameplay screenshot
 * Sora sent showing it strongly on the hand/arm.
 *
 * `additive` is different in kind from the rest: a block whose FIRST stage
 * already blends against the framebuffer never draws an opaque base at all,
 * so the whole surface is see-through wherever its texture is dark.
 * `blendFunc GL_ONE GL_ONE` there is Quake3's pure-energy idiom — Andromeda's
 * team skins point her entire right arm at a shader like this, and that
 * translucent glowing limb is the model's signature look. glTF can't say
 * "additive" in a material, so this flag travels to the viewer, which
 * rebuilds the surface as an additive emissive material at runtime
 * (components/model-skin.tsx).
 *
 * Two more fields, both added for the Nightmare mine/flag variants and both
 * likewise static approximations of something genuinely animated: `flatColor`
 * reads `rgbGen const (r g b)` — a surface with no real texture, just a flat
 * multiplied colour (their solid-black base layer) — into an `[r, g, b]`
 * triple a consumer can hand straight to `baseColorFactor`. `additiveMap` is
 * `glow`'s condition without the `tcGen environment` requirement: the
 * Nightmare outline shells are animated (`tcMod turb/scroll/rotate`, `rgbGen
 * wave`) rather than environment-mapped, but are still an additive glowing
 * layer in the same spirit, so a consumer can bake one frame of it as a static
 * emissive texture. Deliberately a NEW field rather than a broadening of
 * `glow` itself — `glow` keeps its exact original condition so every model
 * already converted against it is untouched; only code that reads
 * `additiveMap` opts into the wider match.
 */
export function analyseShader(block) {
  const stages = []
  let depth = 0
  let start = -1
  for (let i = 0; i < block.length; i++) {
    if (block[i] === "{") {
      if (depth === 0) start = i + 1
      depth++
    } else if (block[i] === "}") {
      depth--
      if (depth === 0 && start >= 0) stages.push(block.slice(start, i))
    }
  }

  const alphaCutout = /alphaFunc/i.test(block)
  // `blendFunc GL_ONE GL_ONE_MINUS_SRC_ALPHA` on a shader's own base stage is a
  // real soft-edged translucency (Rodian's fins), a different technique from
  // alpha-cutout's hard on/off — glTF's `alphaMode: "BLEND"` is the direct
  // equivalent, using the same texture's actual alpha channel.
  const translucent = /blendFunc\s+GL_ONE\s+GL_ONE_MINUS_SRC_ALPHA\b/i.test(block)
  const reflective = /tcGen\s+environment/i.test(block)
  const additive = stages.length > 0 && /blendFunc\s+GL_ONE\s+GL_ONE\b/i.test(stages[0])
  // A stage with no `map` at all, driven instead by `rgbGen const (r g b)` —
  // JK2's idiom for a flat-colour surface (`map $whiteimage` times a constant,
  // or no map keyword at all). The Nightmare item variants' black base layer is
  // the motivating case: no image exists to resolve, so without this the
  // surface would fall through to untextured white instead of matte black.
  const constMatch = /rgbGen\s+const\s*\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)/i.exec(block)
  const flatColor = constMatch ? constMatch.slice(1, 4).map(Number) : null
  let glow = null
  // Same additive-stage scan as `glow` below, but WITHOUT requiring `tcGen
  // environment` — a plain scrolling/turbulent additive layer (JK2's Nightmare
  // outline shells: `tcMod turb/scroll/rotate` + `rgbGen wave`, no environment
  // mapping at all) still reads as a glow in game, just an animated one glTF
  // has no field for. This is a SEPARATE field from `glow`, not a broadening of
  // it: `glow`'s tcGen-environment requirement stays exactly as before, so
  // every model already converted with it is unaffected. Only a NEW consumer
  // that reads `additiveMap` instead sees the wider match, and picks a single
  // static frame of the animation as an approximation, same "cheap but honest"
  // trade-off as `reflective`'s fixed shine.
  let additiveMap = null
  for (const stage of stages) {
    if (/rgbGen\s+entity/i.test(stage)) continue
    const stageAdditive =
      /blendFunc\s+GL_ONE\s+GL_ONE\b/i.test(stage) || /blendFunc\s+GL_SRC_ALPHA\s+GL_ONE\b/i.test(stage)
    if (!stageAdditive) continue
    const mapMatch = /(?:^|\n)\s*map\s+(\S+)/i.exec(stage)
    if (!mapMatch) continue
    additiveMap = mapMatch[1]
    if (/tcGen\s+environment/i.test(stage)) glow = mapMatch[1]
  }
  return { alphaCutout, translucent, reflective, additive, glow, additiveMap, flatColor }
}
