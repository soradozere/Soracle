import { updateSession } from "@/lib/supabase/middleware"
import type { NextRequest } from "next/server"

export async function middleware(request: NextRequest) {
  return await updateSession(request)
}

// 3D model assets (.glb/.gltf and their external .bin buffers) are excluded
// alongside the image formats: they're static public files, so running the
// Supabase session refresh on every model fetch is pure overhead.
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|glb|gltf|bin)$).*)"],
}
