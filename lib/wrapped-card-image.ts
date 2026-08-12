import type { ShareCardData } from "@/lib/wrapped-card-data"

/*
 * Draw the Wrapped card to a PNG.
 *
 * Everything here is drawn by hand rather than captured from the DOM. Screenshot
 * libraries re-implement a subset of CSS and quietly drop what they do not
 * support -- this card leans on color-mix, layered gradients and a masked SVG
 * watermark, all of which would come out wrong -- and printing gave us browser
 * headers, paper margins and three pages. Drawing is more code but the output
 * is exact and the same everywhere.
 *
 * Rendered at 2x and downscaled by the browser when displayed, so the file is
 * sharp when someone opens it full size in Discord.
 */

const W = 920
const H = 1288
const PAD = 52

/** Medal art and colour per placing, matching RankMedal on the boards. */
const MEDALS = [
  { src: "/badges/champion.svg", colour: "#ffd700" },
  { src: "/badges/star.svg", colour: "#c9ced6" },
  { src: "/badges/top5.svg", colour: "#cd7f32" },
]

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

function loadImage(src: string, crossOrigin?: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    const img = new Image()
    if (crossOrigin) img.crossOrigin = crossOrigin
    img.onload = () => resolve(img)
    // Never reject: a dead avatar or a host that refuses CORS must degrade to
    // the monogram, not take the whole export down with it.
    img.onerror = () => resolve(null)
    img.src = src
  })
}

/** Draw an SVG tinted to one colour, which canvas cannot do directly. */
function drawTinted(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  colour: string,
  x: number,
  y: number,
  w: number,
  h: number,
  alpha = 1,
) {
  const off = document.createElement("canvas")
  off.width = Math.ceil(w)
  off.height = Math.ceil(h)
  const octx = off.getContext("2d")
  if (!octx) return
  octx.drawImage(img, 0, 0, w, h)
  octx.globalCompositeOperation = "source-in"
  octx.fillStyle = colour
  octx.fillRect(0, 0, w, h)
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.drawImage(off, x, y)
  ctx.restore()
}

function text(
  ctx: CanvasRenderingContext2D,
  s: string,
  x: number,
  y: number,
  font: string,
  colour: string,
  align: CanvasTextAlign = "left",
  letterSpacing?: string,
) {
  ctx.save()
  ctx.font = font
  ctx.fillStyle = colour
  ctx.textAlign = align
  ctx.textBaseline = "alphabetic"
  if (letterSpacing && "letterSpacing" in ctx) {
    ;(ctx as CanvasRenderingContext2D & { letterSpacing: string }).letterSpacing = letterSpacing
  }
  ctx.fillText(s, x, y)
  ctx.restore()
}

export interface CardImageOptions {
  /** Resolved font families — passed in because next/font mangles the names. */
  displayFont: string
  bodyFont: string
  /** Accent for the non-medal case. */
  primary: string
  /** Oldest-first outcomes, for the form line. */
  results: ("W" | "L" | "D")[]
  /** Rarest thing they unlocked that month, shown under the month line. */
  title: string | null
}

export async function renderWrappedCard(d: ShareCardData, o: CardImageOptions): Promise<Blob | null> {
  const canvas = document.createElement("canvas")
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext("2d")
  if (!ctx) return null

  const edge = d.medal?.edge ?? o.primary
  const core = d.medal?.core ?? "#ffffff"
  const dim = "#8b96a5"

  // Body
  const bg = ctx.createLinearGradient(0, 0, W * 0.4, H)
  bg.addColorStop(0, "#141a22")
  bg.addColorStop(0.55, "#0d1117")
  bg.addColorStop(1, "#10161d")
  roundRect(ctx, 0, 0, W, H, 36)
  ctx.fillStyle = bg
  ctx.fill()
  ctx.save()
  ctx.clip()

  // Foil sweep
  const foil = ctx.createLinearGradient(0, H, W, 0)
  foil.addColorStop(0.22, "rgba(0,0,0,0)")
  foil.addColorStop(0.38, `${edge}26`)
  foil.addColorStop(0.47, `${core}2b`)
  foil.addColorStop(0.56, `${edge}26`)
  foil.addColorStop(0.72, "rgba(0,0,0,0)")
  ctx.fillStyle = foil
  ctx.fillRect(0, 0, W, H)

  const [star, avatar, medalImg] = await Promise.all([
    loadImage("/badges/star.svg"),
    d.avatarUrl ? loadImage(d.avatarUrl, "anonymous") : Promise.resolve(null),
    d.place !== null && d.place <= 3 ? loadImage(MEDALS[d.place - 1].src) : Promise.resolve(null),
  ])

  if (star) drawTinted(ctx, star, edge, W - 300, -80, 392, 392, 0.07)

  // --- Header -------------------------------------------------------------
  let y = PAD + 58
  const avatarSize = 108
  if (avatar) {
    ctx.save()
    roundRect(ctx, PAD, PAD, avatarSize, avatarSize, 20)
    ctx.clip()
    ctx.drawImage(avatar, PAD, PAD, avatarSize, avatarSize)
    ctx.restore()
    ctx.strokeStyle = `${edge}80`
    ctx.lineWidth = 2
    roundRect(ctx, PAD, PAD, avatarSize, avatarSize, 20)
    ctx.stroke()
  } else {
    roundRect(ctx, PAD, PAD, avatarSize, avatarSize, 20)
    ctx.fillStyle = `${edge}1f`
    ctx.fill()
    text(ctx, d.name.slice(0, 1).toUpperCase(), PAD + avatarSize / 2, PAD + 74, `bold 54px ${o.displayFont}`, edge, "center")
  }

  const nameX = PAD + avatarSize + 26
  text(ctx, d.name, nameX, y, `bold 60px ${o.displayFont}`, "#ffffff")
  y += 32
  text(ctx, `${d.month} ${d.year} Wrapped`.toUpperCase(), nameX, y, `600 20px ${o.bodyFont}`, dim, "left", "3.4px")
  if (o.title) {
    y += 30
    text(ctx, o.title.toUpperCase(), nameX, y, `700 20px ${o.bodyFont}`, edge, "left", "2.4px")
  }

  // --- Record row ---------------------------------------------------------
  y = PAD + avatarSize + 92
  text(ctx, "RECORD", PAD, y - 34, `600 19px ${o.bodyFont}`, dim, "left", "3px")
  ctx.font = `bold 52px ${o.bodyFont}`
  ctx.textAlign = "left"
  ctx.fillStyle = "#27ae60"
  ctx.fillText(`${d.wins}W`, PAD, y)
  const wWidth = ctx.measureText(`${d.wins}W`).width
  ctx.fillStyle = "#5a6472"
  ctx.fillText(" – ", PAD + wWidth, y)
  const dashWidth = ctx.measureText(" – ").width
  ctx.fillStyle = "#ff4757"
  ctx.fillText(`${d.losses}L`, PAD + wWidth + dashWidth, y)

  const midX = W * 0.47
  text(ctx, "WIN RATE", midX, y - 34, `600 19px ${o.bodyFont}`, dim, "left", "3px")
  text(ctx, `${d.winPct}%`, midX, y, `bold 52px ${o.bodyFont}`, "#e8ecf2")

  if (d.place !== null) {
    text(ctx, "FINISHED", W - PAD, y - 34, `600 19px ${o.bodyFont}`, dim, "right", "3px")
    ctx.font = `bold 52px ${o.bodyFont}`
    ctx.textAlign = "right"
    const ofText = ` / ${d.of}`
    ctx.font = `400 26px ${o.bodyFont}`
    const ofW = ctx.measureText(ofText).width
    ctx.fillStyle = dim
    ctx.fillText(ofText, W - PAD, y)
    ctx.font = `bold 52px ${o.bodyFont}`
    ctx.fillStyle = edge
    ctx.fillText(`#${d.place}`, W - PAD - ofW, y)
    // The medal itself, so a podium month is legible without reading the number
    if (medalImg) drawTinted(ctx, medalImg, MEDALS[d.place - 1].colour, W - PAD - 46, y - 118, 46, 46, 0.95)
  }

  // --- Stats grid ---------------------------------------------------------
  y += 46
  const gap = 18
  const boxW = (W - PAD * 2 - gap) / 2
  const boxH = 104
  d.stats.slice(0, 6).forEach((s, i) => {
    const bx = PAD + (i % 2) * (boxW + gap)
    const by = y + Math.floor(i / 2) * (boxH + gap)
    roundRect(ctx, bx, by, boxW, boxH, 16)
    ctx.fillStyle = "rgba(255,255,255,0.035)"
    ctx.fill()
    ctx.strokeStyle = "rgba(255,255,255,0.07)"
    ctx.lineWidth = 2
    ctx.stroke()
    text(ctx, s.value, bx + 24, by + 50, `bold 38px ${o.bodyFont}`, "#e8ecf2")
    text(ctx, s.label.toUpperCase(), bx + 24, by + 80, `600 18px ${o.bodyFont}`, dim, "left", "2.6px")
  })
  y += 3 * boxH + 2 * gap + 46

  // --- Form line: the shape of the month, in the space six boxes left over -
  if (o.results.length >= 2) {
    text(ctx, "HOW THE MONTH RAN", PAD, y, `600 19px ${o.bodyFont}`, dim, "left", "3px")
    y += 22
    const gW = W - PAD * 2
    const gH = 88
    let run = 0
    const pts = o.results.map((r, i) => {
      run += r === "W" ? 1 : r === "L" ? -1 : 0
      return { x: (i / (o.results.length - 1)) * gW + PAD, y: run }
    })
    const ys = pts.map((p) => p.y)
    const lo = Math.min(0, ...ys)
    const hi = Math.max(0, ...ys)
    const span = hi - lo || 1
    const py = (v: number) => y + gH - ((v - lo) / span) * gH
    ctx.save()
    ctx.strokeStyle = "rgba(255,255,255,0.10)"
    ctx.lineWidth = 2
    ctx.setLineDash([6, 6])
    ctx.beginPath()
    ctx.moveTo(PAD, py(0))
    ctx.lineTo(W - PAD, py(0))
    ctx.stroke()
    ctx.restore()
    const end = pts[pts.length - 1].y
    ctx.strokeStyle = end > 0 ? "#27ae60" : end < 0 ? "#ff4757" : dim
    ctx.lineWidth = 4
    ctx.lineJoin = "round"
    ctx.beginPath()
    pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, py(p.y)) : ctx.lineTo(p.x, py(p.y))))
    ctx.stroke()
    y += gH + 26
    // Pips, stretched to the same width as the line above them
    const pipGap = 4
    const pipW = (gW - pipGap * (o.results.length - 1)) / o.results.length
    o.results.forEach((r, i) => {
      roundRect(ctx, PAD + i * (pipW + pipGap), y, pipW, 16, 5)
      ctx.fillStyle = r === "W" ? "#27ae60" : r === "L" ? "#ff4757" : "#5a6472"
      ctx.fill()
    })
    y += 16
  }

  // --- The bit people argue about ----------------------------------------
  const rows: [string, string, string][] = []
  if (d.topFriend) rows.push(["Best alongside", d.topFriend, "#27ae60"])
  if (d.topNemesis) rows.push(["Nemesis", d.topNemesis, "#ff4757"])
  if (d.bestScore !== null) rows.push(["Best game", String(d.bestScore), "#ffd700"])
  if (d.streak > 1) rows.push(["Best streak", `${d.streak} wins`, "#f39c12"])

  let ry = H - PAD - 40 - rows.length * 38
  rows.forEach(([label, value, colour]) => {
    text(ctx, label, PAD, ry, `400 24px ${o.bodyFont}`, dim)
    text(ctx, value, W - PAD, ry, `700 24px ${o.bodyFont}`, colour, "right")
    ry += 38
  })

  // --- Footer -------------------------------------------------------------
  ctx.strokeStyle = "rgba(255,255,255,0.08)"
  ctx.lineWidth = 2
  ctx.beginPath()
  ctx.moveTo(PAD, ry + 4)
  ctx.lineTo(W - PAD, ry + 4)
  ctx.stroke()
  text(ctx, "JK2CTF.COM", PAD, ry + 38, `700 19px ${o.bodyFont}`, o.primary, "left", "3.4px")
  const tierLine = `${d.tier !== null ? `TIER ${d.tier} — ${d.tierName.toUpperCase()}` : "UNRANKED"} · ${d.played} GAMES`
  text(ctx, tierLine, W - PAD, ry + 38, `600 19px ${o.bodyFont}`, o.primary, "right", "2.4px")

  ctx.restore()

  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), "image/png"))
}
