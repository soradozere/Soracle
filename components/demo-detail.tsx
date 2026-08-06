"use client"

import { useRef, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Star, Trash2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Textarea } from "@/components/ui/textarea"
import { DemoViewer } from "@/components/demo-viewer"
import type {
  DemoComment,
  DemoDetail as DemoDetailData,
  DemoLink,
  DemoListItem,
  DemoMoment,
  DemoPlaylist,
  Gametype,
} from "@/lib/demos-server"
import { DEMO_TAGS, demoTagClasses, demoTagLabel } from "@/lib/demo-tags"
import { RenderToYoutubeDialog, type RenderCameraState } from "@/components/render-to-youtube-dialog"
import {
  addComment,
  addDemoMoment,
  beginDemoTrim,
  deleteComment,
  finishDemoTrim,
  deleteDemo,
  rateDemo,
  recordDemoView,
  removeDemoMoment,
  reportDemoMap,
  setDemoPlaylists,
  updateDemo,
} from "@/app/(main)/demos/actions"
import { cn, formatDuration } from "@/lib/utils"

const GAMETYPES: Gametype[] = ["CTF", "FFA", "TeamFFA"]

function TagBadges({ tags }: { tags: string[] }) {
  if (tags.length === 0) return null
  return (
    <>
      {tags.map((t) => (
        <Badge key={t} className={cn("border", demoTagClasses(t))}>
          {demoTagLabel(t)}
        </Badge>
      ))}
    </>
  )
}

function playerSlug(name: string): string {
  return encodeURIComponent(name.trim().toLowerCase().replace(/\s+/g, "-"))
}

function GametypeBadge({ gametype }: { gametype: Gametype }) {
  const tint =
    gametype === "CTF"
      ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
      : gametype === "FFA"
        ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
        : "bg-purple-500/15 text-purple-400 border-purple-500/30"
  return <Badge className={cn("border", tint)}>{gametype}</Badge>
}

function RatingWidget({
  demoId,
  canRate,
  initial,
  avgRating,
  ratingCount,
}: {
  demoId: string
  canRate: boolean
  initial: number | null
  avgRating: number | null
  ratingCount: number
}) {
  const [hover, setHover] = useState<number | null>(null)
  const [mine, setMine] = useState<number | null>(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  /*
   * What everyone else made of it, under whatever the stars are showing.
   *
   * The stars are personal -- they show your own rating, and swing to follow
   * the cursor while you pick -- so without this the page could tell you what
   * you thought and nothing about what anyone else did. The count comes with
   * it because "4.5" from two people and from forty are not the same claim.
   *
   * Not live: this is the figure from page load, so it will not include a
   * rating just cast. Refreshing is the honest way to see that, rather than
   * doing arithmetic on a number whose denominator we would be guessing at.
   */
  const summary =
    avgRating !== null && ratingCount > 0 ? (
      <p className="mt-1 text-xs text-muted-foreground">
        Global rating: <span className="font-medium text-foreground">{avgRating.toFixed(1)}</span>
        <span className="tabular-nums"> / 5</span> · {ratingCount} {ratingCount === 1 ? "rating" : "ratings"}
      </p>
    ) : (
      <p className="mt-1 text-xs text-muted-foreground">No ratings yet</p>
    )

  if (!canRate) {
    return (
      <div className="text-right">
        {summary}
        <p className="text-sm text-muted-foreground">Log in as a player to rate this demo.</p>
      </div>
    )
  }

  function submit(n: number) {
    setError(null)
    startTransition(async () => {
      const result = await rateDemo(demoId, n)
      if (!result.success) {
        setError(result.error)
        return
      }
      setMine(n)
    })
  }

  const shown = hover ?? mine ?? 0
  return (
    <div>
      <div className="flex items-center gap-1" onMouseLeave={() => setHover(null)}>
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            disabled={pending}
            onMouseEnter={() => setHover(n)}
            onClick={() => submit(n)}
            className="disabled:opacity-50"
            aria-label={`Rate ${n} star${n > 1 ? "s" : ""}`}
          >
            <Star className={cn("h-5 w-5", n <= shown ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground")} />
          </button>
        ))}
      </div>
      {summary}
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

function OtherDemoRow({ demo }: { demo: DemoListItem }) {
  return (
    // Client-side on purpose: JkdEngine.start() re-attaches to the resident
    // engine, so switching demos this way reuses the loaded 120MB of assets
    // and swaps recordings in a couple of seconds instead of a full reboot.
    <Link href={`/demos/${demo.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted">
      <GametypeBadge gametype={demo.gametype} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{demo.title}</p>
        <p className="truncate text-xs text-muted-foreground">{demo.map}</p>
      </div>
      {demo.durationMs != null && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(demo.durationMs)}</span>
      )}
    </Link>
  )
}

function timeAgo(iso: string): string {
  const seconds = Math.max(0, Math.round((Date.now() - Date.parse(iso)) / 1000))
  if (seconds < 60) return "just now"
  const steps: [number, string][] = [
    [60, "minute"],
    [60, "hour"],
    [24, "day"],
    [7, "week"],
  ]
  let value = seconds
  let unit = "second"
  for (const [size, name] of steps) {
    if (value < size) break
    value = Math.floor(value / size)
    unit = name
  }
  if (unit === "week" && value > 4) return new Date(iso).toLocaleDateString("en-US")
  return `${value} ${unit}${value === 1 ? "" : "s"} ago`
}

/**
 * Turn timestamps people type into links that jump there.
 *
 * "1:23" in a comment means the same thing everywhere else on the internet, so
 * it should mean it here too -- and it lets the people who can comment point
 * at a moment without owning the demo. Split with a capturing group so the
 * text between matches survives; rendered as text nodes and buttons, never as
 * markup, since this is player-written.
 */
const TIMESTAMP_RE = /(\b\d{1,2}:[0-5]\d(?::[0-5]\d)?\b)/g

function CommentBody({ body, onSeek }: { body: string; onSeek?: (ms: number) => void }) {
  const parts = body.split(TIMESTAMP_RE)
  return (
    <>
      {parts.map((part, i) => {
        if (!TIMESTAMP_RE.test(part) || !onSeek) {
          // test() advances lastIndex on a global regex; reset so the next
          // part is judged on its own merits.
          TIMESTAMP_RE.lastIndex = 0
          return <span key={i}>{part}</span>
        }
        TIMESTAMP_RE.lastIndex = 0
        const units = part.split(":").map(Number)
        const seconds =
          units.length === 3 ? units[0] * 3600 + units[1] * 60 + units[2] : units[0] * 60 + units[1]
        return (
          <button
            key={i}
            type="button"
            onClick={() => onSeek(seconds * 1000)}
            className="font-medium text-primary underline-offset-2 hover:underline"
          >
            {part}
          </button>
        )
      })}
    </>
  )
}

function CommentRow({
  comment,
  canDelete,
  onDeleted,
  onSeek,
}: {
  comment: DemoComment
  canDelete: boolean
  onDeleted: () => void
  onSeek?: (ms: number) => void
}) {
  const [pending, startTransition] = useTransition()
  return (
    <li className="flex gap-3 py-3">
      {comment.author.avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={comment.author.avatarUrl}
          alt=""
          className="h-8 w-8 shrink-0 rounded-full border object-cover"
        />
      ) : (
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-xs font-semibold uppercase text-muted-foreground">
          {comment.author.name.slice(0, 2)}
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="text-sm">
          <span className="font-bold text-foreground">{comment.author.name}</span>{" "}
          <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt)}</span>
        </p>
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">
          <CommentBody body={comment.body} onSeek={onSeek} />
        </p>
      </div>
      {canDelete && (
        <button
          type="button"
          aria-label="Delete comment"
          disabled={pending}
          onClick={() =>
            startTransition(async () => {
              const result = await deleteComment(comment.id)
              if (result.success) onDeleted()
            })
          }
          className="shrink-0 self-start p-1 text-muted-foreground hover:text-destructive disabled:opacity-40"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  )
}

function DemoComments({
  demoId,
  comments,
  currentPlayerId,
  isAdmin,
  onSeek,
}: {
  demoId: string
  comments: DemoComment[]
  currentPlayerId: string | null
  isAdmin: boolean
  onSeek?: (ms: number) => void
}) {
  const router = useRouter()
  const [body, setBody] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await addComment(demoId, body)
      if (!result.success) {
        setError(result.error)
        return
      }
      setBody("")
      router.refresh()
    })
  }

  return (
    <section className="mt-8 border-t pt-6">
      <h2 className="mb-4 text-sm font-semibold">
        {comments.length} {comments.length === 1 ? "comment" : "comments"}
      </h2>

      {currentPlayerId ? (
        <div className="mb-2 space-y-2">
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="Say something about this demo…"
            rows={3}
            className="max-w-2xl"
          />
          <div className="flex items-center gap-3">
            <Button size="sm" disabled={pending || !body.trim()} onClick={submit}>
              {pending ? "Posting…" : "Comment"}
            </Button>
            {error && <span className="text-sm text-destructive">{error}</span>}
          </div>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">
          <Link href="/players" className="underline underline-offset-2">
            Log in as a player
          </Link>{" "}
          to leave a comment.
        </p>
      )}

      <ul className="max-w-2xl divide-y">
        {comments.map((c) => (
          <CommentRow
            key={c.id}
            comment={c}
            canDelete={isAdmin || c.author.id === currentPlayerId}
            onDeleted={() => router.refresh()}
          />
        ))}
      </ul>
    </section>
  )
}

function EditDemoDialog({
  demo,
  players,
  playlists,
  inPlaylistIds,
  isAdmin,
}: {
  demo: DemoDetailData
  players: { id: string; name: string }[]
  playlists: DemoPlaylist[]
  inPlaylistIds: string[]
  /**
   * Uploaders get this dialog for their own demos, but a smaller version of
   * it: crediting, playlists and deletion stay with admins, and the server
   * enforces the same split rather than trusting this flag.
   */
  isAdmin: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playerFilter, setPlayerFilter] = useState("")
  const [taggedIds, setTaggedIds] = useState<string[]>(demo.players.map((p) => p.id))
  const [highlightTags, setHighlightTags] = useState<string[]>(demo.tags)
  const [playlistIds, setPlaylistIds] = useState<string[]>(inPlaylistIds)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [pending, startTransition] = useTransition()

  const visiblePlayers = players.filter((p) => p.name.toLowerCase().includes(playerFilter.toLowerCase()))

  function toggleTag(id: string) {
    setTaggedIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  function toggleHighlight(id: string) {
    setHighlightTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  function togglePlaylist(id: string) {
    setPlaylistIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  function submit(formData: FormData) {
    setError(null)
    for (const id of taggedIds) formData.append("playerIds", id)
    for (const id of highlightTags) formData.append("tags", id)
    startTransition(async () => {
      const result = await updateDemo(demo.id, formData)
      if (!result.success) {
        setError(result.error)
        return
      }

      // Membership is its own table, so it is its own write -- but it saves
      // with the rest of the form rather than as a separate ceremony. Only
      // admins can file demos into playlists, and only they were shown the
      // checkboxes, so an uploader's save skips this entirely.
      if (isAdmin) {
        const playlistResult = await setDemoPlaylists(demo.id, playlistIds)
        if (!playlistResult.success) {
          setError(playlistResult.error)
          return
        }
      }
      setOpen(false)
      router.refresh()
    })
  }

  function remove() {
    setError(null)
    startTransition(async () => {
      const result = await deleteDemo(demo.id)
      if (!result.success) {
        setError(result.error)
        setConfirmingDelete(false)
        return
      }
      // Still a hard nav, but for its own reason now: after deleting the demo
      // that is loaded into the resident engine, a clean slate beats leaving
      // the engine suspended mid-way through a recording that no longer exists.
      window.location.href = "/demos"
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          Edit
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Edit demo</DialogTitle>
          <DialogDescription>Admin only. Fixes title, map, players, or credited uploader.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="edit-title">Title</Label>
            <Input id="edit-title" name="title" defaultValue={demo.title} required />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="edit-map">Map</Label>
              <Input id="edit-map" name="map" defaultValue={demo.map} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="edit-gametype">Gametype</Label>
              <Select name="gametype" required defaultValue={demo.gametype}>
                <SelectTrigger id="edit-gametype">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GAMETYPES.map((g) => (
                    <SelectItem key={g} value={g}>
                      {g}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-recordedAt">Date recorded</Label>
            <Input id="edit-recordedAt" name="recordedAt" type="date" defaultValue={demo.recordedAt ?? ""} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-description">Description</Label>
            <Textarea id="edit-description" name="description" defaultValue={demo.description ?? ""} rows={3} />
          </div>
          {isAdmin && (
          <div className="space-y-1.5">
            <Label>Credited uploader</Label>
            <Select name="uploaderPlayerId" defaultValue={demo.uploaderPlayerId ?? "__none__"}>
              <SelectTrigger>
                <SelectValue placeholder="No specific player" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">No specific player</SelectItem>
                {players.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          )}
          {/*
            Not gated on isAdmin, unlike credited-uploader above: the server
            side of this split (updateDemo, app/(main)/demos/actions.ts) has
            always treated protagonist as the uploader's call, not an admin
            one -- "they are the one who knows whose clip it is" -- but this
            field was accidentally nested inside the admin-only block since
            the form was first built, so the backend allowed something the UI
            never offered a way to do.
          */}
          <div className="space-y-1.5">
            <Label>Protagonist</Label>
            <p className="text-xs text-muted-foreground">
              Featured on the library card with their profile picture.
            </p>
            <Select name="protagonistPlayerId" defaultValue={demo.protagonist?.id ?? "__none__"}>
              <SelectTrigger>
                <SelectValue placeholder="None" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">None</SelectItem>
                {players.map((p) => (
                  <SelectItem key={p.id} value={p.id}>
                    {p.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Highlights</Label>
            <p className="text-xs text-muted-foreground">What happens in this one. Drives the library filters.</p>
            <div className="flex flex-wrap gap-1.5">
              {DEMO_TAGS.map((t) => {
                const on = highlightTags.includes(t.id)
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleHighlight(t.id)}
                    aria-pressed={on}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-xs transition-colors",
                      on ? demoTagClasses(t.id) : "border-border text-muted-foreground hover:bg-muted",
                    )}
                  >
                    {t.label}
                  </button>
                )
              })}
            </div>
          </div>
          {isAdmin && (
          <div className="space-y-1.5">
            <Label>Playlists</Label>
            {playlists.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                No playlists yet —{" "}
                <a href="/demos/playlists" className="underline underline-offset-2">
                  create one
                </a>{" "}
                to file this under.
              </p>
            ) : (
              <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border p-2">
                {playlists.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                    <Checkbox checked={playlistIds.includes(p.id)} onCheckedChange={() => togglePlaylist(p.id)} />
                    {p.title}
                  </label>
                ))}
              </div>
            )}
          </div>
          )}
          <div className="space-y-1.5">
            <Label>Players in this demo</Label>
            <Input
              placeholder="Filter players..."
              value={playerFilter}
              onChange={(e) => setPlayerFilter(e.target.value)}
            />
            {/* contain: DialogContent is a CSS grid, and Chromium's grid-track
                sizing pass computes this item's intrinsic size from its full,
                unclipped scrollHeight (~2600px for the whole playerbase) --
                ignoring the max-h-40 that correctly clips what actually
                paints. Size+layout containment tells the browser this
                element's content can't affect anything outside it, which is
                what makes the grid track (and the dialog under it) stop
                reserving space for rows nobody can see. Verified: removes
                dialog.scrollHeight the leak from 3425px down to ~930px. */}
            <div className="h-40 [contain:size_layout] space-y-1 overflow-y-auto rounded-md border p-2">
              {visiblePlayers.map((p) => (
                <label key={p.id} className="flex items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted">
                  <Checkbox checked={taggedIds.includes(p.id)} onCheckedChange={() => toggleTag(p.id)} />
                  {p.name}
                </label>
              ))}
              {visiblePlayers.length === 0 && (
                <p className="px-1 py-1 text-sm text-muted-foreground">No matching players.</p>
              )}
            </div>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="sm:justify-between">
            {/* Two taps, and the second one names what it will destroy -- this
                removes the recording itself, not just the library entry.
                Not gated on isAdmin: this dialog only opens for an admin or
                the uploader in the first place (canEditMoments), and deleting
                your own recording is yours to do. deleteDemo enforces the same
                pair server-side rather than trusting that. */}
            {confirmingDelete ? (
              <div className="flex items-center gap-2">
                <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={remove}>
                  {pending ? "Deleting…" : "Delete permanently"}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => setConfirmingDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button type="button" variant="destructive" size="sm" disabled={pending} onClick={() => setConfirmingDelete(true)}>
                <Trash2 className="mr-1.5 h-3.5 w-3.5" />
                Delete demo
              </Button>
            )}
            <Button type="submit" disabled={pending}>
              {pending ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/**
 * Marking the moment worth watching, right now, on its own.
 *
 * The timestamp is taken from the player rather than typed: you mark a moment
 * while you are looking at it, which is the only way anyone would ever get it
 * right to the second. Saves the instant it's marked -- not staged behind the
 * rest of the edit form -- since the whole point is catching it before it's
 * gone. A short label is optional; a bare timestamp is a useful marker too.
 */
function MomentMarker({
  demoId,
  currentMs,
  moments,
  onChange,
}: {
  demoId: string
  currentMs: () => number
  moments: DemoMoment[]
  onChange: (next: DemoMoment[]) => void
}) {
  const [label, setLabel] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function mark() {
    setError(null)
    const atMs = Math.max(0, Math.round(currentMs()))
    startTransition(async () => {
      const result = await addDemoMoment(demoId, atMs, label)
      if (!result.success || !result.moment) {
        setError(result.success ? "Couldn't save that moment." : result.error)
        return
      }
      onChange([...moments, result.moment].sort((a, b) => a.atMs - b.atMs))
      setLabel("")
    })
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        placeholder="What's happening? (optional)"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        className="h-8 w-44 text-xs"
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault()
            mark()
          }
        }}
      />
      {/* Amber, matching the glow a saved moment leaves on the scrubber -- the
          control is coloured as the thing it produces. */}
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending}
        onClick={mark}
        className="border-amber-500/60 bg-amber-500/15 font-medium text-foreground hover:bg-amber-500/30 hover:text-foreground"
      >
        Mark {formatDuration(Math.max(0, Math.round(currentMs())))}
      </Button>
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

/**
 * Cutting a demo down to the part worth keeping.
 *
 * The in and out points are taken from playback rather than typed, for the same
 * reason moments are: you frame a clip by watching it. The cut itself runs in
 * the engine and comes back as bytes, which go to R2 by the same presigned
 * route an upload takes -- the server never sees the file, only the swap.
 *
 * Guarded behind a confirm because it replaces the recording. The old file is
 * copied to the trash prefix on the way out, but that is a safety net for us,
 * not an undo button for the person clicking.
 */
function TrimControl({
  demoId,
  currentMs,
  durationMs,
  trim,
  settled,
  range,
  onRangeChange,
}: {
  demoId: string
  currentMs: () => number
  durationMs: number
  trim: ((startMs: number, endMs: number) => Promise<Uint8Array>) | null
  /** False until the player has booted far enough to answer either way. */
  settled: boolean
  range: { startMs: number; endMs: number } | null
  onRangeChange: (next: { startMs: number; endMs: number } | null) => void
}) {
  const router = useRouter()
  const [inMs, setInMs] = useState<number | null>(null)
  const [outMs, setOutMs] = useState<number | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Say which of the two "no" answers this is. Rendering nothing at all while
  // the engine boots reads as a missing feature rather than one that is thirty
  // seconds away, which is exactly how it looked the first time.
  if (!settled) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wider">Trim</span> &mdash; waiting for the player to load&hellip;
      </p>
    )
  }
  if (!trim) {
    return (
      <p className="text-xs text-muted-foreground">
        <span className="font-medium uppercase tracking-wider">Trim</span> &mdash; needs a newer player build than the
        one this page loaded.
      </p>
    )
  }

  function setPoint(which: "in" | "out") {
    setError(null)
    setConfirming(false)
    const at = Math.max(0, Math.round(currentMs()))
    const nextIn = which === "in" ? at : inMs
    const nextOut = which === "out" ? at : outMs
    if (which === "in") setInMs(at)
    else setOutMs(at)
    onRangeChange(nextIn !== null && nextOut !== null && nextOut > nextIn ? { startMs: nextIn, endMs: nextOut } : null)
  }

  function clear() {
    setInMs(null)
    setOutMs(null)
    setConfirming(false)
    setError(null)
    onRangeChange(null)
  }

  async function run() {
    if (!range || !trim) return
    setError(null)
    setConfirming(false)
    try {
      setBusy("Cutting…")
      const bytes = await trim(range.startMs, range.endMs)

      setBusy("Saving…")
      const begin = await beginDemoTrim(demoId, bytes.length)
      if (!begin.success) throw new Error(begin.error)

      const put = await fetch(begin.url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream", "Cache-Control": "public, max-age=31536000, immutable" },
        body: new Blob([bytes as BlobPart]),
      })
      if (!put.ok) throw new Error(`Upload failed (${put.status}).`)

      const done = await finishDemoTrim(demoId, begin.storagePath, range.startMs, range.endMs)
      if (!done.success) throw new Error(done.error)

      clear()
      // A hard reload rather than router.refresh(): the demo the engine has
      // open no longer exists, so the cleanest thing is to start it again.
      window.location.reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : "The trim failed.")
    } finally {
      setBusy(null)
    }
  }

  const cutMs = range ? range.endMs - range.startMs : 0

  return (
    /* Cyan throughout, matching the range this lights up on the scrubber --
       the same trick as the amber Mark button: each control wears the colour
       of what it puts on the timeline. */
    <div className="flex flex-wrap items-center gap-2 rounded-md border border-cyan-500/40 bg-cyan-500/5 px-2.5 py-2">
      {/* Named, because two buttons saying "Clip starts here" next to a video
          read as playback controls rather than as the ends of a cut. */}
      <span className="text-[11px] font-semibold uppercase tracking-wider text-cyan-500">Trim</span>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!!busy}
        onClick={() => setPoint("in")}
        className="border-cyan-500/60 bg-cyan-500/15 font-medium text-foreground hover:bg-cyan-500/30 hover:text-foreground"
      >
        {inMs !== null ? `Clip starts ${formatDuration(inMs)}` : "Clip starts here"}
      </Button>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={!!busy}
        onClick={() => setPoint("out")}
        className="border-cyan-500/60 bg-cyan-500/15 font-medium text-foreground hover:bg-cyan-500/30 hover:text-foreground"
      >
        {outMs !== null ? `Clip ends ${formatDuration(outMs)}` : "Clip ends here"}
      </Button>
      {inMs === null && outMs === null && (
        <span className="text-[11px] text-muted-foreground">
          Play to the moment, mark each end, then cut the rest away.
        </span>
      )}

      {range && !confirming && (
        <Button
          type="button"
          size="sm"
          disabled={!!busy}
          onClick={() => setConfirming(true)}
          className="bg-cyan-500 text-black hover:bg-cyan-400"
        >
          {busy ?? `Trim to ${formatDuration(cutMs)}`}
        </Button>
      )}

      {range && confirming && (
        <span className="flex flex-wrap items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1 text-xs">
          <span>
            Replace this recording with {formatDuration(range.startMs)}–{formatDuration(range.endMs)}
            {durationMs > 0 && <> ({formatDuration(durationMs)} → {formatDuration(cutMs)})</>}? This cannot be undone.
          </span>
          <Button type="button" size="sm" variant="destructive" disabled={!!busy} onClick={run}>
            Trim
          </Button>
          <Button type="button" size="sm" variant="ghost" disabled={!!busy} onClick={() => setConfirming(false)}>
            Cancel
          </Button>
        </span>
      )}

      {(inMs !== null || outMs !== null) && !busy && (
        <button type="button" onClick={clear} className="text-xs text-muted-foreground hover:text-foreground">
          Clear
        </button>
      )}
      {busy && <span className="text-xs text-muted-foreground">{busy}</span>}
      {error && <span className="text-xs text-destructive">{error}</span>}
    </div>
  )
}

export function DemoDetail({
  demo,
  others,
  previousDemo,
  nextDemo,
  canRate,
  ownRating,
  isAdmin,
  players,
  comments,
  currentPlayerId,
  playlists,
  inPlaylistIds,
}: {
  demo: DemoDetailData
  others: DemoListItem[]
  /** The demos either side of this one, for the end-of-demo overlay. */
  previousDemo: DemoLink | null
  nextDemo: DemoLink | null
  canRate: boolean
  ownRating: number | null
  isAdmin: boolean
  players: { id: string; name: string }[]
  comments: DemoComment[]
  currentPlayerId: string | null
  playlists: DemoPlaylist[]
  inPlaylistIds: string[]
}) {
  // Theater mode drops the "more demos" sidebar so the video gets the width
  // back -- a page-layout concern, not something DemoViewer itself needs to
  // know about (it already just fills whatever box it's given).
  const [theater, setTheater] = useState(false)
  // Read on demand rather than held in state: the position changes 5x a second
  // and only matters at the instant someone marks a moment.
  const playbackMsRef = useRef(0)
  // Handed up by the player so a timestamp in a comment can drive it.
  const seekRef = useRef<((ms: number) => void) | null>(null)
  // Held here rather than re-derived from `demo` so marking or removing a
  // moment shows up on the scrubber immediately, without a full page reload.
  const [moments, setMoments] = useState<DemoMoment[]>(demo.moments)
  const canEditMoments = isAdmin || (!!currentPlayerId && demo.uploaderPlayerId === currentPlayerId)
  // Handed up by the player once its engine is running, or null if that engine
  // is too old to cut. Held in state rather than a ref because whether the
  // control renders at all depends on it.
  const [trimFn, setTrimFn] = useState<((startMs: number, endMs: number) => Promise<Uint8Array>) | null>(null)
  // Distinguishes "the engine has not answered yet" from "the engine says no".
  const [trimSettled, setTrimSettled] = useState(false)
  const [trimRange, setTrimRange] = useState<{ startMs: number; endMs: number } | null>(null)
  // Handed up by the player once its engine is running. Same thunk wrapping as
  // trimFn: React would otherwise treat the function as a state updater.
  const [readCamera, setReadCamera] = useState<(() => RenderCameraState | null) | null>(null)

  return (
    <div className={cn("grid grid-cols-1 gap-6", !theater && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
      <div>
        <div className="aspect-video w-full">
          <DemoViewer
            demoUrl={demo.demoUrl}
            durationMs={demo.durationMs ?? 0}
            followName={demo.protagonist?.name}
            onPlaybackStarted={() => void recordDemoView(demo.id)}
            // Fills in a map nobody typed at upload. Only ever fills a blank,
            // so a demo that already knows its map is never overwritten.
            onMapDetected={demo.map ? undefined : (map) => void reportDemoMap(demo.id, map)}
            onPositionChange={(ms) => {
              playbackMsRef.current = ms
            }}
            onSeekReady={(fn) => {
              seekRef.current = fn
            }}
            // Wrapped in a thunk: React would otherwise treat the function
            // itself as a state updater and call it.
            onTrimReady={(fn) => {
              setTrimFn(() => fn)
              setTrimSettled(true)
            }}
            onCameraStateReady={(read) => setReadCamera(() => read)}
            trimRange={trimRange}
            previousDemo={previousDemo}
            nextDemo={nextDemo}
            moments={moments}
            onRemoveMoment={
              canEditMoments
                ? (id: string) => {
                    const removed = moments.find((m) => m.id === id)
                    setMoments((prev) => prev.filter((m) => m.id !== id))
                    void removeDemoMoment(demo.id, id).then((result) => {
                      // Put it back -- the delete didn't actually happen.
                      if (!result.success && removed) {
                        setMoments((prev) => [...prev, removed].sort((a, b) => a.atMs - b.atMs))
                      }
                    })
                  }
                : undefined
            }
          />
        </div>

        <div className="mt-4 flex flex-wrap items-start justify-between gap-4">
          <div>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <GametypeBadge gametype={demo.gametype} />
              <TagBadges tags={demo.tags} />
              <span className="text-sm text-muted-foreground">{demo.map}</span>
              {demo.durationMs != null && (
                <span className="text-sm tabular-nums text-muted-foreground">{formatDuration(demo.durationMs)}</span>
              )}
              <span className="text-sm text-muted-foreground">
                · {demo.viewCount} {demo.viewCount === 1 ? "view" : "views"}
              </span>
              <Button variant="ghost" size="sm" className="ml-2 h-7 px-2 text-xs" onClick={() => setTheater((t) => !t)}>
                {theater ? "Exit theater mode" : "Theater mode"}
              </Button>
            </div>
            <h1 className="text-xl font-semibold tracking-tight">{demo.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              <span className="font-bold text-foreground">Uploader:</span> {demo.uploaderName ?? "Soracle"}
              {demo.recordedAt && ` · Recorded ${new Date(demo.recordedAt).toLocaleDateString("en-US")}`}
            </p>
            {demo.description && <p className="mt-2 max-w-prose text-sm">{demo.description}</p>}
            {demo.players.length > 0 && (
              <p className="mt-2 flex flex-wrap gap-x-1 text-sm text-muted-foreground">
                <span className="font-bold text-foreground">Players:</span>{" "}
                {demo.players.map((p, i) => {
                  // The protagonist is the reason to watch this one, so they
                  // read as the subject of the list rather than one more name in it.
                  const isProtagonist = p.id === demo.protagonist?.id
                  return (
                    <span key={p.id}>
                      <Link
                        href={`/player/${playerSlug(p.name)}`}
                        title={isProtagonist ? `${p.name} — protagonist` : undefined}
                        className={cn(
                          "underline-offset-2 hover:underline",
                          isProtagonist && "font-semibold text-sky-400",
                        )}
                      >
                        {p.name}
                      </Link>
                      {i < demo.players.length - 1 && ","}
                    </span>
                  )
                })}
              </p>
            )}
            {/* The uploader can fix their own details without going through an
                admin -- a typo in a title shouldn't need one. */}
            {canEditMoments && (
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <EditDemoDialog
                  demo={demo}
                  players={players}
                  playlists={playlists}
                  inPlaylistIds={inPlaylistIds}
                  isAdmin={isAdmin}
                />
                <MomentMarker
                  demoId={demo.id}
                  currentMs={() => playbackMsRef.current}
                  moments={moments}
                  onChange={setMoments}
                />
              </div>
            )}
            {canEditMoments && (
              <div className="mt-2">
                <TrimControl
                  demoId={demo.id}
                  currentMs={() => playbackMsRef.current}
                  durationMs={demo.durationMs ?? 0}
                  trim={trimFn}
                  settled={trimSettled}
                  range={trimRange}
                  onRangeChange={setTrimRange}
                />
              </div>
            )}
          </div>
          <RatingWidget
            demoId={demo.id}
            canRate={canRate}
            initial={ownRating}
            avgRating={demo.avgRating}
            ratingCount={demo.ratingCount}
          />

          {/* Same gate as trimming and moments: the uploader or an admin.
              requestRender enforces it again server-side through resolveEditor
              rather than trusting that this did not render. */}
          {canEditMoments && (
            <div className="mt-3">
              <RenderToYoutubeDialog
                demoId={demo.id}
                demoTitle={demo.title}
                durationMs={demo.durationMs ?? 0}
                protagonistId={demo.protagonist?.id ?? null}
                protagonistName={demo.protagonist?.name}
                getCameraState={readCamera}
              />
            </div>
          )}
        </div>

        <DemoComments
          demoId={demo.id}
          comments={comments}
          currentPlayerId={currentPlayerId}
          isAdmin={isAdmin}
          onSeek={(ms) => seekRef.current?.(ms)}
        />
      </div>

      {!theater && (
        <aside>
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">More demos</h2>
          <div className="max-h-[32rem] space-y-1 overflow-y-auto rounded-xl border p-1">
            {others.length === 0 ? (
              <p className="p-3 text-sm text-muted-foreground">No other demos yet.</p>
            ) : (
              others.map((o) => <OtherDemoRow key={o.id} demo={o} />)
            )}
          </div>
        </aside>
      )}
    </div>
  )
}
