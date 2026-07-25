"use client"

import {
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react"
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber"
import { ContactShadows, OrbitControls, useAnimations, useGLTF } from "@react-three/drei"
import {
  Box3,
  LoopOnce,
  MathUtils,
  Matrix4,
  MeshStandardMaterial,
  Vector3,
  type AnimationAction,
  type Group,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from "three"
import { Saber } from "@/components/saber"
import { Md3Prop } from "@/components/md3-prop"
import { useAssetUrls } from "@/hooks/use-asset-urls"
import { findSaberColour } from "@/lib/saber-colours"
import { MINES_ASSET, SABER_HILT_ASSET, findFlagAsset, saberTextureAsset } from "@/lib/prop-assets"

/** Every model is rescaled to this height in world units, so one camera fits all. */
const TARGET_HEIGHT = 2

/** Vertical field of view, in degrees. */
const FOV = 40
/**
 * World height the camera takes in per unit of distance: 2·tan(fov/2). Three's
 * `fov` is the VERTICAL angle and horizontal is derived from the aspect ratio,
 * so a distance computed from this frames the same slice of the model no matter
 * what shape the canvas is.
 */
const HEIGHT_PER_UNIT = 2 * Math.tan(MathUtils.degToRad(FOV) / 2)

/** Zoomed out: the whole figure, with a hair of margin so the feet aren't clipped. */
const FAR_FRAME_HEIGHT = TARGET_HEIGHT * 1.04
/** Zoomed in: about a head and a half — a face close-up, not a bust. */
const NEAR_FRAME_HEIGHT = TARGET_HEIGHT * 0.2

// Zoom limits are the two framings above, converted to distances. Deriving them
// rather than picking numbers is what guarantees "fully zoomed out" means "the
// figure exactly fills the canvas" instead of "the figure plus some sky".
const MAX_DISTANCE = FAR_FRAME_HEIGHT / HEIGHT_PER_UNIT
const MIN_DISTANCE = NEAR_FRAME_HEIGHT / HEIGHT_PER_UNIT

// The orbit target RISES as you zoom in. With a fixed target you have to choose
// between framing the feet when zoomed out and leaving dead space above the head
// when zoomed in — you can't have both, because the target is always screen
// centre.
const FAR_TARGET_Y = TARGET_HEIGHT * 0.5
/** Only used when a model has no recognisable head bone. */
const FALLBACK_NEAR_TARGET_Y = TARGET_HEIGHT * 0.9

/** How far above the target the camera sits — just enough to avoid a dead-flat view. */
const CAMERA_RISE = TARGET_HEIGHT * 0.04

// Vertical orbit is locked to the camera's starting elevation: players get to
// spin the model and zoom, but can't tumble it upside down or stare at the soles
// of its feet. Free vertical orbit read as chaotic in testing.
const POLAR_ANGLE = Math.acos(CAMERA_RISE / MAX_DISTANCE)

// Hoisted so the object identity never changes — r3f re-applies Canvas props
// that look new, and re-seating the camera mid-zoom would fight OrbitControls.
const INITIAL_CAMERA = {
  position: [0, FAR_TARGET_Y + CAMERA_RISE, Math.sqrt(MAX_DISTANCE ** 2 - CAMERA_RISE ** 2)] as [
    number,
    number,
    number,
  ],
  fov: FOV,
}

/** Head and neck joints in JK2's _humanoid skeleton, best first. */
const HEAD_BONES = ["face", "cranium", "head"]
const NECK_BONES = ["cervical", "neck"]
/** Joints that sit on a humanoid's centre line, whatever it's doing with its limbs. */
const HIP_BONES = ["pelvis", "hips", "lower_lumbar"]

/**
 * Prefix on the attachment points baked into a converted model by
 * scripts/glm-bolts.mjs — `bolt_r_hand`, `bolt_back`, `bolt_hip_bl` and so on.
 */
const BOLT_PREFIX = "bolt_"
/**
 * JK2 bolts whatever the player is holding to `*r_hand`, not to the hand joint
 * itself. The saber and the trip mines both go here, which is precisely why a
 * model can't carry both: it's one slot in the geometry, not a rule we imposed.
 */
const HAND_BOLT = "r_hand"
/** The flag rides `*back`, the tag between the shoulder blades. */
const FLAG_BOLT = "back"

// Resolved on its own, so switching blade colour doesn't change the hilt's URL.
// Every resolve mints a fresh signed URL, and a new URL makes useGLTF treat the
// same file as a new asset: re-download, re-suspend, and the model gets refitted
// on the way back. Hoisted so the identity never changes.
const HILT_ONLY = [SABER_HILT_ASSET]
const MINES_ONLY = [MINES_ASSET]

// Client-only animated glTF viewer. Everything here runs in the browser — the
// page that renders it dynamic-imports with `ssr: false`, because WebGL has no
// server-side equivalent and r3f's reconciler would throw during prerender.
//
// Deliberately self-contained: no drei <Environment> preset, since those fetch
// HDRIs from a CDN at runtime. Plain lights keep the widget offline-safe and
// avoid a third-party request on a player's profile page.

export type ModelViewerProps = {
  /** URL of a .glb/.gltf, e.g. /models/fox.glb */
  src: string
  /** Looping clip to play. Falls back to a clip named *idle*, then the first one. */
  animation?: string
  /** Slowly spin the camera around the model. */
  autoRotate?: boolean
  /** Freeze the animation without unmounting the canvas. */
  paused?: boolean
  /** Allow drag-to-orbit / scroll-to-zoom. */
  interactive?: boolean
  /** Bump this to play a random one-shot clip, then settle back into the idle. */
  actionTrigger?: number
  /** Blade colour id from lib/saber-colours. Omit for an unarmed model. */
  saber?: string | null
  /**
   * Carry a handful of trip mines instead of a saber.
   *
   * Takes precedence over `saber`, because both hang off the same `*r_hand`
   * bolt and drawing them together puts a hilt through a mine. Two props rather
   * than one tagged union only because the profile still stores a bare colour
   * column; the loadout makes the invalid pair unrepresentable.
   */
  mines?: boolean
  /** CTF flag to carry on the back: "red", "blue", or nothing. */
  flag?: string | null
  /** Reports the model's available clip names once loaded. */
  onClipsLoaded?: (names: string[]) => void
  /** Reports measured frames-per-second, roughly once a second. */
  onFps?: (fps: number) => void
  className?: string
}

/**
 * How far the mesh overhangs the skeleton vertically — the scalp above the
 * cranium, the soles below the ankles — as a FRACTION of the skeleton's own
 * height.
 *
 * Dimensionless on purpose. A converted model can easily carry two scales that
 * disagree (ours has bone translations in raw Quake units and mesh vertices at a
 * tenth of that, reconciled by a 0.1 on the root), and any overhang stored in
 * absolute units is then only correct in whichever of the two spaces it was
 * measured in. A ratio is correct in both.
 */
type MeshOverhang = { top: number; bottom: number }

/**
 * Counts frames and reports FPS about once a second. Lives inside the Canvas so
 * it sees the real render loop rather than the React commit cycle.
 */
function FpsMeter({ onFps }: { onFps?: (fps: number) => void }) {
  const frames = useRef(0)
  const since = useRef(0)

  useFrame(() => {
    if (!onFps) return
    const now = performance.now()
    if (since.current === 0) since.current = now
    frames.current += 1
    const elapsed = now - since.current
    if (elapsed >= 1000) {
      onFps(Math.round((frames.current * 1000) / elapsed))
      frames.current = 0
      since.current = now
    }
  })

  return null
}

/** Every distinct bone driving the model, deduplicated across its surfaces. */
function collectBones(scene: Group): Object3D[] {
  const bones = new Set<Object3D>()
  scene.traverse((obj) => {
    const skinned = obj as SkinnedMesh
    if (!skinned.isSkinnedMesh) return
    for (const bone of skinned.skeleton.bones) bones.add(bone)
  })
  return [...bones]
}

/** World-space box enclosing the skeleton's joints, in whatever pose it's in. */
function skeletonBox(bones: Object3D[]): Box3 {
  const box = new Box3()
  const point = new Vector3()
  for (const bone of bones) box.expandByPoint(bone.getWorldPosition(point))
  return box
}

/**
 * World height of the first named joint that exists and sits in the upper half
 * of the normalised model — so a bone with an unexpected name can't send the
 * camera somewhere daft. Read after the fit, so the value is already in
 * TARGET_HEIGHT space.
 */
function boneY(scene: Group, names: string[]): number | null {
  for (const name of names) {
    const bone = scene.getObjectByName(name)
    if (!bone) continue
    const y = bone.getWorldPosition(new Vector3()).y
    if (y > TARGET_HEIGHT * 0.5 && y < TARGET_HEIGHT) return y
  }
  return null
}

/** First joint from `names` that exists, in the wrapper's current space. */
function findBone(scene: Group, names: string[]): Object3D | null {
  for (const name of names) {
    const bone = scene.getObjectByName(name)
    if (bone) return bone
  }
  return null
}

/**
 * The model's vertical centre line, taken from two joints that sit on it — head
 * and hips — rather than from the middle of the skeleton's bounding box, which
 * an outflung arm drags off to one side. This is the axis the camera orbits, so
 * an error here is invisible zoomed out and shoves the head out of frame in a
 * close-up.
 */
function bodyAxis(scene: Group): Vector3 | null {
  const joints = [findBone(scene, HEAD_BONES), findBone(scene, HIP_BONES)].filter(Boolean) as Object3D[]
  if (joints.length === 0) return null

  const axis = new Vector3()
  const point = new Vector3()
  for (const joint of joints) axis.add(joint.getWorldPosition(point))
  return axis.divideScalar(joints.length)
}

/** Puts the wrapper back into measuring space: no scale, no offset, matrices live. */
function resetForMeasurement(wrapper: Group) {
  wrapper.scale.setScalar(1)
  wrapper.position.set(0, 0, 0)
  wrapper.updateWorldMatrix(true, true)
}

/**
 * Measures how far the mesh reaches beyond the outermost joints, reading only
 * data that came out of the file and cannot change.
 *
 * Every scaling bug this viewer has had traces back to one thing: asking for the
 * bounds of a SkinnedMesh. `Box3.setFromObject` runs
 * `SkinnedMesh.computeBoundingBox()`, which poses each vertex through
 * `skeleton.boneMatrices` — an array three only fills during a render. Measured
 * outside a render it reports whatever the last draw left behind, and instrumenting
 * it showed the same model returning heights of 0.672, 0.246 and 0.401 on three
 * consecutive calls in a single page load while the skeleton underneath it never
 * moved. Priming the array by hand doesn't fix it, and neither does forcing the
 * bind pose first: `skeleton.pose()` rebuilds each root bone's local matrix from
 * its inverse bind matrix, which folds any ancestor transform (here, a 0.1 on the
 * root) into the bone itself and shrinks the whole rig tenfold.
 *
 * So neither input here is posed. Vertex bounds come from the geometry, which is
 * the glTF POSITION accessor's own min/max. Joint positions come from inverting
 * the inverse bind matrices. glTF guarantees those two share a coordinate space —
 * an inverse bind matrix is defined as mapping *that* mesh space into joint space
 * — so they are directly comparable, and both are fixed the moment the file loads.
 */
function measureOverhang(scene: Group): MeshOverhang {
  const mesh = new Box3()
  const joints = new Box3()
  const point = new Vector3()
  const matrix = new Matrix4()

  scene.traverse((obj) => {
    const skinned = obj as SkinnedMesh
    if (!skinned.isSkinnedMesh) return

    // GLTFLoader seeds this from the accessor's declared min/max. The fallback
    // is for models that arrive without it, and computes the same thing from the
    // raw position attribute — which is bind-pose data either way, never posed.
    const { geometry } = skinned
    if (!geometry.boundingBox) geometry.computeBoundingBox()
    if (geometry.boundingBox) mesh.union(geometry.boundingBox)

    for (const inverse of skinned.skeleton.boneInverses) {
      joints.expandByPoint(point.setFromMatrixPosition(matrix.copy(inverse).invert()))
    }
  })

  const height = joints.max.y - joints.min.y
  if (mesh.isEmpty() || joints.isEmpty() || height < 1e-6) return { top: 0, bottom: 0 }

  return {
    top: (mesh.max.y - joints.max.y) / height,
    bottom: (joints.min.y - mesh.min.y) / height,
  }
}

/** Every attachment point baked into the model, keyed by its JK2 tag name. */
function collectBolts(scene: Group): Map<string, Object3D> {
  const bolts = new Map<string, Object3D>()
  scene.traverse((obj) => {
    if (obj.name.startsWith(BOLT_PREFIX)) bolts.set(obj.name.slice(BOLT_PREFIX.length), obj)
  })
  return bolts
}

/**
 * Normalises the model into a predictable box — TARGET_HEIGHT tall, centred on
 * X/Z, feet resting on y=0 — and reports where its face ended up.
 *
 * Sized from the skeleton in its *animated* pose, not its bind pose. Kyle's idle
 * translates model_root by -24 units, so a bind-pose fit sinks him below the
 * floor and leaves a third of the canvas empty above his head. Applied
 * imperatively because it has to run against live world matrices.
 */
function fitModel(wrapper: Group, scene: Group, bones: Object3D[], overhang: MeshOverhang): number {
  resetForMeasurement(wrapper)

  const joints = skeletonBox(bones)
  // Scale the overhang back up against the skeleton we can actually see. The
  // ratio was taken at bind pose; applying it to the live joint box is what
  // makes it independent of the space the model happens to be measured in.
  const jointHeight = joints.max.y - joints.min.y
  const top = joints.max.y + overhang.top * jointHeight
  const bottom = joints.min.y - overhang.bottom * jointHeight
  const axis = bodyAxis(scene) ?? joints.getCenter(new Vector3())

  // Without this the camera framing would depend entirely on the exporter's
  // units — the Khronos Fox is ~100 units tall, JK2's models a different scale
  // again — so any fixed camera would be useless.
  const height = top - bottom
  const scale = height > 1e-6 ? TARGET_HEIGHT / height : 1
  wrapper.scale.setScalar(scale)
  wrapper.position.set(-axis.x * scale, -bottom * scale, -axis.z * scale)
  wrapper.updateWorldMatrix(false, true)

  // Aim the close-up at the real head rather than a guessed fraction of the
  // height: a ponytail, helmet or hood shifts the top of the model well above
  // the face. Range-checked so a bone with a surprising name can't send the
  // camera somewhere daft.
  // Frame the close-up on the head itself: neck joint up to the crown, which for
  // a standing figure is the top of the normalised box. Aiming straight at the
  // head joint isn't enough — on Kyle it sits at 1.76 against a crown at 2.0, so
  // a 0.4-tall frame centred there shaves the top of his head off.
  const headY = boneY(scene, HEAD_BONES)
  const neckY = boneY(scene, NECK_BONES)
  if (headY === null) return neckY ?? FALLBACK_NEAR_TARGET_Y

  const framed = neckY === null ? headY : (neckY + TARGET_HEIGHT) / 2
  // Keep the face near the middle of the shot even when something above the head
  // — a ponytail, a helmet spike — drags the top of the box up with it.
  return MathUtils.clamp(framed, headY, headY + NEAR_FRAME_HEIGHT * 0.35)
}

/**
 * Slides the orbit target up towards the face as the camera closes in, so
 * zooming in frames a portrait rather than pushing the head off the top of the
 * canvas. Reads the live distance each frame, so it tracks a scroll-wheel zoom
 * in progress rather than only settling at the end.
 */
function ZoomAwareTarget({ nearTargetY }: { nearTargetY: number }) {
  const controls = useThree((s) => s.controls) as { getDistance?: () => number; target?: Vector3 } | null
  const camera = useThree((s) => s.camera)

  // Seat the target once, by hand. Passing `target` to <OrbitControls> instead
  // would re-apply it on every React re-render — and since this component moves
  // the target every frame, any unrelated state change (a control being toggled,
  // say) would yank the framing back to mid-body in the middle of a zoom.
  useEffect(() => {
    controls?.target?.set(0, FAR_TARGET_Y, 0)
  }, [controls])

  useFrame(() => {
    if (!controls?.getDistance || !controls.target) return
    // 0 at closest, 1 at furthest.
    const t = MathUtils.clamp((controls.getDistance() - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE), 0, 1)
    const desiredY = MathUtils.lerp(nearTargetY, FAR_TARGET_Y, t)
    const delta = desiredY - controls.target.y
    if (Math.abs(delta) < 1e-4) return

    // Move the CAMERA by the same delta, not just the target. Shifting the
    // target alone changes the camera→target vector, and because the polar angle
    // is pinned, OrbitControls then swings the camera to re-satisfy the angle —
    // which feeds back into the distance and throws the model out of frame
    // entirely. Panning both keeps the spherical coordinates untouched.
    controls.target.y += delta
    camera.position.y += delta
  })

  return null
}

/**
 * Hangs a prop off one of the model's bolt points.
 *
 * This is how the game does it. Ghoul2 never attaches a saber to a joint — it
 * attaches it to a *bolt*, a three-vertex tag surface in the .glm carrying both a
 * position and an orientation, which is why weapons sit in the fist at the right
 * angle on every model without anyone tuning anything. Those tags don't survive
 * Blender's glTF export, so scripts/glm-bolts.mjs reads them back out of the
 * original .glm and bakes them into the .glb as nodes parented to the bone that
 * drives them. Portalling into one inherits its animated world transform for
 * free: no per-frame matrix work, and the prop tracks the idle by itself.
 *
 * Nothing renders if the model has no such bolt — an unconverted model, or the
 * Khronos sample in the lab — rather than falling back to a guessed joint.
 */
function Bolt({ point, children }: { point: Object3D | undefined; children: ReactNode }) {
  if (!point) return null
  return createPortal(<BoltMount>{children}</BoltMount>, point)
}

/**
 * Cancels the bolt's inherited scale, so props are authored in the same
 * normalised units as everything else — the figure is TARGET_HEIGHT tall and a
 * prop sized against that will be right on any model.
 *
 * Read live rather than captured at fit time. A bolt inherits its bone's world
 * scale, which is the export's scale multiplied by whatever the fit chose, so a
 * value cached during one fit is wrong after the next one.
 */
function BoltMount({ children }: { children: ReactNode }) {
  const mount = useRef<Group>(null)
  const boneScale = useMemo(() => new Vector3(), [])

  useFrame(() => {
    const group = mount.current
    if (!group?.parent) return
    group.parent.getWorldScale(boneScale)
    group.scale.setScalar(1 / (boneScale.x || 1))
  })

  return <group ref={mount}>{children}</group>
}

function Model({
  src,
  animation,
  paused,
  actionTrigger,
  saber,
  mines,
  flag,
  onClipsLoaded,
  onFit,
}: Pick<
  ModelViewerProps,
  "src" | "animation" | "paused" | "actionTrigger" | "saber" | "mines" | "flag" | "onClipsLoaded"
> & {
  onFit: (nearTargetY: number) => void
}) {
  const group = useRef<Group>(null)
  const fitGroup = useRef<Group>(null)
  const { scene, animations } = useGLTF(src)
  const { actions, names, mixer } = useAnimations(animations, group)

  // The clip everything returns to: an explicit request, else something that
  // calls itself an idle, else whatever came first in the file.
  const idleName = useMemo(() => {
    if (animation && names.includes(animation)) return animation
    return names.find((name) => /idle/i.test(name)) ?? names[0]
  }, [animation, names])

  useEffect(() => {
    onClipsLoaded?.(names)
  }, [names, onClipsLoaded])

  // Loop the idle. Stopping on cleanup keeps clips from stacking up on the
  // shared mixer when the model or the selected clip changes.
  useEffect(() => {
    const idle = idleName ? actions[idleName] : undefined
    if (!idle) return
    idle.reset().play()
    return () => {
      idle.stop()
    }
  }, [actions, idleName])

  // Pausing the mixer rather than a single action freezes one-shots too.
  useEffect(() => {
    mixer.timeScale = paused ? 0 : 1
  }, [mixer, paused])

  // Latest clip state, read by the action trigger below without making it a
  // dependency — the effect must fire on the trigger and nothing else, or
  // reloading the clip list would replay the animation on its own.
  const clipState = useRef({ actions, names, idleName, mixer })
  clipState.current = { actions, names, idleName, mixer }

  useEffect(() => {
    if (!actionTrigger) return
    const { actions: acts, names: all, idleName: idleKey, mixer: m } = clipState.current
    const idle = idleKey ? acts[idleKey] : undefined
    const oneShots = all.filter((name) => name !== idleKey)

    // Only the idle has been exported so far, so restart it — the button still
    // does something visible, and taunts/gestures drop straight in later with no
    // further changes here.
    if (oneShots.length === 0) {
      idle?.reset().play()
      return
    }

    const action = acts[oneShots[Math.floor(Math.random() * oneShots.length)]]
    if (!action) return

    action.reset()
    action.setLoop(LoopOnce, 1)
    action.clampWhenFinished = true
    action.setEffectiveWeight(1)
    action.fadeIn(0.15).play()
    idle?.fadeOut(0.15)

    const onFinished = (event: { action: AnimationAction }) => {
      if (event.action !== action) return
      m.removeEventListener("finished", onFinished as never)
      idle?.reset().fadeIn(0.25).play()
      action.fadeOut(0.25)
    }
    m.addEventListener("finished", onFinished as never)

    return () => {
      m.removeEventListener("finished", onFinished as never)
    }
  }, [actionTrigger])

  // Kill the specular sheen. Blender's glTF export writes Principled's default
  // roughness of 0.5, which puts a wet-looking highlight across the whole model;
  // JK2's renderer is flat diffuse with no specular at all. Forcing roughness to
  // 1 gets us back to the in-game look, and doing it here rather than in Blender
  // means it holds for every model without anyone remembering to set it.
  useEffect(() => {
    scene.traverse((obj) => {
      const mesh = obj as Mesh
      if (!mesh.isMesh) return

      // Never frustum-cull a piece of this model.
      //
      // three decides visibility from a bounding volume computed off the vertex
      // positions, which for a SkinnedMesh describes the BIND pose — the mesh is
      // actually drawn wherever the bones have since dragged it, and three never
      // recomputes. On a model split into 19 surfaces that shows up as limbs and
      // torsos blinking out one at a time while the parts that happen to still
      // overlap their stale volume keep drawing: a half-rendered figure, varying
      // between loads, which reads exactly like missing textures.
      //
      // The saving would be nothing anyway. Every surface is inside a canvas
      // framed on the whole figure, so culling can only ever reject something
      // that should have been drawn.
      mesh.frustumCulled = false

      const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
      for (const mat of materials) {
        if (mat instanceof MeshStandardMaterial) {
          mat.roughness = 1
          mat.metalness = 0
          mat.needsUpdate = true
        }
      }
    })
  }, [scene])

  // Both of these are properties of the file, not of the current frame, so they
  // survive the shared mutable scene drei hands back for a URL — a remount, a
  // sibling suspending, Fast Refresh — without needing to be re-measured.
  const bones = useMemo(() => collectBones(scene), [scene])
  const bolts = useMemo(() => collectBolts(scene), [scene])
  const overhang = useMemo(() => measureOverhang(scene), [scene])
  const fitted = useRef(false)

  useLayoutEffect(() => {
    const wrapper = fitGroup.current
    if (!wrapper) return
    fitted.current = false
    // Fit straight away so nothing is ever drawn at raw export scale, even if
    // this canvas never gets a frame (scrolled out of view, or mounted paused).
    onFit(fitModel(wrapper, scene, bones, overhang))
  }, [scene, bones, overhang, onFit])

  // Re-fit on the first rendered frame, by which point useAnimations' own
  // useFrame — which subscribes ahead of this one — has run the mixer and put
  // the model in the pose people actually see. Kyle's idle translates model_root
  // by -24 units and stands shorter than his bind pose, so this is not optional.
  useFrame(() => {
    if (fitted.current || !fitGroup.current) return
    fitted.current = true
    onFit(fitModel(fitGroup.current, scene, bones, overhang))
  })

  // Every prop lives in the same private bucket as the models, so they're
  // resolved to signed URLs rather than loaded from a path. The hilt is resolved
  // separately from the blade textures because it's the same file whatever
  // colour the blade is — see HILT_ONLY.
  //
  // Resolving the hand slot to at most one prop here is the whole exclusion:
  // downstream there is no state in which both a hilt and a mine have a URL.
  const saberColour = mines ? null : findSaberColour(saber)
  const flagId = findFlagAsset(flag)

  const hilt = useAssetUrls(saberColour ? HILT_ONLY : null)
  const blade = useAssetUrls(
    saberColour
      ? [saberTextureAsset(saberColour.id, "line"), saberTextureAsset(saberColour.id, "glow")]
      : null,
  )

  const saberAssets = useMemo(() => {
    if (!saberColour || !hilt.urls || !blade.urls) return null
    return {
      hilt: hilt.urls[SABER_HILT_ASSET],
      core: blade.urls[saberTextureAsset(saberColour.id, "line")],
      glow: blade.urls[saberTextureAsset(saberColour.id, "glow")],
    }
  }, [saberColour, hilt.urls, blade.urls])

  const mine = useAssetUrls(mines ? MINES_ONLY : null)
  const flagUrls = useAssetUrls(flagId ? [flagId] : null)

  return (
    <group ref={group}>
      <group ref={fitGroup}>
        <primitive object={scene} />
      </group>

      {/* Every prop gets its OWN Suspense boundary. Sharing the viewer's would
          mean a blade texture loading takes the whole model down to the fallback
          and remounts it — which re-runs the fit, and is why switching colour
          used to resize the figure. Sharing one between the props would do the
          same to each other: picking up a flag would blink the saber out. A prop
          should never be able to do that. */}
      {saberColour && saberAssets && (
        <Suspense fallback={null}>
          <Bolt point={bolts.get(HAND_BOLT)}>
            <Saber colour={saberColour} assets={saberAssets} />
          </Bolt>
        </Suspense>
      )}

      {mines && mine.urls && (
        <Suspense fallback={null}>
          <Bolt point={bolts.get(HAND_BOLT)}>
            <Md3Prop src={mine.urls[MINES_ASSET]} />
          </Bolt>
        </Suspense>
      )}

      {flagId && flagUrls.urls && (
        <Suspense fallback={null}>
          <Bolt point={bolts.get(FLAG_BOLT)}>
            <Md3Prop src={flagUrls.urls[flagId]} />
          </Bolt>
        </Suspense>
      )}
    </group>
  )
}

export function ModelViewer({
  src,
  animation,
  autoRotate = false,
  paused = false,
  interactive = true,
  actionTrigger,
  saber,
  mines,
  flag,
  onClipsLoaded,
  onFps,
  className,
}: ModelViewerProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [nearTargetY, setNearTargetY] = useState(FALLBACK_NEAR_TARGET_Y)

  const handleFit = useCallback((next: number) => setNearTargetY(next), [])

  // Stop rendering entirely when the canvas scrolls out of view. On a profile
  // page the model sits well below the fold, so this keeps an idle tab from
  // burning GPU on something nobody is looking at.
  useEffect(() => {
    const el = wrapper.current
    if (!el || typeof IntersectionObserver === "undefined") return

    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.01 })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div ref={wrapper} className={className}>
      <Canvas
        // Cap device pixel ratio: retina phones would otherwise render 3x and
        // tank the frame rate for no visible gain at this canvas size.
        dpr={[1, 2]}
        frameloop={visible && !paused ? "always" : "never"}
        // Safe to hardcode because <Model> normalises every model to
        // TARGET_HEIGHT first, and the distance is the full-body framing.
        camera={INITIAL_CAMERA}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        {/* Weighted towards ambient: JK2 lights players fairly evenly, so a
            strong key light reads as "rendered CGI" rather than "in-game". */}
        <ambientLight intensity={1.1} />
        <directionalLight position={[3, 6, 4]} intensity={1.3} />
        <directionalLight position={[-4, 2, -3]} intensity={0.45} color="#66fcf1" />

        <Suspense fallback={null}>
          <Model
            src={src}
            animation={animation}
            paused={paused}
            actionTrigger={actionTrigger}
            saber={saber}
            mines={mines}
            flag={flag}
            onClipsLoaded={onClipsLoaded}
            onFit={handleFit}
          />
          <ContactShadows position={[0, -0.01, 0]} opacity={0.5} scale={TARGET_HEIGHT * 3} blur={2.4} far={4} />
        </Suspense>

        {/* Horizontal spin + zoom only — min/max polar are pinned together to
            disable vertical orbit. The target is seated by <ZoomAwareTarget>
            rather than passed here; see the note in that component. */}
        <OrbitControls
          makeDefault
          enabled={interactive}
          autoRotate={autoRotate}
          autoRotateSpeed={1.2}
          enablePan={false}
          minPolarAngle={POLAR_ANGLE}
          maxPolarAngle={POLAR_ANGLE}
          minDistance={MIN_DISTANCE}
          maxDistance={MAX_DISTANCE}
        />
        <ZoomAwareTarget nearTargetY={nearTargetY} />

        <FpsMeter onFps={onFps} />
      </Canvas>
    </div>
  )
}

/** Respects the OS "reduce motion" setting — we don't auto-animate if it's on. */
export function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(false)

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return
    const query = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => setReduced(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])

  return reduced
}
