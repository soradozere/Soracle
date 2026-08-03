/**
 * Mask slurs in player-written text.
 *
 * Deliberately narrow: this is not a profanity filter. JK2 CTF is a game where
 * people swear at each other cheerfully and a comment reading "insane fucking
 * dbs" is a compliment, so ordinary swearing is left alone. What gets masked is
 * the small set of words used to attack people for what they are -- racial and
 * homophobic slurs -- which nobody needs to read under a demo.
 *
 * Applied when a comment is stored, so what is in the database is already
 * clean and no client can opt out of it.
 */

/**
 * Slur stems, matched with the usual letter-for-symbol substitutions applied.
 * Stems rather than whole words so plurals and -ed/-ing forms are caught.
 *
 * Kept as split character arrays rather than plain literals so the file can be
 * read, reviewed and grepped without a wall of slurs in it.
 */
const SLUR_STEMS: string[] = [
  ["n", "i", "g", "g", "e", "r"].join(""),
  ["n", "i", "g", "g", "a"].join(""),
  ["f", "a", "g", "g", "o", "t"].join(""),
  ["t", "r", "a", "n", "n", "y"].join(""),
  ["k", "i", "k", "e"].join(""),
  ["s", "p", "i", "c", "k"].join(""),
  ["c", "h", "i", "n", "k"].join(""),
  ["g", "o", "o", "k"].join(""),
  ["w", "e", "t", "b", "a", "c", "k"].join(""),
  ["c", "o", "o", "n"].join(""),
  ["p", "a", "k", "i"].join(""),
  ["r", "e", "t", "a", "r", "d"].join(""),
  ["t", "r", "a", "n", "s", "s", "e", "x", "u", "a", "l"].join(""),
]

// The substitutions people reach for first. Anything cleverer than this gets
// through, which is accepted: the goal is to stop the casual case, not to win
// an arms race with someone determined to be vile in public under their name.
const LEET: Record<string, string> = {
  "0": "o",
  "1": "i",
  "!": "i",
  "|": "i",
  "3": "e",
  "4": "a",
  "@": "a",
  "5": "s",
  "$": "s",
  "7": "t",
  "+": "t",
}

/**
 * Fold a word to its comparison form: lowercase, leet undone, and runs of a
 * repeated letter collapsed, so "n1ggggg3r" reduces the same way "nigger" does.
 */
function fold(word: string): string {
  const mapped = word
    .toLowerCase()
    .split("")
    .map((c) => LEET[c] ?? c)
    .filter((c) => /[a-z]/.test(c))
    .join("")
  return mapped.replace(/(.)\1+/g, "$1")
}

// Stems folded once at module load, so matching is a set comparison per word.
const FOLDED_STEMS = SLUR_STEMS.map(fold)

function isSlur(word: string): boolean {
  const folded = fold(word)
  if (!folded) return false
  return FOLDED_STEMS.some((stem) => folded.includes(stem))
}

/**
 * Replace any slur with asterisks, leaving everything else untouched.
 *
 * Splits on whitespace only, so punctuation stays attached to its word and a
 * masked word keeps the shape of the sentence around it.
 */
export function maskSlurs(text: string): string {
  return text
    .split(/(\s+)/)
    .map((chunk) => {
      if (!chunk.trim()) return chunk
      // Keep leading/trailing punctuation, mask only the word itself.
      const m = /^([^\p{L}\p{N}]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(chunk)
      if (!m) return chunk
      const [, before, word, after] = m
      if (!word || !isSlur(word)) return chunk
      return before + "*".repeat(word.length) + after
    })
    .join("")
}
