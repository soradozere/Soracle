import { ImageResponse } from "next/og"
import { ACHIEVEMENTS, RARITY_META, type Rarity } from "@/lib/achievement-meta"

export const runtime = "nodejs"

const ROMAN = ["I", "II", "III", "IV", "V", "VI"]

// Renders one achievement crest to a PNG, for the Discord embed thumbnails
// (unlock ping + =achievements). ?rank=N picks the tier (rarity + title). Satori
// can't do the site's CSS-mask hex crest, so this is a clean rarity-gradient
// card with the name + rank + rarity — recognisable, always in sync with meta.
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const rank = Math.max(1, parseInt(new URL(request.url).searchParams.get("rank") ?? "1", 10))

  const def = ACHIEVEMENTS.find((d) => d.id === id)
  let rarity: Rarity = "common"
  let title = def?.title ?? "Achievement"
  if (def?.ranks?.length) {
    const r = def.ranks[Math.min(rank, def.ranks.length) - 1]
    rarity = r.rarity
    title = r.title ?? (rank > 1 ? `${def.title} ${ROMAN[rank - 1] ?? rank}` : def.title)
  } else if (def) {
    rarity = def.rarity ?? "common"
  }

  const color = RARITY_META[rarity].color
  const label = RARITY_META[rarity].label
  const SIZE = 256

  return new ImageResponse(
    (
      <div
        style={{
          width: SIZE,
          height: SIZE,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0b0c10",
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            width: 208,
            height: 208,
            padding: 18,
            borderRadius: 28,
            border: `4px solid ${color}`,
            background: `linear-gradient(160deg, ${color}44 0%, #0f1620 60%, #0a0e14 100%)`,
          }}
        >
          <div style={{ fontSize: 15, fontWeight: 700, letterSpacing: 3, color, textTransform: "uppercase" }}>
            {label}
          </div>
          <div
            style={{
              fontSize: 27,
              fontWeight: 800,
              color: "#ffffff",
              textAlign: "center",
              marginTop: 10,
              lineHeight: 1.15,
            }}
          >
            {title}
          </div>
        </div>
      </div>
    ),
    { width: SIZE, height: SIZE },
  )
}
