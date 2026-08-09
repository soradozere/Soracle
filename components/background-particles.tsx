"use client"

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react"

interface Star {
  x: number
  y: number
  size: number
  opacity: number
  twinkleSpeed: number
  twinklePhase: number
}

interface Nebula {
  x: number
  y: number
  radiusX: number
  radiusY: number
  rotation: number
  r: number
  g: number
  b: number
  opacity: number
}

interface Galaxy {
  x: number
  y: number
  radius: number
  rotation: number
  opacity: number
  arms: number
}

interface Meteor {
  x: number
  y: number
  length: number
  speed: number
  opacity: number
  angle: number
  active: boolean
}

// ---- Profile-theme backgrounds ---------------------------------------------
// A profile can swap the shared starfield for one of these, selected via
// data-profile-bg on <html> (set by the profile's apply effect). Each is a small
// particle set drawn by its own renderer below; colours come from the theme's
// --color-primary so they stay theme-driven.
interface Ember {
  x: number
  y: number
  r: number
  o: number
  vy: number
  vx: number
  ph: number
  fl: number
}

interface Flake {
  x: number
  y: number
  r: number
  o: number
  vy: number
  sway: number
  swayAmp: number
  ph: number
}

// Accretion-disk dust for the Void black hole.
interface VoidDust {
  angle: number
  radius: number
  speed: number
  size: number
  op: number
}

// Soft drifting clouds for the light Bespin theme.
interface Cloud {
  x: number
  y: number
  rx: number
  ry: number
  o: number
  vx: number
  ph: number
}

// Outlined polygons drifting across the light Geometry theme.
interface GeoShape {
  x: number
  y: number
  size: number
  rot: number
  vr: number
  vx: number
  vy: number
  sides: number
  o: number
}

// One glyph cell for the Slicer / Hacker backgrounds. Nothing falls: a cell
// decodes a character in, holds it, fades it out, then does it again with a new
// one. Purely a function of elapsed time — see drawGlyphField.
interface GlyphCell {
  col: number
  row: number
  /** Phase offset in seconds, so the field never pulses in unison. */
  offset: number
  /** Cycle length: decode + hold + fade + gap. */
  period: number
  /** Peak opacity, so the field has depth rather than one flat tone. */
  peak: number
  /** Stirred into the glyph hash so two cells never agree for long. */
  seed: number
  /** The few drawn bright, like a cursor landing on a character. */
  hot: boolean
}

// Code-rain glyph set + cell size (module-level; never changes).
const RAIN_GLYPHS = "アイウエオカキクケコサシスセソタチツテトﾊﾋﾌﾍﾎ0123456789<>=/\\|+*[]#$%&"
const RAIN_CELL = 18

interface NebulaLobe {
  baseAngle: number
  dist: number
  rx: number
  ry: number
  r: number
  g: number
  b: number
  opacity: number
  orbit: number
  spin: number
}

interface Building {
  x: number
  w: number
  h: number
}
interface CityWindow {
  x: number
  y: number
  o: number
  tw: number
}
interface Lane {
  x: number
  y: number
  len: number
  sp: number
  o: number
  blue: boolean
}
interface CityScene {
  buildings: Building[]
  windows: CityWindow[]
  lanes: Lane[]
}

// Slow floating motes for the image-background theme (dust caught in the light).
interface ImgDust {
  x: number
  y: number
  r: number
  o: number
  vx: number
  vy: number
  ph: number
}

export interface BackgroundParticlesRef {
  triggerHyperspace: () => void
}

export const BackgroundParticles = forwardRef<BackgroundParticlesRef>((props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const starsRef = useRef<Star[]>([])
  const meteorsRef = useRef<Meteor[]>([])
  const nebulasRef = useRef<Nebula[]>([])
  const galaxiesRef = useRef<Galaxy[]>([])
  // Profile-theme backgrounds: which renderer to run (default "starfield"), plus
  // the particle sets each one needs.
  const bgKindRef = useRef<string>("starfield")
  const embersRef = useRef<Ember[]>([])
  const snowRef = useRef<Flake[]>([])
  const bigNebulaRef = useRef<NebulaLobe[]>([])
  const voidHoleRef = useRef<VoidDust[]>([])
  const cloudsRef = useRef<Cloud[]>([])
  const shapesRef = useRef<GeoShape[]>([])
  const glyphsRef = useRef<GlyphCell[]>([])
  const cityRef = useRef<CityScene | null>(null)
  // Image-background theme: the loaded wallpaper, the url it was loaded from (so we
  // only reload when it changes), a ready flag, and slow dust motes drifting over it.
  const bgImageRef = useRef<HTMLImageElement | null>(null)
  const bgImageUrlRef = useRef<string>("")
  const bgImageReadyRef = useRef(false)
  const imgDustRef = useRef<ImgDust[]>([])
  const hyperspaceRef = useRef(false)
  const hyperspaceTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined)
  const animationFrameIdRef = useRef<number | undefined>(undefined)
  const currentColorRef = useRef<string>("102, 252, 241")

  useImperativeHandle(ref, () => ({
    triggerHyperspace: () => {
      hyperspaceRef.current = true
      if (hyperspaceTimeoutRef.current) {
        clearTimeout(hyperspaceTimeoutRef.current)
      }
      hyperspaceTimeoutRef.current = setTimeout(() => {
        hyperspaceRef.current = false
      }, 1500)
    },
  }))

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const ctx = canvas.getContext("2d", { alpha: true })
    if (!ctx) return

    // Read once: profile-theme backgrounds freeze to a static frame when the
    // viewer prefers reduced motion (the starfield keeps its long-standing gentle
    // twinkle). A runtime toggle needs a reload to take effect — acceptable.
    const reduce = typeof window !== "undefined" && window.matchMedia
      ? window.matchMedia("(prefers-reduced-motion: reduce)").matches
      : false

    // Whether the site theme sits on a light ground (Cloud City's cream). Keyed
    // on background LUMINANCE rather than the theme's name, so any future light
    // theme swaps to the daytime sky without touching this file.
    let daylight = false

    const updateThemeColor = () => {
      const styles = getComputedStyle(document.documentElement)
      const primaryColor = styles.getPropertyValue("--color-primary").trim()
      if (primaryColor) {
        const hex = primaryColor.replace("#", "")
        const r = parseInt(hex.substring(0, 2), 16)
        const g = parseInt(hex.substring(2, 4), 16)
        const b = parseInt(hex.substring(4, 6), 16)
        currentColorRef.current = `${r}, ${g}, ${b}`
      }
      const bg = styles.getPropertyValue("--color-background").trim()
      if (/^#[0-9a-f]{6}$/i.test(bg)) {
        const br = parseInt(bg.slice(1, 3), 16)
        const bgr = parseInt(bg.slice(3, 5), 16)
        const bb = parseInt(bg.slice(5, 7), 16)
        daylight = (0.2126 * br + 0.7152 * bgr + 0.0722 * bb) / 255 > 0.55
      }
    }

    // Which background renderer to run, read off <html data-profile-bg>. Absent
    // (every non-profile page, and accent-only profile themes) = the starfield.
    // For image themes, also (re)load the wallpaper named in data-profile-bg-image;
    // it's loaded once per url and cached until the url changes.
    const updateBgKind = () => {
      bgKindRef.current = document.documentElement.dataset.profileBg || "starfield"
      const url = document.documentElement.dataset.profileBgImage || ""
      if (url !== bgImageUrlRef.current) {
        bgImageUrlRef.current = url
        bgImageReadyRef.current = false
        bgImageRef.current = null
        if (url) {
          const img = new Image()
          img.onload = () => {
            // Ignore a late load if the theme has since changed to another url.
            if (bgImageUrlRef.current === url) {
              bgImageRef.current = img
              bgImageReadyRef.current = true
            }
          }
          img.src = url
        }
      }
    }

    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      initStars()
      initNebulas()
      initGalaxies()
      initEmbers()
      initSnow()
      initBigNebula()
      initVoidHole()
      initClouds()
      initShapes()
      initGlyphField()
      initCity()
      initImageDust()
    }

    const initStars = () => {
      const starCount = Math.floor((canvas.width * canvas.height) / 4000)
      const stars: Star[] = []

      for (let i = 0; i < starCount; i++) {
        stars.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: Math.random() * 1.5 + 0.5,
          opacity: Math.random() * 0.8 + 0.2,
          twinkleSpeed: Math.random() * 0.02 + 0.005,
          twinklePhase: Math.random() * Math.PI * 2,
        })
      }

      starsRef.current = stars
    }

    // Nebula color palettes: cool blues, magentas, teals, purples
    const nebulaPalettes = [
      { r: 80,  g: 160, b: 255 },  // blue
      { r: 180, g: 80,  b: 220 },  // violet
      { r: 60,  g: 200, b: 220 },  // teal
      { r: 220, g: 80,  b: 140 },  // pink
      { r: 80,  g: 120, b: 200 },  // deep blue
      { r: 140, g: 60,  b: 180 },  // purple
    ]

    const initNebulas = () => {
      const count = 4 + Math.floor(Math.random() * 3)
      const nebulas: Nebula[] = []
      for (let i = 0; i < count; i++) {
        const palette = nebulaPalettes[Math.floor(Math.random() * nebulaPalettes.length)]
        nebulas.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radiusX: 80 + Math.random() * 220,
          radiusY: 50 + Math.random() * 140,
          rotation: Math.random() * Math.PI * 2,
          r: palette.r,
          g: palette.g,
          b: palette.b,
          opacity: 0.04 + Math.random() * 0.07,
        })
      }
      nebulasRef.current = nebulas
    }

    const initGalaxies = () => {
      const count = 2 + Math.floor(Math.random() * 2)
      const galaxies: Galaxy[] = []
      for (let i = 0; i < count; i++) {
        galaxies.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          radius: 40 + Math.random() * 80,
          rotation: Math.random() * Math.PI * 2,
          opacity: 0.06 + Math.random() * 0.08,
          arms: 2 + Math.floor(Math.random() * 3),
        })
      }
      galaxiesRef.current = galaxies
    }

    const initMeteors = () => {
      const meteors: Meteor[] = []
      for (let i = 0; i < 5; i++) {
        meteors.push(createMeteor(canvas, false))
      }
      meteorsRef.current = meteors
    }

    const createMeteor = (canvas: HTMLCanvasElement, active: boolean): Meteor => {
      const angle = Math.PI / 4 + (Math.random() * Math.PI) / 6
      return {
        x: Math.random() * canvas.width * 1.5,
        y: -50 - Math.random() * 200,
        length: Math.random() * 80 + 40,
        speed: Math.random() * 8 + 6,
        opacity: Math.random() * 0.6 + 0.4,
        angle,
        active,
      }
    }

    // ---- Profile-background particle sets ----
    const makeEmber = (seed: boolean): Ember => ({
      x: Math.random() * canvas.width,
      y: seed ? Math.random() * canvas.height : canvas.height + 6,
      r: Math.random() * 1.9 + 0.7,
      o: Math.random() * 0.6 + 0.3,
      vy: -(Math.random() * 1.1 + 0.6),
      vx: (Math.random() - 0.5) * 0.5,
      ph: Math.random() * Math.PI * 2,
      fl: Math.random() * 0.05 + 0.02,
    })

    const initEmbers = () => {
      const n = Math.round((canvas.width * canvas.height) / 11000)
      const arr: Ember[] = []
      for (let i = 0; i < n; i++) arr.push(makeEmber(true))
      embersRef.current = arr
    }

    const initImageDust = () => {
      // Sparse, slow motes — just enough to keep the still wallpaper from feeling dead.
      const n = Math.round((canvas.width * canvas.height) / 42000)
      const arr: ImgDust[] = []
      for (let i = 0; i < n; i++) {
        arr.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: 0.6 + Math.random() * 1.6,
          o: 0.05 + Math.random() * 0.18,
          vx: (Math.random() - 0.5) * 0.12,
          vy: -0.05 - Math.random() * 0.15,
          ph: Math.random() * Math.PI * 2,
        })
      }
      imgDustRef.current = arr
    }

    const initSnow = () => {
      // Denser than a starfield, with a depth axis so it reads as falling snow
      // (near flakes are bigger, brighter and faster) rather than static stars.
      const n = Math.round((canvas.width * canvas.height) / 5200)
      const arr: Flake[] = []
      for (let i = 0; i < n; i++) {
        const near = Math.random() // 0 = far/small/slow, 1 = near/big/fast
        arr.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          r: 0.8 + near * 3.0,
          o: 0.4 + near * 0.5,
          vy: 0.5 + near * 1.6,
          sway: Math.random() * 0.8 + 0.3,
          swayAmp: 0.4 + near * 0.9,
          ph: Math.random() * Math.PI * 2,
        })
      }
      snowRef.current = arr
    }

    // One big swirling nebula: a handful of coloured lobes orbiting a bright core
    // at different radii and speeds, so the differential motion reads as a swirl.
    const nebulaLobeCols = [
      [168, 85, 247],
      [120, 90, 235],
      [214, 80, 190],
      [110, 70, 210],
      [90, 120, 235],
      [150, 60, 200],
    ]
    const initBigNebula = () => {
      // Scale to the LARGER axis (usually width) and spread the lobes wide, so the
      // cloud fills the viewport and spills off every edge rather than sitting as a
      // small blob in the middle.
      const s = Math.max(canvas.width, canvas.height)
      const n = 9
      const lobes: NebulaLobe[] = []
      for (let i = 0; i < n; i++) {
        const c = nebulaLobeCols[i % nebulaLobeCols.length]
        lobes.push({
          baseAngle: (i / n) * Math.PI * 2 + Math.random() * 0.5,
          dist: s * (0.12 + Math.random() * 0.34), // wide orbit → lobes reach the edges
          rx: s * (0.34 + Math.random() * 0.3), // bigger, overlapping lobes
          ry: s * (0.26 + Math.random() * 0.22),
          r: c[0],
          g: c[1],
          b: c[2],
          opacity: 0.18 + Math.random() * 0.14,
          orbit: 0.16 + Math.random() * 0.3, // rad/s — lively, not sluggish
          spin: 0.2 + Math.random() * 0.4,
        })
      }
      bigNebulaRef.current = lobes
    }

    // Void's black hole: a ring of dust that swirls around a dark core, faster the
    // closer it is (keplerian-ish), reaching out toward the edges.
    const initVoidHole = () => {
      const s = Math.max(canvas.width, canvas.height)
      const n = 340
      const arr: VoidDust[] = []
      for (let i = 0; i < n; i++) {
        const t = Math.random()
        arr.push({
          angle: Math.random() * Math.PI * 2,
          radius: s * (0.06 + t * 0.66), // reaches the edges, like the nebula
          speed: 0.12 + (1 - t) * 0.55,
          size: 0.6 + Math.random() * 2.0,
          // brighter nearer the hole, so the disk reads as a swirl around the core
          op: (0.06 + Math.random() * 0.2) * (1.4 - t),
        })
      }
      voidHoleRef.current = arr
    }

    // Bespin: soft, warm, slowly drifting clouds for a light daytime sky.
    const initClouds = () => {
      const s = Math.max(canvas.width, canvas.height)
      const n = 7
      const arr: Cloud[] = []
      for (let i = 0; i < n; i++) {
        arr.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          rx: s * (0.14 + Math.random() * 0.2),
          ry: s * (0.07 + Math.random() * 0.1),
          o: 0.25 + Math.random() * 0.35,
          vx: (0.15 + Math.random() * 0.35) * (Math.random() < 0.5 ? 1 : -1),
          ph: Math.random() * Math.PI * 2,
        })
      }
      cloudsRef.current = arr
    }

    // Geometry: outlined polygons drifting and slowly rotating on a light ground.
    const initShapes = () => {
      const s = Math.max(canvas.width, canvas.height)
      const n = 14
      const sides = [3, 4, 6, 3, 4]
      const arr: GeoShape[] = []
      for (let i = 0; i < n; i++) {
        arr.push({
          x: Math.random() * canvas.width,
          y: Math.random() * canvas.height,
          size: s * (0.04 + Math.random() * 0.1),
          rot: Math.random() * Math.PI * 2,
          vr: (Math.random() - 0.5) * 0.006,
          vx: (Math.random() - 0.5) * 0.4,
          vy: (Math.random() - 0.5) * 0.4,
          sides: sides[i % sides.length],
          o: 0.25 + Math.random() * 0.4,
        })
      }
      shapesRef.current = arr
    }

    /*
     * Slicer / Hacker: a sparse grid of glyphs that decode in and fade out where
     * they are.
     *
     * This replaced a Matrix-style cascade. Falling columns are relentless —
     * every cell in the viewport moving in one direction, constantly — which is
     * exhausting to read a profile through. Cycling in place gives the same
     * "terminal thinking to itself" idea with most of the field settled at any
     * moment, and it costs less: a fraction of the cells draw per frame rather
     * than every cell of every column's trail.
     *
     * A third of the grid positions get a cell, so it reads as scattered text
     * rather than a filled screen. Cells hold no animation state — position in the
     * cycle is derived from elapsed time, which keeps it frame-rate independent
     * and means a backgrounded tab resumes correctly instead of drifting.
     */
    const initGlyphField = () => {
      const cols = Math.ceil(canvas.width / RAIN_CELL)
      const rows = Math.ceil(canvas.height / RAIN_CELL)
      const arr: GlyphCell[] = []
      for (let col = 0; col < cols; col++) {
        for (let row = 0; row < rows; row++) {
          // 0.17 fills roughly a sixth of the grid. It was 0.34 — the motion
          // rework read as a wall of text; half the symbols, same choreography.
          if (Math.random() > 0.17) continue
          arr.push({
            col,
            row,
            // Short cycles: at 3–9 seconds the first attempt at this looked
            // static at a glance, which defeated the point.
            period: 0.9 + Math.random() * 1.9,
            offset: Math.random() * 4,
            peak: 0.2 + Math.random() * 0.52,
            seed: Math.floor(Math.random() * 9973),
            hot: Math.random() < 0.07,
          })
        }
      }
      glyphsRef.current = arr
    }

    const initCity = () => {
      const w = canvas.width
      const h = canvas.height
      const buildings: Building[] = []
      let x = 0
      while (x < w) {
        const bw = 18 + Math.random() * 46
        const bh = 30 + Math.random() * (h * 0.45)
        buildings.push({ x, w: bw, h: bh })
        x += bw + 3 + Math.random() * 6
      }
      const windows: CityWindow[] = []
      for (const b of buildings) {
        for (let yy = h - b.h + 8; yy < h - 6; yy += 9) {
          for (let xx = b.x + 4; xx < b.x + b.w - 3; xx += 8) {
            if (Math.random() < 0.5) windows.push({ x: xx, y: yy, o: Math.random(), tw: Math.random() * 0.04 + 0.005 })
          }
        }
      }
      const lanes: Lane[] = []
      const laneCount = Math.round(h / 30) // speeder lanes stacked up the sky
      for (let i = 0; i < laneCount; i++) {
        lanes.push({
          x: Math.random() * w,
          y: Math.random() * h * 0.62, // in the sky, above the skyline
          len: 16 + Math.random() * 46, // speeder streak length
          sp: (Math.random() * 2.4 + 1.0) * (Math.random() < 0.5 ? 1 : -1), // fast, L or R
          o: Math.random() * 0.5 + 0.35,
          blue: Math.random() < 0.45,
        })
      }
      cityRef.current = { buildings, windows, lanes }
    }

    resizeCanvas()
    initMeteors()
    window.addEventListener("resize", resizeCanvas)

    updateThemeColor()
    updateBgKind()
    const observer = new MutationObserver(() => {
      updateThemeColor()
      updateBgKind()
    })
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style", "data-profile-bg", "data-profile-bg-image"],
    })

    let lastMeteorTime = Date.now()
    const meteorInterval = 3000
    // Built once, reused every frame (redrawing scanlines as hundreds of
    // fillRects per frame was the main cause of the Slicer slowdown).
    let scanlinePattern: CanvasPattern | null = null

    /*
     * Soft-blob sprite cache — the fix for the Nebula and Bespin themes running
     * hot.
     *
     * Both drew their shapes as createRadialGradient + arc + fill, per shape, per
     * frame: nine nebula lobes and seven clouds, each a gradient object built and
     * thrown away 60 times a second, filling areas a third of the viewport wide
     * with `lighter` blending. Building a gradient is not free and the overdraw is
     * enormous.
     *
     * A radial blob is scale-invariant, so it only has to be rasterised once per
     * COLOUR: 128px sprites, then drawImage with a transform, which is the path
     * the GPU is actually good at. Keyed by the rgba string so the nebula's nine
     * lobes share three or four sprites between them.
     */
    const blobCache = new Map<string, HTMLCanvasElement>()
    const blobSprite = (r: number, g: number, b: number, rawPeak: number): HTMLCanvasElement => {
      // Quantised to 0.02 steps: every init re-rolls each shape's opacity, so
      // keying on the raw float would mint fresh sprites on every resize and
      // grow the cache forever (a window drag fires resize continuously). At
      // 0.02 the visual difference is imperceptible and the cache is bounded
      // by palette size for the life of the mount.
      const peak = Math.round(rawPeak * 50) / 50
      const key = `${r},${g},${b},${peak}`
      const hit = blobCache.get(key)
      if (hit) return hit
      const size = 128
      const off = document.createElement("canvas")
      off.width = size
      off.height = size
      const octx = off.getContext("2d")!
      const grad = octx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2)
      // Same three stops the per-frame gradients used, so the look is unchanged.
      grad.addColorStop(0, `rgba(${r}, ${g}, ${b}, ${peak})`)
      grad.addColorStop(0.5, `rgba(${r}, ${g}, ${b}, ${peak * 0.4})`)
      grad.addColorStop(1, `rgba(${r}, ${g}, ${b}, 0)`)
      octx.fillStyle = grad
      octx.fillRect(0, 0, size, size)
      blobCache.set(key, off)
      return off
    }
    /** Draw a cached blob centred at (x,y), rx/ry wide, rotated. */
    const drawBlob = (
      sprite: HTMLCanvasElement,
      x: number,
      y: number,
      rx: number,
      ry: number,
      rotation = 0,
    ) => {
      ctx.save()
      ctx.translate(x, y)
      if (rotation) ctx.rotate(rotation)
      ctx.drawImage(sprite, -rx, -ry, rx * 2, ry * 2)
      ctx.restore()
    }

    // ---- Profile-background renderers ----
    const drawBigNebula = (time: number) => {
      const w = canvas.width
      const h = canvas.height
      const s = Math.max(w, h)
      const cx = w * 0.5
      const cy = h * 0.5
      const t = reduce ? 0 : time

      ctx.save()
      ctx.globalCompositeOperation = "lighter"
      bigNebulaRef.current.forEach((nb) => {
        const a = nb.baseAngle + t * nb.orbit
        const x = cx + Math.cos(a) * nb.dist
        const y = cy + Math.sin(a) * nb.dist * 0.85
        drawBlob(blobSprite(nb.r, nb.g, nb.b, nb.opacity), x, y, nb.rx, nb.ry, a * 0.5 + t * nb.spin * 0.3)
      })
      ctx.restore()

      // Bright core
      drawBlob(blobSprite(240, 225, 255, 0.16), cx, cy, s * 0.18, s * 0.18)

      // Sparse stars for depth (reuses the starfield set)
      starsRef.current.forEach((st) => {
        const tw = reduce ? 0.7 : Math.sin(time * st.twinkleSpeed * 60 + st.twinklePhase) * 0.3 + 0.7
        ctx.beginPath()
        ctx.arc(st.x, st.y, st.size * 0.8, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${st.opacity * tw * 0.6})`
        ctx.fill()
      })
    }

    // Void's dark swirling black hole: a rotating dust disk, a bright accretion
    // ring, and a pure-black event horizon so the darkness reads through. No stars.
    const drawVoidHole = (time: number) => {
      const w = canvas.width
      const h = canvas.height
      const s = Math.max(w, h)
      const cx = w * 0.5
      const cy = h * 0.5
      const t = reduce ? 0 : time
      const holeR = s * 0.16

      // Swirling accretion dust (cool grey), flattened into a disk.
      ctx.save()
      ctx.globalCompositeOperation = "lighter"
      voidHoleRef.current.forEach((p) => {
        const a = p.angle + t * p.speed
        const x = cx + Math.cos(a) * p.radius
        const y = cy + Math.sin(a) * p.radius * 0.6
        ctx.beginPath()
        ctx.arc(x, y, p.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(205, 210, 225, ${p.op})`
        ctx.fill()
      })
      ctx.restore()

      // Bright accretion ring hugging the event horizon.
      ctx.save()
      ctx.globalCompositeOperation = "lighter"
      ctx.translate(cx, cy)
      ctx.scale(1, 0.6)
      const rg = ctx.createRadialGradient(0, 0, holeR * 0.7, 0, 0, holeR * 1.6)
      rg.addColorStop(0, "rgba(230, 232, 240, 0)")
      rg.addColorStop(0.55, "rgba(230, 232, 240, 0.16)")
      rg.addColorStop(0.78, "rgba(255, 255, 255, 0.28)")
      rg.addColorStop(1, "rgba(230, 232, 240, 0)")
      ctx.fillStyle = rg
      ctx.beginPath()
      ctx.arc(0, 0, holeR * 1.5, 0, Math.PI * 2)
      ctx.fill()
      ctx.restore()

      // Event horizon: a pure-black core, so the blackness comes through.
      const cg = ctx.createRadialGradient(cx, cy, 0, cx, cy, holeR * 1.15)
      cg.addColorStop(0, "rgba(0, 0, 0, 1)")
      cg.addColorStop(0.72, "rgba(0, 0, 0, 0.98)")
      cg.addColorStop(1, "rgba(0, 0, 0, 0)")
      ctx.fillStyle = cg
      ctx.beginPath()
      ctx.arc(cx, cy, holeR * 1.15, 0, Math.PI * 2)
      ctx.fill()
    }

    // Bespin: a warm sun glow with soft, near-white clouds drifting across the
    // light beige sky.
    const drawClouds = (time: number) => {
      const w = canvas.width
      const h = canvas.height
      // Sun: one cached blob rather than a full-canvas gradient fill per frame.
      const sun = Math.max(w, h) * 0.65
      drawBlob(blobSprite(255, 236, 200, 0.4), w * 0.82, h * 0.08, sun, sun)

      cloudsRef.current.forEach((cl) => {
        if (!reduce) {
          cl.x += cl.vx
          if (cl.x - cl.rx > w) cl.x = -cl.rx
          if (cl.x + cl.rx < 0) cl.x = w + cl.rx
        }
        const y = cl.y + (reduce ? 0 : Math.sin(time * 0.2 + cl.ph) * 8)
        // Rounded to 2 decimals so slightly different opacities share a sprite
        // instead of each cloud minting its own.
        drawBlob(blobSprite(255, 250, 240, Math.round(cl.o * 100) / 100), cl.x, y, cl.rx, cl.ry)
      })
    }

    // Geometry: dark, outlined polygons drifting and slowly rotating on the light
    // ground (stroke colour follows the theme's primary, which is near-black here).
    const drawShapes = (time: number) => {
      const col = currentColorRef.current
      ctx.lineWidth = 1.4
      shapesRef.current.forEach((sh) => {
        if (!reduce) {
          sh.rot += sh.vr
          sh.x += sh.vx
          sh.y += sh.vy
          if (sh.x < -80) sh.x = canvas.width + 80
          if (sh.x > canvas.width + 80) sh.x = -80
          if (sh.y < -80) sh.y = canvas.height + 80
          if (sh.y > canvas.height + 80) sh.y = -80
        }
        ctx.save()
        ctx.translate(sh.x, sh.y)
        ctx.rotate(sh.rot)
        ctx.strokeStyle = `rgba(${col}, ${sh.o})`
        ctx.beginPath()
        const k = sh.size / 2
        const off = sh.sides === 3 ? -Math.PI / 2 : sh.sides === 4 ? Math.PI / 4 : 0
        for (let v = 0; v < sh.sides; v++) {
          const a = off + (v / sh.sides) * Math.PI * 2
          const px = Math.cos(a) * k
          const py = Math.sin(a) * k
          if (v === 0) ctx.moveTo(px, py)
          else ctx.lineTo(px, py)
        }
        ctx.closePath()
        ctx.stroke()
        ctx.restore()
      })
    }

    // Slicer / Hacker: glyphs decoding in and out in place, over faint CRT
    // scanlines. Hacker runs slower and brighter than Slicer, which is what
    // distinguishes the two now that neither cascades.
    const drawGlyphField = (time: number, aggressive: boolean) => {
      const w = canvas.width
      const h = canvas.height
      const col = currentColorRef.current
      const rate = aggressive ? 0.6 : 1
      const gain = aggressive ? 1.3 : 1
      // Reduced motion: hold the field at a fixed point in its cycle rather than
      // flickering. Every cell is at a different phase, so it still reads as text.
      const t = reduce ? 12 : time * rate
      ctx.font = `${RAIN_CELL}px ui-monospace, "SF Mono", Menlo, monospace`
      ctx.textBaseline = "top"

      for (const cell of glyphsRef.current) {
        const elapsed = t + cell.offset
        const cycle = Math.floor(elapsed / cell.period)
        const phase = (elapsed % cell.period) / cell.period

        // A quarter decoding, a quarter held, a quarter fading, a quarter dark.
        if (phase > 0.75) continue
        const visible = Math.sin((phase / 0.75) * Math.PI)
        const alpha = visible * cell.peak * gain
        if (alpha < 0.02) continue

        // The glyph is a pure function of (cell, cycle) — plus, while decoding, a
        // fast-advancing term so the character churns before settling. That churn
        // is what reads as "materialising" rather than merely fading in.
        const settling = phase < 0.22 ? Math.floor(phase * 90) : 0
        const glyph = RAIN_GLYPHS[(cell.seed + cycle * 37 + settling * 11) % RAIN_GLYPHS.length]

        const x = cell.col * RAIN_CELL
        const y = cell.row * RAIN_CELL
        ctx.fillStyle =
          cell.hot && phase < 0.35
            ? `rgba(248, 250, 250, ${Math.min(1, alpha * 1.7)})`
            : `rgba(${col}, ${alpha})`
        ctx.fillText(glyph, x, y)
      }

      // Faint CRT scanlines — one fill of a cached repeating pattern.
      if (!scanlinePattern) {
        const off = document.createElement("canvas")
        off.width = 1
        off.height = 3
        const octx = off.getContext("2d")
        if (octx) {
          octx.fillStyle = "rgba(0, 0, 0, 0.18)"
          octx.fillRect(0, 0, 1, 1)
          scanlinePattern = ctx.createPattern(off, "repeat")
        }
      }
      if (scanlinePattern) {
        ctx.fillStyle = scanlinePattern
        ctx.fillRect(0, 0, w, h)
      }
    }

    const drawEmbers = (time: number) => {
      const w = canvas.width
      const h = canvas.height
      const col = currentColorRef.current
      embersRef.current.forEach((em) => {
        if (!reduce) {
          em.y += em.vy
          em.x += em.vx + Math.sin(time * 1.2 + em.ph) * 0.3
          em.o -= em.fl * 0.5
          if (em.y < -8 || em.o <= 0) Object.assign(em, makeEmber(false))
        }
        const flick = reduce ? 0.8 : Math.sin(time * 6 + em.ph) * 0.3 + 0.7
        ctx.beginPath()
        ctx.arc(em.x, em.y, em.r, 0, Math.PI * 2)
        ctx.shadowBlur = 6
        ctx.shadowColor = `rgba(${col}, ${Math.max(0, em.o) * 0.8})`
        ctx.fillStyle = `rgba(${col}, ${Math.max(0, em.o) * flick})`
        ctx.fill()
        ctx.shadowBlur = 0
      })
      const fg = ctx.createLinearGradient(0, h, 0, h * 0.5)
      fg.addColorStop(0, `rgba(${col}, 0.12)`)
      fg.addColorStop(1, `rgba(${col}, 0)`)
      ctx.fillStyle = fg
      ctx.fillRect(0, 0, w, h)
    }

    const drawSnow = (time: number) => {
      const w = canvas.width
      const h = canvas.height
      const col = currentColorRef.current // icy tint, used only for the glow
      snowRef.current.forEach((fk) => {
        if (!reduce) {
          fk.y += fk.vy
          fk.x += Math.sin(time * fk.sway + fk.ph) * fk.swayAmp
          if (fk.y > h + 4) {
            fk.y = -4
            fk.x = Math.random() * w
          }
        }
        // White flakes (snow, not blue stars); the nearer/bigger ones get a soft
        // icy halo so they read as falling snow with depth.
        if (fk.r > 2) {
          ctx.shadowBlur = fk.r * 2.5
          ctx.shadowColor = `rgba(${col}, ${fk.o * 0.5})`
        }
        ctx.beginPath()
        ctx.arc(fk.x, fk.y, fk.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(255, 255, 255, ${fk.o})`
        ctx.fill()
        ctx.shadowBlur = 0
      })
    }

    const drawCity = (time: number) => {
      const scene = cityRef.current
      if (!scene) return
      const w = canvas.width
      const h = canvas.height
      const col = currentColorRef.current

      // Horizon glow
      const hg = ctx.createLinearGradient(0, h, 0, h * 0.4)
      hg.addColorStop(0, `rgba(${col}, 0.14)`)
      hg.addColorStop(1, `rgba(${col}, 0)`)
      ctx.fillStyle = hg
      ctx.fillRect(0, 0, w, h)

      // Building silhouettes
      ctx.fillStyle = "rgba(4, 6, 16, 0.9)"
      scene.buildings.forEach((b) => ctx.fillRect(b.x, h - b.h, b.w, b.h))

      // Lit windows
      scene.windows.forEach((wn) => {
        const fl = reduce ? wn.o : (Math.sin(time * wn.tw * 60 + wn.x) * 0.4 + 0.6) * wn.o
        if (fl < 0.15) return
        ctx.fillStyle = `rgba(${col}, ${fl * 0.9})`
        ctx.fillRect(wn.x, wn.y, 2, 2.5)
      })

      // Horizontal speeder traffic streaking across the sky (amber = theme, some
      // blue for contrast). Bright at the leading edge, fading tail behind.
      scene.lanes.forEach((ln) => {
        if (!reduce) {
          ln.x += ln.sp
          if (ln.x > w + ln.len) ln.x = -ln.len
          if (ln.x < -ln.len) ln.x = w + ln.len
        }
        const dir = ln.sp < 0 ? -1 : 1
        const g = ctx.createLinearGradient(ln.x, ln.y, ln.x + ln.len * dir, ln.y)
        const lc = ln.blue ? "90, 160, 255" : col
        g.addColorStop(0, `rgba(${lc}, 0)`)
        g.addColorStop(1, `rgba(${lc}, ${ln.o})`)
        ctx.strokeStyle = g
        ctx.lineWidth = 1.4
        ctx.beginPath()
        ctx.moveTo(ln.x, ln.y)
        ctx.lineTo(ln.x + ln.len * dir, ln.y)
        ctx.stroke()
      })
    }

    const drawImageBg = (time: number) => {
      const w = canvas.width
      const h = canvas.height
      const img = bgImageRef.current
      if (bgImageReadyRef.current && img && img.naturalWidth) {
        const iw = img.naturalWidth
        const ih = img.naturalHeight
        const baseScale = Math.max(w / iw, h / ih) // cover-fit: fill, crop overflow
        if (reduce) {
          // Frozen, centred cover-fit for reduced-motion.
          const dw = iw * baseScale
          const dh = ih * baseScale
          ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh)
        } else {
          // Ken Burns: a slow zoom "breathe" plus a lazy pan drift across both axes,
          // each on its own long sine so the motion never repeats obviously. The
          // extra zoom (>1) guarantees overflow to pan within, so no edges show.
          const zoom = 1.09 + Math.sin(time * 0.06) * 0.05 // ~1.04–1.14, ~105s period
          const scale = baseScale * zoom
          const dw = iw * scale
          const dh = ih * scale
          const panX = Math.sin(time * 0.05) * 0.5 + 0.5 // 0..1
          const panY = Math.sin(time * 0.038 + 1.0) * 0.5 + 0.5 // 0..1, offset phase
          ctx.drawImage(img, -(dw - w) * panX, -(dh - h) * panY, dw, dh)
        }
        // Gentle darken so the solid content panels sit comfortably over the art.
        ctx.fillStyle = "rgba(6, 9, 14, 0.28)"
        ctx.fillRect(0, 0, w, h)
      } else {
        // Fallback while — or if — the wallpaper is missing: a steel-blue gradient
        // in the theme's mood, so the theme is never a blank void.
        const g = ctx.createLinearGradient(0, 0, w, h)
        g.addColorStop(0, "#10151d")
        g.addColorStop(0.5, "#0a0d12")
        g.addColorStop(1, "#05070a")
        ctx.fillStyle = g
        ctx.fillRect(0, 0, w, h)
      }
      // Vignette to frame the centred content.
      const vg = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75)
      vg.addColorStop(0, "rgba(0,0,0,0)")
      vg.addColorStop(1, "rgba(0,0,0,0.55)")
      ctx.fillStyle = vg
      ctx.fillRect(0, 0, w, h)
      // Warm dust motes (tinted by the accent) drifting up through the light.
      drawDust(time)
    }

    // Slow accent-tinted motes, shared by the Nostalgia wallpaper and the
    // daylight sky. They drift upward and wrap; the twinkle keeps a
    // reduced-motion frame from looking like dead pixels.
    const drawDust = (time: number) => {
      const w = canvas.width
      const h = canvas.height
      const col = currentColorRef.current
      imgDustRef.current.forEach((d) => {
        if (!reduce) {
          d.x += d.vx
          d.y += d.vy
          if (d.y < -4) { d.y = h + 4; d.x = Math.random() * w }
          if (d.x < -4) d.x = w + 4
          else if (d.x > w + 4) d.x = -4
        }
        const tw = reduce ? 1 : Math.sin(time * 1.5 + d.ph) * 0.4 + 0.7
        ctx.beginPath()
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${col}, ${d.o * tw})`
        ctx.fill()
      })
    }

    // The daytime sky light site themes swap to (see `daylight`): the Bespin
    // profile renderer's sun and cloud banks, a warm haze low on the frame for
    // a horizon, and the accent motes. No stars, galaxies or meteors — over a
    // cream page they only ever read as grey specks.
    const drawDaylight = (time: number) => {
      const w = canvas.width
      const h = canvas.height
      drawClouds(time)
      const haze = ctx.createLinearGradient(0, h * 0.72, 0, h)
      haze.addColorStop(0, "rgba(255, 214, 170, 0)")
      haze.addColorStop(1, "rgba(255, 214, 170, 0.38)")
      ctx.fillStyle = haze
      ctx.fillRect(0, h * 0.72, w, h * 0.28)
      drawDust(time)
    }

    const drawProfileBg = (kind: string, time: number) => {
      if (kind === "image") drawImageBg(time)
      else if (kind === "nebula") drawBigNebula(time)
      else if (kind === "voidhole") drawVoidHole(time)
      else if (kind === "embers") drawEmbers(time)
      else if (kind === "snow") drawSnow(time)
      else if (kind === "city") drawCity(time)
      else if (kind === "clouds") drawClouds(time)
      else if (kind === "shapes") drawShapes(time)
      else if (kind === "coderain") drawGlyphField(time, false)
      else if (kind === "hackerrain") drawGlyphField(time, true)
    }

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const time = Date.now() * 0.001

      // Profile themes with a custom background take their own renderer and skip
      // the starfield/meteor/hyperspace path entirely.
      const kind = bgKindRef.current
      if (kind !== "starfield") {
        drawProfileBg(kind, time)
        animationFrameIdRef.current = requestAnimationFrame(animate)
        return
      }

      // Light site themes (Cloud City) trade the starfield for the daytime
      // sky. Hyperspace quietly no-ops here — there are no stars to streak in
      // daylight, and the balancer's trigger is harmless without them.
      if (daylight) {
        drawDaylight(time)
        animationFrameIdRef.current = requestAnimationFrame(animate)
        return
      }

      const isHyperspace = hyperspaceRef.current
      const color = currentColorRef.current

      // Draw nebulas
      if (!isHyperspace) {
        nebulasRef.current.forEach((nebula) => {
          ctx.save()
          ctx.translate(nebula.x, nebula.y)
          ctx.rotate(nebula.rotation)
          ctx.scale(1, nebula.radiusY / nebula.radiusX)

          const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, nebula.radiusX)
          gradient.addColorStop(0,   `rgba(${nebula.r}, ${nebula.g}, ${nebula.b}, ${nebula.opacity})`)
          gradient.addColorStop(0.4, `rgba(${nebula.r}, ${nebula.g}, ${nebula.b}, ${nebula.opacity * 0.5})`)
          gradient.addColorStop(1,   `rgba(${nebula.r}, ${nebula.g}, ${nebula.b}, 0)`)

          ctx.beginPath()
          ctx.arc(0, 0, nebula.radiusX, 0, Math.PI * 2)
          ctx.fillStyle = gradient
          ctx.fill()
          ctx.restore()
        })

        // Draw galaxies (spiral arm pattern via dots)
        galaxiesRef.current.forEach((galaxy) => {
          ctx.save()
          ctx.translate(galaxy.x, galaxy.y)
          ctx.rotate(galaxy.rotation)

          // Soft core glow
          const coreGrad = ctx.createRadialGradient(0, 0, 0, 0, 0, galaxy.radius * 0.3)
          coreGrad.addColorStop(0, `rgba(255, 240, 200, ${galaxy.opacity * 1.2})`)
          coreGrad.addColorStop(1, `rgba(255, 240, 200, 0)`)
          ctx.beginPath()
          ctx.arc(0, 0, galaxy.radius * 0.3, 0, Math.PI * 2)
          ctx.fillStyle = coreGrad
          ctx.fill()

          // Spiral arms
          for (let arm = 0; arm < galaxy.arms; arm++) {
            const armOffset = (arm / galaxy.arms) * Math.PI * 2
            for (let i = 0; i < 60; i++) {
              const t = i / 60
              const angle = armOffset + t * Math.PI * 3
              const r = t * galaxy.radius
              const px = Math.cos(angle) * r
              const py = Math.sin(angle) * r * 0.4
              const dotOpacity = galaxy.opacity * (1 - t) * 0.9
              const dotSize = (1 - t) * 1.5 + 0.3
              ctx.beginPath()
              ctx.arc(px, py, dotSize, 0, Math.PI * 2)
              ctx.fillStyle = `rgba(200, 220, 255, ${dotOpacity})`
              ctx.fill()
            }
          }

          // Outer haze
          const hazeGrad = ctx.createRadialGradient(0, 0, galaxy.radius * 0.2, 0, 0, galaxy.radius)
          hazeGrad.addColorStop(0, `rgba(160, 180, 255, ${galaxy.opacity * 0.4})`)
          hazeGrad.addColorStop(1, `rgba(160, 180, 255, 0)`)
          ctx.save()
          ctx.scale(1, 0.4)
          ctx.beginPath()
          ctx.arc(0, 0, galaxy.radius, 0, Math.PI * 2)
          ctx.fillStyle = hazeGrad
          ctx.fill()
          ctx.restore()

          ctx.restore()
        })
      }

      // Draw stars
      starsRef.current.forEach((star) => {
        const twinkle = Math.sin(time * star.twinkleSpeed * 60 + star.twinklePhase) * 0.3 + 0.7
        const currentOpacity = star.opacity * twinkle

        if (isHyperspace) {
          // Hyperspace streaking effect
          const streakLength = 30 + star.size * 20
          const gradient = ctx.createLinearGradient(
            star.x,
            star.y,
            star.x,
            star.y + streakLength
          )
          gradient.addColorStop(0, `rgba(${color}, ${currentOpacity})`)
          gradient.addColorStop(1, `rgba(${color}, 0)`)

          ctx.beginPath()
          ctx.moveTo(star.x, star.y)
          ctx.lineTo(star.x, star.y + streakLength)
          ctx.strokeStyle = gradient
          ctx.lineWidth = star.size * 2
          ctx.stroke()

          star.y += 15
          if (star.y > canvas.height) {
            star.y = -10
            star.x = Math.random() * canvas.width
          }
        } else {
          // Normal twinkling stars
          ctx.beginPath()
          ctx.arc(star.x, star.y, star.size, 0, Math.PI * 2)

          // Add glow for larger stars
          if (star.size > 1) {
            ctx.shadowBlur = star.size * 4
            ctx.shadowColor = `rgba(${color}, ${currentOpacity * 0.5})`
          }

          // Mix white with theme color for more realistic stars
          const starColor = star.size > 1.2
            ? `rgba(${color}, ${currentOpacity})`
            : `rgba(255, 255, 255, ${currentOpacity})`

          ctx.fillStyle = starColor
          ctx.fill()
          ctx.shadowBlur = 0
        }
      })

      // Handle meteors (only when not in hyperspace)
      if (!isHyperspace) {
        const now = Date.now()
        if (now - lastMeteorTime > meteorInterval + Math.random() * 2000) {
          const inactiveMeteor = meteorsRef.current.find((m) => !m.active)
          if (inactiveMeteor) {
            Object.assign(inactiveMeteor, createMeteor(canvas, true))
            inactiveMeteor.active = true
          }
          lastMeteorTime = now
        }

        meteorsRef.current.forEach((meteor) => {
          if (!meteor.active) return

          // Update meteor position
          meteor.x += Math.cos(meteor.angle) * meteor.speed
          meteor.y += Math.sin(meteor.angle) * meteor.speed

          // Draw meteor trail
          const tailX = meteor.x - Math.cos(meteor.angle) * meteor.length
          const tailY = meteor.y - Math.sin(meteor.angle) * meteor.length

          const gradient = ctx.createLinearGradient(tailX, tailY, meteor.x, meteor.y)
          gradient.addColorStop(0, `rgba(${color}, 0)`)
          gradient.addColorStop(0.7, `rgba(${color}, ${meteor.opacity * 0.5})`)
          gradient.addColorStop(1, `rgba(255, 255, 255, ${meteor.opacity})`)

          ctx.beginPath()
          ctx.moveTo(tailX, tailY)
          ctx.lineTo(meteor.x, meteor.y)
          ctx.strokeStyle = gradient
          ctx.lineWidth = 2
          ctx.lineCap = "round"
          ctx.stroke()

          // Meteor head glow
          ctx.beginPath()
          ctx.arc(meteor.x, meteor.y, 2, 0, Math.PI * 2)
          ctx.shadowBlur = 10
          ctx.shadowColor = `rgba(255, 255, 255, ${meteor.opacity})`
          ctx.fillStyle = `rgba(255, 255, 255, ${meteor.opacity})`
          ctx.fill()
          ctx.shadowBlur = 0

          // Deactivate if off screen
          if (meteor.y > canvas.height + 100 || meteor.x > canvas.width + 100 || meteor.x < -100) {
            meteor.active = false
          }
        })
      }

      animationFrameIdRef.current = requestAnimationFrame(animate)
    }

    // requestAnimationFrame stops in a hidden tab, but meteors are advanced per
    // FRAME and only retired once a frame finds them off-screen. So everything in
    // flight when you switch away freezes mid-arc and stays active, and the whole
    // lot resumes at once when you come back — the "shower" on return. Park the
    // loop while hidden, and clear the sky before restarting so nothing survives
    // the gap. The spawn clock is rebased too, or the first frame back would fire
    // immediately on a stale timestamp.
    const handleVisibility = () => {
      if (document.hidden) {
        if (animationFrameIdRef.current) cancelAnimationFrame(animationFrameIdRef.current)
        animationFrameIdRef.current = undefined
        return
      }
      meteorsRef.current.forEach((m) => (m.active = false))
      lastMeteorTime = Date.now()
      if (animationFrameIdRef.current === undefined) animate()
    }
    document.addEventListener("visibilitychange", handleVisibility)

    animate()

    return () => {
      window.removeEventListener("resize", resizeCanvas)
      document.removeEventListener("visibilitychange", handleVisibility)
      observer.disconnect()
      if (animationFrameIdRef.current) {
        cancelAnimationFrame(animationFrameIdRef.current)
      }
      if (hyperspaceTimeoutRef.current) {
        clearTimeout(hyperspaceTimeoutRef.current)
      }
    }
  }, [])

  return (
    // will-change pins the starfield to its own compositing layer. Without it,
    // hovering anything that transforms (the /players rows) promotes that element
    // and forces the canvas underneath to re-rasterize, which reads as the
    // background shifting behind whatever you point at. Cards with translucent
    // backgrounds make it especially visible, since the sky shows through them.
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ background: "transparent", willChange: "transform" }}
    />
  )
})

BackgroundParticles.displayName = "BackgroundParticles"
