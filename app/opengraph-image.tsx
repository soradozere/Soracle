import { ImageResponse } from "next/og"
import { readFile } from "node:fs/promises"
import { join } from "node:path"

// Social-share thumbnail for the site root, so a plain link to Soracle unfurls
// as a branded card in Discord etc. Mirrors the app masthead: glowing JK2 logo,
// the Orbitron title, and the tagline. Per-player links use the card generated
// by app/player/[slug]/opengraph-image.tsx instead.
export const alt = "JK2 Capture the Flag — 6v6 CTF for Jedi Knight 2: Jedi Outcast"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const BG = "#0b0c10"
const CYAN = "#66fcf1"
const DIM = "#8892a0"
const TITLE = "JK2 CAPTURE THE FLAG"

// Orbitron (the masthead font) isn't a system font, so fetch its TTF from Google
// for the title. Falls back to the default bold sans if the fetch fails, so the
// card always renders.
async function loadOrbitron(text: string): Promise<ArrayBuffer | null> {
  try {
    const url = `https://fonts.googleapis.com/css2?family=Orbitron:wght@700&text=${encodeURIComponent(text)}`
    const css = await (await fetch(url)).text()
    const src = css.match(/src: url\((.+?)\) format\('(?:opentype|truetype)'\)/)
    if (!src) return null
    return await (await fetch(src[1])).arrayBuffer()
  } catch {
    return null
  }
}

export default async function Image() {
  const [logoBuf, orbitron] = await Promise.all([
    readFile(join(process.cwd(), "public/logo.png")).catch(() => null),
    loadOrbitron(TITLE),
  ])
  const logoSrc = logoBuf ? `data:image/png;base64,${logoBuf.toString("base64")}` : null

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "48px",
          background: `radial-gradient(circle at 30% 20%, #12202b 0%, ${BG} 60%)`,
          padding: "72px",
          position: "relative",
        }}
      >
        {logoSrc && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoSrc}
            alt="JK2 logo"
            width={200}
            height={200}
            style={{ filter: "drop-shadow(0 0 40px rgba(102,252,241,0.5))" }}
          />
        )}

        <div style={{ display: "flex", flexDirection: "column", maxWidth: 760 }}>
          <div
            style={{
              display: "flex",
              fontSize: 88,
              lineHeight: 1.05,
              fontWeight: 700,
              color: "#ffffff",
              letterSpacing: 2,
              ...(orbitron ? { fontFamily: "Orbitron" } : {}),
              textShadow: `0 0 30px rgba(102,252,241,0.55)`,
            }}
          >
            {TITLE}
          </div>
          <div style={{ display: "flex", fontSize: 30, color: DIM, marginTop: 28 }}>
            Jedi Knight 2: Jedi Outcast • 6v6 Competitive
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      ...(orbitron ? { fonts: [{ name: "Orbitron", data: orbitron, weight: 700 as const, style: "normal" as const }] } : {}),
    },
  )
}
