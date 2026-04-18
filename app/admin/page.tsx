import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PlayerManagementTable } from "@/components/player-management-table"
import { AdminMatchLog } from "@/components/admin-match-log"
import { RankSuggestions } from "@/components/rank-suggestions"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { LogOut, Home, Settings } from "lucide-react"

export default async function AdminPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  async function handleLogout() {
    "use server"
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect("/auth/login")
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <Link href="/" className="hover:opacity-80 transition-opacity">
              <h1 className="text-2xl font-bold">JK2 Team Balancer</h1>
            </Link>
            <span className="text-sm text-muted-foreground">Admin Panel</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-muted-foreground">{user.email}</span>
            <Link href="/admin/settings">
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </Link>
            <Link href="/">
              <Button variant="outline" size="sm">
                <Home className="h-4 w-4 mr-2" />
                Back to Balancer
              </Button>
            </Link>
            <form action={handleLogout}>
              <Button variant="outline" size="sm" type="submit">
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </form>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 space-y-12">
        <section>
          <div className="mb-6">
            <h2 className="text-3xl font-bold mb-2">Player Management</h2>
            <p className="text-muted-foreground">
              Add, edit, or remove players. Changes are saved automatically and will be reflected in the team balancer
              immediately.
            </p>
          </div>
          <PlayerManagementTable />
        </section>

        <section>
          <div className="mb-6">
            <h2 className="text-3xl font-bold mb-2">Log Match</h2>
            <p className="text-muted-foreground">
              Record match results to track win/loss statistics for players.
            </p>
          </div>
          <AdminMatchLog />
        </section>

        <section>
          <div className="mb-6">
            <h2 className="text-3xl font-bold mb-2">Rank Suggestions</h2>
            <p className="text-muted-foreground">
              Players who are consistently over- or under-performing relative to their tier, based on match history analysis.
            </p>
          </div>
          <RankSuggestions />
        </section>
      </main>
    </div>
  )
}
