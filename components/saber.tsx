"use client"

import { useLayoutEffect, useMemo, useRef } from "react"
import { useFrame, useLoader } from "@react-three/fiber"
import { useGLTF } from "@react-three/drei"
import {
  AdditiveBlending,
  MeshStandardMaterial,
  TextureLoader,
  Vector3,
  type Group,
  type Mesh,
  type Object3D,
  type Texture,
} from "three"
import type { SaberColour } from "@/lib/saber-colours"
import { MD3_SCALE } from "@/components/md3-prop"

// Everything here is in NORMALISED model units — <Model> rescales every model so
// the figure stands TARGET_HEIGHT = 2 tall, so 1.0 is half a person. The parent
// counter-scales for the bone it hangs off, so these numbers mean the same thing
// whatever units the source model used. MD3_SCALE is shared with the other
// converted props so everything the model carries is sized by one rule.

/** Blade length in Quake units — JK2's is 40, scaled to match the hilt. */
const BLADE_LENGTH = 40 * MD3_SCALE
const BLADE_WIDTH = 3.6 * MD3_SCALE
/** The halo is drawn much wider than the core; that ratio is what reads as glow. */
const GLOW_WIDTH = BLADE_WIDTH * 3.4

/** Fallback blade origin if a hilt has no tag_flash. */
const FALLBACK_FLASH_Y = 4.36 * MD3_SCALE

/**
 * One face of the blade: a flat quad that spins about the blade axis to face the
 * camera.
 *
 * This is how the game does it and it matters. JK2 never builds blade geometry —
 * it draws camera-facing quads textured with gfx/effects/sabers/<colour>_line
 * and _glow2, which is why those files are a 64x256 strip and a 128x128 halo. An
 * extruded tube with an additive shell — which is what this component used to be
 * — reads as a neon rod instead, because a tube shades its silhouette and a
 * billboard doesn't.
 */
const BLADE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`

/**
 * Alpha comes from the texture's own brightness.
 *
 * The blade textures are JPEGs, so every pixel has alpha 1 — including the black
 * surround. Additive blending makes that black contribute nothing to COLOUR, but
 * it still writes ALPHA, which turns the quad's whole rectangle opaque against a
 * transparent canvas: a black slab around the blade. Taking alpha from luminance
 * makes the black genuinely absent instead of merely invisible.
 */
const BLADE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D map;
  uniform float intensity;
  varying vec2 vUv;
  void main() {
    vec3 texel = texture2D(map, vUv).rgb;
    float lum = max(max(texel.r, texel.g), texel.b);
    gl_FragColor = vec4(texel * intensity, lum);
  }
`

function BladeFace({
  texture,
  width,
  intensity,
  renderOrder,
}: {
  texture: Texture
  width: number
  intensity: number
  renderOrder: number
}) {
  const mesh = useRef<Mesh>(null)
  const cameraLocal = useMemo(() => new Vector3(), [])
  const uniforms = useMemo(
    () => ({ map: { value: texture }, intensity: { value: intensity } }),
    [texture, intensity]
  )

  useFrame((state) => {
    const quad = mesh.current
    if (!quad) return
    // Rotate about the blade's own axis (local Y) until the quad faces the
    // camera. A full lookAt would tip the blade over; only the spin is wanted.
    cameraLocal.copy(state.camera.position)
    quad.parent?.worldToLocal(cameraLocal)
    quad.rotation.y = Math.atan2(cameraLocal.x, cameraLocal.z)
  })

  return (
    <mesh ref={mesh} renderOrder={renderOrder}>
      <planeGeometry args={[width, BLADE_LENGTH]} />
      <shaderMaterial
        uniforms={uniforms}
        vertexShader={BLADE_VERTEX_SHADER}
        fragmentShader={BLADE_FRAGMENT_SHADER}
        transparent
        blending={AdditiveBlending}
        depthWrite={false}
      />
    </mesh>
  )
}

/**
 * The blade: a bright core inside a wide halo, both billboarded, plus a point
 * light.
 *
 * The light is what sells it — without colour spilling onto the model the blade
 * reads as a sticker laid over the render rather than a light source in the
 * scene. Deliberately short-range so it picks out the nearest arm and chest
 * instead of floodlighting the figure.
 */
function Blade({
  colour,
  originY,
  assets,
}: {
  colour: SaberColour
  originY: number
  assets: SaberAssets
}) {
  const [core, glow] = useLoader(TextureLoader, [assets.core, assets.glow])

  const blade = useRef<Group>(null)
  const ignition = useRef(0)

  // Extend from the emitter on mount rather than popping in whole. Cheap, and it
  // makes a profile feel switched-on as it loads.
  useFrame((_, delta) => {
    if (!blade.current || ignition.current >= 1) return
    ignition.current = Math.min(1, ignition.current + delta * 3.5)
    blade.current.scale.y = ignition.current
    blade.current.position.y = originY + (BLADE_LENGTH / 2) * ignition.current
  })

  return (
    <group ref={blade} position={[0, originY, 0]} scale={[1, 0, 1]}>
      <BladeFace texture={glow} width={GLOW_WIDTH} intensity={0.75} renderOrder={1} />
      <BladeFace texture={core} width={BLADE_WIDTH} intensity={1} renderOrder={2} />
      <pointLight color={colour.glow} intensity={2.2} distance={1.5} decay={2} />
    </group>
  )
}

/**
 * The converted JK2 hilt, with the blade rising from its tag_flash.
 *
 * tag_flash comes straight out of the MD3, so the blade starts exactly where the
 * game says it does rather than at a hand-tuned offset.
 */
function Hilt({ colour, assets }: { colour: SaberColour; assets: SaberAssets }) {
  const { scene } = useGLTF(assets.hilt)

  const model = useMemo(() => scene.clone(true), [scene])

  const flashY = useMemo(() => {
    const flash = model.getObjectByName("tag_flash")
    return flash ? flash.position.y * MD3_SCALE : FALLBACK_FLASH_Y
  }, [model])

  // The hilt is bare metal; JK2 has no specular, same as the player models.
  useLayoutEffect(() => {
    model.traverse((obj: Object3D) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return
      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of materials) {
        if (mat instanceof MeshStandardMaterial) {
          mat.roughness = 0.45
          mat.metalness = 0.8
          mat.needsUpdate = true
        }
      }
    })
  }, [model])

  return (
    <group>
      <primitive object={model} scale={MD3_SCALE} />
      <Blade colour={colour} originY={flashY} assets={assets} />
    </group>
  )
}

/**
 * Loadable URLs for the three files a saber is made of. Resolved by the caller
 * rather than built here: these are Raven assets served from a private bucket
 * behind short-lived signed URLs, so there is no stable path to hardcode.
 */
export type SaberAssets = {
  hilt: string
  core: string
  glow: string
}

/**
 * A lightsaber, built along +Y from the grip so it can be parented straight to
 * one of the model's bolt points.
 */
export function Saber({ colour, assets }: { colour: SaberColour; assets: SaberAssets }) {
  return <Hilt colour={colour} assets={assets} />
}
