/**
 * Shared constants for the render queue.
 *
 * Here rather than in app/admin/renders/actions.ts because that file is
 * "use server", and Next only allows async functions to be exported from one --
 * a plain `export const` there fails the build while passing tsc, since it is a
 * framework rule rather than a type error.
 */

/**
 * YouTube's daily upload allowance, expressed in videos rather than quota units.
 *
 * The API grants 10,000 units a day and an upload costs about 1,600, so six is
 * roughly what fits. Counted locally rather than discovered from a 403, because
 * a failed upload still spends the quota -- the seventh attempt would burn the
 * allowance and publish nothing.
 */
export const DAILY_PUBLISH_CAP = 6
