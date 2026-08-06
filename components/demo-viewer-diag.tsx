"use client"

import { useEffect, useState } from "react"
import {
  bytesToMb,
  getHeapBytes,
  getPeakHeapBytes,
  readWebglInfo,
  startFpsMeter,
  subscribeDiagEvents,
  watchContextLoss,
  type DiagEvent,
  type WebglInfo,
} from "@/lib/demo-viewer/diagnostics"

/**
 * The `?diag=1` overlay.
 *
 * Written to be read off a phone screen by someone standing up, and then
 * screenshotted -- that is the whole reporting mechanism, so every figure has
 * to be legible at arm's length and none of it may cover the picture it is
 * measuring. It sits over the top-right corner, where the viewer draws nothing.
 *
 * Deliberately not interactive. A panel that could be tapped would be a panel
 * competing with the tap-to-show-controls gesture underneath it.
 */
export function DemoViewerDiag({ canvas }: { canvas: HTMLCanvasElement | null }) {
  const [fps, setFps] = useState<number | null>(null)
  const [heap, setHeap] = useState<{ now: number; peak: number } | null>(null)
  const [size, setSize] = useState<{ backing: string; css: string } | null>(null)
  const [gl, setGl] = useState<WebglInfo | null>(null)
  const [events, setEvents] = useState<DiagEvent[]>([])

  useEffect(() => startFpsMeter(setFps), [])
  useEffect(() => subscribeDiagEvents(setEvents), [])
  useEffect(() => {
    if (!canvas) return
    return watchContextLoss(canvas)
  }, [canvas])

  /*
   * Polled rather than driven by the render loop.
   *
   * These change slowly -- the heap grows in steps, the canvas is resized only
   * when the window is -- and re-rendering this panel at frame rate would show
   * up in the very FPS figure it is displaying.
   */
  useEffect(() => {
    const read = () => {
      const now = getHeapBytes()
      const peak = getPeakHeapBytes()
      setHeap(now === null || peak === null ? null : { now: bytesToMb(now), peak: bytesToMb(peak) })
      if (canvas) {
        const rect = canvas.getBoundingClientRect()
        setSize({
          backing: `${canvas.width}×${canvas.height}`,
          css: `${Math.round(rect.width)}×${Math.round(rect.height)}`,
        })
      }
    }
    read()
    const timer = setInterval(read, 500)
    return () => clearInterval(timer)
  }, [canvas])

  /*
   * Asked for repeatedly until it answers. The engine creates its GL context
   * partway through boot, so the first look almost always finds nothing, and a
   * one-shot read on mount would leave this blank for the whole session.
   */
  useEffect(() => {
    if (!canvas || gl) return
    const attempt = () => {
      const info = readWebglInfo(canvas)
      if (info) setGl(info)
    }
    attempt()
    const timer = setInterval(attempt, 1000)
    return () => clearInterval(timer)
  }, [canvas, gl])

  return (
    <div
      // Above the viewer chrome, below nothing. pointer-events-none so every
      // gesture underneath still reaches the picture.
      className="pointer-events-none absolute right-2 top-2 z-50 max-w-[min(19rem,60vw)] rounded-lg bg-black/80 px-2.5 py-2 font-mono text-[10px] leading-relaxed text-white/85 backdrop-blur-sm"
    >
      <div className="mb-1 text-[9px] uppercase tracking-[0.16em] text-cyan-300/80">diagnostics</div>

      <Row label="heap" value={heap ? `${heap.now} MB  (peak ${heap.peak})` : "unavailable"} />
      <Row label="fps" value={fps === null ? "…" : String(fps)} />
      <Row label="dpr" value={String(typeof window === "undefined" ? "?" : window.devicePixelRatio)} />
      <Row label="canvas" value={size ? size.backing : "…"} />
      <Row label="css" value={size ? size.css : "…"} />
      <Row label="gl" value={gl ? gl.version : "…"} />
      <Row label="gpu" value={gl ? gl.renderer : "…"} />
      <Row label="maxtex" value={gl ? String(gl.maxTextureSize) : "…"} />

      {/* Only once something has happened -- an empty log is noise. */}
      {events.length > 0 && (
        <div className="mt-1.5 border-t border-white/15 pt-1.5">
          {events.map((e) => (
            <div key={`${e.at}-${e.text}`} className="text-amber-300/90">
              {new Date(e.at).toLocaleTimeString()} {e.text}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <span className="w-12 shrink-0 text-white/40">{label}</span>
      {/* break-all because a GPU string is one long unspaced token and would
          otherwise push the panel off the side of a phone screen. */}
      <span className="break-all">{value}</span>
    </div>
  )
}
