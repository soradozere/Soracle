import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { PlayerManagementTable } from "@/components/player-management-table"
import { AdminMatchLog } from "@/components/admin-match-log"
import { RankSuggestions } from "@/components/rank-suggestions"
import { AutoCalibrationToggle } from "@/components/auto-calibration-toggle"
import { AdminHeader, AdminSection } from "@/components/admin-header"
import { Button } from "@/components/ui/button"
import { ExportDataButton } from "@/components/export-data-button"
import { readAutoCalibrationEnabled } from "@/lib/calibration"
import Link from "next/link"
import { LogOut, Home, Settings, Youtube } from "lucide-react"

export default async function AdminPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  // Full-admin only. Match admins (captains) can sign in but must not reach the
  // admin panel — bounce them to the main app (their tools live on Match History).
  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (isAdmin !== true) {
    redirect("/")
  }

  const autoCalibration = await readAutoCalibrationEnabled(supabase)

  async function handleLogout() {
    "use server"
    const supabase = await createClient()
    await supabase.auth.signOut()
    redirect("/auth/login")
  }

  return (
    <div className="min-h-screen" style={{ background: "var(--color-background)" }}>
      <AdminHeader
        title="Admin Panel"
        subtitle={`JK2 Capture the Flag · signed in as ${user.email}`}
        actions={
          <>
            <ExportDataButton />
            <Link href="/admin/renders">
              <Button variant="outline" size="sm">
                <Youtube className="h-4 w-4 mr-2" />
                Renders
              </Button>
            </Link>
            <Link href="/admin/settings">
              <Button variant="outline" size="sm">
                <Settings className="h-4 w-4 mr-2" />
                Settings
              </Button>
            </Link>
            <span className="w-px h-6 hidden sm:block" style={{ backgroundColor: "var(--glass-hair)" }} />
            <Link href="/">
              <Button variant="outline" size="sm">
                <Home className="h-4 w-4 mr-2" />
                Back to Site
              </Button>
            </Link>
            <form action={handleLogout}>
              <Button variant="outline" size="sm" type="submit">
                <LogOut className="h-4 w-4 mr-2" />
                Logout
              </Button>
            </form>
          </>
        }
      />

      {/* Full-width: the player table is the whole point of this page, and the
          default container cap left it cramped in dead gutters at 100% zoom. */}
      <main className="w-full px-6 py-8 space-y-8">
        <AdminSection
          title="Auto-Calibration"
          description="Adjusts player tiers from match results as the season is played — promotions on form, demotions on slumps, starting from the hand-set tier list. While off, tiers only change when an admin edits them. Admin edits always win either way."
          headerRight={<AutoCalibrationToggle initialEnabled={autoCalibration} />}
        />

        <AdminSection
          title="Player Management"
          description="Add, edit, or remove players. Changes are saved automatically and will be reflected in the team balancer immediately."
        >
          <PlayerManagementTable />
        </AdminSection>

        <AdminSection title="Log Match" description="Record match results to track win/loss statistics for players.">
          <AdminMatchLog />
        </AdminSection>

        <AdminSection
          title="Rank Suggestions"
          description="Players who are consistently over- or under-performing relative to their tier, based on match history analysis."
        >
          <RankSuggestions />
        </AdminSection>
      </main>
    </div>
  )
}
