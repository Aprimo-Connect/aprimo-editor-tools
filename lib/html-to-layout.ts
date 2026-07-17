import type { Fit, ImageLayer, ButtonLayer, TextLayer, ShapeLayer, TextSpan, Layer, LayerBase, Layout } from "@/lib/creative-template-render"

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`)

const INLINE_TAGS  = new Set(["SPAN", "A", "B", "I", "STRONG", "EM", "MARK", "SMALL", "SUB", "SUP", "CODE", "TIME", "ABBR"])
const TEXT_TAGS    = new Set(["H1", "H2", "H3", "H4", "H5", "H6", "P", "A", "LI", "DT", "DD", "FIGCAPTION", "BLOCKQUOTE", "CITE", "LABEL", "CAPTION", "TD", "TH"])
const BUTTON_TAGS  = new Set(["BUTTON"])
const SKIP_TAGS    = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "HEAD", "META", "LINK", "TITLE"])

// Inserts the HTML into the live DOM off-screen so the browser performs real layout,
// then uses getBoundingClientRect + getComputedStyle to get accurate positions and
// cascaded style values. Each container becomes a ShapeLayer with children nested inside.
export function htmlToLayout(html: string, canvasWidth: number, canvasHeight: number): Layout {
  const host = document.createElement("div")
  host.style.cssText = `position:fixed;left:${-(canvasWidth + 200)}px;top:0;width:${canvasWidth}px;height:${canvasHeight}px;overflow:hidden;pointer-events:none;opacity:0`
  host.innerHTML = html
  document.body.appendChild(host)

  try {
    const maybeRoot = host.firstElementChild instanceof HTMLElement ? host.firstElementChild : null
    const root: HTMLElement = (maybeRoot && (maybeRoot.style.width || maybeRoot.style.position)) ? maybeRoot : host
    const rootRect = root.getBoundingClientRect()

    const rootCs = getComputedStyle(root)
    const rawBg = root.style.background || root.style.backgroundColor || rootCs.background || "#ffffff"
    const width = Math.round(rootRect.width) || canvasWidth
    const height = Math.round(rootRect.height) || canvasHeight

    let textN = 0, imageN = 0, shapeN = 0

    const walkEl = (el: HTMLElement, parentRect: DOMRect): Layer | null => {
      if (SKIP_TAGS.has(el.tagName)) return null
      const rect = el.getBoundingClientRect()
      const w = Math.round(rect.width)
      const h = Math.round(rect.height)
      if (w <= 0 || h <= 0) return null

      const x = Math.round(rect.left - parentRect.left)
      const y = Math.round(rect.top - parentRect.top)
      const cs = getComputedStyle(el)
      const opRaw = parseFloat(el.style.opacity || cs.opacity)
      const opacity = isNaN(opRaw) ? 1 : opRaw
      const id = uid()
      const base: LayerBase = { id, name: id, x, y, width: w, height: h, rotation: 0, opacity, visible: true, locked: true }

      if (el.tagName === "IMG") {
        imageN++
        return {
          ...base, name: `Image ${imageN}`, type: "image",
          content: { src: (el as HTMLImageElement).src || el.getAttribute("src") || "", fit: (cs.objectFit as Fit) || "cover" },
        } as ImageLayer
      }

      const bgImage = el.style.backgroundImage || cs.backgroundImage || ""
      const bgUrlMatch = bgImage.match(/url\(['"]?([^'")\s]+)['"]?\)/)
      if (bgUrlMatch) {
        imageN++
        const fit: Fit = cs.backgroundSize === "contain" ? "contain" : cs.backgroundSize === "100% 100%" ? "fill" : "cover"
        return { ...base, name: `Image ${imageN}`, type: "image", content: { src: bgUrlMatch[1], fit } } as ImageLayer
      }

      const text = (el.textContent ?? "").replace(/\s+/g, " ").trim()
      const isLeafEl = el.childElementCount === 0
      const onlyInlineEl = el.childElementCount > 0 && [...el.children].every(c => INLINE_TAGS.has(c.tagName))
      const hasBg = (() => {
        const bg = el.style.backgroundColor || el.style.background || cs.backgroundColor || cs.background || ""
        return bg && bg !== "transparent" && bg !== "rgba(0, 0, 0, 0)"
      })()
      const isButtonLike = BUTTON_TAGS.has(el.tagName)
        || ((isLeafEl || onlyInlineEl) && cs.cursor === "pointer" && hasBg && text.length > 0 && h <= 80)
      if (isButtonLike && text) {
        const btnN = ++textN
        const fsRaw2 = parseFloat(cs.fontSize)
        return {
          ...base, name: `Button ${btnN}`, type: "button",
          content: {
            label: text || "Button",
            fontFamily: cs.fontFamily || "Inter, sans-serif",
            fontSize: Math.round(fsRaw2) || 14,
            fontWeight: parseInt(cs.fontWeight) || 600,
            color: cs.color || "#ffffff",
            background: el.style.background || el.style.backgroundColor || cs.backgroundColor || "#333333",
            radius: parseFloat(cs.borderRadius) || 8,
          },
        } as ButtonLayer
      }

      const isTextTag = TEXT_TAGS.has(el.tagName)
      if ((isTextTag || isLeafEl || onlyInlineEl) && text) {
        textN++
        const fsRaw = parseFloat(cs.fontSize)
        const lhRaw = parseFloat(cs.lineHeight)
        const lh = !isNaN(lhRaw) && !isNaN(fsRaw) && fsRaw > 0 ? lhRaw / fsRaw : 1.2
        const align = cs.textAlign === "center" ? "center" : cs.textAlign === "right" ? "right" : "left"
        let spans: TextSpan[] | undefined
        if (onlyInlineEl && el.childElementCount > 0) {
          const runs: TextSpan[] = []
          for (const child of el.children) {
            const sc = getComputedStyle(child as HTMLElement)
            const runText = (child.textContent ?? "").replace(/\s+/g, " ")
            if (!runText) continue
            const runColor = sc.color !== cs.color ? sc.color : undefined
            const runWeight = sc.fontWeight !== cs.fontWeight ? parseInt(sc.fontWeight) || undefined : undefined
            runs.push({ text: runText, ...(runColor ? { color: runColor } : {}), ...(runWeight !== undefined ? { fontWeight: runWeight } : {}) })
          }
          if (runs.some((s) => s.color || s.fontWeight !== undefined)) spans = runs
        }
        return {
          ...base, name: `Text ${textN}`, type: "text",
          content: {
            text,
            fontFamily: cs.fontFamily || "Inter, sans-serif",
            fontSize: Math.round(fsRaw) || 16,
            fontWeight: parseInt(cs.fontWeight) || 400,
            color: cs.color || "#111111",
            align,
            lineHeight: Math.max(0.5, lh),
            ...(cs.textTransform && cs.textTransform !== "none" ? { textTransform: cs.textTransform } : {}),
            ...(spans ? { spans } : {}),
          },
        } as TextLayer
      }

      shapeN++
      const fill = el.style.background || el.style.backgroundColor || cs.backgroundColor || ""
      const isTransparent = !fill || fill === "transparent" || fill === "rgba(0, 0, 0, 0)"
      const borderRadius = parseFloat(cs.borderRadius) || 0
      const isEllipse = cs.borderRadius === "50%" || (borderRadius > 0 && borderRadius >= Math.min(w, h) / 2)
      const bw = parseFloat(cs.borderTopWidth) || 0
      const bColor = cs.borderTopColor || "#000000"

      const children: Layer[] = []
      for (const child of el.children) {
        if (!(child instanceof HTMLElement)) continue
        const cl = walkEl(child, rect)
        if (cl) children.push(cl)
      }

      return {
        ...base, name: `Shape ${shapeN}`, type: "shape",
        content: {
          shape: isEllipse ? "ellipse" : "rectangle",
          fillType: isTransparent ? "none" : "color",
          fill: isTransparent ? "#eeeeee" : fill,
          src: "", imageFit: "cover",
          stroke: bColor,
          strokeWidth: bw,
          radius: isEllipse ? 0 : borderRadius,
        },
        children,
      } as ShapeLayer
    }

    const layers: Layer[] = []
    for (const child of root.children) {
      if (!(child instanceof HTMLElement)) continue
      const layer = walkEl(child, rootRect)
      if (layer) layers.push(layer)
    }

    return { version: 1, name: "Imported from HTML", width, height, background: rawBg, layers }
  } finally {
    document.body.removeChild(host)
  }
}
