"use client"

// The rotating JK2 emblem in the masthead, with a lightsaber blade running
// behind it — the logo from the game's own main menu, rebuilt for the web.
//
// The source model is a map prop (models/map_objects/bespin/jk2logo.md3),
// converted to glTF. It is not just the ring+monogram: a long thin spindle
// runs above and below the emblem, ~15 units tall against the emblem's own
// ~7. Bucketing its verts by height showed the wide (ring-diameter) geometry
// sits in the bottom half, roughly z -7..0.5 in the source's units, so rather
// than auto-fitting the whole model we recentre on that band and pick a fixed
// camera distance that crops the spindle out of frame.
//
// Materials are the game's own, not approximations, converted from a local
// Jedi Outcast install:
//   logo-diffuse.jpg <- models/map_objects/bespin/jk2logo.jpg
//   logo-env.jpg     <- gfx/menus/jk2logo.jpg
//   saber-core.jpg   <- gfx/effects/sabers/blurcore.jpg
//   saber-glow.jpg   <- gfx/effects/sabers/blurglow.jpg
//
// The per-colour blade maps (blue_line/blue_glow2 and friends) were tried and
// abandoned: they are authored dark on purpose because the game multiplies
// them by a vertex colour (`rgbGen vertex`) — _glow2 peaks at 83/255 against
// the blur map's 255 — so reproducing them needs a gain pass, and the result
// was dimmer and muddier than tinting the neutral blur maps. The blur maps
// also tint exactly to any theme colour, which the pre-coloured ones cannot.
//
// All five files are Raven/Activision assets and this repo is public, so —
// same as the player models on profile pages — they aren't committed. They're
// in the private Supabase bucket (lib/masthead-assets.ts, uploaded by
// scripts/upload-model-assets.mjs) and resolved through /api/model-url, the
// same route and the same useAssetUrls hook the profile viewer uses for a
// dressed model's hilt and blade textures.

import { Suspense, useEffect, useRef, useState } from "react"
import { Canvas, useFrame } from "@react-three/fiber"
import { useGLTF, useTexture } from "@react-three/drei"
import {
  AdditiveBlending,
  ClampToEdgeWrapping,
  MirroredRepeatWrapping,
  Mesh,
  MeshBasicMaterial,
  MeshMatcapMaterial,
  SRGBColorSpace,
  type Group,
} from "three"
import { useAssetUrls } from "@/hooks/use-asset-urls"
import {
  MASTHEAD_ASSET_IDS,
  MASTHEAD_LOGO_DIFFUSE,
  MASTHEAD_LOGO_ENV,
  MASTHEAD_LOGO_MODEL,
  MASTHEAD_SABER_CORE,
  MASTHEAD_SABER_GLOW,
} from "@/lib/masthead-assets"

// Center of the ring+monogram band, in the model's own (already axis-remapped)
// units — see md3_to_glb.py's per-Z-slice vertex dump.
const RING_BAND_CENTER_Y = -3.25
const VERTICAL_NUDGE = 0.25

// Behind the emblem, not on its mid-plane. At z=0 the blade sat level with
// the model's own centre, so only geometry with z>0 occluded it — the emblem
// straddles z=0, so about half of it failed to occlude and the blade read as
// being in front. The model is only ~0.36 deep either side of centre, so
// -1.5 clears all of it while staying close enough that perspective barely
// shrinks the blade (14.2/15.7 ~ 0.9). The ring still sweeps +/-2.7 in z as
// it spins, so it correctly passes in front of the blade on its near half and
// behind it on its far half. Lives OUTSIDE the rotating group so it never
// orbits with the model.
const BEAM_Z = -1.5
// Camera sees ~8.2 world units of height (2 * 14.2 * tan(fov/2)), so this runs
// far off frame at both ends — the blade never shows a cap.
const BEAM_HEIGHT = 30
// Drawn the way the game draws a blade: soft-edged textures on flat quads,
// blended additively, rather than solid cylinders — the cylinders are what
// made it read as a hard bar instead of a glow. No billboarding needed: the
// camera never moves, so a plane in XY already faces it head on.
//
// Three layers, not two: the blade sits behind the emblem, whose central
// column swallows the middle of it, so the wide low-opacity halo is what
// actually reads as glow. Two tight layers alone looked like a line.
const HALO_WIDTH = 3.4
const GLOW_WIDTH = 1.5
const CORE_WIDTH = 0.45

// Held well down. These maps are flat at maximum across most of their width
// (measured: the glow map is at full brightness for ~75% of it, with a sharp
// falloff only at the very edge), so at full strength they read as a solid
// bright bar rather than a glow — and that bar out-competes the emblem, worst
// of all when the ring turns edge-on and has little surface left to hold. The
// thin core still runs at full: it is what keeps the blade looking like a
// blade once these two are pulled back.
const HALO_OPACITY = 0.22
const GLOW_OPACITY = 0.6
// The emblem's diffuse is a genuinely dark flat grey (~0.4 luminance) and in
// game it is lit; unlit here it loses the foreground to a bright additive
// blade. Multiplies the map, so it needs toneMapped off to exceed 1.
const EMBLEM_GAIN = 1.45

// Tracks --color-primary live (a MutationObserver, not just a read-on-mount)
// so the blade follows the site's ThemeSelector without a page reload.
function useThemePrimaryColor() {
  const [color, setColor] = useState("#00fff2")

  useEffect(() => {
    const root = document.documentElement
    const read = () => {
      const value = getComputedStyle(root).getPropertyValue("--color-primary").trim()
      if (value) setColor(value)
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ["style"] })
    return () => observer.disconnect()
  }, [])

  return color
}

function SaberBeam({ coreUrl, glowUrl }: { coreUrl: string; glowUrl: string }) {
  const color = useThemePrimaryColor()
  const [coreMap, glowMap] = useTexture([coreUrl, glowUrl])
  const blade = useRef<Group>(null)

  // There is no saber animation in the assets to borrow — no animMap anywhere
  // references sabers, and the .roq videos are all cutscenes. The blade is a
  // static shader; what makes one look alive in game is code, which jitters
  // the blade width a few percent every frame. Reproduced here rather than
  // faked, and deliberately small: past ~8% it reads as a strobe.
  useFrame(() => {
    if (blade.current) blade.current.scale.x = 1 + (Math.random() - 0.5) * 0.06
  })

  // These are HALF-blade profiles, not full ones. Sampling the middle rows
  // shows brightness pinned at max on the left edge and falling to zero by the
  // right — x=0 is the blade's centre line and +x runs outward. Quake3 mirrors
  // them about the blade axis; mapped straight onto a 0..1 quad you get half a
  // blade shoved to one side, which is exactly the off-centre look.
  //
  // So drive u from -1 at the left edge to +1 at the right (repeat 2, offset
  // -1) and let MirroredRepeat fold the negative half back — the centre line
  // lands dead centre and both sides fall off identically. wrapT stays clamped
  // so stretching the quad to BEAM_HEIGHT never tiles the soft end-caps in.
  useEffect(() => {
    for (const map of [coreMap, glowMap]) {
      map.wrapS = MirroredRepeatWrapping
      map.wrapT = ClampToEdgeWrapping
      map.repeat.set(2, 1)
      map.offset.set(-1, 0)
      map.needsUpdate = true
    }
  }, [coreMap, glowMap])

  return (
    <group ref={blade} position={[0, 0, BEAM_Z]}>
      {/* Wide, faint outer halo — this is what actually reads as glow once the
          emblem covers the blade's middle. */}
      <mesh>
        <planeGeometry args={[HALO_WIDTH, BEAM_HEIGHT]} />
        <meshBasicMaterial
          map={glowMap}
          color={color}
          transparent
          opacity={HALO_OPACITY}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* Tighter, brighter body of the blade. */}
      <mesh position={[0, 0, 0.005]}>
        <planeGeometry args={[GLOW_WIDTH, BEAM_HEIGHT]} />
        <meshBasicMaterial
          map={glowMap}
          color={color}
          transparent
          opacity={GLOW_OPACITY}
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
      {/* White-hot core, a touch in front so it always reads over the halo. */}
      <mesh position={[0, 0, 0.01]}>
        <planeGeometry args={[CORE_WIDTH, BEAM_HEIGHT]} />
        <meshBasicMaterial
          map={coreMap}
          transparent
          blending={AdditiveBlending}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>
    </group>
  )
}

function SpinningLogo({
  modelUrl,
  diffuseUrl,
  envUrl,
}: {
  modelUrl: string
  diffuseUrl: string
  envUrl: string
}) {
  const { scene } = useGLTF(modelUrl)
  const [diffuseMap, envMap] = useTexture([diffuseUrl, envUrl])
  const group = useRef<Group>(null)

  // Reproduces the model's actual two-stage shader (rw_models.shader) rather
  // than approximating it with PBR chrome:
  //   stage 1  map jk2logo            + rgbGen identityLighting  -> unlit grey
  //   stage 2  map gfx/menus/jk2logo  + blendFunc GL_ONE GL_ONE
  //                                   + tcGen environment        -> additive
  // `tcGen environment` is sphere mapping, which is exactly what a matcap is,
  // so stage 2 becomes an additive MeshMatcapMaterial drawn over a duplicate
  // of each mesh. That blue-violet sphere map is what gives the emblem its
  // sheen — the flat diffuse alone is genuinely just grey.
  useEffect(() => {
    for (const map of [diffuseMap, envMap]) {
      map.colorSpace = SRGBColorSpace
      map.needsUpdate = true
    }

    const baseMaterial = new MeshBasicMaterial({ map: diffuseMap, toneMapped: false })
    baseMaterial.color.setScalar(EMBLEM_GAIN)
    const envMaterial = new MeshMatcapMaterial({
      matcap: envMap,
      blending: AdditiveBlending,
      depthWrite: false,
      transparent: true,
    })

    const originals: { mesh: Mesh; material: Mesh["material"] }[] = []
    const overlays: Mesh[] = []

    scene.traverse((child) => {
      const mesh = child as Mesh
      if (!mesh.isMesh) return
      originals.push({ mesh, material: mesh.material })
      mesh.material = baseMaterial
      // Child of the mesh, so it inherits its transform exactly and needs no
      // matrix copying of its own.
      overlays.push(new Mesh(mesh.geometry, envMaterial))
    })

    originals.forEach(({ mesh }, i) => mesh.add(overlays[i]))

    return () => {
      originals.forEach(({ mesh, material }, i) => {
        mesh.remove(overlays[i])
        mesh.material = material
      })
      baseMaterial.dispose()
      envMaterial.dispose()
    }
  }, [scene, diffuseMap, envMap])

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.7
  })

  return (
    <group ref={group} position={[0, -RING_BAND_CENTER_Y - VERTICAL_NUDGE, 0]}>
      <primitive object={scene} />
    </group>
  )
}

export function MastheadLogo3D() {
  // One batch: model + diffuse + env + 2 blade textures, one signed-URL round
  // trip. All-or-nothing, same as a dressed profile — there's no useful
  // partial render of a logo missing its blade textures. Renders nothing
  // until resolved rather than a placeholder: the bordered box around this
  // (site-header.tsx) already reads fine empty for the brief gap, and this
  // icon has no loading shell of its own the way the profile panel does.
  const { urls } = useAssetUrls(MASTHEAD_ASSET_IDS)
  if (!urls) return null

  return (
    <Canvas
      dpr={[1, 2]}
      // 14.2, not 11, because the canvas is the full 44px box rather than the
      // 34px it started as. Framing sets the model's on-screen size: at a
      // fixed distance, widening the canvas stretches the same world extent
      // over more pixels and scales the emblem up with it. Recompute as
      // d = (px / 5.39) / (2 * tan(fov/2)) if either changes.
      camera={{ position: [0, 0, 14.2], fov: 32 }}
      gl={{ antialias: true, alpha: true }}
      style={{ background: "transparent" }}
    >
      <Suspense fallback={null}>
        <SaberBeam coreUrl={urls[MASTHEAD_SABER_CORE]} glowUrl={urls[MASTHEAD_SABER_GLOW]} />
        <SpinningLogo
          modelUrl={urls[MASTHEAD_LOGO_MODEL]}
          diffuseUrl={urls[MASTHEAD_LOGO_DIFFUSE]}
          envUrl={urls[MASTHEAD_LOGO_ENV]}
        />
      </Suspense>
    </Canvas>
  )
}
