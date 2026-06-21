export type ThemeName = "jedi" | "sith" | "bespin" | "cloud-city" | "yavin" | "nar-shaddaa"

export interface Theme {
  name: ThemeName
  displayName: string
  colors: {
    background: string
    surface: string
    surfaceElevated: string
    border: string
    borderHover: string
    primary: string
    primaryDim: string
    primaryGlow: string
    accentRed: string
    accentBlue: string
    accentGreen: string
    accentYellow: string
    accentPurple: string
    accentTeal: string
    text: string
    textBright: string
    textDim: string
  }
}

export const themes: Record<ThemeName, Theme> = {
  jedi: {
    name: "jedi",
    displayName: "Jedi",
    colors: {
      background: "#0b0c10",
      surface: "#1f2833",
      surfaceElevated: "#2a3441",
      border: "#3d4855",
      borderHover: "#45a29e",
      primary: "#00fff2",
      primaryDim: "#00d4c9",
      primaryGlow: "#00fff280",
      accentRed: "#ff4757",
      accentBlue: "#62d6e8",
      accentGreen: "#27ae60",
      accentYellow: "#f39c12",
      accentPurple: "#9b59b6",
      accentTeal: "#45a29e",
      text: "#c5c6c7",
      textBright: "#ffffff",
      textDim: "#8892a0",
    },
  },
  sith: {
    name: "sith",
    displayName: "Sith",
    colors: {
      background: "#0f0000",
      surface: "#1f0000",
      surfaceElevated: "#2f0505",
      border: "#5a0a0a",
      borderHover: "#9a0000",
      primary: "#ff0033",
      primaryDim: "#dd0022",
      primaryGlow: "#ff003380",
      accentRed: "#ff3355",
      accentBlue: "#ff6677",
      accentGreen: "#ff4444",
      accentYellow: "#ff5566",
      accentPurple: "#ee0044",
      accentTeal: "#cc0000",
      text: "#e4d4d4",
      textBright: "#ffffff",
      textDim: "#999999",
    },
  },
  bespin: {
    name: "bespin",
    displayName: "Bespin Nights",
    // Cloud City at night: a dark, warm theme with the amber-orange identity
    // glowing on a deep warm base.
    colors: {
      background: "#15110d",
      surface: "#211a13",
      surfaceElevated: "#2e2419",
      border: "#473829",
      borderHover: "#c2814f",
      primary: "#f0a44e",
      primaryDim: "#d4883a",
      primaryGlow: "#f0a44e80",
      accentRed: "#f06a4a",
      accentBlue: "#6fb1d6",
      accentGreen: "#9bbf6b",
      accentYellow: "#f5c542",
      accentPurple: "#c794b8",
      accentTeal: "#6fbfae",
      text: "#ece1d2",
      textBright: "#fff8ee",
      textDim: "#ad9c87",
    },
  },
  "cloud-city": {
    name: "cloud-city",
    displayName: "Cloud City",
    // The app's light theme: bright, warm Cloud City daylight with burnt-orange
    // accents. Paired with theme-aware base styles + a scoped override layer in
    // globals.css so the dark-first hardcoded colors read correctly on light.
    colors: {
      background: "#e7ddcc",
      surface: "#f3ede1",
      surfaceElevated: "#fbf6ec",
      border: "#cabda6",
      borderHover: "#b86b49",
      primary: "#bf5e2e",
      primaryDim: "#9f4c22",
      primaryGlow: "#bf5e2e40",
      accentRed: "#c0492b",
      accentBlue: "#3a7ca5",
      accentGreen: "#5f7d3a",
      accentYellow: "#b3791a",
      accentPurple: "#8a5a7a",
      accentTeal: "#3f8a7d",
      text: "#2e2a24",
      textBright: "#15110d",
      textDim: "#6a6155",
    },
  },
  yavin: {
    name: "yavin",
    displayName: "Yavin",
    colors: {
      background: "#0a0f05",
      surface: "#141f0a",
      surfaceElevated: "#1f2d14",
      border: "#3a5020",
      borderHover: "#6a8b35",
      primary: "#a8ff3a",
      primaryDim: "#88dd2a",
      primaryGlow: "#a8ff3a80",
      accentRed: "#d85a44",
      accentBlue: "#6baecf",
      accentGreen: "#9be34a",
      accentYellow: "#e4b76a",
      accentPurple: "#ab8dc5",
      accentTeal: "#7dbb8c",
      text: "#d5e4c5",
      textBright: "#ffffff",
      textDim: "#9aaa8a",
    },
  },
  "nar-shaddaa": {
    name: "nar-shaddaa",
    displayName: "Nar Shaddaa",
    colors: {
      background: "#0a0515",
      surface: "#150a20",
      surfaceElevated: "#251a35",
      border: "#3d2d5f",
      borderHover: "#7a4fb5",
      primary: "#d946ef",
      primaryDim: "#c026d3",
      primaryGlow: "#d946ef80",
      accentRed: "#ff6bb9",
      accentBlue: "#8b5cf6",
      accentGreen: "#00ffbb",
      accentYellow: "#ffe93d",
      accentPurple: "#d77dff",
      accentTeal: "#7dd3c0",
      text: "#e8d5eb",
      textBright: "#ffffff",
      textDim: "#a89ab3",
    },
  },
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement

  // Lets globals.css scope light-theme-only fixes for the dark-first hardcoded
  // colors (e.g. html[data-theme="cloud-city"] …).
  root.dataset.theme = theme.name

  root.style.setProperty("--color-background", theme.colors.background)
  root.style.setProperty("--color-surface", theme.colors.surface)
  root.style.setProperty("--color-surface-elevated", theme.colors.surfaceElevated)
  root.style.setProperty("--color-border", theme.colors.border)
  root.style.setProperty("--color-border-hover", theme.colors.borderHover)
  root.style.setProperty("--color-primary", theme.colors.primary)
  root.style.setProperty("--color-primary-dim", theme.colors.primaryDim)
  root.style.setProperty("--color-primary-glow", theme.colors.primaryGlow)
  root.style.setProperty("--color-accent-red", theme.colors.accentRed)
  root.style.setProperty("--color-accent-blue", theme.colors.accentBlue)
  root.style.setProperty("--color-accent-green", theme.colors.accentGreen)
  root.style.setProperty("--color-accent-yellow", theme.colors.accentYellow)
  root.style.setProperty("--color-accent-purple", theme.colors.accentPurple)
  root.style.setProperty("--color-accent-teal", theme.colors.accentTeal)
  root.style.setProperty("--color-text", theme.colors.text)
  root.style.setProperty("--color-text-bright", theme.colors.textBright)
  root.style.setProperty("--color-text-dim", theme.colors.textDim)

  // Update body background
  document.body.style.backgroundColor = theme.colors.background
}
