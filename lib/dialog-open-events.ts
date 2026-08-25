/**
 * Tracks how many dialogs (components/ui/dialog.tsx) are open right now, and
 * fires a DOM event on every change.
 *
 * Exists for background-particles.tsx. That canvas repaints every frame, and
 * a dialog's translucent, `backdrop-filter`-blurred surface has to re-sample
 * whatever is painted behind it on every frame IT is visible too -- including
 * through its own entrance animation, which is a `transform`. The file's own
 * comment on `will-change` already names this exact family of glitch for a
 * milder trigger (hovering anything that transforms nearby re-rasterizes the
 * canvas and bleeds through translucent cards); a dialog animating open over
 * a continuously repainting canvas is the same race with higher stakes --
 * caught live as a dialog occasionally rendering with no visible background
 * at all. Pausing the canvas removes the moving target for as long as a
 * dialog might be sampling it.
 *
 * A counter rather than a boolean: Radix dialogs can nest (a confirm dialog
 * opened from within another), and the count must not reach zero until the
 * outermost one closes too.
 *
 * An event rather than a prop or context, for the reason render-queue-events.ts
 * gives for the same shape of problem: the two live in unrelated trees (every
 * page's dialogs, and the one background canvas mounted near the root), and
 * lifting shared state above both would be the heavier answer.
 */

export const DIALOG_OPEN_CHANGED = "soracle:dialog-open-changed"

let openCount = 0

function announce() {
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(DIALOG_OPEN_CHANGED, { detail: openCount }))
}

export function markDialogOpen() {
  openCount++
  announce()
}

export function markDialogClosed() {
  openCount = Math.max(0, openCount - 1)
  announce()
}

export function isAnyDialogOpen(): boolean {
  return openCount > 0
}
