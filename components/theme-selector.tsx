"use client"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { themes, type ThemeName } from "@/lib/themes"

interface ThemeSelectorProps {
  currentTheme: ThemeName
  onThemeChange: (theme: ThemeName) => void
}

// lucide's "paintbrush", inlined as a mask so the glyph can be painted in two
// parts: a neutral handle and a dipped bristle end (see below). An <svg> element
// can't do that without splitting the artwork into separate paths.
const BRUSH_MASK =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%23000' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='M18.37 2.63 14 7l-1.59-1.59a2 2 0 0 0-2.82 0L8 7l9 9 1.59-1.59a2 2 0 0 0 0-2.82L17 10l4.37-4.37a2.12 2.12 0 1 0-3-3Z'/%3E%3Cpath d='M9 8c-2 3-4 3.5-7 4l8 8c.5-3 1-5 4-7'/%3E%3Cpath d='M14.5 17.5 4.5 15'/%3E%3C/svg%3E\")"

export function ThemeSelector({ currentTheme, onThemeChange }: ThemeSelectorProps) {
  return (
    <DropdownMenu>
      {/* A rainbow brush reads as a toy, and a fixed spectrum says nothing about
          which theme is on. So the handle stays the same neutral as every other
          icon in the masthead cluster and only the bristles are dipped -- in the
          ACTIVE theme's own accents, which means the icon shifts with the palette
          it controls. The border carries one faint iridescent sweep across the
          top-left shoulder, the way light catches a glass edge. */}
      <DropdownMenuTrigger
        className="w-9 h-9 rounded-[11px] grid place-items-center transition-all hint-left hint-below"
        data-hint="Theme — the bristles are dipped in whichever palette is active"
        style={{
          border: "1px solid transparent",
          background: `
            linear-gradient(180deg,
              color-mix(in srgb, var(--color-surface-elevated) 75%, transparent),
              color-mix(in srgb, var(--color-surface) 55%, transparent)) padding-box,
            linear-gradient(145deg,
              color-mix(in srgb, var(--color-primary) 55%, transparent),
              color-mix(in srgb, var(--color-accent-purple) 30%, transparent) 38%,
              var(--glass-hair) 68%) border-box`,
          boxShadow:
            "inset 0 1px 0 var(--glass-spec), 0 0 14px -8px color-mix(in srgb, var(--color-primary) 70%, transparent)",
        }}
        aria-label="Change theme"
      >
        <span className="relative block w-[18px] h-[18px]">
          <span
            className="absolute inset-0"
            style={{
              WebkitMask: `${BRUSH_MASK} center / contain no-repeat`,
              mask: `${BRUSH_MASK} center / contain no-repeat`,
              backgroundColor: "var(--color-text)",
              opacity: 0.9,
            }}
          />
          <span
            className="absolute inset-0"
            style={{
              WebkitMask: `${BRUSH_MASK} center / contain no-repeat`,
              mask: `${BRUSH_MASK} center / contain no-repeat`,
              // Two accents and a muted third: enough iridescence to read as
              // "colour", short of a spectrum.
              background:
                "linear-gradient(135deg, var(--color-primary), var(--color-accent-purple) 58%, color-mix(in srgb, var(--color-accent-yellow) 65%, var(--color-text)))",
              // Clipped to the bristle end of the glyph, which sits lower-left.
              clipPath: "polygon(0 30%, 72% 100%, 0 100%)",
              filter:
                "saturate(0.88) drop-shadow(0 0 4px color-mix(in srgb, var(--color-primary) 40%, transparent))",
            }}
          />
        </span>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="end"
        className="w-48"
        style={{
          backgroundColor: "color-mix(in srgb, var(--color-surface) 96%, transparent)",
          borderColor: "var(--glass-hair)",
          backdropFilter: "blur(24px) saturate(160%)",
        }}
      >
        <DropdownMenuRadioGroup value={currentTheme} onValueChange={(value) => onThemeChange(value as ThemeName)}>
          {Object.values(themes).map((theme) => (
            <DropdownMenuRadioItem
              key={theme.name}
              value={theme.name}
              className="cursor-pointer gap-2.5"
              style={{ color: "var(--color-text)" }}
            >
              {/* The swatch is the theme's identity colour, so the list reads at a
                  glance without needing the names. */}
              <span
                className="w-[13px] h-[13px] rounded-full shrink-0"
                style={{ backgroundColor: theme.colors.primary, border: "1px solid rgba(255,255,255,0.3)" }}
              />
              {theme.displayName}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
