"use client"

import { useEffect, useMemo, useState } from "react"

// The CTF 101 hero, decoding itself into AurekBesh and back on a timer.
//
// Structure follows the masthead (MastheadTitle in site-header.tsx): two full
// layers stacked in one grid cell, each laid out naturally in its own font.
// The masthead then crossfades them; this rotates instead, per letter and
// staggered, so the line turns over left to right rather than dissolving.
//
// Two layers rather than one card per letter, and that is not a style choice.
// AurekBesh advance widths are near-uniform (~56-65px at this size) while
// Orbitron's vary wildly — "j" is 14px, "a" is 42px. Sharing a box means one
// font's metrics win and the other overflows: Latin-sized boxes turn the
// decoded headline into a pile-up (a 14px box holding a 56px glyph), and
// Aurek-sized boxes pad visible gaps between every Latin letter at rest, which
// is the state people actually look at. No single scale factor fixes it —
// even at 0.3, "j" still overflows. Independent layers let each font set its
// own metrics and never fight.
//
// Nothing fades. A letter leaves by rotating edge-on, which is geometry, not
// opacity — and mid-flip both layers are near-edge-on, so the fact that the
// two fonts don't align letter-for-letter never shows.
//
// Styles are inline rather than classes in globals.css on purpose. Tailwind
// prunes `@layer components` rules it can't match against scanned source, and
// a brand-new component's classes are exactly the case it drops — an earlier
// build of this shipped a headline with every letter doubled, because the DOM
// was there and the CSS wasn't. Inline styles can't be pruned.
//
// Only letters turn. AurekBesh is a Latin-substitution font with no glyphs for
// punctuation, so a flipping full stop would land on an identical full stop.

const STAGGER_MS = 26
const HOLD_MS = 1600 // fully decoded before turning back
const CYCLE_MS = 12000 // start of one decode to the start of the next
const TURN_MS = 420

// AurekBesh is set smaller than the Latin, as it is in the masthead (17px
// Orbitron to 11px AurekBesh). Lower here than the masthead's ratio because
// its glyphs are much wider per character: at anything above ~0.5 the decoded
// line outgrows the container and wraps.
const AUREK_SCALE = 0.46

interface Char {
  char: string
  /** Position in the sweep, or null for punctuation that doesn't turn. */
  i: number | null
}

export function DecodingTitle({ lines, className }: { lines: string[]; className?: string }) {
  const [decoded, setDecoded] = useState(false)
  const [enabled, setEnabled] = useState(false)

  // Grouped into words so the browser only ever breaks at spaces. Without this
  // every letter is its own inline-block and the headline wraps mid-word
  // ("Twelve playe / rs.").
  const { rows, letterCount } = useMemo(() => {
    let i = 0
    const rows = lines.map((line) =>
      line.split(" ").map((word) => [...word].map<Char>((char) => ({ char, i: /[a-z]/i.test(char) ? i++ : null }))),
    )
    return { rows, letterCount: i }
  }, [lines])

  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    setEnabled(true)

    let backTimer: ReturnType<typeof setTimeout>
    const cycle = setInterval(() => {
      // Skipped on a hidden tab: the effect is decorative, and nobody needs a
      // timer repainting a background tab every twelve seconds.
      if (document.hidden) return
      setDecoded(true)
      backTimer = setTimeout(() => setDecoded(false), HOLD_MS)
    }, CYCLE_MS)

    return () => {
      clearInterval(cycle)
      clearTimeout(backTimer)
    }
  }, [])

  // Reduced motion, and the server render: the plain headline, no per-letter
  // machinery in the DOM at all.
  if (!enabled) {
    return (
      <h1 className={className}>
        {lines.map((line, i) => (
          <span key={i}>
            {line}
            {i < lines.length - 1 && <br />}
          </span>
        ))}
      </h1>
    )
  }

  return (
    <h1 className={className} aria-label={lines.join(" ")} style={{ display: "grid", justifyItems: "center" }}>
      <Layer rows={rows} total={letterCount} decoded={decoded} face="latin" />
      <Layer rows={rows} total={letterCount} decoded={decoded} face="aurek" />
    </h1>
  )
}

function Layer({
  rows,
  total,
  decoded,
  face,
}: {
  rows: Char[][][]
  total: number
  decoded: boolean
  face: "latin" | "aurek"
}) {
  const aurek = face === "aurek"

  // One continuous turn: the Latin tips away from the reader while the
  // AurekBesh arrives from behind, so the pair reads as one cylinder rolling
  // over rather than two separate animations.
  const angle = aurek ? (decoded ? 0 : 90) : decoded ? -90 : 0

  return (
    <span
      aria-hidden
      style={{
        gridColumn: 1,
        gridRow: 1,
        alignSelf: "center",
        ...(aurek ? { fontFamily: "var(--font-aurek-besh)", fontSize: `${AUREK_SCALE}em` } : null),
      }}
    >
      {rows.map((words, ri) => (
        <span key={ri}>
          {words.map((word, wi) => (
            <span key={wi}>
              <span style={{ display: "inline-block", whiteSpace: "nowrap" }}>
                {word.map((c, ci) =>
                  c.i === null ? (
                    <span key={ci} style={{ display: "inline-block", transform: `rotateX(${angle}deg)` }}>
                      {c.char}
                    </span>
                  ) : (
                    <span key={ci} style={{ display: "inline-block", perspective: "700px" }}>
                      <span
                        style={{
                          display: "inline-block",
                          transition: `transform ${TURN_MS}ms var(--glass-ease)`,
                          // Out on the way in, back in reverse on the way out,
                          // so the sweep always travels rather than snapping
                          // back all at once.
                          transitionDelay: `${(decoded ? c.i : total - 1 - c.i) * STAGGER_MS}ms`,
                          transform: `rotateX(${angle}deg)`,
                        }}
                      >
                        {c.char}
                      </span>
                    </span>
                  ),
                )}
              </span>
              {wi < words.length - 1 && " "}
            </span>
          ))}
          {ri < rows.length - 1 && <br />}
        </span>
      ))}
    </span>
  )
}
