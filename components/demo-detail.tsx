"use client"

import { useState, useTransition } from "react"
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
  DemoListItem,
  DemoPlaylist,
  Gametype,
} from "@/lib/demos-server"
import { DEMO_TAGS, demoTagClasses, demoTagLabel } from "@/lib/demo-tags"
import {
  addComment,
  deleteComment,
  deleteDemo,
  rateDemo,
  recordDemoView,
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

function RatingWidget({ demoId, canRate, initial }: { demoId: string; canRate: boolean; initial: number | null }) {
  const [hover, setHover] = useState<number | null>(null)
  const [mine, setMine] = useState<number | null>(initial)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  if (!canRate) {
    return <p className="text-sm text-muted-foreground">Log in as a player to rate this demo.</p>
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
      {error && <p className="mt-1 text-xs text-destructive">{error}</p>}
    </div>
  )
}

function OtherDemoRow({ demo }: { demo: DemoListItem }) {
  return (
    // Plain <a>, not <Link>: the engine is a page-scoped singleton (it throws
    // if window.Module already exists), so switching demos needs a full
    // reload to tear the old one down -- a client-side transition would land
    // on a second DemoViewer while the first engine is still resident.
    <a href={`/demos/${demo.id}`} className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted">
      <GametypeBadge gametype={demo.gametype} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{demo.title}</p>
        <p className="truncate text-xs text-muted-foreground">{demo.map}</p>
      </div>
      {demo.durationMs != null && (
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatDuration(demo.durationMs)}</span>
      )}
    </a>
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

function CommentRow({
  comment,
  canDelete,
  onDeleted,
}: {
  comment: DemoComment
  canDelete: boolean
  onDeleted: () => void
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
        <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{comment.body}</p>
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
}: {
  demoId: string
  comments: DemoComment[]
  currentPlayerId: string | null
  isAdmin: boolean
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
}: {
  demo: DemoDetailData
  players: { id: string; name: string }[]
  playlists: DemoPlaylist[]
  inPlaylistIds: string[]
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
      // with the rest of the form rather than as a separate ceremony.
      const playlistResult = await setDemoPlaylists(demo.id, playlistIds)
      if (!playlistResult.success) {
        setError(playlistResult.error)
        return
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
      // Hard nav for the same reason the demo links are: this page's engine
      // is a resident singleton, and the library must not be reached with it
      // still half-alive behind a client-side transition.
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
                removes the recording itself, not just the library entry. */}
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

export function DemoDetail({
  demo,
  others,
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

  return (
    <div className={cn("grid grid-cols-1 gap-6", !theater && "lg:grid-cols-[minmax(0,1fr)_20rem]")}>
      <div>
        <div className="aspect-video w-full">
          <DemoViewer
            demoUrl={demo.demoUrl}
            durationMs={demo.durationMs ?? 0}
            followName={demo.protagonist?.name}
            onPlaybackStarted={() => void recordDemoView(demo.id)}
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
            {isAdmin && (
              <div className="mt-3">
                <EditDemoDialog
                  demo={demo}
                  players={players}
                  playlists={playlists}
                  inPlaylistIds={inPlaylistIds}
                />
              </div>
            )}
          </div>
          <RatingWidget demoId={demo.id} canRate={canRate} initial={ownRating} />
        </div>

        <DemoComments
          demoId={demo.id}
          comments={comments}
          currentPlayerId={currentPlayerId}
          isAdmin={isAdmin}
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
