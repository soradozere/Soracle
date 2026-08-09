"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { KeyRound, Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { playerSlug } from "@/lib/player-profile"

// Standalone change-password form for a signed-in player.
//
// The same POST already existed behind a toggle inside the profile edit dialog,
// which meant "change my password" was three clicks deep in a modal that is
// mostly about avatars and titles. This is the page the masthead account menu
// links to; the dialog's version stays where it is for anyone already in there.
export function PlayerPasswordForm() {
  const router = useRouter()
  const [player, setPlayer] = useState<{ name: string } | null>(null)
  const [checking, setChecking] = useState(true)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  useEffect(() => {
    let active = true
    fetch("/api/player-auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        if (!data.playerId) {
          // Nothing to change a password for — send them to sign in instead of
          // showing a form that can only fail.
          router.replace("/player-login")
          return
        }
        setPlayer({ name: data.name })
        setChecking(false)
      })
      .catch(() => active && setChecking(false))
    return () => {
      active = false
    }
  }, [router])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    if (newPassword !== confirmPassword) {
      setError("New passwords don't match")
      return
    }
    if (newPassword.length < 8) {
      setError("New password must be at least 8 characters")
      return
    }
    setSaving(true)
    try {
      const res = await fetch("/api/player-auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Failed to change password")
        return
      }
      setDone(true)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch {
      setError("Something went wrong. Try again.")
    } finally {
      setSaving(false)
    }
  }

  if (checking) {
    return (
      <div className="glass-panel p-8 flex justify-center">
        <Loader2 className="w-5 h-5 animate-spin" style={{ color: "var(--color-primary)" }} />
      </div>
    )
  }

  return (
    <div className="glass-panel p-6 max-w-md">
      <div className="flex items-center gap-3 mb-5">
        <span className="glyph-chip w-10 h-10" style={{ color: "var(--color-primary)" }}>
          <KeyRound className="w-[18px] h-[18px]" />
        </span>
        <div>
          <h1 className="text-lg font-bold" style={{ fontFamily: "var(--font-orbitron)" }}>
            Change password
          </h1>
          {player && (
            <p className="text-xs" style={{ color: "var(--color-text-dim)" }}>
              Signed in as {player.name}
            </p>
          )}
        </div>
      </div>

      <form onSubmit={submit} className="space-y-3">
        {/* autoComplete hints matter here: without them a password manager
            offers to fill the new-password boxes with the old one. */}
        <div className="space-y-1.5">
          <Label htmlFor="current" className="text-xs" style={{ color: "var(--color-text-dim)" }}>
            Current password
          </Label>
          <Input
            id="current"
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="next" className="text-xs" style={{ color: "var(--color-text-dim)" }}>
            New password
          </Label>
          <Input
            id="next"
            type="password"
            autoComplete="new-password"
            placeholder="At least 8 characters"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="confirm" className="text-xs" style={{ color: "var(--color-text-dim)" }}>
            Confirm new password
          </Label>
          <Input
            id="confirm"
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        {error && (
          <p className="text-xs" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}
        {done && (
          <p className="text-xs" style={{ color: "var(--color-success)" }}>
            Password updated.
          </p>
        )}

        <div className="flex items-center gap-3 pt-1">
          <Button type="submit" disabled={saving || !currentPassword || !newPassword || !confirmPassword} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Update password
          </Button>
          {player && (
            <Link
              href={`/player/${playerSlug(player.name)}`}
              className="text-xs hover:underline"
              style={{ color: "var(--color-text-dim)" }}
            >
              Back to profile
            </Link>
          )}
        </div>
      </form>
    </div>
  )
}
