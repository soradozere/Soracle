import { ImageResponse } from "next/og"
import { findPlayerForMeta, tierLabel, initialsOf } from "@/lib/profile-meta"

// Social-share thumbnail for /player/<name>, generated per player so a link
// dropped in Discord unfurls as a branded card: avatar (or initials monogram),
// name, slogan and tier. Mirrors the profile header's look.
export const alt = "Soracle player profile"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const BG = "#0b0c10"
const CYAN = "#66fcf1"
const TEXT = "#c5c6c7"
const DIM = "#8892a0"

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const player = await findPlayerForMeta(slug)

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          background: `radial-gradient(circle at 30% 20%, #12202b 0%, ${BG} 60%)`,
          padding: "72px",
          position: "relative",
        }}
      >
        {player ? (
          <div style={{ display: "flex", alignItems: "center", gap: "56px" }}>
            {/* Avatar or initials monogram */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 260,
                height: 260,
                borderRadius: 28,
                border: `4px solid ${CYAN}`,
                background: BG,
                overflow: "hidden",
                boxShadow: `0 0 60px rgba(102,252,241,0.25)`,
              }}
            >
              {player.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={player.avatarUrl} alt={player.name} width={260} height={260} style={{ objectFit: "cover" }} />
              ) : (
                <div style={{ display: "flex", fontSize: 140, fontWeight: 800, color: CYAN }}>
                  {initialsOf(player.name)}
                </div>
              )}
            </div>

            {/* Name / slogan / tier */}
            <div style={{ display: "flex", flexDirection: "column", maxWidth: 720 }}>
              <div style={{ display: "flex", fontSize: 92, fontWeight: 800, color: "#ffffff" }}>{player.name}</div>
              {player.slogan && (
                <div style={{ display: "flex", fontSize: 34, fontStyle: "italic", color: CYAN, marginTop: 12 }}>
                  “{player.slogan}”
                </div>
              )}
              <div style={{ display: "flex", marginTop: 28 }}>
                <div
                  style={{
                    display: "flex",
                    fontSize: 30,
                    fontWeight: 700,
                    color: BG,
                    background: CYAN,
                    padding: "10px 24px",
                    borderRadius: 10,
                  }}
                >
                  {tierLabel(player.tier)}
                </div>
              </div>
            </div>
          </div>
        ) : (
          <div style={{ display: "flex", fontSize: 72, fontWeight: 800, color: TEXT }}>Soracle player profile</div>
        )}

        {/* Brand wordmark */}
        <div
          style={{
            display: "flex",
            position: "absolute",
            bottom: 56,
            right: 72,
            fontSize: 30,
            fontWeight: 700,
            letterSpacing: 6,
            color: DIM,
          }}
        >
          SORACLE
        </div>
      </div>
    ),
    size,
  )
}
