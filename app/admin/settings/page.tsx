import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { PasswordChangeForm } from "@/components/password-change-form"
import { FeaturedVideoAdmin } from "@/components/featured-video-admin"
import { AdminRoles } from "@/components/admin-roles"
import { AdminHeader, AdminSection } from "@/components/admin-header"
import { requireFullAdminPage } from "@/lib/player-role"

export default async function SettingsPage() {
  // Full-admin only (match admins have no business in settings).
  const { label, userId } = await requireFullAdminPage()

  return (
    <div className="min-h-screen" style={{ background: "var(--color-background)" }}>
      <AdminHeader
        title="Admin Settings"
        subtitle="Site configuration an admin can change without a deploy, plus your own account"
        actions={
          <Link href="/admin">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Admin
            </Button>
          </Link>
        }
      />

      <main className="container mx-auto px-4 py-8 max-w-2xl space-y-8">
        <AdminSection
          title="Homepage Featured Video"
          description="Normally the newest upload on youtube.com/@jk2ctf. Pin a specific video when someone posts a frag movie on their own channel, then switch back to automatic."
        >
          <FeaturedVideoAdmin />
        </AdminSection>

        <AdminSection
          title="Roles"
          description="Give a player Full Admin (same access as this account) or Captains (approve/log/edit matches) directly on their existing login — no separate account needed."
        >
          <AdminRoles />
        </AdminSection>

        {userId && (
          <AdminSection title="Change Password">
            <PasswordChangeForm />
          </AdminSection>
        )}

        <AdminSection title="Account Information">
          <div className="space-y-2 text-sm">
            <div>
              <span style={{ color: "var(--color-text-dim)" }}>{userId ? "Email" : "Player login"}:</span>{" "}
              <span className="font-medium">{label}</span>
            </div>
            {userId && (
              <div>
                <span style={{ color: "var(--color-text-dim)" }}>User ID:</span>{" "}
                <span className="font-mono text-xs">{userId}</span>
              </div>
            )}
          </div>
        </AdminSection>
      </main>
    </div>
  )
}
