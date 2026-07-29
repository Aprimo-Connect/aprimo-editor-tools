// Server-side helpers for importing a design from Figma via OAuth + REST API.
// Docs: https://www.figma.com/developers/api

const FIGMA_AUTH_URL = "https://www.figma.com/oauth"
const FIGMA_TOKEN_URL = "https://api.figma.com/v1/oauth/token"
const FIGMA_API = "https://api.figma.com"

export type FigmaBox = { x: number; y: number; width: number; height: number }

export type FigmaTextStyle = {
  fontFamily?: string
  fontSize?: number
  fontWeight?: number
  lineHeightPx?: number
  letterSpacing?: number
  textAlignHorizontal?: string
  textAlignVertical?: string
}

// Lightweight tree the hierarchy panel renders (mirrors the DOM tree shape).
export type FigmaTreeNode = {
  fpid: string // Figma node id
  tag: string // node type, e.g. FRAME / TEXT / RECTANGLE
  name: string
  text?: string
  box?: FigmaBox
  textStyle?: FigmaTextStyle // present on TEXT nodes
  color?: string // TEXT: text color from the first solid fill
  bg?: string // non-TEXT: background from the first solid fill
  children: FigmaTreeNode[]
}

/** Extracts the file key and optional node id from any Figma file/design URL. */
export function parseFigmaUrl(input: string): { key: string; nodeId?: string } | null {
  try {
    const url = new URL(input.trim())
    const m = url.pathname.match(/\/(?:file|design|proto|make|board)\/([A-Za-z0-9]+)/)
    if (!m) return null
    const key = m[1]
    const raw = url.searchParams.get("node-id") ?? undefined
    // URLs use "1-2"; the API expects "1:2".
    const nodeId = raw ? decodeURIComponent(raw).replace(/-/g, ":") : undefined
    return { key, nodeId }
  } catch {
    return null
  }
}

// Figma's current scope for reading file contents (nodes). The old "file_read"
// and "files:read" names are rejected as "Invalid scopes for app".
// See https://developers.figma.com/docs/rest-api/scopes/
export const DEFAULT_FIGMA_SCOPE = "file_content:read"

export function buildAuthorizeUrl(
  clientId: string,
  redirectUri: string,
  state: string,
  scope: string = DEFAULT_FIGMA_SCOPE
): string {
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope,
    state,
    response_type: "code",
  })
  return `${FIGMA_AUTH_URL}?${params.toString()}`
}

export async function exchangeCodeForToken(opts: {
  clientId: string
  clientSecret: string
  redirectUri: string
  code: string
}): Promise<{ access_token: string; expires_in: number; refresh_token?: string }> {
  // Figma now expects client credentials via HTTP Basic auth, not in the body.
  const basic = Buffer.from(`${opts.clientId}:${opts.clientSecret}`).toString("base64")
  const body = new URLSearchParams({
    redirect_uri: opts.redirectUri,
    code: opts.code,
    grant_type: "authorization_code",
  })
  const res = await fetch(FIGMA_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basic}`,
    },
    body,
  })
  if (!res.ok) {
    throw new Error(`Figma token exchange failed (${res.status}): ${await res.text()}`)
  }
  return res.json()
}

function authHeaders(token: string) {
  return { Authorization: `Bearer ${token}` }
}

/**
 * Fetches a subtree (when nodeId is given) or the whole document, plus its name.
 * `raw` is the complete, untouched Figma API response for inspection.
 */
export async function fetchDocument(
  token: string,
  key: string,
  nodeId?: string
): Promise<{ name: string; root: unknown; raw: unknown }> {
  if (nodeId) {
    const res = await fetch(`${FIGMA_API}/v1/files/${key}/nodes?ids=${encodeURIComponent(nodeId)}`, {
      headers: authHeaders(token),
    })
    if (!res.ok) throw new Error(`Figma nodes fetch failed (${res.status}): ${await res.text()}`)
    const data = await res.json()
    const node = data?.nodes?.[nodeId]?.document
    if (!node) throw new Error("Node not found in the file.")
    return { name: data?.name ?? node?.name ?? "Figma design", root: node, raw: data }
  }

  const res = await fetch(`${FIGMA_API}/v1/files/${key}`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(`Figma file fetch failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  // Default to the first frame on the first page so we render something concrete.
  const firstPage = data?.document?.children?.[0]
  const firstFrame = firstPage?.children?.find((c: { type?: string }) => c?.type === "FRAME") ?? firstPage
  return { name: data?.name ?? "Figma design", root: firstFrame ?? data?.document, raw: data }
}

/** Maps a file's image-fill `imageRef`s to their (temporary) URLs. */
export async function getImageFills(token: string, key: string): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${FIGMA_API}/v1/files/${key}/images`, { headers: authHeaders(token) })
    if (!res.ok) return {}
    const data = await res.json()
    return data?.meta?.images ?? {}
  } catch {
    return {}
  }
}

export type FramePage = { id: string; name: string; frames: { id: string; name: string; type: string }[] }

// Node types worth importing as a "frame".
const FRAME_TYPES = new Set(["FRAME", "COMPONENT", "COMPONENT_SET", "SECTION", "INSTANCE"])

/** Lists pages and their top-level frames (shallow fetch) for the frame picker. */
export async function listFrames(token: string, key: string): Promise<{ name: string; pages: FramePage[] }> {
  const res = await fetch(`${FIGMA_API}/v1/files/${key}?depth=2`, { headers: authHeaders(token) })
  if (!res.ok) throw new Error(`Figma file fetch failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  const pages: FramePage[] = (data?.document?.children ?? [])
    .filter((p: { type?: string }) => p?.type === "CANVAS")
    .map((page: { id: string; name: string; children?: { id: string; name: string; type: string }[] }) => ({
      id: page.id,
      name: page.name,
      frames: (page.children ?? [])
        .filter((c) => FRAME_TYPES.has(c.type))
        .map((f) => ({ id: f.id, name: f.name, type: f.type })),
    }))
  return { name: data?.name ?? "Figma file", pages }
}

/** Renders a node to an image URL (temporary S3 link served by Figma). */
export async function fetchImage(
  token: string,
  key: string,
  nodeId: string,
  format: "png" | "svg" = "png"
): Promise<string | null> {
  // scale=1 keeps the render cheap; scale=2 doubles Figma's cost-based rate usage.
  const params = new URLSearchParams({ ids: nodeId, format, scale: "1" })
  const res = await fetch(`${FIGMA_API}/v1/images/${key}?${params.toString()}`, {
    headers: authHeaders(token),
  })
  if (!res.ok) throw new Error(`Figma image render failed (${res.status}): ${await res.text()}`)
  const data = await res.json()
  return data?.images?.[nodeId] ?? null
}

type RawColor = { r: number; g: number; b: number; a?: number }
type RawFill = { type?: string; visible?: boolean; opacity?: number; color?: RawColor }
type RawEffect = {
  type?: string
  visible?: boolean
  radius?: number
  color?: RawColor
  offset?: { x: number; y: number }
}
type RawNode = {
  id: string
  name?: string
  type?: string
  characters?: string
  absoluteBoundingBox?: FigmaBox | null
  style?: FigmaTextStyle
  fills?: RawFill[]
  effects?: RawEffect[]
  children?: RawNode[]
}

// --- Figma node → HTML/CSS conversion (absolute layout relative to the frame) ---
/* eslint-disable @typescript-eslint/no-explicit-any */
function cssColor(c: any, opacity = 1): string | null {
  if (!c) return null
  const a = (c.a ?? 1) * opacity
  return `rgba(${Math.round(c.r * 255)}, ${Math.round(c.g * 255)}, ${Math.round(c.b * 255)}, ${a})`
}
function fillToCss(fills: any): string | null {
  if (!Array.isArray(fills)) return null
  const f = fills.find((x) => x?.visible !== false)
  if (!f) return null
  if (f.type === "SOLID") return cssColor(f.color, f.opacity ?? 1)
  if ((f.type === "GRADIENT_LINEAR" || f.type === "GRADIENT_RADIAL") && Array.isArray(f.gradientStops)) {
    const stops = f.gradientStops.map((s: any) => `${cssColor(s.color)} ${Math.round((s.position ?? 0) * 100)}%`).join(", ")
    return f.type === "GRADIENT_RADIAL" ? `radial-gradient(${stops})` : `linear-gradient(180deg, ${stops})`
  }
  return null
}
function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}
const H_ALIGN: Record<string, string> = { LEFT: "flex-start", CENTER: "center", RIGHT: "flex-end", JUSTIFIED: "space-between" }
const V_ALIGN: Record<string, string> = { TOP: "flex-start", CENTER: "center", BOTTOM: "flex-end" }

// First visible IMAGE fill resolved to a URL + object-fit, or null.
function imageFill(fills: any, imageFills: Record<string, string>): { url: string; fit: string } | null {
  if (!Array.isArray(fills)) return null
  const f = fills.find((x) => x?.visible !== false && x.type === "IMAGE" && x.imageRef)
  if (!f) return null
  const url = imageFills[f.imageRef]
  if (!url) return null
  const fit = f.scaleMode === "FIT" ? "contain" : f.scaleMode === "STRETCH" ? "fill" : "cover"
  return { url, fit }
}

// Node types that Figma renders as vector paths (no HTML equivalent — must be exported as SVG).
const VECTOR_TYPES = new Set(["VECTOR", "BOOLEAN_OPERATION", "STAR", "POLYGON", "LINE", "REGULAR_POLYGON"])

/** Walks a Figma node tree and returns the IDs of all VECTOR-like nodes. */
export function collectVectorIds(node: any): string[] {
  const ids: string[] = []
  const walk = (n: any) => {
    if (!n) return
    if (VECTOR_TYPES.has(n.type) && n.id) {
      ids.push(n.id)
      return // don't recurse into vector children — the whole node is one export
    }
    ;(n.children ?? []).forEach(walk)
  }
  walk(node)
  return ids
}

/**
 * Batch-exports a list of Figma node IDs as SVG via the Images API, fetches the
 * SVG content server-side, and returns a map of nodeId → `data:image/svg+xml;base64,...`
 * so the output HTML works in sandboxed iframes without CORS issues.
 */
export async function getSvgExports(token: string, key: string, nodeIds: string[]): Promise<Record<string, string>> {
  if (!nodeIds.length) return {}
  try {
    const params = new URLSearchParams({ ids: nodeIds.join(","), format: "svg", scale: "1" })
    const res = await fetch(`${FIGMA_API}/v1/images/${key}?${params}`, { headers: authHeaders(token) })
    if (!res.ok) return {}
    const data = await res.json()
    const urls: Record<string, string> = data?.images ?? {}
    const entries = await Promise.all(
      Object.entries(urls).map(async ([id, url]) => {
        if (!url) return null
        try {
          const r = await fetch(url)
          if (!r.ok) return null
          const svg = await r.text()
          const b64 = Buffer.from(svg).toString("base64")
          return [id, `data:image/svg+xml;base64,${b64}`] as const
        } catch {
          return null
        }
      })
    )
    return Object.fromEntries(entries.filter(Boolean) as [string, string][])
  } catch {
    return {}
  }
}

/** Generates a static HTML reproduction of a Figma frame (absolute layout). */
export function nodeToHtml(root: any, imageFills: Record<string, string> = {}, svgExports: Record<string, string> = {}): string {
  const box = root?.absoluteBoundingBox
  if (!box) return "<div></div>"
  const parts: string[] = []

  const walk = (node: any) => {
    if (!node || node.visible === false) return
    const b = node.absoluteBoundingBox
    if (!b) {
      ;(node.children ?? []).forEach(walk)
      return
    }
    const s: string[] = [
      "position:absolute",
      `left:${Math.round(b.x - box.x)}px`,
      `top:${Math.round(b.y - box.y)}px`,
      `width:${Math.round(b.width)}px`,
      `height:${Math.round(b.height)}px`,
    ]
    if (typeof node.opacity === "number" && node.opacity < 1) s.push(`opacity:${node.opacity}`)
    if (node.cornerRadius) s.push(`border-radius:${node.cornerRadius}px`)
    const stroke = fillToCss(node.strokes)
    if (stroke && node.strokeWeight) s.push(`border:${node.strokeWeight}px solid ${stroke}`)

    // SVG/vector nodes — render as an img using the pre-exported SVG data URL.
    const svgSrc = svgExports[node.id]
    if (svgSrc || VECTOR_TYPES.has(node.type)) {
      if (svgSrc) {
        parts.push(`  <img data-figma-id="${node.id}" src="${svgSrc}" crossorigin="anonymous" style="${s.concat("object-fit:contain").join(";")}" />`)
      }
      return // VECTOR nodes with no export are invisible; skip rather than emit blank div
    }

    if (node.type === "TEXT") {
      const st = node.style ?? {}
      s.push(`color:${fillToCss(node.fills) ?? "#000"}`)
      s.push(`font-size:${st.fontSize ?? 16}px`)
      s.push(`font-family:'${st.fontFamily ?? "sans-serif"}', sans-serif`)
      s.push(`font-weight:${st.fontWeight ?? 400}`)
      if (st.lineHeightPx) s.push(`line-height:${st.lineHeightPx}px`)
      if (st.letterSpacing) s.push(`letter-spacing:${st.letterSpacing}px`)
      s.push(`text-align:${(st.textAlignHorizontal ?? "LEFT").toLowerCase()}`)
      s.push("display:flex;flex-direction:column;white-space:pre-wrap")
      s.push(`justify-content:${V_ALIGN[st.textAlignVertical ?? "TOP"] ?? "flex-start"}`)
      s.push(`align-items:${H_ALIGN[st.textAlignHorizontal ?? "LEFT"] ?? "flex-start"}`)
      if (st.textCase === "UPPER") s.push("text-transform:uppercase")
      else if (st.textCase === "LOWER") s.push("text-transform:lowercase")
      else if (st.textCase === "TITLE") s.push("text-transform:capitalize")
      const chars: string = node.characters ?? ""
      const overrides: number[] = Array.isArray(node.characterStyleOverrides) ? node.characterStyleOverrides : []
      const table: Record<string, any> = node.styleOverrideTable ?? {}
      let inner: string
      if (overrides.length > 0 && Object.keys(table).length > 0) {
        const baseColor = fillToCss(node.fills) ?? "#000"
        const spans: string[] = []
        let i = 0
        while (i < chars.length) {
          const ov = overrides[i] ?? 0
          let j = i + 1
          while (j < chars.length && (overrides[j] ?? 0) === ov) j++
          const chunk = escapeHtml(chars.slice(i, j))
          if (ov === 0 || !table[String(ov)]) {
            spans.push(`<span>${chunk}</span>`)
          } else {
            const ovStyle = table[String(ov)]
            const color = fillToCss(ovStyle.fills) ?? baseColor
            const spanStyle = `color:${color}${ovStyle.fontWeight != null && ovStyle.fontWeight !== st.fontWeight ? `;font-weight:${ovStyle.fontWeight}` : ""}`
            spans.push(`<span style="${spanStyle}">${chunk}</span>`)
          }
          i = j
        }
        inner = spans.join("")
      } else {
        inner = escapeHtml(chars)
      }
      parts.push(`  <div data-figma-id="${node.id}" style="${s.join(";")}">${inner}</div>`)
      return
    }

    // Image fill → emit a real <img> (renders, and is bindable in the builder).
    const img = imageFill(node.fills, imageFills)
    if (img) {
      parts.push(
        `  <img data-figma-id="${node.id}" src="${img.url}" crossorigin="anonymous" style="${s.concat(`object-fit:${img.fit}`).join(";")}" />`
      )
      ;(node.children ?? []).forEach(walk)
      return
    }

    const bg = fillToCss(node.fills)
    if (bg) s.push(`background:${bg}`)
    parts.push(`  <div data-figma-id="${node.id}" style="${s.join(";")}"></div>`)
    ;(node.children ?? []).forEach(walk)
  }

  ;(root.children ?? []).forEach(walk)
  const rootBg = fillToCss(root.fills)
  const rootStyle = [
    "position:relative",
    `width:${Math.round(box.width)}px`,
    `height:${Math.round(box.height)}px`,
    "overflow:hidden",
    rootBg ? `background:${rootBg}` : "background:#ffffff",
  ].join(";")
  return `<div style="${rootStyle}">\n${parts.join("\n")}\n</div>`
}

// First solid fill as a #rrggbb hex (the canvas color inputs want hex), or null.
function solidHex(fills: any): string | null {
  if (!Array.isArray(fills)) return null
  const f = fills.find((x) => x?.visible !== false && x.type === "SOLID" && x.color)
  if (!f?.color) return null
  const h = (n: number) => Math.round(n * 255).toString(16).padStart(2, "0")
  return `#${h(f.color.r)}${h(f.color.g)}${h(f.color.b)}`
}

// First visible solid fill as rgba (includes fill.opacity and color.a), or null.
// Used for rendering (canvas fillStyle) where full opacity is needed.
function solidRgba(fills: any): string | null {
  if (!Array.isArray(fills)) return null
  const f = fills.find((x) => x?.visible !== false && x.type === "SOLID" && x.color)
  if (!f?.color) return null
  const { r, g, b, a } = f.color
  const alpha = (a ?? 1) * (f.opacity ?? 1)
  return `rgba(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)}, ${alpha})`
}

// Like solidRgba, but also approximates a gradient fill with its first stop color.
// Used for shape fill and layout background (canvas rendering).
function firstColor(fills: any): string | null {
  const solid = solidRgba(fills)
  if (solid) return solid
  if (!Array.isArray(fills)) return null
  const g = fills.find((x) => x?.visible !== false && typeof x?.type === "string" && x.type.startsWith("GRADIENT"))
  const stop = g?.gradientStops?.[0]?.color
  if (!stop) return null
  return `rgba(${Math.round(stop.r * 255)}, ${Math.round(stop.g * 255)}, ${Math.round(stop.b * 255)}, ${stop.a ?? 1})`
}

/** Converts visible Figma effects (drop shadows, blurs) to canvas LayerEffect objects. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractEffects(effects: any): any[] {
  if (!Array.isArray(effects)) return []
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const result: any[] = []
  for (const e of effects) {
    if (!e || e.visible === false) continue
    if (e.type === "DROP_SHADOW" && e.color) {
      const { r, g, b } = e.color
      const a = e.color.a ?? 1
      result.push({
        type: "drop-shadow",
        color: `rgba(${Math.round(r * 255)},${Math.round(g * 255)},${Math.round(b * 255)},${a})`,
        offsetX: e.offset?.x ?? 0,
        offsetY: e.offset?.y ?? 0,
        blur: e.radius ?? 0,
      })
    } else if (e.type === "LAYER_BLUR") {
      result.push({ type: "blur", radius: e.radius ?? 0 })
    }
  }
  return result
}

/**
 * Converts a Figma frame into our canvas Layout model (see /creative-template-create). Figma
 * containers (with children) become shape/group layers; TEXT → text layers;
 * image fills → image layers; everything else → rectangle/ellipse shapes.
 * Coordinates are relative to each node's parent.
 */
export function nodeToLayout(root: any, imageFills: Record<string, string> = {}, svgExports: Record<string, string> = {}): unknown {
  const box = root?.absoluteBoundingBox ?? { x: 0, y: 0, width: 800, height: 600 }

  const toLayer = (node: any, parentBox: any): any => {
    if (!node || node.visible === false) return null
    const b = node.absoluteBoundingBox
    if (!b) return null

    // absoluteBoundingBox is the axis-aligned box around the (already-rotated)
    // node, so for rotated nodes it's larger than the real size. Recover the true
    // W/H from the AABB + angle, and center the box so CSS rotate() reproduces it.
    let x = Math.round(b.x - parentBox.x)
    let y = Math.round(b.y - parentBox.y)
    let width = Math.round(b.width)
    let height = Math.round(b.height)
    if (node.rotation) {
      const c = Math.abs(Math.cos(node.rotation))
      const s = Math.abs(Math.sin(node.rotation))
      const det = c * c - s * s // = cos(2θ)
      if (Math.abs(det) > 0.05) {
        const w = (b.width * c - b.height * s) / det
        const h = (b.height * c - b.width * s) / det
        if (w > 0 && h > 0) {
          const cx = b.x - parentBox.x + b.width / 2
          const cy = b.y - parentBox.y + b.height / 2
          width = Math.round(w)
          height = Math.round(h)
          x = Math.round(cx - w / 2)
          y = Math.round(cy - h / 2)
        }
      }
    }

    const nodeEffects = extractEffects(node.effects)
    const base = {
      id: node.id,
      name: node.name ?? node.type ?? "Layer",
      x,
      y,
      width,
      height,
      // Figma rotation is in radians; convert to CSS rotate() degrees.
      rotation: node.rotation ? Math.round((node.rotation * 180) / Math.PI) : 0,
      opacity: typeof node.opacity === "number" ? node.opacity : 1,
      visible: true,
      locked: true,
      ...(nodeEffects.length > 0 ? { effects: nodeEffects } : {}),
    }

    // Vector nodes — emit as image layers using the pre-exported SVG.
    const svgSrc = svgExports[node.id]
    if (svgSrc || VECTOR_TYPES.has(node.type)) {
      if (!svgSrc) return null // no export available; skip
      return { ...base, type: "image", content: { src: svgSrc, fit: "contain", ...(node.cornerRadius ? { radius: node.cornerRadius } : {}) } }
    }

    if (node.type === "TEXT") {
      const s = node.style ?? {}
      const a = String(s.textAlignHorizontal ?? "LEFT")
      const textTransform =
        s.textCase === "UPPER" ? "uppercase" : s.textCase === "LOWER" ? "lowercase" : s.textCase === "TITLE" ? "capitalize" : undefined
      // WIDTH_AND_HEIGHT = single-line auto-sizing text in Figma; should never wrap.
      const noWrap = s.textAutoResize === "WIDTH_AND_HEIGHT"
      const baseColor = solidHex(node.fills) ?? "#111111"

      // Build per-run spans from Figma's character-level style override tables.
      const chars: string = node.characters ?? ""
      const overrideIndices: number[] = Array.isArray(node.characterStyleOverrides) ? node.characterStyleOverrides : []
      const overrideTable: Record<string, any> = node.styleOverrideTable ?? {}
      let spans: { text: string; color?: string; fontWeight?: number }[] | undefined
      if (overrideIndices.some((idx) => idx !== 0) && Object.keys(overrideTable).length > 0) {
        const runs: { text: string; color?: string; fontWeight?: number }[] = []
        let i = 0
        while (i < chars.length) {
          const ovIdx = overrideIndices[i] ?? 0
          let j = i + 1
          while (j < chars.length && (overrideIndices[j] ?? 0) === ovIdx) j++
          const runText = chars.slice(i, j)
          const ov = ovIdx !== 0 ? overrideTable[String(ovIdx)] : null
          const runColor = ov?.fills ? solidHex(ov.fills) ?? undefined : undefined
          const runWeight = ov?.fontWeight != null && ov.fontWeight !== s.fontWeight ? (ov.fontWeight as number) : undefined
          runs.push({ text: runText, ...(runColor && runColor !== baseColor ? { color: runColor } : {}), ...(runWeight !== undefined ? { fontWeight: runWeight } : {}) })
          i = j
        }
        if (runs.some((r) => r.color || r.fontWeight !== undefined)) spans = runs
      }

      return {
        ...base,
        type: "text",
        content: {
          text: chars,
          fontFamily: s.fontFamily ? `${s.fontFamily}, sans-serif` : "Inter, sans-serif",
          fontSize: Math.round(s.fontSize ?? 16),
          fontWeight: s.fontWeight ?? 400,
          color: baseColor,
          align: a === "CENTER" ? "center" : a === "RIGHT" ? "right" : "left",
          lineHeight: s.lineHeightPx && s.fontSize ? Number((s.lineHeightPx / s.fontSize).toFixed(2)) : 1.2,
          ...(textTransform ? { textTransform } : {}),
          ...(noWrap ? { noWrap: true } : {}),
          ...(spans ? { spans } : {}),
        },
      }
    }

    const kids = Array.isArray(node.children) ? node.children.filter((c: any) => c?.visible !== false) : []
    const img = imageFill(node.fills, imageFills)
    const isEllipse = node.type === "ELLIPSE"
    const shapeContent = {
      shape: isEllipse ? "ellipse" : "rectangle",
      fillType: img ? "image" : firstColor(node.fills) ? "color" : "none",
      fill: firstColor(node.fills) ?? "#6366f1",
      src: img?.url ?? "",
      imageFit: img?.fit ?? "cover",
      stroke: solidHex(node.strokes) ?? "#000000",
      // Only carry a stroke width when there's an actual stroke (frames often have
      // strokeWeight:1 with no strokes, which would draw phantom borders).
      strokeWidth: solidHex(node.strokes) ? node.strokeWeight ?? 0 : 0,
      radius: typeof node.cornerRadius === "number" ? node.cornerRadius : 0,
    }

    if (kids.length > 0) {
      return { ...base, type: "shape", content: shapeContent, children: kids.map((c: any) => toLayer(c, b)).filter(Boolean) }
    }
    if (img) {
      return { ...base, type: "image", content: { src: img.url, fit: img.fit, ...(node.cornerRadius ? { radius: node.cornerRadius } : {}) } }
    }
    return { ...base, type: "shape", content: shapeContent, children: [] }
  }

  return {
    version: 1,
    name: root?.name ?? "Imported layout",
    width: Math.round(box.width),
    height: Math.round(box.height),
    background: firstColor(root?.fills) ?? "#ffffff",
    layers: (root?.children ?? []).map((c: any) => toLayer(c, box)).filter(Boolean),
  }
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** Converts a raw Figma node into the compact tree the panel renders. */
export function toTree(node: RawNode, depth = 0): FigmaTreeNode {
  const out: FigmaTreeNode = {
    fpid: node.id,
    tag: (node.type ?? "NODE").toLowerCase(),
    name: node.name ?? "",
    box: node.absoluteBoundingBox ?? undefined,
    children: [],
  }
  if (node.type === "TEXT" && node.characters) {
    out.text = node.characters
    out.textStyle = node.style
    out.color = solidRgba(node.fills) ?? undefined // text color
  } else {
    out.bg = solidRgba(node.fills) ?? undefined // container background
  }
  if (depth < 60 && Array.isArray(node.children)) {
    out.children = node.children.map((c) => toTree(c, depth + 1))
  }
  return out
}
