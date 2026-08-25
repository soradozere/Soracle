import { createServerClient } from "@supabase/ssr"
import { NextResponse, type NextRequest } from "next/server"

// Mirrors PLAYER_SESSION_COOKIE in lib/player-auth.ts (name only, not
// imported: that module pulls in Node's `crypto`, which the Edge Runtime
// middleware runs in doesn't support). Keep this string in sync if that one
// ever changes.
const PLAYER_SESSION_COOKIE = "soracle_player"

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({
    request,
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({
            request,
          })
          cookiesToSet.forEach(({ name, value, options }) => supabaseResponse.cookies.set(name, value, options))
        },
      },
    },
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Redirect unauthenticated users trying to access admin routes -- unless
  // they carry a player-login session cookie, which might belong to a player
  // promoted to full_admin (scripts/044_add_player_admin_roles.sql). This is
  // only a cheap presence check, not signature/role verification (Node's
  // `crypto`, needed for that, isn't available in this Edge Runtime) -- the
  // real check is requireFullAdminPage() (lib/player-role.ts), which runs
  // next in Node.js and redirects home if the cookie turns out to be invalid,
  // expired, or not actually full_admin.
  if (
    !user &&
    request.nextUrl.pathname.startsWith("/admin") &&
    !request.nextUrl.pathname.startsWith("/auth") &&
    !request.cookies.get(PLAYER_SESSION_COOKIE)?.value
  ) {
    const url = request.nextUrl.clone()
    url.pathname = "/auth/login"
    return NextResponse.redirect(url)
  }

  return supabaseResponse
}
