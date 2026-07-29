/**
 * Pure-canvas renderer for the Layer/Layout model.
 * Used by both the creative-template-create editor and the creative-template-fill page.
 * No DOM-to-canvas conversion — all drawing uses the Canvas 2D API directly.
 */

// ── Shared types ──────────────────────────────────────────────────────────────
export type Align = "left" | "center" | "right"
export type Fit = "cover" | "contain" | "fill"

export type TextSpan = { text: string; color?: string; fontWeight?: number }

export type TextContent = {
  text: string; fontFamily: string; fontSize: number; fontWeight: number
  color: string; align: Align; lineHeight: number; textTransform?: string
  noWrap?: boolean; spans?: TextSpan[]
  aprimoField?: { id: string; name: string }
}
export type ImageContent = { src: string; fit: Fit; source?: "asset" | "free"; radius?: number }
export type ShapeContent = {
  shape: "rectangle" | "ellipse"; fillType: "color" | "none" | "image"
  fill: string; src: string; imageFit: Fit; stroke: string; strokeWidth: number; radius: number
}
export type ButtonContent = {
  label: string; fontFamily: string; fontSize: number; fontWeight: number
  color: string; background: string; radius: number
}
export type LayerEffect =
  | { type: "drop-shadow"; color: string; offsetX: number; offsetY: number; blur: number }
  | { type: "blur"; radius: number }

export type LayerBase = {
  id: string; name: string; x: number; y: number; width: number; height: number
  rotation: number; opacity: number; visible: boolean; locked: boolean
  effects?: LayerEffect[]
}
export type TextLayer   = LayerBase & { type: "text";   content: TextContent }
export type ImageLayer  = LayerBase & { type: "image";  content: ImageContent }
export type ShapeLayer  = LayerBase & { type: "shape";  content: ShapeContent; children: Layer[] }
export type ButtonLayer = LayerBase & { type: "button"; content: ButtonContent }
export type Layer  = TextLayer | ImageLayer | ShapeLayer | ButtonLayer
export type Layout = { version: 1; name: string; width: number; height: number; background: string; layers: Layer[] }

// ── Image cache ───────────────────────────────────────────────────────────────
const _imgCache = new Map<string, HTMLImageElement | null>()
export function clearImageCache() { _imgCache.clear() }

function loadImg(src: string): Promise<HTMLImageElement | null> {
  if (!src) return Promise.resolve(null)
  if (_imgCache.has(src)) return Promise.resolve(_imgCache.get(src)!)
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload  = () => { _imgCache.set(src, img);  resolve(img)  }
    img.onerror = () => { _imgCache.set(src, null); resolve(null) }
    img.src = src
  })
}

// ── Drawing helpers ───────────────────────────────────────────────────────────
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.arcTo(x + w, y,     x + w, y + r,     r)
  ctx.lineTo(x + w, y + h - r)
  ctx.arcTo(x + w, y + h, x + w - r, y + h, r)
  ctx.lineTo(x + r, y + h)
  ctx.arcTo(x,     y + h, x,     y + h - r, r)
  ctx.lineTo(x, y + r)
  ctx.arcTo(x,     y,     x + r, y,         r)
  ctx.closePath()
}

function ellipsePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number) {
  ctx.beginPath()
  ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2)
}

function shapePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, c: ShapeContent) {
  if (c.shape === "ellipse") ellipsePath(ctx, x, y, w, h)
  else roundedRect(ctx, x, y, w, h, c.radius ?? 0)
}

function applyTextTransform(t: string, transform?: string) {
  if (transform === "uppercase") return t.toUpperCase()
  if (transform === "lowercase") return t.toLowerCase()
  if (transform === "capitalize") return t.replace(/\b\w/g, (c) => c.toUpperCase())
  return t
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const result: string[] = []
  for (const para of text.split("\n")) {
    const words = para.split(" ")
    let cur = ""
    for (const word of words) {
      const candidate = cur ? `${cur} ${word}` : word
      if (cur && ctx.measureText(candidate).width > maxWidth) { result.push(cur); cur = word }
      else cur = candidate
    }
    result.push(cur)
  }
  return result
}

function drawObjectFit(ctx: CanvasRenderingContext2D, img: HTMLImageElement, x: number, y: number, w: number, h: number, fit: Fit) {
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  let dx = x, dy = y, dw = w, dh = h
  if (fit === "contain") {
    const s = Math.min(w / iw, h / ih); dw = iw * s; dh = ih * s
    dx = x + (w - dw) / 2; dy = y + (h - dh) / 2
  } else if (fit === "cover") {
    const s = Math.max(w / iw, h / ih); dw = iw * s; dh = ih * s
    dx = x + (w - dw) / 2; dy = y + (h - dh) / 2
  }
  ctx.drawImage(img, dx, dy, dw, dh)
}

// ── Layer draw functions ──────────────────────────────────────────────────────
async function drawText(ctx: CanvasRenderingContext2D, l: TextLayer) {
  const { x, y, width, content: c } = l

  // When bound to an Aprimo field and no preview text is set, draw a placeholder.
  if (c.aprimoField && !c.text?.trim()) {
    ctx.save()
    ctx.textBaseline = "top"
    ctx.font = `italic ${c.fontSize}px ${c.fontFamily}`
    ctx.fillStyle = "rgba(100,100,100,0.55)"
    ctx.textAlign = "left"
    ctx.fillText(`{{${c.aprimoField.name}}}`, x, y)
    ctx.restore()
    return
  }

  const lineH = c.fontSize * (c.lineHeight ?? 1.2)
  ctx.save()
  ctx.textBaseline = "top"

  if (c.spans && c.spans.length > 0) {
    // Break spans into word tokens so we can wrap across lines.
    type Token = { text: string; color?: string; fontWeight?: number; isSpace: boolean }
    const tokens: Token[] = []
    for (const s of c.spans) {
      const transformed = applyTextTransform(s.text, c.textTransform)
      for (const part of transformed.split(/(\s+)/)) {
        if (part) tokens.push({ text: part, color: s.color, fontWeight: s.fontWeight, isSpace: /^\s+$/.test(part) })
      }
    }

    // Build wrapped lines of tokens
    const spanLines: Token[][] = []
    let line: Token[] = []
    let lineW = 0
    for (const token of tokens) {
      if (token.isSpace) {
        if (line.length > 0) { line.push(token); ctx.font = `${token.fontWeight ?? c.fontWeight} ${c.fontSize}px ${c.fontFamily}`; lineW += ctx.measureText(token.text).width }
        continue
      }
      ctx.font = `${token.fontWeight ?? c.fontWeight} ${c.fontSize}px ${c.fontFamily}`
      const tw = ctx.measureText(token.text).width
      if (line.length > 0 && lineW + tw > width) {
        while (line.length && line[line.length - 1].isSpace) line.pop()
        spanLines.push(line); line = []; lineW = 0
      }
      line.push(token); lineW += tw
    }
    if (line.length) { while (line.length && line[line.length - 1].isSpace) line.pop(); spanLines.push(line) }

    // Render each line
    spanLines.forEach((lineTokens, li) => {
      let total = 0
      for (const t of lineTokens) { ctx.font = `${t.fontWeight ?? c.fontWeight} ${c.fontSize}px ${c.fontFamily}`; total += ctx.measureText(t.text).width }
      let ox = c.align === "center" ? x + (width - total) / 2 : c.align === "right" ? x + width - total : x
      const ty = y + li * lineH
      for (const t of lineTokens) {
        ctx.font = `${t.fontWeight ?? c.fontWeight} ${c.fontSize}px ${c.fontFamily}`
        ctx.fillStyle = t.color ?? c.color
        ctx.textAlign = "left"
        const tw = ctx.measureText(t.text).width
        ctx.fillText(t.text, ox, ty)
        ox += tw
      }
    })
  } else {
    const text = applyTextTransform(c.text ?? "", c.textTransform)
    ctx.font = `${c.fontWeight} ${c.fontSize}px ${c.fontFamily}`
    ctx.fillStyle = c.color
    ctx.textAlign = c.align
    const ax = c.align === "center" ? x + width / 2 : c.align === "right" ? x + width : x
    // Always wrap — noWrap only means the Figma box auto-sized; on canvas we still
    // need to break if the text is wider than the layer bounds.
    const lines = wrapLines(ctx, text, width)
    lines.forEach((line, i) => ctx.fillText(line, ax, y + i * lineH))
  }
  ctx.restore()
}

async function drawImage(ctx: CanvasRenderingContext2D, l: ImageLayer) {
  const { x, y, width, height, content: c } = l
  ctx.save()
  ctx.beginPath()
  if (c.radius) roundedRect(ctx, x, y, width, height, c.radius)
  else ctx.rect(x, y, width, height)
  ctx.clip()
  const img = c.src ? await loadImg(c.src) : null
  if (img) {
    drawObjectFit(ctx, img, x, y, width, height, c.fit)
  } else {
    ctx.fillStyle = "rgba(0,0,0,0.06)"
    ctx.fillRect(x, y, width, height)
    ctx.strokeStyle = "rgba(0,0,0,0.25)"
    ctx.lineWidth = 1
    ctx.setLineDash([6, 4]); ctx.strokeRect(x + 0.5, y + 0.5, width - 1, height - 1); ctx.setLineDash([])
    ctx.fillStyle = "rgba(0,0,0,0.30)"
    ctx.font = `500 ${Math.max(11, Math.min(14, height / 6))}px sans-serif`
    ctx.textAlign = "center"; ctx.textBaseline = "middle"
    ctx.fillText(c.src ? "Image (failed to load)" : "Image", x + width / 2, y + height / 2)
  }
  ctx.restore()
}

async function drawShape(ctx: CanvasRenderingContext2D, l: ShapeLayer) {
  const { x, y, width, height, content: c, children } = l

  // Fill
  ctx.save()
  shapePath(ctx, x, y, width, height, c)
  if (c.fillType === "color" && c.fill) {
    ctx.fillStyle = c.fill; ctx.fill()
  } else if (c.fillType === "image") {
    ctx.save(); ctx.clip()
    const img = c.src ? await loadImg(c.src) : null
    if (img) drawObjectFit(ctx, img, x, y, width, height, c.imageFit)
    ctx.restore()
    shapePath(ctx, x, y, width, height, c) // redraw for stroke
  }
  if (c.strokeWidth && c.stroke) {
    ctx.strokeStyle = c.stroke; ctx.lineWidth = c.strokeWidth; ctx.stroke()
  }
  ctx.restore()

  // Children (positioned relative to shape origin, clipped to shape)
  if (children.length > 0) {
    ctx.save()
    shapePath(ctx, x, y, width, height, c); ctx.clip()
    ctx.translate(x, y)
    for (const child of children) await drawLayer(ctx, child)
    ctx.restore()
  }
}

async function drawButton(ctx: CanvasRenderingContext2D, l: ButtonLayer) {
  const { x, y, width, height, content: c } = l
  ctx.save()
  roundedRect(ctx, x, y, width, height, c.radius ?? 0)
  ctx.fillStyle = c.background || "#000"; ctx.fill()
  ctx.font = `${c.fontWeight} ${c.fontSize}px ${c.fontFamily}`
  ctx.fillStyle = c.color || "#fff"
  ctx.textAlign = "center"; ctx.textBaseline = "middle"
  ctx.fillText(c.label || "", x + width / 2, y + height / 2)
  ctx.restore()
}

export async function drawLayer(ctx: CanvasRenderingContext2D, layer: Layer): Promise<void> {
  if (!layer.visible) return
  ctx.save()
  ctx.globalAlpha = layer.opacity ?? 1
  if (layer.rotation) {
    const cx = layer.x + layer.width / 2, cy = layer.y + layer.height / 2
    ctx.translate(cx, cy); ctx.rotate((layer.rotation * Math.PI) / 180); ctx.translate(-cx, -cy)
  }
  if (layer.effects?.length) {
    for (const e of layer.effects) {
      if (e.type === "drop-shadow") {
        ctx.shadowColor = e.color; ctx.shadowBlur = e.blur
        ctx.shadowOffsetX = e.offsetX; ctx.shadowOffsetY = e.offsetY
        break // canvas supports one active shadow
      }
    }
    const blurFx = layer.effects.find((e): e is Extract<LayerEffect, { type: "blur" }> => e.type === "blur")
    if (blurFx) ctx.filter = `blur(${blurFx.radius}px)`
  }
  switch (layer.type) {
    case "text":   await drawText(ctx, layer);   break
    case "image":  await drawImage(ctx, layer);  break
    case "shape":  await drawShape(ctx, layer);  break
    case "button": await drawButton(ctx, layer); break
  }
  ctx.restore()
}

export async function drawLayout(ctx: CanvasRenderingContext2D, layout: Layout): Promise<void> {
  const { width, height, background, layers } = layout
  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = background || "#ffffff"; ctx.fillRect(0, 0, width, height)
  for (const layer of layers) await drawLayer(ctx, layer)
}
