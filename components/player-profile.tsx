"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import {
  loadPlayerProfile,
  playerSlug,
  spotlightEmbedUrl,
  type PlayerProfileData,
  type ProfileBadge,
  type ProfileMatchEntry,
} from "@/lib/player-profile"
import type { Player } from "@/lib/types"
import { Flame, Swords, Heart, ChevronDown, Pencil, Video, Loader2 } from "lucide-react"
import { BADGE_META } from "@/lib/badge-meta"
import { BadgeIcon } from "@/components/badge-icon"
import { AchievementsStrip } from "@/components/achievements-strip"
import { TitleProgression } from "@/components/title-progression"
import {
  SCORE_LADDER,
  THEMES,
  PREVIEW_THEME_IDS,
  earnedTitles,
  isPreviewTheme,
  mergeRecordedTitles,
  seasonFor,
  themeById,
  unlockedThemes,
  unlockRequirementLabel,
  type EarnedTitle,
  type ThemeId,
} from "@/lib/titles"
import { scoreFromViews } from "@/lib/achievement-score"
import { RARITY_META } from "@/lib/achievement-meta"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { createClient } from "@/lib/supabase/client"
import { useToast } from "@/hooks/use-toast"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import {
  Bar,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip as ChartTooltip,
  XAxis,
  YAxis,
} from "recharts"

// The player profile body, rendered by the /player/[slug] page (right-click →
// Show Profile navigates to it in the same tab). Design is deliberately freeform for now —
// Sam wants to nail visuals later with custom images, so badges etc. are simple
// styled chips.

interface PlayerProfileProps {
  player: Player
  allPlayers: Player[]
  // Admins get an inline editor for slogan / avatar / spotlight (RLS enforces
  // the write; this only decides whether the pencil is shown).
  isAdmin?: boolean
  // A player logged in as themselves gets the same editor minus the slogan
  // field — enforced server-side by /api/player-profile, not just by hiding it.
  isOwner?: boolean
}

// Admin-editable presentation fields, held in local state so edits show live.
// title / profile_theme hold ids ("" = none); entitlement is checked at render.
interface EditableFields {
  tooltip: string
  avatar_url: string
  spotlight_url: string
  title: string
  profile_theme: string
}

const ROLE_COLORS: Record<string, string> = {
  Capper: "#62d6e8",
  Chase: "#27ae60",
  Camp: "#45a29e",
  Cleaner: "#9b59b6",
  Support: "#f39c12",
}

const ROLE_LABELS: Record<string, string> = {
  Capper: "CAP",
  Chase: "CHA",
  Camp: "CAM",
  Cleaner: "BC",
  Support: "SUP",
}

const TIER_NAMES: Record<number, string> = {
  10: "The Chosen One",
  9: "Jedi Grandmaster",
  8: "Jedi Master",
  7: "Jedi Sentinel",
  6: "Jedi Guardian",
  5: "Jedi Knight",
  4: "Jedi",
  3: "Padawan",
  2: "Initiate",
  1: "Youngling",
}

function formatFlagHold(ms: number): string {
  const totalSeconds = Math.round(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

function kdRatio(kills: number, deaths: number): string {
  if (kills === 0 && deaths === 0) return "—"
  if (deaths === 0) return "∞"
  return (kills / deaths).toFixed(2)
}

function StatTile({ label, value, hint }: { label: string; value: string | number; hint: string }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div className="bg-[#0b0c10]/60 border border-[#3d4855] rounded-lg p-3 text-center cursor-default">
          <div className="text-xl font-bold font-mono text-[#c5c6c7]">{value}</div>
          <div className="text-[10px] uppercase tracking-wider text-[#8892a0] mt-1">{label}</div>
        </div>
      </TooltipTrigger>
      <TooltipContent className="bg-[#1f2833] border border-[var(--pa30,#66fcf14d)] text-[#c5c6c7] text-xs max-w-56">
        {hint}
      </TooltipContent>
    </Tooltip>
  )
}

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg backdrop-blur-lg">
      <div className="px-4 py-3 border-b border-[#3d4855]">
        <h2 className="text-sm font-bold font-mono tracking-wider text-[var(--pa,#66fcf1)]">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

function BadgeChip({ badge }: { badge: ProfileBadge }) {
  const { color, label } = BADGE_META[badge.id]
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className="flex items-center gap-2 px-3 py-2 rounded-lg border bg-[#0b0c10]/60 cursor-default"
          style={{ borderColor: `${color}66`, boxShadow: `0 0 10px ${color}22` }}
        >
          <BadgeIcon id={badge.id} className="w-6 h-6" />
          <span className="text-xs font-bold text-[#c5c6c7]">{label}</span>
          {badge.entries.length > 1 && (
            <span className="text-xs font-mono font-bold" style={{ color }}>
              ×{badge.entries.length}
            </span>
          )}
        </div>
      </TooltipTrigger>
      <TooltipContent className="bg-[#1f2833] border border-[var(--pa30,#66fcf14d)] p-3">
        <div className="space-y-1">
          {badge.entries.map((entry) => (
            <div key={entry.month} className="flex items-center justify-between gap-4 text-xs">
              <span className="text-[#c5c6c7]">{entry.month}</span>
              <span className="font-mono font-bold" style={{ color }}>
                {entry.detail}
              </span>
            </div>
          ))}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

const RESULT_STYLES: Record<ProfileMatchEntry["result"], { label: string; color: string }> = {
  W: { label: "WIN", color: "#27ae60" },
  L: { label: "LOSS", color: "#ff4757" },
  D: { label: "DRAW", color: "#8892a0" },
}

// One team panel inside a history row: names as chips, this profile's player
// highlighted, everyone else linking through to their own profile. Deliberately
// does NOT highlight the winning team — the card's green/red glow already says
// how the match went for THIS player, which is the profile's point of view.
function HistoryTeam({
  team,
  names,
  score,
  playerName,
}: {
  team: "Red" | "Blue"
  names: string[]
  score: number
  playerName: string
}) {
  const color = team === "Red" ? "#ff4757" : "#00d4ff"
  return (
    <div className="p-3 rounded-lg" style={{ backgroundColor: `${color}10` }}>
      <div className="flex items-center justify-between mb-2">
        <span className="font-bold text-sm" style={{ color }}>
          {team.toUpperCase()} TEAM
        </span>
        <span className="text-xl font-bold font-mono" style={{ color }}>
          {score}
        </span>
      </div>
      <div className="flex flex-wrap gap-1">
        {/* Key includes the index: team arrays can contain the same name twice
            (e.g. a partial player logged in two stints). */}
        {names.map((name, i) =>
          name === playerName ? (
            <span
              key={`${name}-${i}`}
              className="text-xs font-bold bg-[var(--pa,#66fcf1)] text-[#0b0c10] px-2 py-0.5 rounded"
            >
              {name}
            </span>
          ) : (
            <Link
              key={`${name}-${i}`}
              href={`/player/${playerSlug(name)}`}
              className="text-xs text-[#c5c6c7] bg-[#1f2833] px-2 py-0.5 rounded hover:text-[var(--pa,#66fcf1)] transition-colors"
            >
              {name}
            </Link>
          ),
        )}
      </div>
    </div>
  )
}

function HistoryRow({ entry, playerName }: { entry: ProfileMatchEntry; playerName: string }) {
  const result = RESULT_STYLES[entry.result]
  const date = new Date(entry.date)
  return (
    <div
      className="bg-[#0b0c10]/60 border rounded-lg p-4"
      style={{
        borderColor: `${result.color}55`,
        boxShadow: `0 0 14px ${result.color}26, inset 0 0 24px ${result.color}0d`,
      }}
    >
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span
            className="px-2 py-0.5 rounded text-xs font-bold"
            style={{ backgroundColor: `${result.color}33`, color: result.color }}
          >
            {result.label}
          </span>
          {entry.matchType && (
            <span className="px-2 py-0.5 rounded text-xs font-bold bg-[#8892a0]/20 text-[#8892a0]">
              {entry.matchType.toUpperCase()}
            </span>
          )}
        </div>
        <span className="text-xs text-[#8892a0]">
          {date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}{" "}
          {date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <HistoryTeam team="Red" names={entry.redTeam} score={entry.redScore} playerName={playerName} />
        <HistoryTeam team="Blue" names={entry.blueTeam} score={entry.blueScore} playerName={playerName} />
      </div>

      {entry.my && (
        <div className="mt-3 pt-3 border-t border-[#3d4855] text-xs font-mono text-[#8892a0]">
          <span className="text-[var(--pa,#66fcf1)] font-bold">{entry.my.score}</span> pts
          {" · "}
          {entry.my.captures} caps
          {" · "}
          {entry.my.returns} ret
          {" · "}
          {entry.my.kills}/{entry.my.deaths} K/D
          {" · "}
          {formatFlagHold(entry.my.flagHoldMs)} hold
        </div>
      )}
    </div>
  )
}

// Short initial view keeps the profile page compact; Show More digs in faster.
const HISTORY_INITIAL = 5
const HISTORY_PAGE_SIZE = 10

function MatchHistorySection({ entries, playerName }: { entries: ProfileMatchEntry[]; playerName: string }) {
  const [visible, setVisible] = useState(HISTORY_INITIAL)

  if (entries.length === 0) {
    return <p className="text-sm text-[#8892a0]">No matches recorded yet.</p>
  }

  return (
    <div className="space-y-3">
      {entries.slice(0, visible).map((entry) => (
        <HistoryRow key={entry.id} entry={entry} playerName={playerName} />
      ))}
      {visible < entries.length && (
        <button
          onClick={() => setVisible((v) => v + HISTORY_PAGE_SIZE)}
          className="w-full flex items-center justify-center gap-2 py-2.5 rounded-lg border border-[#3d4855] text-sm text-[#8892a0] hover:text-[var(--pa,#66fcf1)] hover:border-[var(--pa50,#66fcf180)] transition-colors"
        >
          <ChevronDown className="w-4 h-4" />
          Show more ({entries.length - visible} older)
        </button>
      )}
    </div>
  )
}

function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  const point = payload[0]?.payload
  if (!point) return null
  return (
    <div className="bg-[#1f2833]/95 border border-[var(--pa30,#66fcf14d)] rounded-lg px-3 py-2 text-xs text-[#c5c6c7] shadow-lg">
      <div className="font-bold text-[var(--pa,#66fcf1)] mb-1">{label}</div>
      {point.games > 0 ? (
        <>
          <div>
            {point.wins}W – {point.losses}L{point.draws > 0 ? ` – ${point.draws}D` : ""} ({point.games} games)
          </div>
          <div>Win rate: {point.winRate}%</div>
        </>
      ) : (
        <div className="text-[#8892a0]">Didn't play</div>
      )}
      <div className="text-[#f39c12]">Rating: {point.elo}</div>
    </div>
  )
}

// The player's chosen highlight clip, rendered as a responsive 16:9 embed.
// Only shown when a URL is set; a bad/unsupported link falls back to a plain
// link so nothing silently disappears.
function Spotlight({ url }: { url: string }) {
  const embed = spotlightEmbedUrl(url)
  return (
    <div>
      {embed ? (
        <div className="relative w-full overflow-hidden rounded-lg border border-[#3d4855]" style={{ paddingTop: "56.25%" }}>
          <iframe
            src={embed}
            title="Player spotlight"
            className="absolute inset-0 h-full w-full"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        </div>
      ) : (
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm text-[var(--pa,#66fcf1)] hover:underline break-all"
        >
          {url}
        </a>
      )}
    </div>
  )
}

// Admin-only editor for slogan / avatar / spotlight. Writes straight to the
// players table via the browser client — the players update RLS policy is
// admin-only, so this is safe. Calls onSaved with the new values on success.
function EditProfileDialog({
  open,
  onOpenChange,
  playerId,
  playerName,
  initial,
  titleOptions,
  themeOptions,
  canEditTooltip,
  canChangePassword,
  onSaved,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  playerId: string
  playerName: string
  initial: EditableFields
  // What this player is entitled to right now — the dropdowns only ever offer
  // these, so an admin can't equip something unearned by accident.
  titleOptions: EarnedTitle[]
  themeOptions: ThemeId[]
  // Only a full admin can set the slogan — it's Sam's signature line, not a
  // self-service field. A player editing their own profile never sees it.
  canEditTooltip: boolean
  // Password changes are for the logged-in player themselves. Admins reset
  // passwords from the admin panel instead (they don't know the current one).
  canChangePassword: boolean
  onSaved: (fields: EditableFields) => void
}) {
  const [fields, setFields] = useState<EditableFields>(initial)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const { toast } = useToast()

  // Password change is a separate sub-form with its own state and its own
  // submit — it doesn't ride along with Save, so a failed password change
  // can't lose the profile edits (or vice versa).
  const [showPassword, setShowPassword] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)
  const [passwordDone, setPasswordDone] = useState(false)

  // Re-seed the form whenever it's (re)opened for a player.
  useEffect(() => {
    if (open) {
      setFields(initial)
      setSaveError(null)
      setShowPassword(false)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setPasswordError(null)
      setPasswordDone(false)
    }
  }, [open, initial])

  const handleChangePassword = async () => {
    setPasswordError(null)
    if (newPassword !== confirmPassword) {
      setPasswordError("New passwords don't match")
      return
    }
    setPasswordSaving(true)
    try {
      const res = await fetch("/api/player-auth/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      })
      const data = await res.json()
      if (!res.ok) {
        setPasswordError(data.error || "Failed to change password")
        return
      }
      setPasswordDone(true)
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
    } catch {
      setPasswordError("Something went wrong. Try again.")
    } finally {
      setPasswordSaving(false)
    }
  }

  const handleSave = async () => {
    setSaving(true)
    setSaveError(null)
    // Empty string → null so cleared fields actually clear in the DB.
    const avatar_url = fields.avatar_url.trim() || null
    const spotlight_url = fields.spotlight_url.trim() || null
    const title = fields.title || null
    const profile_theme = fields.profile_theme || null

    if (canEditTooltip) {
      // Admin path: writes straight to the players table via the browser
      // client — the players update RLS policy is admin-only, so this is safe.
      const tooltip = fields.tooltip.trim() || null
      const supabase = createClient()
      const { error } = await supabase
        .from("players")
        .update({ tooltip, avatar_url, spotlight_url, title, profile_theme })
        .eq("id", playerId)
      setSaving(false)
      if (error) {
        setSaveError(error.message)
        return
      }
      onSaved({ tooltip: tooltip ?? "", avatar_url: avatar_url ?? "", spotlight_url: spotlight_url ?? "", title: title ?? "", profile_theme: profile_theme ?? "" })
      onOpenChange(false)
      return
    }

    // Player-owner path: no direct table access, and no tooltip field at all.
    // The route re-validates title/theme entitlement server-side.
    const res = await fetch("/api/player-profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ avatar_url, spotlight_url, title, profile_theme }),
    })
    const data = await res.json()
    setSaving(false)
    if (!res.ok) {
      setSaveError(data.error || "Failed to save")
      return
    }
    onSaved({
      tooltip: initial.tooltip,
      avatar_url: avatar_url ?? "",
      spotlight_url: spotlight_url ?? "",
      title: title ?? "",
      profile_theme: profile_theme ?? "",
    })
    onOpenChange(false)
  }

  const spotlightPreview = spotlightEmbedUrl(fields.spotlight_url)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[#0b0c10]/95 backdrop-blur-md border-[var(--pa30,#66fcf14d)] text-[#c5c6c7]">
        <DialogHeader>
          <DialogTitle className="text-[var(--pa,#66fcf1)] font-mono">Edit profile — {playerName}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          {canEditTooltip && (
            <div className="space-y-1.5">
              <Label htmlFor="edit-slogan" className="text-xs text-[#8892a0]">
                Slogan
              </Label>
              <Textarea
                id="edit-slogan"
                value={fields.tooltip}
                onChange={(e) => setFields((f) => ({ ...f, tooltip: e.target.value }))}
                placeholder="Their one-liner (also shown as the Balancer tooltip)"
                className="bg-[#1f2833] border-[#3d4855]"
                rows={2}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="edit-avatar" className="text-xs text-[#8892a0]">
              Avatar image URL
            </Label>
            <Input
              id="edit-avatar"
              value={fields.avatar_url}
              onChange={(e) => setFields((f) => ({ ...f, avatar_url: e.target.value }))}
              placeholder="https://…/image.png"
              className="bg-[#1f2833] border-[#3d4855]"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-spotlight" className="text-xs text-[#8892a0]">
              Spotlight clip (Vimeo, YouTube or Streamable link)
            </Label>
            <Input
              id="edit-spotlight"
              value={fields.spotlight_url}
              onChange={(e) => setFields((f) => ({ ...f, spotlight_url: e.target.value }))}
              placeholder="https://vimeo.com/… , https://youtu.be/… or https://streamable.com/…"
              className="bg-[#1f2833] border-[#3d4855]"
            />
            {fields.spotlight_url.trim() && (
              <p className={`text-xs ${spotlightPreview ? "text-[#27ae60]" : "text-[#f39c12]"}`}>
                {spotlightPreview ? "✓ Recognised video link" : "⚠ Not a recognised Vimeo/YouTube/Streamable link — will show as a plain link"}
              </p>
            )}
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-[#8892a0]">Title</Label>
            {/* Radix reserves "" for clearing, so "none" is the no-title sentinel. */}
            <Select
              value={fields.title || "none"}
              onValueChange={(v) => setFields((f) => ({ ...f, title: v === "none" ? "" : v }))}
            >
              <SelectTrigger className="bg-[#1f2833] border-[#3d4855] w-full">
                <SelectValue placeholder="No title" />
              </SelectTrigger>
              <SelectContent className="bg-[#1f2833] border-[#3d4855] text-[#c5c6c7]">
                <SelectItem value="none">No title</SelectItem>
                {titleOptions.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    <span style={{ color: RARITY_META[t.rarity].color }}>{t.title}</span>
                    <span className="text-[#8892a0] text-xs ml-2">{t.source}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-[#8892a0]">
              Only titles this player has earned are listed. Seasonal ones lapse when the month ends.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-[#8892a0]">Profile theme</Label>
            <Select
              value={fields.profile_theme || "none"}
              onValueChange={(v) => {
                if (v === "none") {
                  setFields((f) => ({ ...f, profile_theme: "" }))
                  return
                }
                // Locked themes stay clickable so selecting one explains how to
                // unlock it; it doesn't equip, so the trigger keeps the current
                // choice.
                if (!themeOptions.includes(v as ThemeId)) {
                  const theme = themeById(v)
                  const req = theme ? unlockRequirementLabel(theme) : null
                  toast({
                    title: "Theme locked",
                    description: req
                      ? `You need to earn "${req}" to unlock this theme.`
                      : "You haven't unlocked this theme yet.",
                    duration: 4000,
                  })
                  return
                }
                setFields((f) => ({ ...f, profile_theme: v }))
              }}
            >
              <SelectTrigger className="bg-[#1f2833] border-[#3d4855] w-full">
                <SelectValue placeholder="No theme" />
              </SelectTrigger>
              <SelectContent className="bg-[#1f2833] border-[#3d4855] text-[#c5c6c7]">
                <SelectItem value="none">No theme</SelectItem>
                {THEMES.map((t) => {
                  const locked = !themeOptions.includes(t.id)
                  return (
                    <SelectItem key={t.id} value={t.id} className={locked ? "opacity-70" : undefined}>
                      <span className="inline-block w-2.5 h-2.5 rounded-full mr-2" style={{ background: t.accent }} />
                      {t.label}
                      {locked ? (
                        <span className="text-[#8892a0] text-xs ml-2">🔒 locked</span>
                      ) : (
                        isPreviewTheme(t.id) && <span className="text-[#8892a0] text-xs ml-2">preview</span>
                      )}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-[#8892a0]">
              Unlocked by all-time Achievement Score — recolours the whole profile, stars included.
            </p>
          </div>
          {canChangePassword && (
            <div className="pt-3 border-t border-[#3d4855]">
              {!showPassword ? (
                <button
                  type="button"
                  onClick={() => setShowPassword(true)}
                  className="text-xs text-[#8892a0] hover:text-[var(--pa,#66fcf1)] transition-colors"
                >
                  Change password
                </button>
              ) : (
                <div className="space-y-2">
                  <Label className="text-xs text-[#8892a0]">Change password</Label>
                  <Input
                    type="password"
                    autoComplete="current-password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Current password"
                    className="bg-[#1f2833] border-[#3d4855]"
                  />
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="New password (min 8 characters)"
                    className="bg-[#1f2833] border-[#3d4855]"
                  />
                  <Input
                    type="password"
                    autoComplete="new-password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm new password"
                    className="bg-[#1f2833] border-[#3d4855]"
                  />
                  {passwordError && <p className="text-xs text-[#ff4757]">{passwordError}</p>}
                  {passwordDone && <p className="text-xs text-[#27ae60]">✓ Password updated</p>}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={handleChangePassword}
                    disabled={passwordSaving || !currentPassword || !newPassword || !confirmPassword}
                  >
                    {passwordSaving ? "Updating…" : "Update password"}
                  </Button>
                </div>
              )}
            </div>
          )}
          {saveError && <p className="text-xs text-[#ff4757]">{saveError}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving} className="gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export function PlayerProfile({ player, allPlayers, isAdmin = false, isOwner = false }: PlayerProfileProps) {
  const canEdit = isAdmin || isOwner
  const [data, setData] = useState<PlayerProfileData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editOpen, setEditOpen] = useState(false)

  // Admin-editable fields as live local state, seeded from the player and reset
  // when navigating to a different player.
  const [fields, setFields] = useState<EditableFields>({
    tooltip: player.tooltip ?? "",
    avatar_url: player.avatar_url ?? "",
    spotlight_url: player.spotlight_url ?? "",
    title: player.title ?? "",
    profile_theme: player.profile_theme ?? "",
  })
  useEffect(() => {
    setFields({
      tooltip: player.tooltip ?? "",
      avatar_url: player.avatar_url ?? "",
      spotlight_url: player.spotlight_url ?? "",
      title: player.title ?? "",
      profile_theme: player.profile_theme ?? "",
    })
  }, [player.id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false
    setData(null)
    setError(null)
    loadPlayerProfile(player, allPlayers)
      .then((result) => {
        if (!cancelled) setData(result)
      })
      .catch((e) => {
        console.error("Failed to load player profile:", e)
        if (!cancelled) setError("Failed to load profile data. Try again in a moment.")
      })
    return () => {
      cancelled = true
    }
  }, [player.id]) // eslint-disable-line react-hooks/exhaustive-deps

  // Derived from the views the profile already loaded, so the titles panel costs
  // no extra fetch. The season is whichever month we're in now — a month with no
  // catalogue entry simply has no seasonal ladder.
  const achievementScore = data ? scoreFromViews(data.achievements) : 0
  const season = seasonFor(new Date().toISOString())
  const monthScore = data?.currentMonth.stats?.score ?? 0

  // Entitlements, recomputed on render — the stored title/theme are only choices,
  // and one the player no longer qualifies for simply doesn't display.
  // Live entitlement plus anything banked from past seasons — those ladders are
  // gone from the catalogue, so a July Odysseus can only come from the table.
  const earned = data
    ? mergeRecordedTitles(earnedTitles(achievementScore, monthScore, season), data.recordedTitles)
    : []
  const equippedTitle = fields.title ? earned.find((t) => t.id === fields.title) ?? null : null
  // Highest earned rank per crest (id → rank, 1-based), for the crest-gated themes.
  const earnedCrestRanks = new Map(
    (data?.achievements ?? []).filter((v) => v.earned).map((v) => [v.id, v.rank] as const),
  )
  const availableThemes = data ? unlockedThemes(achievementScore, earnedCrestRanks) : []
  // Admins can preview the not-yet-unlocked full-palette themes; regular owners
  // only ever see what they've actually unlocked. The admin save path writes
  // straight to the players table, so this list is the whole availability story.
  const editorThemeOptions: ThemeId[] = isAdmin ? [...availableThemes, ...PREVIEW_THEME_IDS] : availableThemes
  const theme = themeById(fields.profile_theme)
  // Preview themes render whenever equipped (only an admin could have set one);
  // the unlockable ones still re-validate against this player's entitlement.
  const activeTheme = theme && (availableThemes.includes(theme.id) || isPreviewTheme(theme.id)) ? theme : null

  // Recolour the whole page — chrome AND starfield — by writing the accent vars
  // to the document root. It has to be the root, not a wrapper: tooltips and the
  // edit dialog render through portals outside this subtree, and
  // BackgroundParticles watches --color-primary there (via MutationObserver).
  // Full-palette themes additionally repaint the base colour vars and flip on the
  // data-profile-theme override layer (globals.css) plus the data-profile-bg
  // background renderer; accent-only themes leave those untouched.
  useEffect(() => {
    if (!activeTheme) return
    const root = document.documentElement
    const prevPrimary = root.style.getPropertyValue("--color-primary")
    root.style.setProperty("--color-primary", activeTheme.accent)
    const alphas: [string, string][] = [
      ["--pa", ""],
      ["--pa30", "4d"],
      ["--pa40", "66"],
      ["--pa50", "80"],
      ["--pa80", "cc"],
    ]
    for (const [k, a] of alphas) root.style.setProperty(k, activeTheme.accent + a)

    // Full palette: repaint the base colour vars, saving prior values so the page
    // cleanly reverts when the theme is cleared or the viewer navigates away.
    const paletteVars: [string, string][] = []
    const prevPalette = new Map<string, string>()
    if (activeTheme.palette) {
      const p = activeTheme.palette
      paletteVars.push(
        ["--color-background", p.background],
        ["--color-surface", p.surface],
        ["--color-surface-elevated", p.surfaceElevated],
        ["--color-border", p.border],
        ["--color-text", p.text],
        ["--color-text-bright", p.textBright],
        ["--color-text-dim", p.textDim],
        // Text that sits on the accent (tier chip). Dark themes: the dark base.
        ["--color-on-accent", p.onAccent ?? p.background],
      )
      for (const [k, v] of paletteVars) {
        prevPalette.set(k, root.style.getPropertyValue(k))
        root.style.setProperty(k, v)
      }
      root.dataset.profileTheme = activeTheme.id
      root.dataset.profileBg = activeTheme.background ?? "starfield"
      root.dataset.profileMode = activeTheme.mode ?? "dark"
      // Image backgrounds pass their wallpaper url to the canvas renderer.
      if (activeTheme.image) root.dataset.profileBgImage = activeTheme.image
      else delete root.dataset.profileBgImage
    }

    return () => {
      if (prevPrimary) root.style.setProperty("--color-primary", prevPrimary)
      else root.style.removeProperty("--color-primary")
      for (const [k] of alphas) root.style.removeProperty(k)
      for (const [k] of paletteVars) {
        const prev = prevPalette.get(k)
        if (prev) root.style.setProperty(k, prev)
        else root.style.removeProperty(k)
      }
      if (activeTheme.palette) {
        delete root.dataset.profileTheme
        delete root.dataset.profileBg
        delete root.dataset.profileMode
        delete root.dataset.profileBgImage
      }
    }
  }, [activeTheme])

  const initials = player.name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase()

  if (error) {
    return <div className="p-8 text-center text-[#ff4757]">{error}</div>
  }

  return (
    <TooltipProvider delayDuration={200}>
    <div className="space-y-4 text-[#c5c6c7]">
      {/* ---- Header: avatar, name, slogan, tier + roles ---- */}
      <div className="bg-[#1f2833]/40 border border-[#3d4855] rounded-lg backdrop-blur-lg p-5">
        <div className="flex flex-col sm:flex-row gap-5">
          {/* Custom avatar image if set, else initials (in-game 3D models are a later phase) */}
          <div
            className="w-24 h-24 shrink-0 rounded-xl border-2 border-[var(--pa40,#66fcf166)] bg-[#0b0c10] flex items-center justify-center overflow-hidden"
            style={{ boxShadow: "0 0 20px rgba(102,252,241,0.15)" }}
          >
            {fields.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={fields.avatar_url} alt={player.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-4xl font-bold font-mono text-[var(--pa,#66fcf1)]">{initials}</span>
            )}
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3">
              <h1 className="text-3xl font-bold text-white" style={{ fontFamily: "var(--font-orbitron)" }}>{player.name}</h1>
              {canEdit && (
                <button
                  onClick={() => setEditOpen(true)}
                  className="flex items-center gap-1 text-xs text-[#8892a0] hover:text-[var(--pa,#66fcf1)] transition-colors border border-[#3d4855] hover:border-[var(--pa50,#66fcf180)] rounded px-2 py-1"
                  title={isAdmin ? "Edit slogan, avatar and spotlight" : "Edit avatar, spotlight, title and theme"}
                >
                  <Pencil className="w-3.5 h-3.5" />
                  Edit
                </button>
              )}
            </div>

            {fields.tooltip && (
              <p className="text-sm italic text-[var(--pa80,#66fcf1cc)] mt-2">“{fields.tooltip}”</p>
            )}

            <div className="flex items-center gap-2 mt-3">
              <span className="px-3 py-1 rounded-md text-xs font-bold bg-[var(--pa,#66fcf1)] text-[#0b0c10]">
                Tier {player.tierValue} — {TIER_NAMES[player.tierValue] ?? "Unranked"}
              </span>
            </div>

            {equippedTitle && (
              <div
                className="mt-2 text-sm font-bold tracking-wide"
                style={{
                  color: RARITY_META[equippedTitle.rarity].color,
                  fontFamily: "var(--font-orbitron)",
                  textShadow: `0 0 12px ${RARITY_META[equippedTitle.rarity].color}66`,
                }}
                title={`${equippedTitle.title} — ${equippedTitle.source}`}
              >
                {equippedTitle.title}
              </div>
            )}
          </div>

          {/* Role ratings */}
          <div className="w-full sm:w-72 shrink-0 space-y-2">
            {Object.entries(player.roles).map(([role, value]) => (
              <div key={role} className="flex items-center gap-2.5">
                <span className="text-xs w-9 font-mono text-[#8892a0]">{ROLE_LABELS[role]}</span>
                <div className="flex-1 h-2.5 rounded-full overflow-hidden bg-[#0b0c10] border border-[#3d4855]">
                  <div
                    className="h-full"
                    style={{
                      width: `${(value / 10) * 100}%`,
                      backgroundColor: ROLE_COLORS[role],
                      opacity: 0.7,
                    }}
                  />
                </div>
                <span className="text-xs w-4 text-right font-mono font-bold text-[#c5c6c7]">{value}</span>
              </div>
            ))}
          </div>
        </div>

        {/* ---- Awards ---- */}
        {data && data.badges.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-4 pt-4 border-t border-[#3d4855]">
            {data.badges.map((badge) => (
              <BadgeChip key={badge.id} badge={badge} />
            ))}
          </div>
        )}
      </div>

      {!data ? (
        <div className="p-10 text-center text-[#8892a0] animate-pulse font-mono text-sm">
          COMPILING SERVICE RECORD…
        </div>
      ) : (
        <>
          {/* ---- This month ---- */}
          <SectionCard title={`THIS MONTH — ${data.currentMonth.label.toUpperCase()}`}>
              {data.currentMonth.games === 0 ? (
                <p className="text-sm text-[#8892a0]">No matches played this month yet.</p>
              ) : (
                <>
                  <div className="flex items-baseline gap-4 mb-4">
                    <div className="text-3xl font-bold font-mono">
                      <span className="text-[#27ae60]">{data.currentMonth.wins}W</span>
                      <span className="text-[#8892a0] mx-1">–</span>
                      <span className="text-[#ff4757]">{data.currentMonth.losses}L</span>
                      {data.currentMonth.draws > 0 && (
                        <>
                          <span className="text-[#8892a0] mx-1">–</span>
                          <span className="text-[#8892a0]">{data.currentMonth.draws}D</span>
                        </>
                      )}
                    </div>
                    <div className="text-sm text-[#8892a0]">{data.currentMonth.winRate}% win rate</div>
                    {data.currentMonth.bestStreak >= 2 && (
                      <div className="flex items-center gap-1 text-sm text-[#f39c12]">
                        <Flame className="w-4 h-4" />
                        {data.currentMonth.bestStreak} streak
                      </div>
                    )}
                  </div>
                  {data.currentMonth.stats ? (
                    <>
                      <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-2">
                        <StatTile label="Caps" value={data.currentMonth.stats.captures} hint="Flag captures this month" />
                        <StatTile label="Returns" value={data.currentMonth.stats.returns} hint="Flag returns this month" />
                        <StatTile label="Assists" value={data.currentMonth.stats.assists} hint="Capture assists this month" />
                        <StatTile label="BC" value={data.currentMonth.stats.baseCleaner} hint="Base cleaner kills — clearing defenders out of the enemy base" />
                        <StatTile label="Grabs" value={data.currentMonth.stats.flagGrabs} hint="Flag grabs this month" />
                        <StatTile label="Kills" value={data.currentMonth.stats.kills} hint="Total kills this month" />
                        <StatTile label="Deaths" value={data.currentMonth.stats.deaths} hint="Total deaths this month" />
                        <StatTile
                          label="K/D"
                          value={kdRatio(data.currentMonth.stats.kills, data.currentMonth.stats.deaths)}
                          hint="Kills per death this month"
                        />
                        <StatTile
                          label="Flag Hold"
                          value={formatFlagHold(data.currentMonth.stats.flagHoldMs)}
                          hint="Total time carrying the flag this month (min:sec)"
                        />
                      </div>
                      <p className="text-[10px] text-[#8892a0] mt-3">
                        Scoreboard stats recorded for {data.currentMonth.stats.statMatches} of {data.currentMonth.games}{" "}
                        matches this month.
                      </p>
                    </>
                  ) : (
                    <p className="text-xs text-[#8892a0]">No scoreboard stats uploaded for this month yet.</p>
                  )}
                </>
              )}
            </SectionCard>

          {/* ---- Career ---- */}
            <SectionCard title="CAREER">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-4">
                <StatTile label="Matches" value={data.totals.games} hint="All matches on record" />
                <StatTile
                  label="Record"
                  value={`${data.totals.wins}–${data.totals.losses}${data.totals.draws ? `–${data.totals.draws}` : ""}`}
                  hint={`All-time wins–losses${data.totals.draws ? "–draws" : ""}`}
                />
                <StatTile
                  label="Win Rate"
                  value={data.totals.winRate !== null ? `${data.totals.winRate}%` : "—"}
                  hint="All-time win percentage"
                />
                <StatTile
                  label="Peak Rating"
                  value={data.totals.peakElo}
                  hint="Highest ELO rating ever reached (tier-seeded, replayed over every match)"
                />
              </div>
              <AchievementsStrip achievements={data.achievements} />
              <div className="mt-4">
              <Tooltip>
                <TooltipTrigger asChild>
              <div className="bg-[#0b0c10]/60 border border-[#f1c40f]/40 rounded-lg p-4 flex items-center justify-between cursor-default">
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-[#8892a0]">
                    Highest match score
                  </div>
                  {data.careerHigh ? (
                    <div className="text-xs text-[#8892a0] mt-1">
                      {data.careerHigh.date
                        ? new Date(data.careerHigh.date).toLocaleDateString("en-GB", {
                            day: "numeric",
                            month: "short",
                            year: "numeric",
                          })
                        : ""}
                    </div>
                  ) : (
                    <div className="text-xs text-[#8892a0] mt-1">No scoreboard stats recorded yet</div>
                  )}
                </div>
                <div className="text-4xl font-bold font-mono text-[#f1c40f]">
                  {data.careerHigh ? data.careerHigh.score : "—"}
                </div>
              </div>
                </TooltipTrigger>
                <TooltipContent className="bg-[#1f2833] border border-[var(--pa30,#66fcf14d)] text-[#c5c6c7] text-xs max-w-64">
                  Best single-match scoreboard score. Only matches with an uploaded stats CSV count.
                </TooltipContent>
              </Tooltip>
              {data.totals.firstMatch && (
                <p className="text-[10px] text-[#8892a0] mt-3">
                  First recorded match:{" "}
                  {new Date(data.totals.firstMatch).toLocaleDateString("en-GB", {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </p>
              )}
              </div>
            </SectionCard>

          {/* ---- Title progression: this month's season + all-time score ---- */}
          {data && (
            <SectionCard title="TITLES">
              <TitleProgression
                seasonName={season?.name ?? null}
                seasonLadder={season?.ladder ?? null}
                monthScore={data.currentMonth.stats?.score ?? 0}
                scoreLadder={SCORE_LADDER}
                achievementScore={achievementScore}
              />
            </SectionCard>
          )}

          {/* ---- Spotlight (player's chosen highlight clip) ---- */}
          {fields.spotlight_url ? (
            <SectionCard title="SPOTLIGHT">
              <Spotlight url={fields.spotlight_url} />
            </SectionCard>
          ) : (
            canEdit && (
              <SectionCard title="SPOTLIGHT">
                <button
                  onClick={() => setEditOpen(true)}
                  className="w-full flex items-center justify-center gap-2 py-6 rounded-lg border border-dashed border-[#3d4855] text-sm text-[#8892a0] hover:text-[var(--pa,#66fcf1)] hover:border-[var(--pa50,#66fcf180)] transition-colors"
                >
                  <Video className="w-4 h-4" />
                  Add a spotlight clip (Vimeo, YouTube or Streamable)
                </button>
              </SectionCard>
            )
          )}

          {/* ---- Performance graph ---- */}
          <SectionCard title="ALL-TIME PERFORMANCE">
            {data.series.length === 0 ? (
              <p className="text-sm text-[#8892a0]">No matches recorded yet.</p>
            ) : (
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.series} margin={{ top: 5, right: 5, bottom: 0, left: -15 }}>
                    <XAxis
                      dataKey="label"
                      tick={{ fill: "#8892a0", fontSize: 11 }}
                      axisLine={{ stroke: "#3d4855" }}
                      tickLine={false}
                    />
                    <YAxis
                      yAxisId="winrate"
                      domain={[0, 100]}
                      tick={{ fill: "#8892a0", fontSize: 11 }}
                      axisLine={{ stroke: "#3d4855" }}
                      tickLine={false}
                      unit="%"
                    />
                    <YAxis
                      yAxisId="elo"
                      orientation="right"
                      domain={["auto", "auto"]}
                      tick={{ fill: "#f39c12", fontSize: 11 }}
                      axisLine={{ stroke: "#3d4855" }}
                      tickLine={false}
                      width={50}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar
                      yAxisId="winrate"
                      dataKey="winRate"
                      name="Win rate"
                      fill="var(--pa,#66fcf1)"
                      fillOpacity={0.35}
                      radius={[3, 3, 0, 0]}
                      maxBarSize={28}
                    />
                    <Line
                      yAxisId="elo"
                      dataKey="elo"
                      name="Rating"
                      type="monotone"
                      stroke="#f39c12"
                      strokeWidth={2}
                      dot={false}
                    />
                  </ComposedChart>
                </ResponsiveContainer>
                <div className="flex gap-4 justify-center mt-1 text-[10px] text-[#8892a0]">
                  <span>
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-[var(--pa40,#66fcf166)] mr-1 align-middle" />
                    Monthly win rate
                  </span>
                  <span>
                    <span className="inline-block w-4 h-0.5 bg-[#f39c12] mr-1 align-middle" />
                    Rating (tier-seeded ELO)
                  </span>
                </div>
              </div>
            )}
          </SectionCard>

          {/* ---- Friends & nemeses ---- */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <SectionCard title="BEST TEAM-MATES">
              {data.friends.length === 0 ? (
                <p className="text-sm text-[#8892a0]">Not enough games played together yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.friends.map((friend, i) => (
                    <div
                      key={friend.name}
                      className="flex items-center justify-between bg-[#0b0c10]/60 border border-[#3d4855] rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-[#8892a0] w-4">#{i + 1}</span>
                        <Heart className="w-4 h-4 text-[#27ae60]" />
                        <Link
                          href={`/player/${playerSlug(friend.name)}`}
                          className="text-sm font-bold text-[#c5c6c7] hover:text-[var(--pa,#66fcf1)] transition-colors"
                        >
                          {friend.name}
                        </Link>
                      </div>
                      <div className="text-xs font-mono text-[#8892a0]">
                        <span className="text-[#27ae60] font-bold">{Math.round(friend.rate * 100)}%</span>
                        {" · "}
                        {friend.wins}W–{friend.losses}L together ({friend.games} games)
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>

            <SectionCard title="NEMESES">
              {data.nemeses.length === 0 ? (
                <p className="text-sm text-[#8892a0]">No recurring opponents yet.</p>
              ) : (
                <div className="space-y-2">
                  {data.nemeses.map((nemesis, i) => (
                    <div
                      key={nemesis.name}
                      className="flex items-center justify-between bg-[#0b0c10]/60 border border-[#3d4855] rounded-lg px-3 py-2"
                    >
                      <div className="flex items-center gap-3">
                        <span className="text-xs font-mono text-[#8892a0] w-4">#{i + 1}</span>
                        <Swords className="w-4 h-4 text-[#ff4757]" />
                        <Link
                          href={`/player/${playerSlug(nemesis.name)}`}
                          className="text-sm font-bold text-[#c5c6c7] hover:text-[var(--pa,#66fcf1)] transition-colors"
                        >
                          {nemesis.name}
                        </Link>
                      </div>
                      <div className="text-xs font-mono text-[#8892a0]">
                        <span className="text-[#ff4757] font-bold">beats you {Math.round(nemesis.rate * 100)}%</span>
                        {" · "}
                        {nemesis.myWins}W–{nemesis.theirWins}L vs ({nemesis.meetings} meetings)
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </SectionCard>
          </div>

          {/* ---- Personal match history ---- */}
          <SectionCard title={`MATCH HISTORY — ${data.matches.length} GAMES`}>
            <MatchHistorySection entries={data.matches} playerName={player.name} />
          </SectionCard>
        </>
      )}

      {canEdit && (
        <EditProfileDialog
          open={editOpen}
          onOpenChange={setEditOpen}
          playerId={player.id}
          playerName={player.name}
          initial={fields}
          titleOptions={earned}
          themeOptions={editorThemeOptions}
          canEditTooltip={isAdmin}
          canChangePassword={isOwner}
          onSaved={setFields}
        />
      )}
    </div>
    </TooltipProvider>
  )
}
