"use client"

import { useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { AdditiveBlending, type Group } from "three"
import type { SaberColour } from "@/lib/saber-colours"

// Everything here is in NORMALISED model units — <Model> rescales every model so
// the figure stands TARGET_HEIGHT = 2 tall, so 1.0 is half a person. The parent
// counter-scales for the bone it hangs off, so these numbers mean the same thing
// whatever units the model was exported in.
const HILT_LENGTH = 0.17
const HILT_RADIUS = 0.021
const BLADE_LENGTH = 0.92
const BLADE_RADIUS = 0.016
/** The halo, wide enough to read as light rather than a fatter blade. */
const GLOW_RADIUS = BLADE_RADIUS * 3.2
const OUTER_GLOW_RADIUS = BLADE_RADIUS * 6

const BLADE_CENTER = HILT_LENGTH / 2 + BLADE_LENGTH / 2

/**
 * A lightsaber, drawn along +Y from the origin so it can be parented straight to
 * a hand bone and rotated into place by the caller.
 *
 * The blade is three nested capsules — a near-white core, a saturated halo and a
 * wide soft bloom — all unlit and additively blended. That stack is standing in
 * for real bloom: a postprocessing pass would look better but costs a
 * full-screen render on every profile page, which is a poor trade against the
 * viewer's current 41 draw calls. Revisit with numbers if this looks cheap.
 *
 * The point light is what actually sells it. Without light spilling onto the
 * model the blade reads as a sticker laid over the render, not a light source in
 * the scene.
 */
export function Saber({ colour, scale = 1 }: { colour: SaberColour; scale?: number }) {
  const blade = useRef<Group>(null)

  // Ignite on mount: the blade extends from the emitter rather than popping in
  // whole. Cheap, and it makes the model feel switched-on when a profile loads.
  const ignition = useRef(0)
  useFrame((_, delta) => {
    if (!blade.current || ignition.current >= 1) return
    ignition.current = Math.min(1, ignition.current + delta * 3)
    blade.current.scale.y = ignition.current
    // Grow from the emitter, not from the middle of the blade.
    blade.current.position.y = BLADE_CENTER * ignition.current
  })

  return (
    <group scale={scale}>
      {/* Hilt: a plain dark cylinder with a brighter emitter collar. Stands in
          until the converted JK2 hilt lands; at profile size it reads fine. */}
      <mesh position={[0, 0, 0]}>
        <cylinderGeometry args={[HILT_RADIUS, HILT_RADIUS * 0.92, HILT_LENGTH, 12]} />
        <meshStandardMaterial color="#2b2f36" roughness={0.55} metalness={0.7} />
      </mesh>
      <mesh position={[0, HILT_LENGTH / 2, 0]}>
        <cylinderGeometry args={[HILT_RADIUS * 0.85, HILT_RADIUS * 0.85, HILT_LENGTH * 0.13, 12]} />
        <meshStandardMaterial color="#8d949c" roughness={0.35} metalness={0.9} />
      </mesh>

      <group ref={blade} position={[0, 0, 0]} scale={[1, 0, 1]}>
        {/* Core. toneMapped={false} keeps it blown-out white instead of being
            dragged back into range by the renderer's tone mapping. */}
        <mesh>
          <capsuleGeometry args={[BLADE_RADIUS, BLADE_LENGTH, 4, 12]} />
          <meshBasicMaterial color={colour.core} toneMapped={false} />
        </mesh>
        <mesh>
          <capsuleGeometry args={[GLOW_RADIUS, BLADE_LENGTH, 4, 12]} />
          <meshBasicMaterial
            color={colour.glow}
            toneMapped={false}
            transparent
            opacity={0.45}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        <mesh>
          <capsuleGeometry args={[OUTER_GLOW_RADIUS, BLADE_LENGTH * 0.98, 4, 12]} />
          <meshBasicMaterial
            color={colour.glow}
            toneMapped={false}
            transparent
            opacity={0.16}
            blending={AdditiveBlending}
            depthWrite={false}
          />
        </mesh>

        {/* Distance is deliberately short: the blade should pick out the arm and
            chest nearest it, not floodlight the whole figure. */}
        <pointLight color={colour.glow} intensity={1.8} distance={1.4} decay={2} />
      </group>
    </group>
  )
}
