"use client"

import { useState, useTransition } from "react"
import { Loader2 } from "lucide-react"
import { Switch } from "@/components/ui/switch"
import { setAutoCalibration } from "@/app/admin/calibration-actions"

// On/off switch for the seasonal tier auto-calibrator. The server page reads the
// current value and passes it in, so the control renders in the right state with
// no client fetch; from there the switch is optimistic and rolls back on error.
export function AutoCalibrationToggle({ initialEnabled }: { initialEnabled: boolean }) {
  const [enabled, setEnabled] = useState(initialEnabled)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const toggle = (next: boolean) => {
    setEnabled(next)
    setError(null)
    startTransition(async () => {
      const result = await setAutoCalibration(next)
      if (!result.success) {
        setEnabled(!next)
        setError(result.error)
      }
    })
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-3">
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" style={{ color: "var(--color-text-dim)" }} />
        ) : (
          <span
            className="font-mono text-xs font-semibold tracking-[0.14em] uppercase"
            style={{ color: enabled ? "var(--color-primary)" : "var(--color-text-dim)" }}
          >
            {enabled ? "On" : "Off"}
          </span>
        )}
        <Switch
          checked={enabled}
          onCheckedChange={toggle}
          disabled={pending}
          aria-label="Auto-calibration"
        />
      </div>
      {error && (
        <p className="text-xs" style={{ color: "var(--color-danger)" }}>
          Couldn&apos;t save: {error}
        </p>
      )}
    </div>
  )
}
