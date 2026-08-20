/**
 * Fired when an admin changes the render queue, so the masthead's notification
 * count can catch up.
 *
 * The count is fetched once when the account menu mounts, deliberately -- it is
 * a nudge rather than a live dashboard, and the August usage audit is a
 * standing reason not to put a background request on every open tab. But
 * `router.refresh()` only re-runs server components, and the account menu is a
 * client one holding the count in state, so without this the badge kept
 * claiming work was waiting immediately after it had been dealt with.
 *
 * An event rather than shared state because the two live in unrelated trees
 * (the queue page and the site masthead) and lifting a store above both to
 * carry one integer would be the heavier answer.
 */
export const RENDER_QUEUE_CHANGED = "soracle:render-queue-changed"

export function announceRenderQueueChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(RENDER_QUEUE_CHANGED))
}
