"use client"

import { useEffect, useRef, forwardRef, useImperativeHandle } from "react"

interface Particle {
  x: number
  y: number
  size: number
  speedX: number
  speedY: number
  opacity: number
}

export interface BackgroundParticlesRef {
  triggerHyperspace: () => void
}

export const BackgroundParticles = forwardRef<BackgroundParticlesRef>((props, ref) => {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const particlesRef = useRef<Particle[]>([])
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
        // Convert hex to RGB
        const hex = primaryColor.replace("#", "")
        const r = parseInt(hex.substring(0, 2), 16)
        const g = parseInt(hex.substring(2, 4), 16)
        const b = parseInt(hex.substring(4, 6), 16)
        currentColorRef.current = `${r}, ${g}, ${b}`
      }
    }

    // Set canvas size
    const resizeCanvas = () => {
      canvas.width = window.innerWidth
      canvas.height = window.innerHeight
    }
    resizeCanvas()
    window.addEventListener("resize", resizeCanvas)

    updateThemeColor()
    const observer = new MutationObserver(updateThemeColor)
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["style"],
    })

    const particleCount = 100
    const particles: Particle[] = []

    for (let i = 0; i < particleCount; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        size: Math.random() * 2 + 0.5,
        speedX: (Math.random() - 0.5) * 0.3,
        speedY: (Math.random() - 0.5) * 0.3,
        opacity: Math.random() * 0.5 + 0.3,
      })
    }

    particlesRef.current = particles

    // Animation loop
    const animate = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height)

      const isHyperspace = hyperspaceRef.current
      const speedMultiplier = isHyperspace ? 15 : 1
      const color = currentColorRef.current

      particles.forEach((particle) => {
        // Update position with hyperspace multiplier
        particle.x += particle.speedX * speedMultiplier
        particle.y += particle.speedY * speedMultiplier

        // Wrap around edges
        if (particle.x < 0) particle.x = canvas.width
        if (particle.x > canvas.width) particle.x = 0
        if (particle.y < 0) particle.y = canvas.height
        if (particle.y > canvas.height) particle.y = 0

        const needsGlow = particle.size > 1.5
        if (needsGlow) {
          ctx.shadowBlur = isHyperspace ? 20 : 10
          ctx.shadowColor = `rgba(${color}, 0.5)`
        }

        // Draw particle
        ctx.beginPath()
        ctx.arc(particle.x, particle.y, particle.size, 0, Math.PI * 2)
        ctx.fillStyle = `rgba(${color}, ${particle.opacity})`
        ctx.fill()

        if (needsGlow) {
          ctx.shadowBlur = 0
        }

        if (isHyperspace) {
          ctx.beginPath()
          ctx.moveTo(particle.x, particle.y)
          ctx.lineTo(particle.x - particle.speedX * 8, particle.y - particle.speedY * 8)
          ctx.strokeStyle = `rgba(${color}, ${particle.opacity * 0.3})`
          ctx.lineWidth = particle.size
          ctx.stroke()
        }
      })

      if (!isHyperspace) {
        const maxDistance = 100
        const maxConnections = 3

        for (let i = 0; i < particles.length; i++) {
          const p1 = particles[i]
          let connectionCount = 0

          for (let j = i + 1; j < particles.length && connectionCount < maxConnections; j++) {
            const p2 = particles[j]
            const dx = p1.x - p2.x
            const dy = p1.y - p2.y

            const distSquared = dx * dx + dy * dy
            const maxDistSquared = maxDistance * maxDistance

            if (distSquared < maxDistSquared) {
              const distance = Math.sqrt(distSquared)
              ctx.beginPath()
              ctx.moveTo(p1.x, p1.y)
              ctx.lineTo(p2.x, p2.y)
              ctx.strokeStyle = `rgba(${color}, ${0.15 * (1 - distance / maxDistance)})`
              ctx.lineWidth = 0.5
              ctx.stroke()
              connectionCount++
            }
          }
        }
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
