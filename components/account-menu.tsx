"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { KeyRound, LogIn, LogOut, Shield, UserCircle2, Video, ClipboardList } from "lucide-react"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { checkCanLogMatches, checkIsAdmin } from "@/lib/is-admin"
import { playerSlug } from "@/lib/player-profile"
import { RENDER_QUEUE_CHANGED } from "@/lib/render-queue-events"

// The masthead's account control: one profile bubble that replaces the old
// PlayerNavButton + AdminNavButton pair. Admin is a mode rather than a page, so
// it sits inside this menu instead of taking a slot in the nav rail; anything
// waiting on the signed-in user (currently the render queue) surfaces as a count
// on the bubble itself, which is the only thing in the masthead that can carry a
// notification without the layout jumping.
export function AccountMenu() {
  const [player, setPlayer] = useState<{ name: string; avatarUrl: string | null } | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [adminHref, setAdminHref] = useState<string | null>(null)
  const [isAdmin, setIsAdmin] = useState(false)
  const [waiting, setWaiting] = useState(0)

  useEffect(() => {
    let active = true
    fetch("/api/player-auth/me")
      .then((r) => r.json())
      .then((data) => {
        if (!active) return
        setPlayer(data.playerId ? { name: data.name, avatarUrl: data.avatarUrl ?? null } : null)
        setLoaded(true)
      })
      .catch(() => active && setLoaded(true))
    return () => {
      active = false
    }
  }, [])

  useEffect(() => {
    let active = true
    checkIsAdmin().then(async (admin) => {
      if (!active) return
      if (admin) {
        setIsAdmin(true)
        setAdminHref("/admin")
        return
      }
      // Match admins (captains) get no panel — their entry point is /logout.
      const captain = await checkCanLogMatches()
      if (active && captain) setAdminHref("/logout")
    })
    return () => {
      active = false
    }
  }, [])

  // Render jobs awaiting review. Fetched once on mount rather than polled: the
  // count is a nudge, not a live dashboard, and the 5 Aug usage audit is a
  // standing reason not to add a background request on every open tab.
  useEffect(() => {
    if (!isAdmin) return
    let active = true
    const load = () =>
      fetch("/api/render/waiting")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => active && data && setWaiting(data.waiting ?? 0))
        .catch(() => {})

    void load()
    // Still not polling -- this only fires when an admin has just changed the
    // queue in this tab, so the badge stops advertising work that has already
    // been dealt with.
    window.addEventListener(RENDER_QUEUE_CHANGED, load)
    return () => {
      active = false
      window.removeEventListener(RENDER_QUEUE_CHANGED, load)
    }
  }, [isAdmin])

  if (!loaded) return null

  // Logged out: the bubble would have no identity to show, so this stays the
  // plain login affordance it is today.
  if (!player) {
    return (
      <Link
        href="/player-login"
        className="flex items-center gap-1.5 px-3 py-2 rounded-[11px] text-sm font-medium transition-all"
        style={{
          color: "var(--color-text)",
          border: "1px solid var(--glass-hair)",
          background: "color-mix(in srgb, var(--color-surface-elevated) 70%, transparent)",
          boxShadow: "inset 0 1px 0 var(--glass-spec)",
        }}
        title="Player login"
      >
        <LogIn className="w-4 h-4" />
        Login
      </Link>
    )
  }

  const initials = player.name.slice(0, 2).toLowerCase()
  const badge = waiting > 0 ? waiting : null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        // No `overflow-hidden` here, however much the avatar wants it: the
        // badge is deliberately positioned outside this circle (-top-1
        // -right-1), so clipping the trigger clips the notification down to a
        // sliver against the rim -- present, unreadable, and easy to mistake
        // for a rendering glitch. The avatar rounds itself instead.
        className="relative w-9 h-9 rounded-full grid place-items-center font-bold text-[13px] transition-all"
        style={{
          fontFamily: "var(--font-mono)",
          color: "var(--color-text-bright)",
          border: "1px solid color-mix(in srgb, var(--color-primary) 45%, transparent)",
          background: player.avatarUrl
            ? undefined
            : "radial-gradient(100% 100% at 30% 20%, color-mix(in srgb, var(--color-primary) 34%, transparent), color-mix(in srgb, var(--color-surface-elevated) 78%, transparent))",
          boxShadow:
            "inset 0 1px 0 var(--glass-spec), 0 0 14px -6px color-mix(in srgb, var(--color-primary) 70%, transparent)",
        }}
        title={badge ? `${player.name} — ${badge} awaiting review` : player.name}
      >
        {player.avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={player.avatarUrl} alt="" className="w-full h-full rounded-full object-cover" />
        ) : (
          initials
        )}
        {badge !== null && (
          // Amber, not red: on the Sith theme a red dot disappears into the
          // palette entirely.
          <span
            className="absolute -top-1 -right-1 min-w-[17px] h-[17px] px-1 rounded-[9px] grid place-items-center text-[10px] font-bold"
            style={{
              fontFamily: "var(--font-mono)",
              color: "var(--color-background)",
              backgroundColor: "var(--color-warning)",
              border: "1.5px solid color-mix(in srgb, var(--color-surface) 80%, var(--color-background))",
              boxShadow: "0 0 12px -2px color-mix(in srgb, var(--color-warning) 90%, transparent)",
            }}
          >
            {badge}
          </span>
        )}
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-56"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-surface) 96%, transparent)",
          borderColor: "var(--glass-hair)",
          backdropFilter: "blur(24px) saturate(160%)",
        }}
      >
        <DropdownMenuLabel className="text-[9.5px] tracking-[0.18em] uppercase" style={{ color: "var(--color-text-dim)" }}>
          {player.name}
        </DropdownMenuLabel>

        <DropdownMenuItem asChild>
          <Link href={`/player/${playerSlug(player.name)}`} className="cursor-pointer">
            <UserCircle2 className="w-4 h-4 opacity-75" />
            My profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/password" className="cursor-pointer">
            <KeyRound className="w-4 h-4 opacity-75" />
            Change password
          </Link>
        </DropdownMenuItem>

        {adminHref && (
          <>
            <DropdownMenuSeparator style={{ backgroundColor: "var(--glass-hair)" }} />
            <DropdownMenuLabel
              className="text-[9.5px] tracking-[0.18em] uppercase"
              style={{ color: "var(--color-text-dim)" }}
            >
              Admin
            </DropdownMenuLabel>
            {isAdmin && (
              <>
                <DropdownMenuItem asChild>
                  <Link href="/admin/renders" className="cursor-pointer" style={{ color: "var(--color-warning)" }}>
                    <Video className="w-4 h-4 opacity-75" />
                    Render queue
                    {badge !== null && (
                      <span
                        className="ml-auto px-1.5 py-0.5 rounded-md text-[10px] font-bold"
                        style={{
                          fontFamily: "var(--font-mono)",
                          color: "var(--color-background)",
                          backgroundColor: "var(--color-warning)",
                        }}
                      >
                        {badge}
                      </span>
                    )}
                  </Link>
                </DropdownMenuItem>
                <DropdownMenuItem asChild>
                  <Link href="/admin" className="cursor-pointer">
                    <ClipboardList className="w-4 h-4 opacity-75" />
                    Review queue
                  </Link>
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem asChild>
              <Link href={adminHref} className="cursor-pointer">
                <Shield className="w-4 h-4 opacity-75" />
                {isAdmin ? "Admin panel" : "Match admin"}
              </Link>
            </DropdownMenuItem>
          </>
        )}

        <DropdownMenuSeparator style={{ backgroundColor: "var(--glass-hair)" }} />
        <DropdownMenuItem asChild>
          <Link href="/logout" className="cursor-pointer">
            <LogOut className="w-4 h-4 opacity-75" />
            Sign out
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
