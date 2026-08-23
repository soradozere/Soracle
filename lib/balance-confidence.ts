/**
 * Turning a balance SCORE into the confidence figure people actually read.
 *
 * Two different numbers wear the name "balance confidence" and keeping them
 * straight matters:
 *
 *  * The SCORE is what the balancer's evaluator produces — a sum of penalties,
 *    so LOWER IS BETTER and it is unbounded above (real lobbies have reached
 *    seven figures). This is what `matches.balance_confidence` stores.
 *  * The PERCENTAGE is the display form: 100% at a flawless split, decaying
 *    toward a 30% floor as penalties pile up. Nobody is shown the raw score
 *    except as a parenthetical, so this is the number the community means when
 *    they say a balance was "86%".
 *
 * The conversion lived twice, copy-pasted between the balancer's option cards
 * and the admin match log, which is exactly how two screens start quoting
 * different confidences for one split. One copy now.
 *
 * The 30% floor is deliberate: a hopeless lobby still gets played, and showing
 * 0% reads as "this is broken" rather than "this is the best of a bad set".
 */

/** Decay rate. Score ~175 lands near 65%; 500+ is effectively at the floor. */
const DECAY = 0.004
/** Even the worst split reads 30%, never 0% — see the note above. */
const FLOOR_PCT = 30

/** Display percentage (0-100, rounded) for a raw evaluator score. */
export function balanceConfidencePct(score: number): number {
  return Math.round(FLOOR_PCT + (100 - FLOOR_PCT) * Math.exp(-DECAY * score))
}

/** Tailwind classes for a confidence percentage — green / amber / red. */
export function confidenceColor(confidencePct: number): { bg: string; text: string } {
  if (confidencePct >= 80) return { bg: "bg-[#27ae60]/20", text: "text-[#27ae60]" }
  if (confidencePct >= 60) return { bg: "bg-[#f39c12]/20", text: "text-[#f39c12]" }
  return { bg: "bg-[#ff4757]/20", text: "text-[#ff4757]" }
}
