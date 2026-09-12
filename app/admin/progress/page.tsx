import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { AdminHeader, AdminSection } from "@/components/admin-header"
import { CalibrationProgress } from "@/components/calibration-progress"
import { requireFullAdminPage } from "@/lib/player-role"

export default async function CalibrationProgressPage() {
  // Full-admin only, same gate as the rest of /admin: this is the tier engine's
  // working state, and match admins have no business in it.
  const { label } = await requireFullAdminPage()

  return (
    <div className="min-h-screen" style={{ background: "var(--color-background)" }}>
      <AdminHeader
        title="Calibration Progress"
        subtitle={`Where every player stands with the auto-calibrator · signed in as ${label}`}
        actions={
          <Link href="/admin">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Admin
            </Button>
          </Link>
        }
      />

      <main className="w-full px-6 py-8">
        <AdminSection
          title="Tier trajectories"
          description="Rank Suggestions lists players the calibrator would move right now. This is the run-up to that: how far each player's latent tier has drifted, how much further it needs to go, and how many checks they have left before the window freezes. Read-only — tiers are edited in Player Management."
        >
          <CalibrationProgress />
        </AdminSection>
      </main>
    </div>
  )
}
