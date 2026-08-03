"use client"

import { useState, useTransition } from "react"
import { useRouter } from "next/navigation"
import Link from "next/link"
import { ListVideo, Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardHeader } from "@/components/ui/card"
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
import { Textarea } from "@/components/ui/textarea"
import { DemoCard } from "@/components/demo-library"
import type { DemoListItem, DemoPlaylist } from "@/lib/demos-server"
import { createPlaylist, deletePlaylist } from "@/app/(main)/demos/actions"

function CreatePlaylistDialog() {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState("")
  const [description, setDescription] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  function submit() {
    setError(null)
    startTransition(async () => {
      const result = await createPlaylist(title, description)
      if (!result.success) {
        setError(result.error)
        return
      }
      setTitle("")
      setDescription("")
      setOpen(false)
      router.refresh()
    })
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">New playlist</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>New playlist</DialogTitle>
          <DialogDescription>
            Demos are added from each demo&rsquo;s own Edit dialog once this exists.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="playlist-title">Name</Label>
            <Input
              id="playlist-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="July 2026 Highlights"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="playlist-description">Description (optional)</Label>
            <Textarea
              id="playlist-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
            />
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
        <DialogFooter>
          <Button onClick={submit} disabled={pending || title.trim().length < 3}>
            {pending ? "Creating…" : "Create playlist"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function PlaylistRow({ playlist, isAdmin }: { playlist: DemoPlaylist; isAdmin: boolean }) {
  const router = useRouter()
  const [confirming, setConfirming] = useState(false)
  const [pending, startTransition] = useTransition()

  return (
    <Card className="transition-colors hover:border-foreground/30">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <Link href={`/demos/playlists/${playlist.slug}`} className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <ListVideo className="h-4 w-4 shrink-0 text-muted-foreground" />
              <h2 className="truncate font-semibold">{playlist.title}</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {playlist.demoCount} {playlist.demoCount === 1 ? "demo" : "demos"}
            </p>
          </Link>
          {isAdmin &&
            (confirming ? (
              <span className="flex shrink-0 items-center gap-1.5">
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      const result = await deletePlaylist(playlist.id)
                      if (result.success) router.refresh()
                      else setConfirming(false)
                    })
                  }
                >
                  {pending ? "Deleting…" : "Delete"}
                </Button>
                <Button size="sm" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>
                  Cancel
                </Button>
              </span>
            ) : (
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${playlist.title}`}
                onClick={() => setConfirming(true)}
                className="shrink-0 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            ))}
        </div>
      </CardHeader>
      {playlist.description && (
        <CardContent>
          <p className="text-sm text-muted-foreground">{playlist.description}</p>
        </CardContent>
      )}
    </Card>
  )
}

export function PlaylistIndex({ playlists, isAdmin }: { playlists: DemoPlaylist[]; isAdmin: boolean }) {
  return (
    <div>
      {isAdmin && (
        <div className="mb-4 flex justify-end">
          <CreatePlaylistDialog />
        </div>
      )}
      {playlists.length === 0 ? (
        <div className="rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          No playlists yet.
          {isAdmin && " Create one, then add demos to it from their Edit dialog."}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {playlists.map((p) => (
            <PlaylistRow key={p.id} playlist={p} isAdmin={isAdmin} />
          ))}
        </div>
      )}
    </div>
  )
}

export function PlaylistDetail({ playlist, demos }: { playlist: DemoPlaylist; demos: DemoListItem[] }) {
  return (
    <div>
      <Link
        href="/demos/playlists"
        className="text-sm text-muted-foreground underline-offset-2 hover:underline"
      >
        ← All playlists
      </Link>
      <h1 className="mt-2 text-2xl font-semibold tracking-tight">{playlist.title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {demos.length} {demos.length === 1 ? "demo" : "demos"}
      </p>
      {playlist.description && <p className="mt-2 max-w-prose text-sm">{playlist.description}</p>}

      {demos.length === 0 ? (
        <div className="mt-6 rounded-xl border border-dashed p-10 text-center text-sm text-muted-foreground">
          Nothing in this playlist yet.
        </div>
      ) : (
        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {demos.map((demo) => (
            <DemoCard key={demo.id} demo={demo} />
          ))}
        </div>
      )}
    </div>
  )
}
