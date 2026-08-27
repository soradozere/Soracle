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
 * The engine's own numbers are quoted in full in docs/jk2-model-conversion.md
 * §7.6. Pitch, roll and the drop offset transcribe directly; yaw, the right
 * offset and the forward offset don't — see each constant's own comment for
 * why, and for how the value actually in use here was arrived at instead.
 */

/** Quake units the flag drops below the lumbar bone. */
const FLAG_DROP = -12
/**
 * ...and slides to the player's right, in the SAME rotating basis as forward
 * (see the position block in `useFrame` below). An earlier version applied
 * this along a fixed glTF axis instead, on the wrong assumption that the bone
 * always faces one canonical direction — that mismatch, not the number
 * itself, was what put the banner over one shoulder instead of centred on the
 * spine. The engine's own value is 8: Kyle's in-game model holds the pole
 * angled out past his sword arm, so the bolt needs a sideways nudge to clear
 * it. Our converted r_flag.glb has no such asymmetry baked into its pivot,
 * and once the basis was fixed, -6 is what centres it — confirmed on both
 * Kyle and Luke, front and back.
 */
const FLAG_RIGHT = -6
/**
 * ...and finally along its own forward axis, once oriented. The engine's own
 * value is 24; ours is 17. The offset is measured against `r_flag.md3`'s own
 * pivot, and our converted `r_flag.glb`'s pivot sits further from the pole's
 * base, so the full 24 units left a visible gap between the banner and the
 * player's back that the game itself doesn't have — but overcorrecting to 12
 * drove the banner into the model instead. Tuned by eye, not re-derived;
 * confirmed on both Kyle and Luke, front and back.
 */
const FLAG_FORWARD = 17

const FLAG_PITCH = -30
/**
 * Yaw is taken from the lumbar bone's +X axis, then turned by this.
 *
 * The engine's number is 270 and ours is 180, because the two aren't
 * measuring from the same place: `CG_PlayerFlag` reads `POSITIVE_X` off a
 * Ghoul2 bone matrix, and we read it off the same bone as Blender exported
 * it, where armatures run along local +Y. Everything else in this file
 * transcribes cleanly because it's expressed in the player's frame; this is
 * the only term where the bone's own axes leak in.
 *
 * NOT derived — the axis-convention algebra that used to live here solved two
 * unmeasured unknowns at once (the bone's own rest yaw, and which axis
 * `flag-red.glb` calls "forward") and landed on 0, which put the banner in
 * front of the player's face, pole crossing the saber. Settled instead by
 * testing all four cardinal turns (see `FLAG_YAWS` in
 * components/model-lab.tsx) against the model directly: 180 is the one that
 * puts the banner on the back.
 */
export const FLAG_YAW_OFFSET = 180
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
  opacity = 1,
  yawOffset = FLAG_YAW_OFFSET,
}: {
  bone: Object3D
  src: string
  scale: number
  opacity?: number
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
    // converted prop does. Drop is world-up, which is unambiguous. Right and
    // forward both come from the SAME yaw-derived basis — computed BEFORE the
    // roll is added, which is the order the engine does it in and does change
    // the answer — so they rotate together with wherever the bone actually is
    // this frame. (An earlier version applied FLAG_RIGHT along a fixed glTF
    // axis on the assumption the bone always faces one canonical direction;
    // it doesn't, and that mismatch is what made the flag sit off-centre.)
    const preRoll = angleVectors(FLAG_PITCH, yaw, 0)
    toGltf(scratch.forward, preRoll.forward)
    toGltf(scratch.right, preRoll.right)

    group.position.copy(scratch.position)
    group.position.y += FLAG_DROP * MD3_SCALE
    group.position.addScaledVector(scratch.right, FLAG_RIGHT * MD3_SCALE)
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
      <Md3Prop src={src} scale={scale} doubleSided opacity={opacity} />
    </group>
  )
}
