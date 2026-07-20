"use client"

import type React from "react"

import { useState } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ArrowLeft, Loader2 } from "lucide-react"
import { BackgroundParticles } from "@/components/background-particles"
import { playerSlug } from "@/lib/player-profile"

// Player login — entirely separate surface from /auth/login (admin). Players
// sign in with a name + an admin-issued password to edit their own profile;
// there is no sign-up, no email, and nothing here links to or reveals
// anything about the admin account.
export default function PlayerLoginPage() {
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const router = useRouter()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/player-auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, password }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error || "Login failed")
        return
      }
      router.push(`/player/${playerSlug(data.name)}`)
    } catch {
      setError("Something went wrong. Try again.")
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#0b0c10] px-4 py-6">
      <BackgroundParticles />
      <div className="max-w-sm mx-auto relative z-10">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm text-[#8892a0] hover:text-[#66fcf1] transition-colors mb-8"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Soracle
        </Link>

        <div className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg backdrop-blur-lg p-6">
          <h1
            className="text-2xl font-bold text-[#66fcf1] mb-1"
            style={{ fontFamily: "var(--font-orbitron)" }}
          >
            Player Login
          </h1>
          <p className="text-sm text-[#8892a0] mb-6">
            Sign in with your player name and password to edit your profile.
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label className="text-sm text-[#c5c6c7]">Player name</label>
              <input
                type="text"
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full rounded-md bg-[#0b0c10] border border-[#3d4855] px-3 py-2 text-sm text-[#c5c6c7] focus:outline-none focus:border-[#66fcf1]"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm text-[#c5c6c7]">Password</label>
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-md bg-[#0b0c10] border border-[#3d4855] px-3 py-2 text-sm text-[#c5c6c7] focus:outline-none focus:border-[#66fcf1]"
              />
            </div>
            {error && <p className="text-sm text-[#ff4757]">{error}</p>}
            <button
              type="submit"
              disabled={loading}
              className="w-full flex items-center justify-center gap-2 rounded-md bg-[#66fcf1] text-[#0b0c10] font-semibold py-2 text-sm hover:bg-[#45a29e] transition-colors disabled:opacity-60"
            >
              {loading && <Loader2 className="w-4 h-4 animate-spin" />}
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>

          <p className="text-xs text-[#8892a0] mt-6">
            Don't have a password? Ask an admin to set one up for you.
          </p>
        </div>
      </div>
    </div>
  )
}
