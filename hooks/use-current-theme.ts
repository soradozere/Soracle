"use client"

import { useEffect, useState } from "react"
import { themes, type ThemeName } from "@/lib/themes"

// The active theme, read from <html data-theme="…"> (set by applyTheme) and kept
// in sync via a MutationObserver. Lets pages react to theme changes without
// owning theme state — the SiteHeader's ThemeSelector is the single writer.
export function useCurrentTheme(): ThemeName {
  const [theme, setTheme] = useState<ThemeName>("jedi")

  useEffect(() => {
    const root = document.documentElement
    const read = () => {
      const name = root.dataset.theme as ThemeName | undefined
      setTheme(name && themes[name] ? name : "jedi")
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] })
    return () => observer.disconnect()
  }, [])

  return theme
}
