import { ImageResponse } from "next/og"
import { getDemo } from "@/lib/demos-server"
import { demoTagLabel } from "@/lib/demo-tags"

// Social-share thumbnail for a demo, so a link dropped in Discord unfurls as
// something about *that* recording rather than the site in general. A frame
// grab would be ideal and is not available -- the picture only exists once the
// engine has run in a browser -- so this leads with the protagonist, who is
// the reason the clip is worth watching, and their avatar is already on file.
export const alt = "JK2 demo"
export const size = { width: 1200, height: 630 }
export const contentType = "image/png"

const BG = "#0b0c10"
const CYAN = "#66fcf1"
const TEXT = "#c5c6c7"
const DIM = "#8b98a5"

function initials(name: string): string {
  return name.replace(/[^a-zA-Z0-9]/g, "").slice(0, 2).toUpperCase() || "JK"
}

/**
 * Whether the OG renderer can actually draw this avatar.
 *
 * Satori rasterises a still frame and silently draws nothing for formats it
 * cannot decode -- animated GIFs above all, which is what half this community
 * uses as a profile picture (Giphy links). An empty box next to a name reads
 * as broken, so anything unrenderable falls back to an initials monogram.
 * Checked by content type rather than by extension, since plenty of these URLs
 * carry no extension at all.
 */
async function avatarIsDrawable(url: string | null): Promise<boolean> {
  if (!url) return false
  try {
    const res = await fetch(url, { method: "HEAD", signal: AbortSignal.timeout(2500) })
    const type = res.headers.get("content-type")?.toLowerCase() ?? ""
    return /^image\/(png|jpe?g|webp)/.test(type)
  } catch {
    return false
  }
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const demo = await getDemo(id).catch(() => null)

  const lead = demo?.protagonist ?? null
  const others = (demo?.players ?? []).filter((p) => p.id !== lead?.id).slice(0, 6)
  const showAvatar = await avatarIsDrawable(lead?.avatarUrl ?? null)

  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: `radial-gradient(circle at 25% 15%, #12202b 0%, ${BG} 62%)`,
          padding: "64px 72px",
        }}
      >
        {/* Eyebrow: what this is */}
        <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
          <div style={{ display: "flex", width: 10, height: 10, borderRadius: 10, background: CYAN }} />
          <div
            style={{
              display: "flex",
              fontSize: 24,
              letterSpacing: 4,
              textTransform: "uppercase",
              color: CYAN,
            }}
          >
            JK2 Capture the Flag · Demo
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 48 }}>
          {lead && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                width: 200,
                height: 200,
                borderRadius: 24,
                border: `4px solid ${CYAN}`,
                background: BG,
                overflow: "hidden",
                flexShrink: 0,
                boxShadow: "0 0 60px rgba(102,252,241,0.25)",
              }}
            >
              {showAvatar && lead.avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={lead.avatarUrl} alt="" width={200} height={200} style={{ objectFit: "cover" }} />
              ) : (
                <div style={{ display: "flex", fontSize: 96, fontWeight: 800, color: CYAN }}>
                  {initials(lead.name)}
                </div>
              )}
            </div>
          )}

          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 14,
              // Satori has no shrink-to-fit: without an explicit ceiling a long
              // title runs straight off the canvas instead of wrapping.
              maxWidth: lead ? 800 : 1050,
            }}
          >
            <div
              style={{
                display: "flex",
                fontSize: demo && demo.title.length > 40 ? 46 : 60,
                fontWeight: 800,
                color: "#ffffff",
                lineHeight: 1.1,
              }}
            >
              {demo?.title ?? "Demo not found"}
            </div>
            {lead && (
              <div style={{ display: "flex", fontSize: 34, color: CYAN }}>
                {lead.name}
                {others.length > 0 && (
                  <span style={{ color: DIM }}>{`  ·  with ${others.map((p) => p.name).join(", ")}`}</span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Footer: the facts a viewer would want before clicking */}
        <div style={{ display: "flex", alignItems: "center", gap: 20, fontSize: 28, color: TEXT }}>
          {demo?.gametype && (
            <div
              style={{
                display: "flex",
                padding: "6px 18px",
                borderRadius: 999,
                border: `2px solid ${CYAN}`,
                color: CYAN,
              }}
            >
              {demo.gametype}
            </div>
          )}
          {demo?.map && <div style={{ display: "flex", color: DIM }}>{demo.map}</div>}
          {(demo?.tags ?? []).slice(0, 3).map((t) => (
            <div key={t} style={{ display: "flex", color: DIM }}>
              {demoTagLabel(t)}
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  )
}
