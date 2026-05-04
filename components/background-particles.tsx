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

export interface BackgroundParticlesRef {
  triggerHyperspace: () => void
}

export const BackgroundParticles = forwardRef<BackgroundParticlesRef>((props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const starsRef = useRef<Star[]>([])
  const meteorsRef = useRef<Meteor[]>([])
  const nebulasRef = useRef<Nebula[]>([])
  const galaxiesRef = useRef<Galaxy[]>([])
  const hyperspaceRef = useRef(false)
  const hyperspaceTimeoutRef = useRef<NodeJS.Timeout>()
  const animationFrameIdRef = useRef<number>()
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

    const updateThemeColor = () => {
      const primaryColor = getComputedStyle(document.documentElement).getPropertyValue("--color-primary").trim()
      if (primaryColor) {
        const hex = primaryColor.replace("#", "")
        const r = parseInt(hex.substring(0, 2), 16)
        const g = parseInt(hex.substring(2, 4), 16)
        const b = parseInt(hex.substring(4, 6), 16)
        currentColorRef.current = `${r}, ${g}, ${b}`
      }
    }

    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
      initStars()
      initNebulas()
      initGalaxies()
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

    resizeCanvas()
    initMeteors()
    window.addEventListener("resize", resizeCanvas)

    updateThemeColor()
    const observer = new MutationObserver(updateThemeColor)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    })

    let lastMeteorTime = Date.now()
    const meteorInterval = 3000

    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const isHyperspace = hyperspaceRef.current
      const color = currentColorRef.current
      const time = Date.now() * 0.001

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

    animate()

    return () => {
      window.removeEventListener("resize", resizeCanvas)
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
    <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none z-0" style={{ background: "transparent" }} />
  )
})

BackgroundParticles.displayName = "BackgroundParticles"
