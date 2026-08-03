"use client"

import { useSearchParams } from "next/navigation"
import { Suspense } from "react"
import { DemoViewer } from "@/components/demo-viewer"

/**
 * Demo viewer.
 *
 * Takes the demo to play from the URL for now -- `?demo=<url>&duration=<seconds>`
 * -- so it can be pointed at anything while the library and its ingest are still
 * being built. Deep links into a moment and a camera come next; the viewer
 * already exposes everything they need.
 */
function DemosPage() {
  const params = useSearchParams()
  const demo = params.get("demo")
  const duration = Number(params.get("duration") || 0) * 1000

  return (
    <main className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Demos</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Watch a recorded match in the browser. Switch between any player&apos;s point of view, or
          detach the camera and fly around.
        </p>
      </header>

      {demo ? (
        <div className="aspect-video w-full">
          <DemoViewer demoUrl={demo} durationMs={duration} />
        </div>
      ) : (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No demo selected. Add <code className="font-mono">?demo=</code> with the URL of a{" "}
          <code className="font-mono">.dm_15</code> file.
        </div>
      )}
    </main>
  )
}

export default function Page() {
  // useSearchParams needs a Suspense boundary to keep the route static-friendly.
  return (
    <Suspense fallback={null}>
      <DemosPage />
    </Suspense>
  )
}
