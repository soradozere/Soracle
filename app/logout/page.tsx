import { redirect } from "next/navigation"
import { cookies } from "next/headers"
import { createClient } from "@/lib/supabase/server"
import { createServiceClient } from "@/lib/supabase/admin"
import { PLAYER_SESSION_COOKIE, verifySessionValue } from "@/lib/player-auth"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { Home, LogOut } from "lucide-react"

/*
 * Sign-out screen for both ways of being signed in.
 *
 * There are two independent sessions on this site: Supabase Auth for admins,
 * and the soracle_player cookie for players. This page only knew about the
 * first, so a signed-in player pressing "Sign out" found no Supabase user, got
 * redirected to the ADMIN login, and stayed logged in the whole time -- the one
 * thing they had asked not to be.
 *
 * It now reports whichever sessions exist and ends all of them together.
 * Signing out of one and silently leaving the other is how you end up believing
 * you have logged out of a shared machine when you have not.
 */
export default async function LogoutPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const cookieStore = await cookies()
  const playerId = verifySessionValue(cookieStore.get(PLAYER_SESSION_COOKIE)?.value)

  let playerName: string | null = null
  if (playerId) {
    const { data } = await createServiceClient().from("players").select("name").eq("id", playerId).maybeSingle()
    playerName = data?.name ?? null
  }

  // Nothing to sign out of: home, rather than a login form nobody asked for.
  if (!user && !playerId) redirect("/")

  async function handleLogout() {
    "use server"
    const supabase = await createClient()
    // Only call signOut when there is a Supabase session; on a player-only
    // session this is a no-op that can still error on a missing refresh token.
    const {
      data: { user: current },
    } = await supabase.auth.getUser()
    if (current) await supabase.auth.signOut()

    const jar = await cookies()
    jar.set(PLAYER_SESSION_COOKIE, "", { path: "/", maxAge: 0 })

    redirect("/")
  }

  const signedInAs = [playerName && `${playerName}`, user?.email].filter(Boolean).join(" · ")

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Log out</CardTitle>
          <CardDescription>
            You&apos;re signed in as {signedInAs}
            {user && playerId && " — both sessions will end"}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form action={handleLogout}>
            <Button type="submit" className="w-full">
              <LogOut className="h-4 w-4 mr-2" />
              Log out
            </Button>
          </form>
          <Link href="/">
            <Button variant="outline" className="w-full">
              <Home className="h-4 w-4 mr-2" />
              Back to Balancer
            </Button>
          </Link>
        </CardContent>
      </Card>
    </div>
  )
}
