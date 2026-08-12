"use client"

import { useEffect, useMemo, useState, useTransition } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { Eye } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
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
import type { DemoListItem, Gametype } from "@/lib/demos-server"
import { DEMO_TAGS, demoTagClasses, demoTagLabel } from "@/lib/demo-tags"
import { matchRank } from "@/lib/demo-search"
import { beginDemoUpload, finishDemoUpload } from "@/app/(main)/demos/actions"
import { cn, formatDuration } from "@/lib/utils"
import { ReactionSummary } from "@/components/demo-reaction-bar"
import dynamic from "next/dynamic"

const GAMETYPES: Gametype[] = ["CTF", "FFA", "TeamFFA"]
// There is deliberately no gametype filter on the browse toolbar. Every demo
// uploaded so far is CTF, so the control was a permanent "All | CTF" pair where
// both choices showed the same demos. Uploads still record a gametype (the
// choices above) and the card still badges it, so a filter can come back the
// day FFA clips actually arrive.

// The viewer boots a WASM engine and pulls ~120MB of game assets, so it must
// never be part of the library page's bundle -- it is loaded only when someone
// actually opens the pre-upload preview.
const DemoViewer = dynamic(() => import("@/components/demo-viewer").then((m) => m.DemoViewer), {
  ssr: false,
  loading: () => <p className="p-6 text-sm text-muted-foreground">Starting the viewer…</p>,
})

function GametypeBadge({ gametype }: { gametype: Gametype }) {
  const tint =
    gametype === "CTF"
      ? "bg-blue-500/15 text-blue-400 border-blue-500/30"
      : gametype === "FFA"
        ? "bg-orange-500/15 text-orange-400 border-orange-500/30"
        : "bg-purple-500/15 text-purple-400 border-purple-500/30"
  return <Badge className={cn("border", tint)}>{gametype}</Badge>
}

// The card's top-left slot: who this is about, when that's known, since
// that's the more useful thing to see at a glance across a grid of CTF
// clips. Falls back to the gametype badge for the (common, for now) case of
// no protagonist set, rather than leaving the slot empty.
function LeadBadge({ demo }: { demo: DemoListItem }) {
  if (!demo.protagonist) return <GametypeBadge gametype={demo.gametype} />
  return <Badge className="border bg-sky-500/15 text-sky-400 border-sky-500/30">{demo.protagonist.name}</Badge>
}

// Exported so playlist pages show demos exactly as the library does -- a card
// that looked subtly different there would read as a different kind of thing.
export function DemoCard({ demo }: { demo: DemoListItem }) {
  return (
    // Client-side navigation on purpose: the engine is a page-scoped singleton
    // that survives route changes, and JkdEngine.start() re-attaches to a
    // resident module instead of booting a second one -- so moving between
    // demos reuses the engine (and its 120MB of loaded assets) rather than
    // paying the full boot on every click.
    //
    // prefetch={false} because the library renders every demo it is showing at
    // once (no pagination), and Next prefetches a Link as it enters the
    // viewport -- so scrolling the grid fired one request per card. /demos/[id]
    // is dynamic, and the nearest loading boundary is app/loading.tsx, which
    // returns null: the prefetch was fetching an empty shell, not the demo, so
    // it bought nothing a click doesn't do anyway. It cost 1.5K invocations in
    // 12h -- 40% of the project's Fluid CPU -- against 169 actual visits here.
    // This does NOT make the link a full page load; client-side navigation and
    // the resident engine above are unaffected.
    <Link href={`/demos/${demo.id}`} prefetch={false}>
      <Card className="h-full transition-colors hover:border-foreground/30">
        <CardHeader>
          <div className="flex items-center justify-between gap-2">
            <LeadBadge demo={demo} />
            <div className="flex items-center gap-2">
              {demo.durationMs != null && (
                <span className="text-xs tabular-nums text-muted-foreground">{formatDuration(demo.durationMs)}</span>
              )}
              <ReactionSummary counts={demo.reactions} total={demo.reactionTotal} />
            </div>
          </div>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="mt-2 line-clamp-2 font-semibold leading-snug">{demo.title}</h3>
              <p className="text-sm text-muted-foreground">{demo.map}</p>
              {demo.tags.length > 0 && (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {demo.tags.map((t) => (
                    <Badge key={t} className={cn("border px-1.5 py-0 text-[10px]", demoTagClasses(t))}>
                      {demoTagLabel(t)}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
            {/* The one visual flourish on an otherwise text-only card -- only
                shows up when an admin has actually picked a protagonist. */}
            {demo.protagonist?.avatarUrl && (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={demo.protagonist.avatarUrl}
                alt={demo.protagonist.name}
                title={demo.protagonist.name}
                className="mt-2 h-12 w-12 shrink-0 rounded-full border object-cover"
              />
            )}
          </div>
        </CardHeader>
        <CardContent>
          {demo.players.length > 0 && (
            <p className="mb-2 line-clamp-1 text-xs text-muted-foreground">
              <span className="font-bold text-foreground">Players: </span>
              {demo.players.map((p, i) => (
                <span key={p.id} className={cn(p.id === demo.protagonist?.id && "font-semibold text-sky-400")}>
                  {p.name}
                  {i < demo.players.length - 1 && ", "}
                </span>
              ))}
            </p>
          )}
          <div className="flex items-center justify-between text-xs text-muted-foreground">
            <span>
              <span className="font-bold text-foreground">Uploader:</span> {demo.uploaderName ?? "Soracle"}
            </span>
            <span className="flex items-center gap-2">
              <span>{demo.viewCount} views</span>
              {demo.recordedAt && <span>{new Date(demo.recordedAt).toLocaleDateString("en-US")}</span>}
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
  )
}

function UploadDialog({
  players,
  isAdmin,
}: {
  players: { id: string; name: string }[]
  isAdmin: boolean
}) {
  const [open, setOpen] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [playerFilter, setPlayerFilter] = useState("")
  const [taggedIds, setTaggedIds] = useState<string[]>([])
  const [highlightTags, setHighlightTags] = useState<string[]>([])
  const [pending, startTransition] = useTransition()
  const router = useRouter()
  // -1 when no file transfer is running; the byte-level progress of the PUT
  // otherwise. Separate from `pending`, which also covers the metadata save.
  const [uploadPct, setUploadPct] = useState(-1)
  // The file the user has picked, kept so it can be previewed before anything
  // is uploaded. The object URL is derived from it and revoked on the way out,
  // since each createObjectURL pins the whole file in memory until it is.
  const [chosenFile, setChosenFile] = useState<File | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const previewUrl = useMemo(
    () => (chosenFile && previewOpen ? URL.createObjectURL(chosenFile) : null),
    [chosenFile, previewOpen],
  )
  useEffect(() => {
    if (!previewUrl) return
    return () => URL.revokeObjectURL(previewUrl)
  }, [previewUrl])

  const visiblePlayers = players.filter((p) => p.name.toLowerCase().includes(playerFilter.toLowerCase()))

  function toggleTag(id: string) {
    setTaggedIds((prev) => (prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]))
  }

  function toggleHighlight(id: string) {
    setHighlightTags((prev) => (prev.includes(id) ? prev.filter((t) => t !== id) : [...prev, id]))
  }

  /**
   * The file goes to storage directly, not through the server: Vercel rejects
   * request bodies over ~4.5MB before a server action ever runs, which would
   * quietly cap every real match. XMLHttpRequest rather than fetch for the
   * PUT because only XHR reports upload progress, and a 100MB match with a
   * frozen button reads as a hang. The headers must match what the signed
   * URL was signed over, byte for byte.
   */
  function putDemoFile(url: string, file: File): Promise<void> {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest()
      xhr.open("PUT", url)
      xhr.setRequestHeader("Content-Type", "application/octet-stream")
      xhr.setRequestHeader("Cache-Control", "public, max-age=31536000, immutable")
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadPct(Math.round((100 * e.loaded) / e.total))
      }
      xhr.onload = () =>
        xhr.status >= 200 && xhr.status < 300
          ? resolve()
          : reject(new Error(`Storage refused the upload (${xhr.status}).`))
      xhr.onerror = () => reject(new Error("Could not reach storage — check your connection."))
      xhr.send(file)
    })
  }

  function submit(formData: FormData) {
    setError(null)
    for (const id of taggedIds) formData.append("playerIds", id)
    for (const id of highlightTags) formData.append("tags", id)
    const file = formData.get("file")
    // The file rides the signed PUT, never the action -- a multi-MB action
    // body is exactly what this flow exists to avoid.
    formData.delete("file")
    startTransition(async () => {
      try {
        if (!(file instanceof File) || file.size === 0) {
          setError("Choose a demo file.")
          return
        }
        const begin = await beginDemoUpload(file.name, file.size)
        if (!begin.success) {
          setError(begin.error)
          return
        }
        setUploadPct(0)
        try {
          await putDemoFile(begin.url, file)
        } catch (e) {
          setError(e instanceof Error ? e.message : "Upload failed.")
          return
        }
        const result = await finishDemoUpload(begin.storagePath, formData)
        if (!result.success) {
          setError(result.error)
          return
        }
        setOpen(false)
        setTaggedIds([])
        // Client-side, like the cards: a resident engine is re-attached to,
        // not fought with, so there is nothing a full page load would fix.
        router.push(`/demos/${result.id}`)
      } finally {
        setUploadPct(-1)
      }
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>Upload a demo</Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload a demo</DialogTitle>
          <DialogDescription>JK2 .dm_15 files only. Give it a real title, not the raw filename.</DialogDescription>
        </DialogHeader>
        <form action={submit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="title">Title</Label>
            <Input id="title" name="title" placeholder="Sora vs N|A East — CTF Yavin" required />
          </div>
          {/* No map field: the recording states its own, and the viewer fills
              it in the first time anyone watches (see reportDemoMap). */}
          <div className="space-y-1.5">
            <Label htmlFor="gametype">Gametype</Label>
            <Select name="gametype" required defaultValue="CTF">
              <SelectTrigger id="gametype">
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
          <div className="space-y-1.5">
            <Label htmlFor="recordedAt">Date recorded</Label>
            <Input id="recordedAt" name="recordedAt" type="date" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="file">Demo file (.dm_15)</Label>
            <Input
              id="file"
              name="file"
              type="file"
              accept=".dm_15"
              required
              onChange={(e) => setChosenFile(e.target.files?.[0] ?? null)}
            />
            {/* Watch it before it exists anywhere but this machine. The engine
                runs in this page and loads over a plain fetch, so a blob: URL
                plays exactly like the R2 one would -- nothing is uploaded, no
                row is written, and picking a different file just replaces it. */}
            {chosenFile && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="w-full"
                onClick={() => setPreviewOpen(true)}
              >
                <Eye className="mr-2 h-4 w-4" />
                Preview before publishing
              </Button>
            )}
            {!isAdmin && (
              <p className="text-xs text-muted-foreground">
                Up to 5MB — a single game or highlight reel. Ask an admin to publish anything longer.
              </p>
            )}
          </div>
          {isAdmin && (
            <div className="space-y-1.5">
              <Label>Uploaded on behalf of (optional)</Label>
              <Select name="onBehalfOf">
                <SelectTrigger>
                  <SelectValue placeholder="No specific player" />
                </SelectTrigger>
                <SelectContent>
                  {players.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Highlights (optional)</Label>
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
            <Label>Players in this demo</Label>
            <Input
              placeholder="Filter players..."
              value={playerFilter}
              onChange={(e) => setPlayerFilter(e.target.value)}
            />
            {/* contain: see the matching comment in demo-detail.tsx's edit
                dialog -- same grid-track/nested-overflow interaction. */}
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
          <DialogFooter className="items-center gap-3">
            {uploadPct >= 0 && (
              <div className="h-1 w-32 overflow-hidden rounded-full bg-muted">
                <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${uploadPct}%` }} />
              </div>
            )}
            <Button type="submit" disabled={pending}>
              {uploadPct >= 0 ? `Uploading… ${uploadPct}%` : pending ? "Saving…" : "Publish demo"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>

      {/* Nested inside the upload dialog so closing the preview returns to the
          half-filled form rather than throwing the metadata away. */}
      <Dialog open={previewOpen} onOpenChange={setPreviewOpen}>
        <DialogContent className="max-w-5xl">
          <DialogHeader>
            <DialogTitle>Preview — {chosenFile?.name}</DialogTitle>
            <DialogDescription>
              Playing from this machine. Nothing has been uploaded yet; close this and publish when it looks right.
            </DialogDescription>
          </DialogHeader>
          {previewUrl && (
            <div className="overflow-hidden rounded-md border">
              <DemoViewer demoUrl={previewUrl} demoFileName={chosenFile?.name} />
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setPreviewOpen(false)}>
              Back to details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  )
}

const SORTS = [
  { id: "recent", label: "Date uploaded" },
  { id: "reacts", label: "Most reacts" },
  { id: "views", label: "Views" },
] as const
type SortKey = (typeof SORTS)[number]["id"]


// Grouping key for "which month was this actually played" -- recordedAt when
// it's known, otherwise the upload date is the closest thing to it. Behind a
// function (not inlined) because both the month-list builder and the filter
// itself need to agree on exactly the same key.
function monthKeyOf(demo: DemoListItem): string {
  return (demo.recordedAt ?? demo.createdAt).slice(0, 7) // "2026-07"
}
function monthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" })
}


export function DemoLibrary({
  demos,
  players,
  canUpload,
  isAdmin,
}: {
  demos: DemoListItem[]
  players: { id: string; name: string }[]
  canUpload: boolean
  isAdmin: boolean
}) {
  const [query, setQuery] = useState("")
  const [month, setMonth] = useState("all")
  const [sort, setSort] = useState<SortKey>("recent")
  const [tag, setTag] = useState("all")

  const months = useMemo(() => {
    const keys = [...new Set(demos.map(monthKeyOf))]
    return keys.sort().reverse()
  }, [demos])

  // Only offer tags something is actually filed under -- a menu where most
  // entries find nothing is just noise.
  const usedTags = useMemo(() => {
    const present = new Set(demos.flatMap((d) => d.tags))
    return DEMO_TAGS.filter((t) => present.has(t.id))
  }, [demos])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    const list = demos.filter((d) => {
      if (month !== "all" && monthKeyOf(d) !== month) return false
      if (tag !== "all" && !d.tags.includes(tag as never)) return false
      if (!q) return true
      return (
        d.title.toLowerCase().includes(q) ||
        d.map.toLowerCase().includes(q) ||
        (d.uploaderName?.toLowerCase().includes(q) ?? false) ||
        d.players.some((p) => p.name.toLowerCase().includes(q))
      )
    })
    const sorted = [...list]
    if (sort === "reacts") {
      sorted.sort((a, b) => b.reactionTotal - a.reactionTotal)
    } else if (sort === "views") {
      sorted.sort((a, b) => b.viewCount - a.viewCount)
    } else {
      sorted.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    }

    /*
     * With a name typed in, put the demos that are *about* that person first.
     *
     * A name matches four different things -- who starred in it, who was in
     * it, who uploaded it, and the words in its title -- and flattening those
     * into one date-ordered list buries the good stuff. Searching a player
     * gave their headline clips mixed in with everything they happened to
     * upload, in whatever order they landed.
     *
     * Applied only when something is typed, and only as a first key: the
     * chosen sort still decides the order inside each band, so switching to
     * "highest rated" still does what it says, just about the right demos
     * first.
     */
    if (!q) return sorted
    return sorted.sort((a, b) => matchRank(b, q) - matchRank(a, q))
  }, [demos, query, month, sort, tag])

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Input
            placeholder="Search title, map, or player..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64"
          />
          <Select value={month} onValueChange={setMonth}>
            <SelectTrigger className="w-40">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Every month</SelectItem>
              {months.map((key) => (
                <SelectItem key={key} value={key}>
                  {monthLabel(key)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {usedTags.length > 0 && (
            <Select value={tag} onValueChange={setTag}>
              <SelectTrigger className="w-40">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All highlights</SelectItem>
                {usedTags.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Select value={sort} onValueChange={(v) => setSort(v as SortKey)}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SORTS.map((s) => (
                <SelectItem key={s.id} value={s.id}>
                  Sort: {s.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canUpload ? (
          <UploadDialog players={players} isAdmin={isAdmin} />
        ) : (
          <Button variant="outline" disabled title="Log in to upload a demo">
            Log in to upload
          </Button>
        )}
      </div>


      {filtered.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          {demos.length === 0 ? "No demos yet." : "No demos match your search."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((demo) => (
            <DemoCard key={demo.id} demo={demo} />
          ))}
        </div>
      )}
    </div>
  )
}
