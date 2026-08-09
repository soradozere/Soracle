import type { Metadata } from "next"
import { PlayerPasswordForm } from "@/components/player-password-form"

export const metadata: Metadata = {
  title: "Change password — JK2 Capture the Flag",
  // Nothing here should ever be indexed or shared.
  robots: { index: false, follow: false },
}

// Inside the (main) group so it keeps the masthead, footer and starfield — this
// is a normal signed-in page, not an auth screen.
export default function ChangePasswordPage() {
  return (
    <div className="container mx-auto px-4 py-10 relative z-10">
      <PlayerPasswordForm />
    </div>
  )
}
