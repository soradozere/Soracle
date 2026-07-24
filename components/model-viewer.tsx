"use client"

import { Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Canvas, createPortal, useFrame, useThree } from "@react-three/fiber"
import { ContactShadows, OrbitControls, useAnimations, useGLTF } from "@react-three/drei"
import {
  Box3,
  LoopOnce,
  MathUtils,
  MeshStandardMaterial,
  Vector3,
  type AnimationAction,
  type Group,
  type Mesh,
  type Object3D,
  type SkinnedMesh,
} from "three"
import { Saber } from "@/components/saber"
import { findSaberColour, type SaberColour } from "@/lib/saber-colours"

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
/** Where a weapon hangs. JK2 rigs the right hand as `rhand`. */
const HAND_BONES = ["rhand", "r_hand", "rhang_tag_bone"]

// How the saber sits in the fist. JK2's bones have no axis convention worth
// deriving from — the hand's local +Y points back down the arm, so the blade
// starts out growing towards the floor — and these were found by eye against the
// idle. Euler XYZ in radians; the offset is in normalised model units.
//
// The PI flips the blade to point out of the fist rather than into it. The extra
// 0.3 tips it away from the body: dead vertical, the blade crosses his chest and
// face, which both looks wrong and hides the model the panel is there to show.
const SABER_ROTATION: [number, number, number] = [Math.PI + 0.3, 0, 0]
const SABER_OFFSET: [number, number, number] = [0, 0, 0]

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
  /** Reports the model's available clip names once loaded. */
  onClipsLoaded?: (names: string[]) => void
  /** Reports measured frames-per-second, roughly once a second. */
  onFps?: (fps: number) => void
  className?: string
}

/** Where the model ended up once normalised, so the camera and props can use it. */
type ModelFit = {
  nearTargetY: number
  /** The bone a weapon hangs off, or null if this model has no recognisable hand. */
  hand: Object3D | null
  /**
   * The hand bone's world scale. Anything parented to the bone inherits it, so a
   * prop has to divide it back out to be sized in normalised units rather than
   * whatever the model was exported in.
   */
  handScale: number
}

/** How far the mesh overhangs the skeleton, vertically, measured at bind pose. */
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
 * Measures, at the bind pose, how far the mesh reaches beyond the outermost
 * joints — the scalp above the cranium, the soles below the ankles.
 *
 * The skeleton is rigid, so that overhang carries across poses, which lets the
 * fit below work off joint positions alone. That matters because joints are
 * ordinary Object3Ds we can read at any time, whereas the skinned mesh bounds
 * are only trustworthy here, before anything has been animated or drawn.
 */
function measureOverhang(wrapper: Group, scene: Group, bones: Object3D[]): MeshOverhang {
  // Force the bind pose first. This function's whole premise is that it's
  // measuring an unposed model, and that is NOT guaranteed: drei's useGLTF hands
  // back one shared, mutated scene per URL, so a remount — a sibling suspending,
  // Fast Refresh, revisiting a profile — arrives with the bones wherever the
  // animation left them. Measured in that state the overhang is nonsense and the
  // model renders at a fraction of its size. skeleton.pose() makes it
  // deterministic; the mixer re-poses on the next frame regardless.
  for (const bone of bones) bone.parent?.updateMatrixWorld(true)
  scene.traverse((obj) => {
    const skinned = obj as SkinnedMesh
    if (skinned.isSkinnedMesh) skinned.skeleton.pose()
  })

  resetForMeasurement(wrapper)

  // SkinnedMesh.computeBoundingBox() — which Box3.setFromObject calls for us —
  // poses every vertex through skeleton.boneMatrices, and three only fills that
  // array during a render, so prime it by hand and drop any cached box.
  scene.traverse((obj) => {
    const skinned = obj as SkinnedMesh
    if (!skinned.isSkinnedMesh) return
    skinned.skeleton.update()
    // three's types say these are non-null, but the class initialises them to
    // null and treats null as "recompute on next use", which is what we want.
    const cache = skinned as unknown as { boundingBox: unknown; boundingSphere: unknown }
    cache.boundingBox = null
    cache.boundingSphere = null
  })

  const mesh = new Box3().setFromObject(wrapper)
  const joints = skeletonBox(bones)
  if (mesh.isEmpty() || joints.isEmpty()) return { top: 0, bottom: 0 }

  return { top: mesh.max.y - joints.max.y, bottom: joints.min.y - mesh.min.y }
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
function fitModel(wrapper: Group, scene: Group, bones: Object3D[], overhang: MeshOverhang): ModelFit {
  resetForMeasurement(wrapper)

  const joints = skeletonBox(bones)
  const top = joints.max.y + overhang.top
  const bottom = joints.min.y - overhang.bottom
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
  const hand = findBone(scene, HAND_BONES)
  const props = {
    hand,
    handScale: hand ? hand.getWorldScale(new Vector3()).x || 1 : 1,
  }

  const headY = boneY(scene, HEAD_BONES)
  const neckY = boneY(scene, NECK_BONES)
  if (headY === null) return { nearTargetY: neckY ?? FALLBACK_NEAR_TARGET_Y, ...props }

  const framed = neckY === null ? headY : (neckY + TARGET_HEIGHT) / 2
  // Keep the face near the middle of the shot even when something above the head
  // — a ponytail, a helmet spike — drags the top of the box up with it.
  return { nearTargetY: MathUtils.clamp(framed, headY, headY + NEAR_FRAME_HEIGHT * 0.35), ...props }
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
 * Positions the saber inside the fist.
 *
 * The nesting matters: the outer group divides out the bone's world scale, so
 * everything inside it is in normalised model units. Offset is applied before
 * rotation, so it shifts the grip along the hand's own axes and the rotation
 * then aims the blade — which is the order that's tractable to tune by eye.
 */
function SaberRig({ colour, scale }: { colour: SaberColour; scale: number }) {
  return (
    <group scale={scale}>
      <group position={SABER_OFFSET} rotation={SABER_ROTATION}>
        <Saber colour={colour} />
      </group>
    </group>
  )
}

function Model({
  src,
  animation,
  paused,
  actionTrigger,
  onClipsLoaded,
  onFit,
}: Pick<ModelViewerProps, "src" | "animation" | "paused" | "actionTrigger" | "onClipsLoaded"> & {
  onFit: (fit: ModelFit) => void
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

  // Learn the mesh-vs-skeleton overhang while the model is still in its bind
  // pose — the only moment the skinned bounds can be trusted. Re-measuring the
  // skinned mesh later looks tempting and is wrong: mid-frame the bones carry
  // local transforms the renderer hasn't reconciled, so CPU-side skinning smears
  // the vertices even though that same frame draws correctly. Measured that way
  // Kyle came out 202 units tall against a real 64.
  const bones = useMemo(() => collectBones(scene), [scene])
  const overhang = useRef<MeshOverhang>({ top: 0, bottom: 0 })
  const fitted = useRef(false)

  useLayoutEffect(() => {
    const wrapper = fitGroup.current
    if (!wrapper) return
    fitted.current = false
    overhang.current = measureOverhang(wrapper, scene, bones)
    // Fit against the bind pose straight away so nothing is ever drawn at raw
    // export scale, even if this canvas never gets a frame (scrolled out of
    // view, or mounted paused).
    onFit(fitModel(wrapper, scene, bones, overhang.current))
  }, [scene, bones, onFit])

  // Re-fit on the first rendered frame, by which point useAnimations' own
  // useFrame — which subscribes ahead of this one — has run the mixer and put
  // the model in the pose people actually see.
  useFrame(() => {
    if (fitted.current || !fitGroup.current) return
    fitted.current = true
    onFit(fitModel(fitGroup.current, scene, bones, overhang.current))
  })

  return (
    <group ref={group}>
      <group ref={fitGroup}>
        <primitive object={scene} />
      </group>
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
  onClipsLoaded,
  onFps,
  className,
}: ModelViewerProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)
  const [fit, setFit] = useState<ModelFit>({
    nearTargetY: FALLBACK_NEAR_TARGET_Y,
    hand: null,
    handScale: 1,
  })

  const handleFit = useCallback((next: ModelFit) => setFit(next), [])
  const saberColour = findSaberColour(saber)

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
            onClipsLoaded={onClipsLoaded}
            onFit={handleFit}
          />
          <ContactShadows position={[0, -0.01, 0]} opacity={0.5} scale={TARGET_HEIGHT * 3} blur={2.4} far={4} />

          {/* Parented straight to the hand bone, so it inherits the bone's
              animated world transform every frame for free — no per-frame matrix
              work here, and it tracks the idle on its own. */}
          {saberColour &&
            fit.hand &&
            createPortal(<SaberRig colour={saberColour} scale={1 / fit.handScale} />, fit.hand)}
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
        <ZoomAwareTarget nearTargetY={fit.nearTargetY} />

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
