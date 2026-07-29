import { NextResponse } from "next/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { MODEL_BUCKET, MODEL_URL_TTL_SECONDS, findPlayerModel, findSkinAsset } from "@/lib/player-models"
import { findPropAsset } from "@/lib/prop-assets"

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
// route can only ever sign objects we ship — no traversal, no enumeration. It
// serves three catalogues: player models, the skin textures that repaint them,
// and the shared props (saber hilt, blade textures) that hang off them.
//
// Two shapes: `?id=` resolves one asset (the model .glb), `?ids=a,b,c`
// resolves a set in ONE storage round trip via createSignedUrls. The batch
// shape exists because a dressed profile wants up to a dozen small assets at
// once — skin textures, hilt, blade pair, mines, flag — and minting them one
// serverless invocation at a time was most of the profile's request count.

/** More than any legitimate loadout can ask for, small enough to stay bounded. */
const MAX_BATCH = 64

function resolveFile(id: string | null) {
  return findPlayerModel(id)?.file ?? findSkinAsset(id) ?? findPropAsset(id)
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url)
  const batchParam = searchParams.get("ids")
  if (batchParam !== null) return resolveBatch(batchParam)

  const id = searchParams.get("id")
  const file = resolveFile(id)

  if (!file) {
    return NextResponse.json({ error: "Unknown model" }, { status: 404 })
  }

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.storage
      .from(MODEL_BUCKET)
      .createSignedUrl(file, MODEL_URL_TTL_SECONDS)

    if (error || !data?.signedUrl) {
      return fallback(file, error?.message ?? "No signed URL returned")
    }

    return NextResponse.json(
      { url: data.signedUrl, source: "storage" },
      // Cache well inside the TTL so a reload reuses the link rather than
      // minting a new one, but never so long that we hand out a dead URL.
      { headers: { "Cache-Control": `private, max-age=${Math.floor(MODEL_URL_TTL_SECONDS / 2)}` } },
    )
  } catch (err) {
    return fallback(file, err instanceof Error ? err.message : "Storage unavailable")
  }
}

async function resolveBatch(param: string) {
  const ids = param.split(",").filter(Boolean)
  if (ids.length === 0 || ids.length > MAX_BATCH) {
    return NextResponse.json({ error: "Bad batch" }, { status: 400 })
  }

  // All-or-nothing, mirroring useAssetUrls: one unknown id fails the request
  // rather than handing back a partial set someone then renders half-dressed.
  const files = ids.map((id) => ({ id, file: resolveFile(id) }))
  const unknown = files.find((f) => !f.file)
  if (unknown) {
    return NextResponse.json({ error: `Unknown asset: ${unknown.id}` }, { status: 404 })
  }

  try {
    const supabase = createServiceClient()
    const { data, error } = await supabase.storage
      .from(MODEL_BUCKET)
      .createSignedUrls(
        files.map((f) => f.file as string),
        MODEL_URL_TTL_SECONDS,
      )

    if (error || !data) {
      return batchFallback(files, error?.message ?? "No signed URLs returned")
    }

    // createSignedUrls answers in input order; any entry can fail individually.
    const urls: Record<string, string> = {}
    for (let i = 0; i < files.length; i++) {
      const signed = data[i]?.signedUrl
      if (!signed) return batchFallback(files, data[i]?.error ?? "No signed URL returned")
      urls[files[i].id] = signed
    }

    return NextResponse.json(
      { urls, source: "storage" },
      { headers: { "Cache-Control": `private, max-age=${Math.floor(MODEL_URL_TTL_SECONDS / 2)}` } },
    )
  } catch (err) {
    return batchFallback(files, err instanceof Error ? err.message : "Storage unavailable")
  }
}

function batchFallback(files: { id: string; file: string | undefined | null }[], reason: string) {
  return NextResponse.json(
    {
      urls: Object.fromEntries(files.map((f) => [f.id, `/models/${f.file}`])),
      source: "local",
      reason,
    },
    { headers: { "Cache-Control": "no-store" } },
  )
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
