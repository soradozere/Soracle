"use client"

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"

interface MatchStatsCsvModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function MatchStatsCsvModal({ open, onOpenChange }: MatchStatsCsvModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-[var(--color-surface)]/95 backdrop-blur-md border-[#66fcf1]/30 text-white max-w-md">
        <DialogHeader>
          <DialogTitle className="text-xl" style={{ color: "var(--color-primary)" }}>
            Upload Match Stats CSV
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2">
          <input
            type="file"
            accept=".csv"
            className="block w-full text-sm text-[#c5c6c7] file:mr-3 file:cursor-pointer file:rounded-md file:border file:border-[#66fcf1]/40 file:bg-transparent file:px-3 file:py-1.5 file:text-sm file:text-[#66fcf1] hover:file:bg-[#66fcf1]/10"
          />
          <p className="text-xs text-[#8892a0]">
            CSV parsing and player mapping will arrive in Phase 3. For now, this is a placeholder.
          </p>
        </div>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            className="border-[var(--color-border)] bg-transparent text-white hover:bg-[var(--color-border)]"
          >
            Cancel
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
