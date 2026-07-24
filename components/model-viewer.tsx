"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { Canvas, useFrame, useThree } from "@react-three/fiber"
import { ContactShadows, OrbitControls, useAnimations, useGLTF } from "@react-three/drei"
import { Box3, MathUtils, MeshStandardMaterial, Vector3, type Group, type Mesh } from "three"

/** Every model is rescaled to this height in world units, so one camera fits all. */
const TARGET_HEIGHT = 2

// Camera rig. Derived rather than hardcoded so the locked orbit angle below
// always matches wherever the camera actually sits.
//
// The orbit target RISES as you zoom in. With a fixed target you have to choose
// between framing the feet when zoomed out and leaving dead space above the head
// when zoomed in — you can't have both, because the target is always screen
// centre. Interpolating it means far = whole figure centred, close = head and
// shoulders, which is what you actually want from a portrait.
const FAR_TARGET_Y = TARGET_HEIGHT * 0.5 // mid-body: whole figure sits centred
const NEAR_TARGET_Y = TARGET_HEIGHT * 0.92 // the face
const MIN_DISTANCE = TARGET_HEIGHT * 0.22 // close enough to read an expression
const MAX_DISTANCE = TARGET_HEIGHT * 1.6
const CAMERA_Y = TARGET_HEIGHT * 0.56
// Default sits close enough that the figure nearly fills the canvas height —
// vertical FOV is 40°, so visible height is 2·d·tan(20°) ≈ 0.728·d, and the
// model is normalised to TARGET_HEIGHT.
const CAMERA_Z = TARGET_HEIGHT * 1.42

// Vertical orbit is locked to the camera's starting elevation: players get to
// spin the model and zoom, but can't tumble it upside down or stare at the
// soles of its feet. Free vertical orbit read as chaotic in testing.
const POLAR_ANGLE = Math.acos((CAMERA_Y - FAR_TARGET_Y) / Math.hypot(CAMERA_Y - FAR_TARGET_Y, CAMERA_Z))

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
  /** Animation clip name to play. Falls back to the model's first clip. */
  animation?: string
  /** Slowly spin the camera around the model. */
  autoRotate?: boolean
  /** Freeze the animation without unmounting the canvas. */
  paused?: boolean
  /** Allow drag-to-orbit / scroll-to-zoom. */
  interactive?: boolean
  /** Reports the model's available clip names once loaded. */
  onClipsLoaded?: (names: string[]) => void
  /** Reports measured frames-per-second, roughly once a second. */
  onFps?: (fps: number) => void
  className?: string
}

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

/**
 * Slides the orbit target up towards the shoulders as the camera closes in, so
 * zooming in frames a portrait rather than pushing the head off the top of the
 * canvas. Reads the live distance each frame, so it tracks a scroll-wheel zoom
 * in progress rather than only settling at the end.
 */
function ZoomAwareTarget() {
  const controls = useThree((s) => s.controls) as { getDistance?: () => number; target?: Vector3 } | null
  const camera = useThree((s) => s.camera)

  useFrame(() => {
    if (!controls?.getDistance || !controls.target) return
    // 0 at closest, 1 at furthest.
    const t = MathUtils.clamp((controls.getDistance() - MIN_DISTANCE) / (MAX_DISTANCE - MIN_DISTANCE), 0, 1)
    const desiredY = MathUtils.lerp(NEAR_TARGET_Y, FAR_TARGET_Y, t)
    const delta = desiredY - controls.target.y
    if (Math.abs(delta) < 1e-4) return

    // Move the CAMERA by the same delta, not just the target. Shifting the
    // target alone changes the camera→target vector, and because the polar
    // angle is pinned, OrbitControls then swings the camera to re-satisfy the
    // angle — which feeds back into the distance and throws the model out of
    // frame entirely. Panning both keeps the spherical coordinates untouched.
    controls.target.y += delta
    camera.position.y += delta
  })

  return null
}

function Model({
  src,
  animation,
  paused,
  onClipsLoaded,
}: Pick<ModelViewerProps, "src" | "animation" | "paused" | "onClipsLoaded">) {
  const group = useRef<Group>(null)
  const { scene, animations } = useGLTF(src)
  const { actions, names } = useAnimations(animations, group)

  useEffect(() => {
    onClipsLoaded?.(names)
  }, [names, onClipsLoaded])

  // Play the requested clip (or the first one). Re-runs when the model or the
  // selected clip changes; stopping on cleanup keeps clips from stacking up on
  // the shared mixer when switching.
  useEffect(() => {
    const clipName = animation && actions[animation] ? animation : names[0]
    if (!clipName) return
    const action = actions[clipName]
    if (!action) return

    action.reset().play()
    return () => {
      action.stop()
    }
  }, [actions, names, animation])

  // Pause in place rather than stopping, so resuming picks up mid-stride.
  useEffect(() => {
    const clipName = animation && actions[animation] ? animation : names[0]
    const action = clipName ? actions[clipName] : undefined
    if (action) action.paused = !!paused
  }, [actions, names, animation, paused])

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

  // Normalise the model into a predictable box: TARGET_HEIGHT tall, centred on
  // X/Z, feet resting on y=0. Without this the camera framing depends entirely
  // on the exporter's units — the Khronos Fox is ~100 units tall, and JK2's
  // Quake-unit models are bigger still, so any fixed camera would be useless.
  const fit = useMemo(() => {
    const box = new Box3().setFromObject(scene)
    const size = box.getSize(new Vector3())
    const center = box.getCenter(new Vector3())
    const scale = size.y > 0 ? TARGET_HEIGHT / size.y : 1

    return {
      scale,
      position: [-center.x * scale, -box.min.y * scale, -center.z * scale] as [number, number, number],
    }
  }, [scene])

  return (
    <group ref={group}>
      <group scale={fit.scale} position={fit.position}>
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
  onClipsLoaded,
  onFps,
  className,
}: ModelViewerProps) {
  const wrapper = useRef<HTMLDivElement>(null)
  const [visible, setVisible] = useState(true)

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
        // Chest-height, slightly-above eye framing. Safe to hardcode because
        // <Model> normalises every model to TARGET_HEIGHT first.
        camera={{ position: [0, CAMERA_Y, CAMERA_Z], fov: 40 }}
        gl={{ antialias: true, powerPreference: "high-performance" }}
      >
        {/* Weighted towards ambient: JK2 lights players fairly evenly, so a
            strong key light reads as "rendered CGI" rather than "in-game". */}
        <ambientLight intensity={1.1} />
        <directionalLight position={[3, 6, 4]} intensity={1.3} />
        <directionalLight position={[-4, 2, -3]} intensity={0.45} color="#66fcf1" />

        <Suspense fallback={null}>
          <Model src={src} animation={animation} paused={paused} onClipsLoaded={onClipsLoaded} />
          <ContactShadows position={[0, -0.01, 0]} opacity={0.5} scale={TARGET_HEIGHT * 3} blur={2.4} far={4} />
        </Suspense>

        {/* Orbit around the model's midpoint rather than its feet, so dragging
            doesn't swing the subject out of frame. Horizontal spin + zoom only —
            min/max polar are pinned together to disable vertical orbit. */}
        <OrbitControls
          makeDefault
          target={[0, FAR_TARGET_Y, 0]}
          enabled={interactive}
          autoRotate={autoRotate}
          autoRotateSpeed={1.2}
          enablePan={false}
          minPolarAngle={POLAR_ANGLE}
          maxPolarAngle={POLAR_ANGLE}
          minDistance={MIN_DISTANCE}
          maxDistance={MAX_DISTANCE}
        />
        <ZoomAwareTarget />

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
