/**
 * Fired when an admin flips the auto-calibration switch, so the Rank
 * Suggestions panel can recompute.
 *
 * The panel's answer depends on the switch in two ways at once: while
 * auto-calibration is on it previews the engine over the engine's own window
 * (matches since the switch was last enabled), and while it is off it reads
 * recent history and says so. A toggle therefore invalidates both the numbers
 * and the label, and enabling in particular resets the window to this instant,
 * so the honest live answer straight afterwards is "nothing yet".
 *
 * An event rather than revalidatePath for the reason render-queue-events.ts
 * gives: `router.refresh()` only re-runs server components, and the panel is a
 * mounted client one holding its result in state. Without this it kept
 * rendering the pre-toggle answer under a switch that had already moved.
 */
export const AUTO_CALIBRATION_CHANGED = "soracle:auto-calibration-changed"

export function announceAutoCalibrationChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(AUTO_CALIBRATION_CHANGED))
}
