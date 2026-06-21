"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { Shield } from "lucide-react"
import { checkCanLogMatches, checkIsAdmin } from "@/lib/is-admin"

// Top-bar "Admin" button shown next to Help. Full admins go to the admin panel;
// match admins (captains, no panel access) go to the logout screen. Hidden for
// everyone else.
export function AdminNavButton() {
  const [href, setHref] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    checkIsAdmin().then(async (admin) => {
      if (!active) return
      if (admin) {
        setHref("/admin")
        return
      }
      const captain = await checkCanLogMatches()
      if (active && captain) setHref("/logout")
    })
    return () => {
      active = false
    }
  }, [])

  if (!href) return null

  return (
    <Link
      href={href}
      className="px-3 py-1.5 rounded-md text-sm transition-all font-medium flex items-center gap-1.5 bg-[#2a3441]/60 backdrop-blur-sm text-[#c5c6c7] hover:bg-[#3d4855] border border-[#3d4855]"
      title="Admin"
    >
      <Shield className="w-4 h-4" />
      Admin
    </Link>
  )
}
