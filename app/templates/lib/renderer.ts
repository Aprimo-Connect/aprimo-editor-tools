// Template Renderer — pure canvas drawing functions.
//
// No React reactivity, no DOM queries. All functions are stateless and
// side-effect free except for drawing into the provided canvas context.

import { gcd } from "./cdn-url"
import type { Anchor, DrawState, Format, FormatId, Layer, Styles } from "../types"

// ── Source-element bridge ──────────────────────────────────────────────
// An HTMLImageElement and HTMLVideoElement both work as ctx.drawImage
// sources but expose dimensions through different properties. This helper
// normalises access so the rest of the renderer stays type-clean.

interface SourceDims {
  sw: number
  sh: number
  isVideo: boolean
}

function getSourceDims(el: HTMLImageElement | HTMLVideoElement): SourceDims {
  if (el instanceof HTMLVideoElement) {
    return {
      sw: el.videoWidth || el.width || 1,
      sh: el.videoHeight || el.height || 1,
      isVideo: true,
    }
  }
  return {
    sw: el.naturalWidth || el.width || 1,
    sh: el.naturalHeight || el.height || 1,
    isVideo: false,
  }
}

// ── Layout helpers ────────────────────────────────────────────────────

interface PaddedFormat {
  padding?: number
}

/**
 * Resolve content padding for a format. Auto = 7% of shortest side; manual
 * (1–20) = that percentage of the shortest side.
 */
export function resolvePadding(minDim: number, fmt?: PaddedFormat): number {
  const p = fmt?.padding
  if (p && p > 0) return Math.max(4, minDim * (p / 100))
  return Math.max(8, minDim * 0.07)
}

export function buildSmartCropUrl(base: string, w: number, h: number): string {
  if (!base) return base
  const d = gcd(Math.round(w), Math.round(h))
  const ratio = `${w / d}:${h / d}`
  const sep = base.includes("?") ? "&" : "?"
  return `${base}${sep}width=${w}&crop=${ratio},smart&format=webp`
}

export function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "")
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ]
}

// ── Background fill ───────────────────────────────────────────────────

export interface FocalFit {
  scale: number
  ox: number
  oy: number
  dw: number
  dh: number
}

/**
 * Draw a background fill behind the image. Modes: color, linear gradient,
 * radial gradient. Gradient centres are based on the focal point position
 * mapped onto the canvas via `computeFocalFit`.
 */
export function drawBackground(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  ds: DrawState,
  fit: FocalFit,
): void {
  const mode = ds.bgMode
  if (!mode || mode === "none") return

  const c1 = ds.bgColor1 || "#0f172a"
  const c2 = ds.bgColor2 || "#1e293b"
  const dist = (ds.bgDistance ?? 100) / 100
  const focalX = ds.focalX ?? 0.5
  const focalY = ds.focalY ?? 0.5

  const cx = fit.ox + focalX * fit.dw
  const cy = fit.oy + focalY * fit.dh

  if (mode === "color") {
    ctx.fillStyle = c1
    ctx.fillRect(0, 0, w, h)
  } else if (mode === "linear") {
    const angle = ((ds.bgAngle ?? 180) * Math.PI) / 180
    const len = Math.max(w, h) * dist
    const x0 = cx - (Math.sin(angle) * len) / 2
    const y0 = cy - (Math.cos(angle) * len) / 2
    const x1 = cx + (Math.sin(angle) * len) / 2
    const y1 = cy + (Math.cos(angle) * len) / 2
    const grad = ctx.createLinearGradient(x0, y0, x1, y1)
    grad.addColorStop(0, c1)
    grad.addColorStop(1, c2)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  } else if (mode === "radial") {
    const radius = Math.max(w, h) * dist * 0.6
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius)
    grad.addColorStop(0, c1)
    grad.addColorStop(1, c2)
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, w, h)
  }
}

// ── Source draw / focal fit ───────────────────────────────────────────

/**
 * Draw a source element with cover-fit, placing the subject (focalX/Y) at
 * the target canvas position (targetX/Y). Lets the anchor-aware system
 * place the subject in the "safe zone" away from overlays.
 */
export function drawSource(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  el: HTMLImageElement | HTMLVideoElement,
  focalX = 0.5,
  focalY = 0.5,
  targetX = 0.5,
  targetY = 0.5,
): void {
  const { sw, sh } = getSourceDims(el)
  const scale = Math.max(w / sw, h / sh)
  const dw = sw * scale
  const dh = sh * scale

  let ox = -(focalX * dw - targetX * w)
  let oy = -(focalY * dh - targetY * h)

  if (dw > w) ox = Math.max(-(dw - w), Math.min(0, ox))
  else ox = (w - dw) / 2
  if (dh > h) oy = Math.max(-(dh - h), Math.min(0, oy))
  else oy = (h - dh) / 2

  ctx.drawImage(el, ox, oy, dw, dh)
}

export type FocalFitMode = "cover" | "contain" | "safe"

/**
 * Compute image scale and offset for cover-fit that keeps as much of the
 * focal area visible as possible.
 *
 * Hard constraint: canvas is always fully covered (no empty borders).
 * Soft constraint: the focal area rectangle is fully visible when the
 *   aspect ratio allows it; otherwise the image is centred on the focal
 *   area within the available cover-fit range.
 */
export function computeFocalFit(
  w: number,
  h: number,
  sw: number,
  sh: number,
  focalX: number,
  focalY: number,
  focalW: number,
  focalH: number,
  targetX = 0.5,
  targetY = 0.5,
  fitMode: FocalFitMode = "cover",
): FocalFit {
  const sCover = Math.max(w / sw, h / sh)
  const sFocal = Math.min(w / (focalW * sw), h / (focalH * sh))

  // 'safe': zoom out if needed to guarantee full focal visibility
  // 'cover'/'contain' (default): fill canvas, focal is best-effort
  const scale = fitMode === "safe" ? Math.min(sCover, sFocal) : sCover
  const dw = sw * scale
  const dh = sh * scale

  const fl = (focalX - focalW / 2) * dw
  const fr = (focalX + focalW / 2) * dw
  const ft = (focalY - focalH / 2) * dh
  const fb = (focalY + focalH / 2) * dh

  const oxMinCover = dw >= w ? -(dw - w) : (w - dw) / 2
  const oxMaxCover = dw >= w ? 0 : (w - dw) / 2
  const oyMinCover = dh >= h ? -(dh - h) : (h - dh) / 2
  const oyMaxCover = dh >= h ? 0 : (h - dh) / 2

  const oxMinFocal = -fl
  const oxMaxFocal = w - fr
  const oyMinFocal = -ft
  const oyMaxFocal = h - fb

  const oxMin = Math.max(oxMinCover, oxMinFocal)
  const oxMax = Math.min(oxMaxCover, oxMaxFocal)
  const oyMin = Math.max(oyMinCover, oyMinFocal)
  const oyMax = Math.min(oyMaxCover, oyMaxFocal)

  let ox = -(focalX * dw - targetX * w)
  let oy = -(focalY * dh - targetY * h)

  if (oxMin <= oxMax) {
    ox = Math.max(oxMin, Math.min(oxMax, ox))
  } else {
    ox = w / 2 - (fl + fr) / 2
    ox = Math.max(oxMinCover, Math.min(oxMaxCover, ox))
  }

  if (oyMin <= oyMax) {
    oy = Math.max(oyMin, Math.min(oyMax, oy))
  } else {
    oy = h / 2 - (ft + fb) / 2
    oy = Math.max(oyMinCover, Math.min(oyMaxCover, oy))
  }

  return { scale, ox, oy, dw, dh }
}

// ── Text helpers ──────────────────────────────────────────────────────

export function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  maxW: number,
  lineH: number,
  fontSize?: number,
  maxLines?: number,
): number {
  if (!text) return y
  const cap = maxLines ?? 5
  const words = text.split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let line = ""
  for (const word of words) {
    const test = line ? line + " " + word : word
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line)
      line = word
      if (lines.length >= cap) break
    } else {
      line = test
    }
  }
  if (line && lines.length < cap) lines.push(line)
  for (const l of lines) {
    ctx.fillText(l, x, y)
    y += lineH
  }
  // Strip trailing line-height so curY sits at the visual bottom of text.
  if (lines.length > 0) y -= lineH - (fontSize ?? lineH)
  return y
}

export function countLines(
  ctx: CanvasRenderingContext2D,
  text: string,
  font: string,
  maxW: number,
  maxLines: number,
): number {
  ctx.font = font
  const words = text.split(/\s+/).filter(Boolean)
  let lines = 1
  let line = ""
  for (const word of words) {
    const test = line ? line + " " + word : word
    if (ctx.measureText(test).width > maxW && line) {
      lines++
      line = word
      if (lines >= maxLines) break
    } else {
      line = test
    }
  }
  return Math.min(lines, maxLines)
}

export function applyTextShadow(
  ctx: CanvasRenderingContext2D,
  color: string,
  size: number,
): void {
  // ctx.scale(dpr) also scales shadowBlur — compensate so shadows stay
  // the same visual size regardless of the context transform.
  const t = ctx.getTransform()
  const s = Math.max(t.a, t.d) || 1
  ctx.shadowColor =
    color === "#ffffff" ? "rgba(0,0,0,0.55)" : "rgba(255,255,255,0.25)"
  ctx.shadowBlur = size / s
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 1 / s
}

export function clearShadow(ctx: CanvasRenderingContext2D): void {
  ctx.shadowColor = "transparent"
  ctx.shadowBlur = 0
  ctx.shadowOffsetX = 0
  ctx.shadowOffsetY = 0
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function fontStr(
  weight: string | number,
  size: number,
  family: string,
): string {
  return `${weight} ${size}px "${family}", sans-serif`
}

// ── CTA / overlay / logo ──────────────────────────────────────────────

interface DrawCTAOptions {
  fontSize?: number
  padH?: number
  padV?: number
}

export function drawCTA(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  text: string,
  ds: DrawState,
  opts: DrawCTAOptions = {},
): number | undefined {
  if (!text) return
  const padH = opts.padH ?? Math.max(4, ds.ctaPadH)
  const padV = opts.padV ?? Math.max(2, ds.ctaPadV)
  const fontSize = opts.fontSize || Math.max(8, ds.ctaFontSize || 11)
  const font = ds.ctaFont || "Inter"
  const weight = ds.ctaFontWeight || "600"

  ctx.font = fontStr(weight, fontSize, font)
  const textW = ctx.measureText(text).width
  const btnW = textW + padH * 2
  const actualBtnH = fontSize + padV * 2
  const r = 2 + (ds.ctaRadius / 100) * (actualBtnH * 0.5 - 2)
  const [ar, ag, ab] = hexToRgb(ds.accentColor)
  ctx.fillStyle = `rgb(${ar},${ag},${ab})`
  roundRect(ctx, cx - btnW / 2, cy - actualBtnH / 2, btnW, actualBtnH, r)
  ctx.fill()
  ctx.fillStyle = ds.ctaTextColor || "#ffffff"
  ctx.textAlign = "center"
  ctx.textBaseline = "middle"
  ctx.fillText(text, cx, cy)
  return actualBtnH
}

export function buildOverlayGradient(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  anchor: Anchor,
  r: number,
  g: number,
  b: number,
  opa: number,
): CanvasGradient {
  const ancV = anchor[0]
  const ancH = anchor[1]
  let grad: CanvasGradient
  if (ancH === "l") {
    grad = ctx.createLinearGradient(0, 0, w, 0)
    grad.addColorStop(0, `rgba(${r},${g},${b},${opa})`)
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${opa * 0.65})`)
    grad.addColorStop(0.85, `rgba(${r},${g},${b},${opa * 0.15})`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0.04)`)
  } else if (ancH === "r") {
    grad = ctx.createLinearGradient(w, 0, 0, 0)
    grad.addColorStop(0, `rgba(${r},${g},${b},${opa})`)
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${opa * 0.65})`)
    grad.addColorStop(0.85, `rgba(${r},${g},${b},${opa * 0.15})`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0.04)`)
  } else if (ancV === "t") {
    grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, `rgba(${r},${g},${b},${opa})`)
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${opa * 0.6})`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0.04)`)
  } else if (ancV === "b") {
    grad = ctx.createLinearGradient(0, h, 0, 0)
    grad.addColorStop(0, `rgba(${r},${g},${b},${opa})`)
    grad.addColorStop(0.5, `rgba(${r},${g},${b},${opa * 0.6})`)
    grad.addColorStop(1, `rgba(${r},${g},${b},0.04)`)
  } else {
    grad = ctx.createLinearGradient(0, 0, 0, h)
    grad.addColorStop(0, `rgba(${r},${g},${b},${opa * 0.35})`)
    grad.addColorStop(0.35, `rgba(${r},${g},${b},${opa * 0.75})`)
    grad.addColorStop(0.65, `rgba(${r},${g},${b},${opa * 0.75})`)
    grad.addColorStop(1, `rgba(${r},${g},${b},${opa * 0.45})`)
  }
  return grad
}

/**
 * Draw the logo at the specified position. The logo is drawn AT this
 * position, no mirroring.
 */
export function drawLogoAnchored(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  logoEl: HTMLImageElement,
  sizeRatio: number,
  position: Anchor,
  fmt: Format,
): void {
  if (!logoEl) return
  const natW = logoEl.naturalWidth || 200
  const natH = logoEl.naturalHeight || 100
  const aspect = natW / natH

  const ref = Math.min(w, h)
  let lh = Math.max(18, ref * sizeRatio)
  let lw = lh * aspect

  if (lw > w * 0.35) {
    lw = w * 0.35
    lh = lw / aspect
  }

  const minDim = Math.min(w, h)
  const pad = resolvePadding(minDim, fmt)
  const padH = pad
  const padV = pad
  const posV = position[0]
  const posH = position[1]
  const lx =
    posH === "l" ? padH : posH === "r" ? w - lw - padH : (w - lw) / 2
  const ly =
    posV === "t" ? padV : posV === "b" ? h - lh - padV : (h - lh) / 2

  const prevSmoothing = ctx.imageSmoothingQuality
  ctx.imageSmoothingQuality = "high"
  ctx.drawImage(logoEl, lx, ly, lw, lh)
  ctx.imageSmoothingQuality = prevSmoothing
}

// ── Content–subject interference detection ────────────────────────────

interface ContentInfo {
  layers?: Layer[]
  styles?: Partial<Styles> | DrawState
  contentScale?: number
  ctaScale?: number
  fmt?: Format
}

/**
 * Estimate the content block height as a normalised fraction of the canvas.
 * Approximates text wrapping without a canvas context by assuming an
 * average character width of ~0.55× the font size.
 */
export function estimateContentHeight(
  fmtW: number,
  fmtH: number,
  contentWidth: number,
  info?: ContentInfo,
): number {
  if (!info) return 0.45

  const { layers, styles, contentScale = 1, ctaScale = 1 } = info
  if (!layers || !layers.length || !styles) return 0.45

  const minDim = Math.min(fmtW, fmtH)
  const pad = resolvePadding(minDim, info.fmt)
  const padH = pad
  const padV = pad
  const maxW = Math.min(fmtW * (contentWidth / 100), fmtW - padH * 2)

  function approxLines(text: string, fontSize: number, maxLines?: number): number {
    if (!text) return 0
    const avgCharW = fontSize * 0.55
    const charsPerLine = Math.max(1, Math.floor(maxW / avgCharW))
    const rawLines = Math.ceil(text.length / charsPerLine)
    return Math.min(rawLines, maxLines ?? 3)
  }

  let blockH = 0
  const active = layers.filter((l) => l.value)
  const s = styles as Partial<Styles>

  for (let i = 0; i < active.length; i++) {
    const layer = active[i]
    if (layer.type === "headline") {
      const sz = Math.max(8, Math.round((s.headlineFontSize ?? 24) * contentScale))
      const lineH = sz * 1.3
      const nLines = approxLines(layer.value, sz, 3)
      blockH += lineH * nLines - (lineH - sz)
    } else if (layer.type === "text") {
      const sz = Math.max(6, Math.round((s.textFontSize ?? 14) * contentScale))
      const lineH = sz * 1.5
      const nLines = approxLines(layer.value, sz, 3)
      blockH += lineH * nLines - (lineH - sz)
    } else if (layer.type === "cta") {
      const ctaSz = Math.max(6, Math.round((s.ctaFontSize ?? 11) * ctaScale))
      const padVCta = Math.max(2, Math.round((s.ctaPadV ?? 10) * ctaScale))
      blockH += ctaSz + padVCta * 2
    }
    if (i < active.length - 1) {
      blockH += Math.max(0, layer.gapAfter ?? 12)
    }
  }

  const totalH = blockH + padV * 2
  return Math.min(totalH / fmtH, 0.95)
}

interface Rect {
  x1: number
  y1: number
  x2: number
  y2: number
}

/**
 * Compute the content overlay bounding box on the canvas (normalised 0–1).
 * Uses the actual contentWidth and estimated content height so that
 * narrow/short content doesn't falsely trigger overlap warnings.
 */
function contentRect(anchor: Anchor, contentWidth = 60, contentH = 0.45): Rect {
  const ancV = anchor[0]
  const ancH = anchor[1]
  const pad = 0.07 // matches padH ≈ 7% of canvas
  const cw = Math.min(contentWidth / 100, 1 - pad * 2)

  let x1 = 0
  let x2 = 1
  if (ancH === "l") {
    x1 = 0
    x2 = pad + cw
  } else if (ancH === "r") {
    x1 = 1 - pad - cw
    x2 = 1
  } else {
    x1 = 0.5 - cw / 2
    x2 = 0.5 + cw / 2
  }

  const ch = Math.max(contentH, 0.10)
  let y1 = 0
  let y2 = 1
  if (ancV === "t") {
    y1 = 0
    y2 = ch
  } else if (ancV === "b") {
    y1 = 1 - ch
    y2 = 1
  } else {
    y1 = 0.5 - ch / 2
    y2 = 0.5 + ch / 2
  }

  return { x1, y1, x2, y2 }
}

/**
 * Compute where the focal area box ends up on the canvas after cover-fit
 * positioning. Returns normalised {x1, y1, x2, y2} on the canvas.
 */
export function focalAreaOnCanvas(
  canvasW: number,
  canvasH: number,
  sw: number,
  sh: number,
  focalX: number,
  focalY: number,
  focalW: number,
  focalH: number,
  anchor: Anchor,
  contentAware: boolean,
  contentWidth = 60,
  contentH = 0.45,
  fitMode: FocalFitMode = "cover",
): Rect {
  const target = contentAware
    ? safeZoneTarget(anchor, contentWidth, contentH)
    : { tx: 0.5, ty: 0.5 }
  const fit = computeFocalFit(
    canvasW, canvasH, sw, sh,
    focalX, focalY, focalW, focalH,
    target.tx, target.ty, fitMode,
  )

  const srcX1 = focalX - focalW / 2
  const srcY1 = focalY - focalH / 2
  const srcX2 = focalX + focalW / 2
  const srcY2 = focalY + focalH / 2

  return {
    x1: (srcX1 * fit.dw + fit.ox) / canvasW,
    y1: (srcY1 * fit.dh + fit.oy) / canvasH,
    x2: (srcX2 * fit.dw + fit.ox) / canvasW,
    y2: (srcY2 * fit.dh + fit.oy) / canvasH,
  }
}

function rectOverlap(a: Rect, b: Rect): number {
  const ox = Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1))
  const oy = Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1))
  return ox * oy
}

const ALL_ANCHORS: Anchor[] = [
  "tl", "tc", "tr",
  "cl", "cc", "cr",
  "bl", "bc", "br",
]

export interface InterferenceResult {
  interferes: boolean
  suggestedAnchor: Anchor
  overlapRatio?: number
}

/**
 * Detect if the focal area overlaps with the content overlay. Uses
 * rectangle intersection, not point distance. Returns the anchor that
 * minimises overlap as `suggestedAnchor`.
 */
export function detectInterference(
  fmtW: number,
  fmtH: number,
  sourceW: number,
  sourceH: number,
  anchor: Anchor,
  focalX: number,
  focalY: number,
  contentAware: boolean,
  focalW = 0.30,
  focalH = 0.30,
  contentWidth = 60,
  contentInfo: ContentInfo | null = null,
  fitMode: FocalFitMode = "cover",
): InterferenceResult {
  if (!sourceW || !sourceH) {
    return { interferes: false, suggestedAnchor: anchor }
  }

  const ch = estimateContentHeight(fmtW, fmtH, contentWidth, contentInfo ?? undefined)

  const focalRect = focalAreaOnCanvas(
    fmtW, fmtH, sourceW, sourceH,
    focalX, focalY, focalW, focalH,
    anchor, contentAware, contentWidth, ch, fitMode,
  )
  const cRect = contentRect(anchor, contentWidth, ch)
  const overlap = rectOverlap(focalRect, cRect)
  const focalArea = Math.max(
    0.001,
    (focalRect.x2 - focalRect.x1) * (focalRect.y2 - focalRect.y1),
  )
  const overlapRatio = overlap / focalArea

  let bestAnchor: Anchor = anchor
  let bestOverlap = 1
  for (const a of ALL_ANCHORS) {
    const fr = focalAreaOnCanvas(
      fmtW, fmtH, sourceW, sourceH,
      focalX, focalY, focalW, focalH,
      a, contentAware, contentWidth, ch, fitMode,
    )
    const cr = contentRect(a, contentWidth, ch)
    const o = rectOverlap(fr, cr)
    const fa = Math.max(0.001, (fr.x2 - fr.x1) * (fr.y2 - fr.y1))
    const ratio = o / fa
    if (ratio < bestOverlap) {
      bestOverlap = ratio
      bestAnchor = a
    }
  }

  const interferes = overlapRatio > 0.15 && bestOverlap < overlapRatio - 0.05
  return { interferes, suggestedAnchor: bestAnchor, overlapRatio }
}

// ── Layer resolution / safe-zone target ───────────────────────────────

interface VisibleLayer {
  id: string
  type: "headline" | "text" | "cta"
  value: string
  gapAfter?: number
}

function resolveVisibleLayers(fmt: Format, ds: DrawState): VisibleLayer[] {
  if (fmt.visibleLayers && ds.layers) {
    return ds.layers.filter((l) => fmt.visibleLayers.includes(l.id))
  }
  // Legacy fallback (unused in the TS port but kept for snapshot compat)
  const result: VisibleLayer[] = []
  result.push({ id: "headline", type: "headline", value: ds.headline })
  result.push({ id: "text", type: "text", value: ds.cta })
  result.push({ id: "cta", type: "cta", value: ds.cta })
  return result
}

/**
 * Compute where the subject should appear on the canvas ("safe zone")
 * based on the content anchor and actual content dimensions. The
 * overlay/text covers the anchor side, so the subject sits on the
 * opposite side, offset proportionally to content size.
 */
function safeZoneTarget(
  anchor: Anchor,
  contentWidth = 60,
  contentH = 0.45,
): { tx: number; ty: number } {
  const ancV = anchor[0]
  const ancH = anchor[1]
  const cw = contentWidth / 100

  let tx = 0.5
  if (ancH === "l") tx = cw + (1 - cw) / 2
  else if (ancH === "r") tx = (1 - cw) / 2

  let ty = 0.5
  if (ancV === "t") ty = contentH + (1 - contentH) / 2
  else if (ancV === "b") ty = (1 - contentH) / 2

  return { tx, ty }
}

// ── Layer group draw ──────────────────────────────────────────────────

interface TypoMetrics {
  hlFont: string
  hlSize: number
  hlWeight: string
  hlColor: string
  txtFont: string
  txtSize: number
  txtWeight: string
  txtColor: string
  ctaFontSize: number
  fixedPadV: number
  fixedPadHScaled: number
  actualBtnH: number
  padH: number
  padV: number
  maxW: number
}

/**
 * Draw a group of layers at a specific anchor position. Core text/CTA
 * rendering loop, parameterised by anchor so per-layer overrides can
 * place different layers in different corners.
 */
function drawLayerGroup(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  layers: VisibleLayer[],
  groupAnchor: Anchor,
  ds: DrawState,
  _fmt: Format,
  typo: TypoMetrics,
): void {
  if (!layers.length) return

  const {
    hlFont, hlSize, hlWeight, hlColor,
    txtFont, txtSize, txtWeight, txtColor,
    ctaFontSize, fixedPadV, fixedPadHScaled, actualBtnH,
    padH, padV, maxW,
  } = typo

  const ancV = groupAnchor[0]
  const ancH = groupAnchor[1]
  const textAlign: CanvasTextAlign =
    ancH === "l" ? "left" : ancH === "r" ? "right" : "center"
  const textX = ancH === "l" ? padH : ancH === "r" ? w - padH : w / 2

  let blockH = 0
  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const text = layer.value
    if (layer.type === "headline") {
      const lineH = hlSize * 1.3
      const nLines = countLines(ctx, text, fontStr(hlWeight, hlSize, hlFont), maxW, 3)
      blockH += lineH * nLines - (lineH - hlSize)
    } else if (layer.type === "text") {
      const lineH = txtSize * 1.5
      const nLines = countLines(ctx, text, fontStr(txtWeight, txtSize, txtFont), maxW, 3)
      blockH += lineH * nLines - (lineH - txtSize)
    } else if (layer.type === "cta") {
      blockH += actualBtnH
    }
    if (i < layers.length - 1) {
      blockH += Math.max(0, layer.gapAfter ?? 12)
    }
  }

  let startY: number
  if (ancV === "t") startY = padV
  else if (ancV === "b") startY = h - padV - blockH
  else startY = (h - blockH) / 2

  let curY = Math.min(Math.max(padV, startY), h - padV - blockH)

  ctx.textAlign = textAlign
  ctx.textBaseline = "top"

  for (let i = 0; i < layers.length; i++) {
    const layer = layers[i]
    const text = layer.value

    if (i > 0) curY += Math.max(0, layers[i - 1].gapAfter ?? 12)

    if (layer.type === "headline") {
      ctx.font = fontStr(hlWeight, hlSize, hlFont)
      ctx.fillStyle = hlColor
      applyTextShadow(ctx, hlColor, hlSize * 0.55)
      curY = wrapText(ctx, text, textX, curY, maxW, hlSize * 1.3, hlSize, 3)
      clearShadow(ctx)
    } else if (layer.type === "text") {
      ctx.font = fontStr(txtWeight, txtSize, txtFont)
      ctx.fillStyle = txtColor
      ctx.globalAlpha = 0.85
      applyTextShadow(ctx, txtColor, txtSize * 0.45)
      curY = wrapText(ctx, text, textX, curY, maxW, txtSize * 1.5, txtSize, 3)
      clearShadow(ctx)
      ctx.globalAlpha = 1
    } else if (layer.type === "cta") {
      const ctaFont = ds.ctaFont || "Inter"
      const ctaWeight = ds.ctaFontWeight || "600"
      ctx.font = fontStr(ctaWeight, ctaFontSize, ctaFont)
      const tw = ctx.measureText(text).width
      const btnW = tw + fixedPadHScaled * 2
      let ctaCX: number
      if (ancH === "l") ctaCX = padH + btnW / 2
      else if (ancH === "r") ctaCX = w - padH - btnW / 2
      else ctaCX = w / 2
      const ctaCY = curY + actualBtnH / 2
      ctx.textAlign = "center"
      drawCTA(ctx, ctaCX, ctaCY, text, ds, {
        fontSize: ctaFontSize,
        padH: fixedPadHScaled,
        padV: fixedPadV,
      })
      ctx.textAlign = textAlign
      ctx.textBaseline = "top"
      curY += actualBtnH
    }
  }
}

// ── Main entry: draw a single format ──────────────────────────────────

export function drawTemplate(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  fmt: Format,
  ds: DrawState,
): void {
  if (!ds.el) return
  ctx.imageSmoothingEnabled = true
  ctx.imageSmoothingQuality = "high"
  const anchor = (fmt.anchor || "bl") as Anchor
  const el = ds.el
  const { sw, sh, isVideo } = getSourceDims(el)
  const focalX = ds.focalX ?? 0.5
  const focalY = ds.focalY ?? 0.5
  const focalW = ds.focalW ?? 0.30
  const focalH = ds.focalH ?? 0.30

  const cwPct = fmt.contentWidth ?? 60
  const visibleLayers = resolveVisibleLayers(fmt, ds)
  const contentInfo: ContentInfo = {
    layers: ds.layers.filter((l) => l.value),
    styles: ds,
    contentScale: fmt.contentScale || 1,
    ctaScale: fmt.ctaScale || 1,
    fmt,
  }
  const estContentH = estimateContentHeight(w, h, cwPct, contentInfo)

  let fit: FocalFit
  if (isVideo) {
    const scale = Math.max(w / sw, h / sh)
    const dw = sw * scale
    const dh = sh * scale
    const ox = (w - dw) / 2
    const oy = (h - dh) / 2
    fit = { scale, ox, oy, dw, dh }
  } else {
    const aware = ds.contentAwareFocal !== false
    const target = aware
      ? safeZoneTarget(anchor, cwPct, estContentH)
      : { tx: 0.5, ty: 0.5 }
    const fitMode = (ds.focalFit || "cover") as FocalFitMode
    fit = computeFocalFit(
      w, h, sw, sh,
      focalX, focalY, focalW, focalH,
      target.tx, target.ty, fitMode,
    )
  }

  // Background layer
  const hasBg = ds.bgMode && ds.bgMode !== "none"
  if (hasBg) {
    drawBackground(ctx, w, h, ds, fit)
  }

  const [r, g, b] = hexToRgb(ds.overlayColor)
  // Note: original Vue version filled letterbox areas with the overlay
  // color when bgMode="none". That conflicts with the user's expectation
  // ("no background means no background") and surfaces visibly through
  // transparent areas of PNG sources. With this skipped, transparent
  // letterbox areas show the canvas-wrap div's background instead.

  ctx.drawImage(el, fit.ox, fit.oy, fit.dw, fit.dh)

  const grad = buildOverlayGradient(ctx, w, h, anchor, r, g, b, ds.overlayOpacity)
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, w, h)

  // ── Precompute shared typography metrics ─────────────────────────
  const userScale = fmt.contentScale || 1
  const ctaUserScale = fmt.ctaScale || 1
  const minDim = Math.min(w, h)

  const typo: TypoMetrics = {
    hlFont: ds.headlineFont || "Inter",
    hlSize: Math.max(8, Math.round((ds.headlineFontSize || 24) * userScale)),
    hlWeight: ds.headlineFontWeight || "700",
    hlColor: ds.headlineColor || "#ffffff",
    txtFont: ds.textFont || "Inter",
    txtSize: Math.max(6, Math.round((ds.textFontSize || 14) * userScale)),
    txtWeight: ds.textFontWeight || "400",
    txtColor: ds.textColor || "#ffffff",
    ctaFontSize: Math.max(6, Math.round((ds.ctaFontSize || 11) * ctaUserScale)),
    fixedPadV: Math.max(2, Math.round(ds.ctaPadV * ctaUserScale)),
    fixedPadHScaled: Math.max(4, Math.round(ds.ctaPadH * ctaUserScale)),
    actualBtnH: 0,
    padH: resolvePadding(minDim, fmt),
    padV: resolvePadding(minDim, fmt),
    maxW: Math.min(w * (cwPct / 100), w - resolvePadding(minDim, fmt) * 2),
  }
  typo.actualBtnH = typo.ctaFontSize + typo.fixedPadV * 2

  // ── Resolve visible layers and group by effective anchor ─────────
  const activeItems = visibleLayers.filter((l) => l.value)
  const layerAnchors = fmt.layerAnchors || {}

  const groups: Record<string, VisibleLayer[]> = {}
  for (const layer of activeItems) {
    const eff = (layerAnchors[layer.id] || anchor) as string
    ;(groups[eff] ||= []).push(layer)
  }

  for (const [groupAnchor, groupLayers] of Object.entries(groups)) {
    drawLayerGroup(ctx, w, h, groupLayers, groupAnchor as Anchor, ds, fmt, typo)
  }

  // Logo — explicit logoAnchor if set, otherwise auto-pick best free corner
  if (ds.logo && fmt.logoSize > 0) {
    let logoPos: Anchor = fmt.logoAnchor as Anchor
    if (!logoPos) {
      const occupied = new Set(Object.keys(groups))
      const mirrorV = anchor[0] === "b" ? "t" : "b"
      const mirrorH =
        anchor[1] === "l" ? "r" : anchor[1] === "r" ? "l" : anchor[1]
      const preferred = (mirrorV + mirrorH) as Anchor
      const candidates: Anchor[] = [
        preferred,
        (mirrorV + "l") as Anchor, (mirrorV + "r") as Anchor, (mirrorV + "c") as Anchor,
        "tl", "tr", "tc", "bl", "br", "bc",
      ]
      logoPos = (candidates.find((c) => !occupied.has(c)) ?? preferred) as Anchor
    }
    drawLogoAnchored(ctx, w, h, ds.logo, fmt.logoSize, logoPos, fmt)
  }
}

// ── Full-resolution render (off-screen) ───────────────────────────────
//
// Used by exporters and publishers. Composes drawTemplate with the
// smart-crop variant when present, and supports skipping the logo for
// the tainted-canvas fallback path.

export function renderFullRes(
  fmt: Format,
  baseDrawState: DrawState,
  croppedEls: Record<FormatId, HTMLImageElement>,
  logoEl: HTMLImageElement | null,
  options: { includeLogo?: boolean } = {},
): HTMLCanvasElement {
  const { includeLogo = true } = options
  const canvas = document.createElement("canvas")
  canvas.width = fmt.w
  canvas.height = fmt.h
  const ctx = canvas.getContext("2d")
  if (!ctx) return canvas

  const cropped = croppedEls[fmt.id]
  const usesCrop = !!cropped
  const ds: DrawState = {
    ...baseDrawState,
    el: cropped ?? baseDrawState.el,
    logo: includeLogo ? logoEl : null,
    focalX: usesCrop ? 0.5 : baseDrawState.focalX ?? 0.5,
    focalY: usesCrop ? 0.5 : baseDrawState.focalY ?? 0.5,
  }
  drawTemplate(ctx, fmt.w, fmt.h, fmt, ds)
  return canvas
}
