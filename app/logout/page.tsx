import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import Link from "next/link"
import { Home, LogOut } from "lucide-react"

// Simple sign-out screen. The "Admin" nav button sends match admins (captains)
// here since they have no admin panel; full admins can use it too.
export default async function LogoutPage() {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) redirect("/auth/login")

  async function handleLogout() {
    "use server"
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect("/")
  }

  return (
    <div className="flex min-h-svh w-full items-center justify-center p-6 md:p-10">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle className="text-2xl">Log out</CardTitle>
          <CardDescription>You&apos;re signed in as {user.email}</CardDescription>
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
