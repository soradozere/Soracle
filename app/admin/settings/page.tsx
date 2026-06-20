import { redirect } from "next/navigation"
import { createClient } from "@/lib/supabase/server"
import { Button } from "@/components/ui/button"
import Link from "next/link"
import { ArrowLeft } from "lucide-react"
import { PasswordChangeForm } from "@/components/password-change-form"

export default async function SettingsPage() {
  const supabase = await createClient()

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser()

  if (error || !user) {
    redirect("/auth/login")
  }

  // Full-admin only (match admins have no business in settings).
  const { data: isAdmin } = await supabase.rpc("is_admin")
  if (isAdmin !== true) {
    redirect("/")
  }

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b">
        <div className="container mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-2xl font-bold">Admin Settings</h1>
          </div>
          <Link href="/admin">
            <Button variant="outline" size="sm">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Admin
            </Button>
          </Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8 max-w-2xl">
        <div className="mb-6">
          <h2 className="text-3xl font-bold mb-2">Account Settings</h2>
          <p className="text-muted-foreground">Manage your account settings and security preferences.</p>
        </div>

        <div className="space-y-6">
          <div className="border rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-4">Change Password</h3>
            <PasswordChangeForm />
          </div>

          <div className="border rounded-lg p-6">
            <h3 className="text-xl font-semibold mb-2">Account Information</h3>
            <div className="space-y-2 text-sm">
              <div>
                <span className="text-muted-foreground">Email:</span> <span className="font-medium">{user.email}</span>
              </div>
              <div>
                <span className="text-muted-foreground">User ID:</span>{" "}
                <span className="font-mono text-xs">{user.id}</span>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  )
}
