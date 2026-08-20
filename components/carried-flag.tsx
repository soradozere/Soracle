"use client"

import { useMemo, useRef } from "react"
import { useFrame } from "@react-three/fiber"
import { Matrix4, Vector3, type Group, type Object3D } from "three"
import { MD3_SCALE, Md3Prop } from "@/components/md3-prop"

/**
 * The CTF flag on a player's back, placed the way the game places it.
 *
 * Every other prop in this viewer hangs off a Ghoul2 bolt and inherits its
 * position AND orientation for free. The flag is the exception, and it cost two
 * rounds of guessing to find out why: it isn't attached to a bolt at all.
 * `CG_PlayerFlag` in JK2's multiplayer cgame takes the position of the
 * `lower_lumbar` BONE, then builds the orientation out of the player's own
 * angles plus fixed offsets, ignoring the bone's rotation entirely. No amount
 * of picking between the model's 46 tag bolts could ever have matched it.
 *
 * The constants below are that function, transcribed. Source quoted in full in
 * docs/jk2-model-conversion.md §7.6.
 */

/** Quake units the flag drops below the lumbar bone. */
const FLAG_DROP = -12
/** ...and slides to the player's right. */
const FLAG_RIGHT = 8
/** ...and finally along its own forward axis, once oriented. */
const FLAG_FORWARD = 24

const FLAG_PITCH = -30
/**
 * Yaw is taken from the lumbar bone's +X axis, then turned by this.
 *
 * The engine's number is 270 and ours is 0, because the two aren't measuring
 * from the same place: `CG_PlayerFlag` reads `POSITIVE_X` off a Ghoul2 bone
 * matrix, and we read it off the same bone as Blender exported it, where
 * armatures run along local +Y. Everything else in this file transcribes
 * cleanly because it's expressed in the player's frame; this is the only term
 * where the bone's own axes leak in.
 *
 * DERIVED, not guessed, after two rounds of guessing wasted Sora's time. The
 * banner's mean normal is the prop's local +X (measured off flag-red.glb),
 * which this basis maps to the flag's forward. Forward in glTF is
 * (cos·cos(yaw), sin, -cos·sin(yaw)) at pitch -30, so pointing it out of the
 * player's back — +Z, since the model faces -Z — needs a total yaw of 270°.
 * The lumbar bone measures -93.1°, so the offset is 270 - (-93.1) = 363 ≈ 0.
 */
export const FLAG_YAW_OFFSET = 0
const FLAG_ROLL = 20

/** The bone the game measures from. A bone, not a `*` tag surface. */
export const FLAG_BONE = "lower_lumbar"

const DEG = Math.PI / 180

/**
 * Quake's `AngleVectors`, returning a Quake-space basis.
 *
 * Transcribed rather than reimplemented, because the sign conventions here are
 * not the obvious ones — Quake's "right" is negated relative to what the name
 * suggests, which is exactly why `AnglesToAxis` stores `-right` as its second
 * axis and calls it left.
 */
function angleVectors(pitch: number, yaw: number, roll: number) {
  const sy = Math.sin(yaw * DEG)
  const cy = Math.cos(yaw * DEG)
  const sp = Math.sin(pitch * DEG)
  const cp = Math.cos(pitch * DEG)
  const sr = Math.sin(roll * DEG)
  const cr = Math.cos(roll * DEG)

  return {
    forward: [cp * cy, cp * sy, -sp],
    right: [-sr * sp * cy + cr * sy, -sr * sp * sy - cr * cy, -sr * cp],
    up: [cr * sp * cy + sr * sy, cr * sp * sy - sr * cy, cr * cp],
  }
}

/** Quake (x, y, z) is glTF (x, z, -y) — the same mapping the converters use. */
function toGltf(out: Vector3, v: number[]) {
  return out.set(v[0], v[2], -v[1])
}

export function CarriedFlag({
  bone,
  src,
  scale,
  yawOffset = FLAG_YAW_OFFSET,
}: {
  bone: Object3D
  src: string
  scale: number
  yawOffset?: number
}) {
  const mount = useRef<Group>(null)

  // Hoisted so the per-frame maths allocates nothing.
  const scratch = useMemo(
    () => ({
      position: new Vector3(),
      boneX: new Vector3(),
      forward: new Vector3(),
      up: new Vector3(),
      right: new Vector3(),
      basis: new Matrix4(),
    }),
    [],
  )

  useFrame(() => {
    const group = mount.current
    if (!group) return

    // Pull the bone's current pose rather than trusting the last render's
    // matrices: useAnimations' own useFrame subscribes ahead of this one, so
    // the mixer has already moved the skeleton by the time we get here.
    bone.updateWorldMatrix(true, false)
    scratch.position.setFromMatrixPosition(bone.matrixWorld)
    scratch.boneX.setFromMatrixColumn(bone.matrixWorld, 0).normalize()

    // The game reads the bolt matrix's +X and keeps only its yaw. glTF (x,y,z)
    // is Quake (x, -z, y), so Quake's yaw = atan2(-z, x) in our axes.
    const yaw = Math.atan2(-scratch.boneX.z, scratch.boneX.x) / DEG + yawOffset

    // Position. The offsets are in Quake units, so they scale the same way any
    // converted prop does. Dropping and sliding happen in the PLAYER's frame,
    // which in this viewer is unrotated: the model faces Quake +X, and Quake's
    // right (0,-1,0) is glTF +Z.
    group.position.copy(scratch.position)
    group.position.y += FLAG_DROP * MD3_SCALE
    group.position.z += FLAG_RIGHT * MD3_SCALE

    // Then 24 units along the flag's own forward — computed BEFORE the roll is
    // added, which is the order the engine does it in and does change the answer.
    toGltf(scratch.forward, angleVectors(FLAG_PITCH, yaw, 0).forward)
    group.position.addScaledVector(scratch.forward, FLAG_FORWARD * MD3_SCALE)

    // Orientation, now with the roll. Columns map the model's own axes onto the
    // entity's: glTF +X to forward, +Y to up (Quake's up), +Z to right.
    const axis = angleVectors(FLAG_PITCH, yaw, FLAG_ROLL)
    scratch.basis.makeBasis(
      toGltf(scratch.forward, axis.forward),
      toGltf(scratch.up, axis.up),
      toGltf(scratch.right, axis.right),
    )
    group.quaternion.setFromRotationMatrix(scratch.basis)
  })

  return (
    <group ref={mount}>
      <Md3Prop src={src} scale={scale} />
    </group>
  )
}
