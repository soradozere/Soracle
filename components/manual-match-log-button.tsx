"use client"

import { useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { createPendingFromUpload } from "@/app/admin/actions"
import { Button } from "@/components/ui/button"
import { useToast } from "@/hooks/use-toast"
import { Loader2, Plus } from "lucide-react"

// Admin button on Match History: pick a scoreboard CSV, and go straight to the
// full review screen for it.
//
// This used to open the CSV modal and log the match on confirm. Now the upload
// is parked in pending_matches first and the admin is sent to
// /admin/review/[id] — the same screen the bot's uploads land on. One review
// path for every source, and an interrupted review survives a refresh instead
// of losing the parse.
export function ManualMatchLogButton({ onLogged }: { onLogged?: () => void }) {
  const router = useRouter()
  const inputRef = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState(false)
  const { toast } = useToast()

  async function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    // Clear immediately so picking the same file again still fires a change.
    event.target.value = ""
    if (!file) return

    setBusy(true)
    const formData = new FormData()
    formData.append("file", file)
    const result = await createPendingFromUpload(formData)
    setBusy(false)

    if (result.success && result.pendingId) {
      router.push(`/admin/review/${result.pendingId}`)
    } else {
      toast({
        title: "Couldn't open that scoreboard",
        description: result.error,
        variant: "destructive",
      })
    }
  }

  return (
    <>
      <Button
        type="button"
        size="sm"
        disabled={busy}
        onClick={() => inputRef.current?.click()}
        className="h-8 bg-[#66fcf1] px-3 text-xs font-medium text-black hover:bg-[#66fcf1]/80"
      >
        {busy ? (
          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
        ) : (
          <Plus className="mr-1 h-3 w-3" />
        )}
        Log a Match
      </Button>
      <input
        ref={inputRef}
        type="file"
        accept=".csv"
        onChange={handleFileChange}
        className="hidden"
      />
    </>
  )
}
