import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { MODEL_BUCKET, MODEL_URL_TTL_SECONDS, findPlayerModel } from "@/lib/player-models"

// Mints a short-lived signed URL for a JK2 player model.
//
// The .glb files are Raven/Activision assets, so they aren't committed to this
// (public) repo and aren't served from /public in production. They sit in a
// PRIVATE Supabase Storage bucket, and this route hands out links that expire.
//
// To be clear about what that does and doesn't achieve: anything the browser
// renders can be downloaded from the network tab — that's unavoidable and not
// what this is for. What it buys is no permanent public URL to hotlink or
// index, links that die shortly after they're handed out, revocability, and
// the assets staying out of git history.
//
// The `id` is looked up in the catalogue rather than used as a path, so this
// route can only ever sign objects we ship — no traversal, no enumeration.

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const model = findPlayerModel(searchParams.get("id"))

  if (!model) {
    return NextResponse.json({ error: "Unknown model" }, { status: 404 })
  }

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.storage
      .from(MODEL_BUCKET)
      .createSignedUrl(model.file, MODEL_URL_TTL_SECONDS)

    if (error || !data?.signedUrl) {
      return fallback(model.file, error?.message ?? "No signed URL returned")
    }

    return NextResponse.json(
      { url: data.signedUrl, source: "storage" },
      // Cache well inside the TTL so a reload reuses the link rather than
      // minting a new one, but never so long that we hand out a dead URL.
      { headers: { "Cache-Control": `private, max-age=${Math.floor(MODEL_URL_TTL_SECONDS / 2)}` } },
    )
  } catch (err) {
    return fallback(model.file, err instanceof Error ? err.message : "Storage unavailable")
  }
}

// Before the bucket exists, fall back to the local file under /public so
// development keeps working. That file is gitignored, so this resolves to a 404
// in any environment where it hasn't been placed by hand — which is the honest
// outcome: it means the bucket isn't set up yet. `source` says which path was
// taken so the UI can show it rather than failing silently.
function fallback(file: string, reason: string) {
  return NextResponse.json(
    { url: `/models/${file}`, source: "local", reason },
    { headers: { "Cache-Control": "no-store" } },
  )
}
