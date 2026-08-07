import type { ButtonLayer, ImageLayer, Layer, Layout, ShapeLayer, TextLayer, TextSpan, TextContent, ImageContent, ShapeContent, ButtonContent } from "@/lib/creative-template-render"

export type AnyContent = TextContent & ImageContent & ShapeContent & ButtonContent
export type FieldDef = { id: string; name: string; label: string; scope: string; memberships: string[] }

// ── Theme tokens ──────────────────────────────────────────────────────────────

export const M = {
  foreground: "#181410",
  primaryColor: "#2E5D4B",
  secondaryColor: "#8AA68F",
  accentColor: "#E8B93B",
  display: "Fraunces, Georgia, serif",
  sans: "Inter, system-ui, sans-serif",
  mono: '"JetBrains Mono", monospace',
}
export type ColorKey = keyof Pick<typeof M, "foreground" | "primaryColor" | "secondaryColor" | "accentColor">
export const alpha = (token: ColorKey, pct: number) =>
  `color-mix(in srgb, ${M[token]} ${pct}%, transparent)`

// ── ID generation ─────────────────────────────────────────────────────────────

export const uid = () =>
  (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`)

// ── Recursive layer tree helpers ──────────────────────────────────────────────

export function findLayer(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l
    if (l.type === "shape") {
      const f = findLayer(l.children, id)
      if (f) return f
    }
  }
  return null
}

export function absolutePos(layers: Layer[], id: string, ox = 0, oy = 0): { x: number; y: number } | null {
  for (const l of layers) {
    if (l.id === id) return { x: ox + l.x, y: oy + l.y }
    if (l.type === "shape") {
      const found = absolutePos(l.children, id, ox + l.x, oy + l.y)
      if (found) return found
    }
  }
  return null
}

export function updateLayers(layers: Layer[], id: string, fn: (l: Layer) => Layer): Layer[] {
  return layers.map((l) => {
    if (l.id === id) return fn(l)
    if (l.type === "shape") return { ...l, children: updateLayers(l.children, id, fn) }
    return l
  })
}

export function removeFromLayers(layers: Layer[], id: string): Layer[] {
  return layers
    .filter((l) => l.id !== id)
    .map((l) => (l.type === "shape" ? { ...l, children: removeFromLayers(l.children, id) } : l))
}

export function reorderInLayers(layers: Layer[], id: string, dir: -1 | 1): Layer[] {
  const i = layers.findIndex((l) => l.id === id)
  if (i >= 0) {
    const j = i + dir
    if (j < 0 || j >= layers.length) return layers
    const next = [...layers]
    ;[next[i], next[j]] = [next[j], next[i]]
    return next
  }
  return layers.map((l) => (l.type === "shape" ? { ...l, children: reorderInLayers(l.children, id, dir) } : l))
}

export function addChildTo(layers: Layer[], parentId: string, child: Layer): Layer[] {
  return layers.map((l) => {
    if (l.type !== "shape") return l
    if (l.id === parentId) return { ...l, children: [...l.children, child] }
    return { ...l, children: addChildTo(l.children, parentId, child) }
  })
}

export function indentLayer(layers: Layer[], id: string): Layer[] {
  const i = layers.findIndex((l) => l.id === id)
  const prev = i > 0 ? layers[i - 1] : null
  if (i > 0 && prev && prev.type === "shape") {
    const layer = layers[i]
    const adjusted = { ...layer, x: layer.x - prev.x, y: layer.y - prev.y } as Layer
    const updatedPrev: Layer = { ...prev, children: [...prev.children, adjusted] }
    return layers.map((l, idx) => (idx === i - 1 ? updatedPrev : l)).filter((_, idx) => idx !== i)
  }
  if (i >= 0) return layers
  return layers.map((l) => (l.type === "shape" ? { ...l, children: indentLayer(l.children, id) } : l))
}

export function outdentLayer(layers: Layer[], id: string): Layer[] {
  const out: Layer[] = []
  for (const l of layers) {
    if (l.type === "shape") {
      const ci = l.children.findIndex((c) => c.id === id)
      if (ci >= 0) {
        const child = l.children[ci]
        out.push({ ...l, children: l.children.filter((_, idx) => idx !== ci) })
        out.push({ ...child, x: child.x + l.x, y: child.y + l.y } as Layer)
      } else {
        out.push({ ...l, children: outdentLayer(l.children, id) })
      }
    } else {
      out.push(l)
    }
  }
  return out
}

// ── Text helpers ──────────────────────────────────────────────────────────────

export const TEXT_FIELD_TYPES = new Set(["SingleLineText", "MultiLineText", "RichText", "Html"])

export function splitIntoRuns(text: string, color: string): TextSpan[] {
  const mid = Math.max(1, Math.ceil(text.length / 2))
  return [{ text: text.slice(0, mid), color }, { text: text.slice(mid), color }]
}

// ── Default layout + layer factories ─────────────────────────────────────────

export const INITIAL: Layout = {
  version: 1,
  name: "Untitled layout",
  width: 800,
  height: 600,
  background: "#ffffff",
  layers: [],
}

export function newTextLayer(n: number): TextLayer {
  return {
    id: uid(), name: `Text ${n}`, type: "text",
    x: 60, y: 60, width: 320, height: 60,
    rotation: 0, opacity: 1, visible: true, locked: true,
    content: {
      text: "New text", fontFamily: "Inter, sans-serif",
      fontSize: 28, fontWeight: 600, color: "#111111",
      align: "left", lineHeight: 1.2,
    },
  }
}

export function newImageLayer(n: number): ImageLayer {
  return {
    id: uid(), name: `Image ${n}`, type: "image",
    x: 60, y: 60, width: 240, height: 180,
    rotation: 0, opacity: 1, visible: true, locked: true,
    content: { src: "", fit: "cover" },
  }
}

export function newShapeLayer(n: number): ShapeLayer {
  return {
    id: uid(), name: `Shape ${n}`, type: "shape",
    x: 60, y: 60, width: 200, height: 200,
    rotation: 0, opacity: 1, visible: true, locked: true,
    content: {
      shape: "rectangle", fillType: "color", fill: "#6366f1", src: "",
      imageFit: "cover", stroke: "#000000", strokeWidth: 0, radius: 8,
    },
    children: [],
  }
}

export function newButtonLayer(n: number): ButtonLayer {
  return {
    id: uid(), name: `Button ${n}`, type: "button",
    x: 60, y: 60, width: 160, height: 44,
    rotation: 0, opacity: 1, visible: true, locked: true,
    content: {
      label: "Button", fontFamily: "Inter, sans-serif",
      fontSize: 16, fontWeight: 600, color: "#ffffff",
      background: "#6366f1", radius: 8,
    },
  }
}
