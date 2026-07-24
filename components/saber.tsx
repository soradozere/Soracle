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

// Everything here is in NORMALISED model units — <Model> rescales every model so
// the figure stands TARGET_HEIGHT = 2 tall, so 1.0 is half a person. The parent
// counter-scales for the bone it hangs off, so these numbers mean the same thing
// whatever units the source model used.
const TARGET_HEIGHT = 2
/**
 * A JK2 player is 64 Quake units tall and MD3 props are in raw Quake units, so
 * this puts a converted hilt at the right size against a normalised figure.
 */
const QUAKE_UNITS_PER_PLAYER = 64
const MD3_SCALE = TARGET_HEIGHT / QUAKE_UNITS_PER_PLAYER

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
function BladeFace({
  texture,
  width,
  opacity,
  renderOrder,
}: {
  texture: Texture
  width: number
  opacity: number
  renderOrder: number
}) {
  const mesh = useRef<Mesh>(null)
  const cameraLocal = useMemo(() => new Vector3(), [])

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
      <meshBasicMaterial
        map={texture}
        transparent
        opacity={opacity}
        blending={AdditiveBlending}
        depthWrite={false}
        toneMapped={false}
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
function Blade({ colour, originY }: { colour: SaberColour; originY: number }) {
  const [core, glow] = useLoader(TextureLoader, [
    `/models/saber/${colour.id}_line.jpg`,
    `/models/saber/${colour.id}_glow.jpg`,
  ])

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
      <BladeFace texture={glow} width={GLOW_WIDTH} opacity={0.55} renderOrder={1} />
      <BladeFace texture={core} width={BLADE_WIDTH} opacity={1} renderOrder={2} />
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
function Hilt({ colour }: { colour: SaberColour }) {
  const { scene } = useGLTF("/models/saber-hilt.glb")

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
      <Blade colour={colour} originY={flashY} />
    </group>
  )
}

/**
 * A lightsaber, built along +Y from the grip so it can be parented straight to a
 * hand bone and rotated into place by the caller.
 */
export function Saber({ colour }: { colour: SaberColour }) {
  return <Hilt colour={colour} />
}

useGLTF.preload("/models/saber-hilt.glb")
