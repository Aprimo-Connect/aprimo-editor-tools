"use client"

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import {
  ArrowDown,
  ArrowUp,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Code2,
  Minus,
  Plus,
  Eye,
  EyeOff,
  Image as ImageIcon,
  IndentDecrease,
  IndentIncrease,
  Layers,
  Lock,
  LockOpen,
  MousePointerClick,
  Save,
  Square,
  Trash2,
  Type,
  X,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { Expander } from "aprimo-js"
import { useAprimo } from "@/context/aprimo-context"
const M = { ink: "#181410", paper: "#F6F3EC", clay: "#2E5D4B", moss: "#8AA68F", sun: "#E8B93B", display: "Fraunces, Georgia, serif", sans: "Inter, system-ui, sans-serif", mono: '"JetBrains Mono", monospace' }
type ColorKey = "ink" | "paper" | "clay" | "moss" | "sun"
const PALETTE: Record<ColorKey, string> = { ink: "#181410", paper: "#F6F3EC", clay: "#2E5D4B", moss: "#8AA68F", sun: "#E8B93B" }
const alpha = (token: ColorKey, pct: number) => `color-mix(in srgb, ${PALETTE[token]} ${pct}%, transparent)`
import { drawLayout as canvasDrawLayout } from "@/lib/creative-template-render"
import { htmlToLayout } from "@/lib/html-to-layout"

/**
 * Content abstraction (the point of this page): a Layout is an ordered stack of
 * Layers. Geometry is common; `content` holds only the type-specific payload,
 * kept separate so a template builder can later swap a literal value for an
 * Aprimo binding without touching layout/geometry.
 */
type Align = "left" | "center" | "right"
type Fit = "cover" | "contain" | "fill"

type LayerBase = {
  id: string
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  opacity: number
  visible: boolean
  locked: boolean
}
// A single styled run within a text layer. Absent fields fall back to the
// parent TextContent values, so only overrides need to be stored.
type TextSpan = {
  text: string
  color?: string
  fontWeight?: number
}

type TextContent = {
  text: string           // full plain-text fallback (always kept in sync)
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  align: Align
  lineHeight: number
  textTransform?: string
  noWrap?: boolean       // true → white-space: nowrap (single-line auto-resize text)
  spans?: TextSpan[]     // present when the text has per-run color/weight overrides
  aprimoField?: { id: string; name: string } // field binding — filled from source asset at fill time
}
type ImageContent = {
  src: string
  fit: Fit
  source?: "asset" | "free"
}
type ShapeContent = {
  shape: "rectangle" | "ellipse"
  fillType: "color" | "none" | "image" // "none" = transparent
  fill: string // color when fillType === "color"
  src: string // image url when fillType === "image"
  imageFit: Fit
  stroke: string
  strokeWidth: number
  radius: number
}
type ButtonContent = {
  label: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  color: string
  background: string
  radius: number
}
type TextLayer = LayerBase & { type: "text"; content: TextContent }
type ImageLayer = LayerBase & { type: "image"; content: ImageContent }
// Shapes double as containers/groups: children are positioned relative to the shape.
type ShapeLayer = LayerBase & { type: "shape"; content: ShapeContent; children: Layer[] }
type ButtonLayer = LayerBase & { type: "button"; content: ButtonContent }
type Layer = TextLayer | ImageLayer | ShapeLayer | ButtonLayer
type AnyContent = TextContent & ImageContent & ShapeContent & ButtonContent

type Layout = {
  version: 1
  name: string
  width: number
  height: number
  background: string
  layers: Layer[] // paint order: index 0 = back, last = front
}

type FigmaFrame = { id: string; name: string; type: string }
type FigmaPage = { id: string; name: string; frames: FigmaFrame[] }

const uid = () => (globalThis.crypto?.randomUUID?.() ?? `id-${Date.now()}-${Math.round(Math.random() * 1e6)}`)

// Normalise any CSS color string to #rrggbb for <input type="color">.
function toHex(color: string): string {
  if (!color) return "#000000"
  if (color.startsWith("#")) return color.length >= 7 ? color.slice(0, 7) : color
  const m = color.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/)
  if (!m) return "#000000"
  return "#" + [m[1], m[2], m[3]].map((n) => parseInt(n).toString(16).padStart(2, "0")).join("")
}

// Recursive tree helpers (shapes can contain children).
function findLayer(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l
    if (l.type === "shape") {
      const f = findLayer(l.children, id)
      if (f) return f
    }
  }
  return null
}
// Returns the canvas-absolute top-left of a layer, accumulating parent shape offsets.
function absolutePos(layers: Layer[], id: string, ox = 0, oy = 0): { x: number; y: number } | null {
  for (const l of layers) {
    if (l.id === id) return { x: ox + l.x, y: oy + l.y }
    if (l.type === "shape") {
      const found = absolutePos(l.children, id, ox + l.x, oy + l.y)
      if (found) return found
    }
  }
  return null
}
function updateLayers(layers: Layer[], id: string, fn: (l: Layer) => Layer): Layer[] {
  return layers.map((l) => {
    if (l.id === id) return fn(l)
    if (l.type === "shape") return { ...l, children: updateLayers(l.children, id, fn) }
    return l
  })
}
function removeFromLayers(layers: Layer[], id: string): Layer[] {
  return layers
    .filter((l) => l.id !== id)
    .map((l) => (l.type === "shape" ? { ...l, children: removeFromLayers(l.children, id) } : l))
}
function reorderInLayers(layers: Layer[], id: string, dir: -1 | 1): Layer[] {
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
function addChildTo(layers: Layer[], parentId: string, child: Layer): Layer[] {
  return layers.map((l) => {
    if (l.type !== "shape") return l
    if (l.id === parentId) return { ...l, children: [...l.children, child] }
    return { ...l, children: addChildTo(l.children, parentId, child) }
  })
}
// Move a layer INTO the shape immediately before it (same list). Coordinates are
// converted so the layer stays put visually.
function indentLayer(layers: Layer[], id: string): Layer[] {
  const i = layers.findIndex((l) => l.id === id)
  const prev = i > 0 ? layers[i - 1] : null
  if (i > 0 && prev && prev.type === "shape") {
    const layer = layers[i]
    const adjusted = { ...layer, x: layer.x - prev.x, y: layer.y - prev.y } as Layer
    const updatedPrev: Layer = { ...prev, children: [...prev.children, adjusted] }
    return layers.map((l, idx) => (idx === i - 1 ? updatedPrev : l)).filter((_, idx) => idx !== i)
  }
  if (i >= 0) return layers // present here but can't indent
  return layers.map((l) => (l.type === "shape" ? { ...l, children: indentLayer(l.children, id) } : l))
}
// Move a layer OUT of its parent shape, into the grandparent list right after it.
function outdentLayer(layers: Layer[], id: string): Layer[] {
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


const TEXT_FIELD_TYPES = new Set(["SingleLineText", "MultiLineText", "RichText", "Html"])

// Split a text string into two color runs at its midpoint.
function splitIntoRuns(text: string, color: string): TextSpan[] {
  const mid = Math.max(1, Math.ceil(text.length / 2))
  return [{ text: text.slice(0, mid), color }, { text: text.slice(mid), color }]
}


const INITIAL: Layout = {
  version: 1,
  name: "Untitled layout",
  width: 800,
  height: 600,
  background: "#ffffff",
  layers: [],
}

function newTextLayer(n: number): TextLayer {
  return {
    id: uid(),
    name: `Text ${n}`,
    type: "text",
    x: 60,
    y: 60,
    width: 320,
    height: 60,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
    content: {
      text: "New text",
      fontFamily: "Inter, sans-serif",
      fontSize: 28,
      fontWeight: 600,
      color: "#111111",
      align: "left",
      lineHeight: 1.2,
    },
  }
}
function newImageLayer(n: number): ImageLayer {
  return {
    id: uid(),
    name: `Image ${n}`,
    type: "image",
    x: 60,
    y: 60,
    width: 240,
    height: 180,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
    content: { src: "", fit: "cover" },
  }
}
function newShapeLayer(n: number): ShapeLayer {
  return {
    id: uid(),
    name: `Shape ${n}`,
    type: "shape",
    x: 60,
    y: 60,
    width: 200,
    height: 200,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
    content: {
      shape: "rectangle",
      fillType: "color",
      fill: "#6366f1",
      src: "",
      imageFit: "cover",
      stroke: "#000000",
      strokeWidth: 0,
      radius: 8,
    },
    children: [],
  }
}
function newButtonLayer(n: number): ButtonLayer {
  return {
    id: uid(),
    name: `Button ${n}`,
    type: "button",
    x: 60,
    y: 60,
    width: 160,
    height: 44,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: true,
    content: {
      label: "Button",
      fontFamily: "Inter, sans-serif",
      fontSize: 16,
      fontWeight: 600,
      color: "#ffffff",
      background: "#6366f1",
      radius: 8,
    },
  }
}

// Inline text editor — overlaid directly on the canvas text layer.
// Separate component so it can own the escape/blur logic via a local ref.
function InlineTextEditor({
  layer,
  onSave,
  onCancel,
}: {
  layer: TextLayer
  onSave: (text: string) => void
  onCancel: () => void
}) {
  const didEscape = useRef(false)
  return (
    <textarea
      autoFocus
      defaultValue={layer.content.text}
      onKeyDown={(e) => {
        if (e.key === "Escape") { didEscape.current = true; onCancel() }
        e.stopPropagation()
      }}
      onBlur={(e) => { if (!didEscape.current) onSave(e.target.value) }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        background: "rgba(255,255,255,0.90)",
        border: `2px solid ${M.clay}`,
        borderRadius: 4,
        padding: 4,
        fontFamily: layer.content.fontFamily,
        fontSize: layer.content.fontSize,
        fontWeight: layer.content.fontWeight,
        color: layer.content.color,
        lineHeight: layer.content.lineHeight,
        resize: "none",
        outline: "none",
        cursor: "text",
        zIndex: 10,
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}

export default function CreateTemplatePage() {
  return <Suspense><CanvasPage /></Suspense>
}

function CanvasPage() {
  const searchParams = useSearchParams()
  const { client, connection } = useAprimo()

  // Multi-canvas: each tab is an independent Layout.
  const [layouts, setLayouts] = useState<Layout[]>([INITIAL])
  const [activeIdx, setActiveIdx] = useState(0)

  // Derived active layout + a stable setLayout that writes only the active slot.
  // Using a ref for activeIdx so setLayout never needs to be recreated.
  const activeIdxRef = useRef(activeIdx)
  activeIdxRef.current = activeIdx
  const layout = layouts[activeIdx] ?? INITIAL
  const setLayout = useCallback((valOrFn: Layout | ((prev: Layout) => Layout)) => {
    setLayouts((prev) => {
      const next = [...prev]
      const idx = activeIdxRef.current
      const cur = next[idx] ?? INITIAL
      next[idx] = typeof valOrFn === "function" ? valOrFn(cur) : valOrFn
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // stable — activeIdx read through ref inside the updater

  const addCanvas = useCallback(() => {
    setLayouts((prev) => {
      const next = [...prev, { ...INITIAL, name: `Canvas ${prev.length + 1}` }]
      setActiveIdx(next.length - 1)
      return next
    })
    setSelectedId(null)
  }, [])

  const removeCanvas = useCallback((idx: number) => {
    setLayouts((prev) => {
      if (prev.length <= 1) return prev
      const next = prev.filter((_, i) => i !== idx)
      setActiveIdx((cur) => Math.min(cur, next.length - 1))
      setSelectedId(null)
      return next
    })
  }, [])

  const switchCanvas = useCallback((idx: number) => {
    setActiveIdx(idx)
    setSelectedId(null)
  }, [])

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showJson, setShowJson] = useState(false)
  const [collapsedShapes, setCollapsedShapes] = useState<Set<string>>(new Set())
  const toggleCollapsed = useCallback((id: string) => {
    setCollapsedShapes((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }, [])

  const [layersOpen, setLayersOpen] = useState(true)
  const [layersWidth, setLayersWidth] = useState(256)
  const [propertiesOpen, setPropertiesOpen] = useState(true)

  const [zoom, setZoom] = useState<number | null>(null)
  const displayScale = zoom ?? 1
  const zoomIn  = useCallback(() => setZoom((z) => Math.min(4,   Math.round(((z ?? 1) + 0.1) * 100) / 100)), [])
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.1, Math.round(((z ?? 1) - 0.1) * 100) / 100)), [])

  const onLayersResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startWidth = layersWidth
    const onMove = (ev: MouseEvent) => setLayersWidth(Math.max(150, Math.min(600, startWidth + (ev.clientX - startX))))
    const onUp = () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp) }
    window.addEventListener("mousemove", onMove)
    window.addEventListener("mouseup", onUp)
  }, [layersWidth])

  // Keep layouts in a ref so saveToAprimo always reads the latest without being recreated.
  const layoutsRef = useRef(layouts)
  layoutsRef.current = layouts
  const [savingTemplate, setSavingTemplate] = useState(false)
  const [savedRecordId, setSavedRecordId] = useState<string | null>(null)
  const savedRecordIdRef = useRef<string | null>(null)
  savedRecordIdRef.current = savedRecordId
  const [loadingItem, setLoadingItem] = useState(false)
  const hasLoadedItem = useRef(false)

  const [sourceContentTypeId, setSourceContentTypeId] = useState("")
  const [sourceContentTypeName, setSourceContentTypeName] = useState("")
  const sourceContentTypeIdRef = useRef(sourceContentTypeId)
  sourceContentTypeIdRef.current = sourceContentTypeId
  const sourceContentTypeNameRef = useRef(sourceContentTypeName)
  sourceContentTypeNameRef.current = sourceContentTypeName

  const saveToAprimo = useCallback(async () => {
    if (!client) { toast.error("Not connected to Aprimo."); return }

    const contentType = process.env.NEXT_PUBLIC_CANVAS_TEMPLATE_CONTENT_TYPE
    const jsonFieldName = process.env.NEXT_PUBLIC_CANVAS_TEMPLATE_JSON_FIELD
    const classificationId = process.env.NEXT_PUBLIC_CANVAS_TEMPLATE_CLASSIFICATION_ID
    if (!contentType) { toast.error("NEXT_PUBLIC_CANVAS_TEMPLATE_CONTENT_TYPE is not configured."); return }
    if (!classificationId) { toast.error("NEXT_PUBLIC_CANVAS_TEMPLATE_CLASSIFICATION_ID is not configured."); return }

    setSavingTemplate(true)
    try {
      // Export the active canvas as a PNG preview/master file.
      const canvas = canvasRef.current
      if (!canvas) throw new Error("Canvas not ready.")
      const pngBlob = await new Promise<Blob>((resolve, reject) =>
        canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Canvas export failed."))), "image/png")
      )
      const layoutName = layoutsRef.current[0]?.name ?? "Untitled"
      const safeTitle = layoutName.replace(/[^a-z0-9\-_ ]/gi, "_")
      const filename = `${safeTitle}.png`
      const file = new File([pngBlob], filename, { type: "image/png" })

      const uploadResult = await client.uploader.uploadFile(file, { parallelLimit: 4 })
      if (!uploadResult.ok) throw new Error(uploadResult.error?.message ?? "Upload failed.")
      const token = uploadResult.data!.token

      // Resolve the JSON field name → field definition ID (same pattern as video-studio).
      let jsonFieldId: string | null = null
      if (jsonFieldName) {
        outer: for await (const result of client.fieldDefinitions.getPaged()) {
          if (!result.ok) break
          const items = (result.data?.items ?? []) as unknown as { id: string; name: string }[]
          for (const item of items) {
            if (item.name === jsonFieldName) { jsonFieldId = item.id; break outer }
          }
        }
      }

      const jsonValue = JSON.stringify({
        version: 1,
        ...(sourceContentTypeIdRef.current && {
          sourceContentTypeId: sourceContentTypeIdRef.current,
          sourceContentTypeName: sourceContentTypeNameRef.current,
        }),
        layouts: layoutsRef.current,
      })
      const existingId = savedRecordIdRef.current

      if (existingId) {
        // Re-save: update the existing record's file + JSON field.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const expander = (Expander as any).create().for("Record").expand("masterfile")
        const recRes = await client.records.getById(existingId, expander as never)
        if (!recRes.ok) throw new Error("Failed to fetch existing record.")
        const masterFileId = (recRes.data as unknown as { _embedded?: { masterfile?: { id?: string } } })
          ?._embedded?.masterfile?.id
        if (!masterFileId) throw new Error("Could not determine master file ID.")

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const updateBody: any = {
          files: { addOrUpdate: [{ id: masterFileId, versions: { addOrUpdate: [{ id: token, fileName: filename }] } }] },
        }
        if (jsonFieldId) updateBody.fields = { addOrUpdate: [{ id: jsonFieldId, localizedValues: [{ value: jsonValue }] }] }
        const updateRes = await client.records.update(existingId, updateBody as never)
        if (!updateRes.ok) throw new Error((updateRes as { error?: { message?: string } }).error?.message ?? "Failed to update record.")
        toast.success("Template updated in Aprimo.")
      } else {
        // First save: create a new Aprimo record.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const recordBody: any = {
          title: safeTitle,
          contentType,
          classifications: { addOrUpdate: [{ id: classificationId }] },
          files: { master: token, addOrUpdate: [{ versions: { addOrUpdate: [{ id: token, fileName: filename }] } }] },
        }
        if (jsonFieldId) recordBody.fields = { addOrUpdate: [{ id: jsonFieldId, localizedValues: [{ value: jsonValue }] }] }

        const createRes = await client.records.create(recordBody as never)
        if (!createRes.ok) throw new Error((createRes as { error?: { message?: string } }).error?.message ?? "Failed to create record.")
        const recordId = (createRes.data as { id?: string })?.id ?? null
        setSavedRecordId(recordId)

        const recordUrl = recordId && connection
          ? `https://${connection.environment}.dam.aprimo.com/dam/contentitems/${recordId.replace(/-/g, "")}`
          : undefined
        toast.success("Template saved to Aprimo.", {
          action: recordUrl ? { label: "View", onClick: () => window.open(recordUrl, "_blank") } : undefined,
        })
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save to Aprimo.")
    } finally {
      setSavingTemplate(false)
    }
  }, [client, connection])

  // Cmd/Ctrl+S → save
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "s") { e.preventDefault(); void saveToAprimo() }
    }
    window.addEventListener("keydown", handler)
    return () => window.removeEventListener("keydown", handler)
  }, [saveToAprimo])

  // Canvas renderer — redraws the active layout whenever it changes.
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    void canvasDrawLayout(ctx, layout)
  }, [layout])

  const [htmlModalOpen, setHtmlModalOpen] = useState(false)
  const [htmlSource, setHtmlSource] = useState("")

  // Figma import modal state
  const [figmaModalOpen, setFigmaModalOpen] = useState(false)
  const [figmaUrl, setFigmaUrl] = useState("")
  const [figmaConnected, setFigmaConnected] = useState<boolean | null>(null)
  const [figmaPages, setFigmaPages] = useState<FigmaPage[] | null>(null)
  const [figmaSelectedIds, setFigmaSelectedIds] = useState<Set<string>>(new Set())
  const [figmaFinding, setFigmaFinding] = useState(false)
  const [figmaImporting, setFigmaImporting] = useState(false)

  // After OAuth redirect: auto-open the Figma modal (or show error).
  useEffect(() => {
    if (searchParams.get("figma_connected")) {
      setFigmaModalOpen(true)
      window.history.replaceState({}, "", "/creative-template-create")
    }
    const err = searchParams.get("figma_error")
    if (err) {
      toast.error(`Figma connection failed: ${err}`)
      window.history.replaceState({}, "", "/creative-template-create")
    }
  }, [searchParams])

  // Load an existing template when ?item=<recordId> is in the URL.
  // Waits for the Aprimo client to be ready before fetching.
  useEffect(() => {
    const itemId = searchParams.get("record")
    if (!itemId || !client || hasLoadedItem.current) return
    hasLoadedItem.current = true

    const jsonFieldName = process.env.NEXT_PUBLIC_CANVAS_TEMPLATE_JSON_FIELD

    async function loadItem() {
      setLoadingItem(true)
      try {
        // Resolve field name → definition ID
        let jsonFieldId: string | null = null
        if (jsonFieldName) {
          outer: for await (const result of client!.fieldDefinitions.getPaged()) {
            if (!result.ok) break
            const items = (result.data?.items ?? []) as unknown as { id: string; name: string }[]
            for (const f of items) {
              if (f.name === jsonFieldName) { jsonFieldId = f.id; break outer }
            }
          }
        }
        if (!jsonFieldId) throw new Error(`JSON field "${jsonFieldName ?? "?"}" not found.`)

        // Fetch record with field values expanded
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const expander = (Expander as any).create().for("Record").expand("fields")
        const recRes = await client!.records.getById(itemId!, expander as never)
        if (!recRes.ok) throw new Error("Failed to fetch record.")

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const fieldValues = ((recRes.data as any)?._embedded?.fields?.items ?? []) as any[]
        const match = fieldValues.find((fv: { id?: string }) => fv.id === jsonFieldId)
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const jsonStr = (match as any)?.localizedValues?.[0]?.value as string | undefined
        if (!jsonStr) throw new Error("No template data found on this record.")

        const parsed = JSON.parse(jsonStr) as { sourceContentTypeId?: string; sourceContentTypeName?: string; layouts?: unknown }
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.layouts)) {
          throw new Error("Record does not contain valid template data.")
        }

        setLayouts(parsed.layouts as Layout[])
        setActiveIdx(0)
        setSelectedId(null)
        setSavedRecordId(itemId)
        setSourceContentTypeId(parsed.sourceContentTypeId ?? "")
        setSourceContentTypeName(parsed.sourceContentTypeName ?? "")
        if (parsed.sourceContentTypeId) void loadContentTypes()
        toast.success("Template loaded.")
      } catch (err) {
        toast.error(`Could not load template: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setLoadingItem(false)
      }
    }

    void loadItem()
  }, [client, searchParams])

  const selected = useMemo(() => (selectedId ? findLayer(layout.layers, selectedId) : null), [layout, selectedId])

  // Pick up a layout converted from /figma-import.
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem("canvas-layout-handoff")
      if (!raw) return
      sessionStorage.removeItem("canvas-layout-handoff")
      const parsed = JSON.parse(raw)
      if (parsed && Array.isArray(parsed.layers)) {
        setLayouts([parsed as Layout])
        setActiveIdx(0)
        setSelectedId(null)
        toast.success("Layout imported from Figma.")
      }
    } catch {
      /* ignore */
    }
  }, [])

  // Check Figma connection when modal opens.
  useEffect(() => {
    if (!figmaModalOpen) return
    setFigmaConnected(null)
    fetch("/api/figma-import")
      .then((r) => r.json())
      .then((d) => setFigmaConnected(!!d.connected))
      .catch(() => setFigmaConnected(false))
  }, [figmaModalOpen])

  const findFigmaFrames = useCallback(async () => {
    if (!figmaUrl.trim()) return
    setFigmaFinding(true)
    setFigmaPages(null)
    setFigmaSelectedIds(new Set())
    try {
      const res = await fetch("/api/figma-import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: figmaUrl, action: "frames" }),
      })
      const data = await res.json()
      if (!res.ok) {
        if (res.status === 401) setFigmaConnected(false)
        toast.error(data.error ?? "Couldn't list frames.")
        return
      }
      setFigmaPages((data as { pages: FigmaPage[] }).pages)
    } catch {
      toast.error("Failed to reach Figma.")
    } finally {
      setFigmaFinding(false)
    }
  }, [figmaUrl])

  const importFigmaFrames = useCallback(async () => {
    if (!figmaUrl.trim()) return
    setFigmaImporting(true)
    try {
      const ids = [...figmaSelectedIds]
      // If none selected, import the frame embedded in the URL itself.
      const nodeIds = ids.length > 0 ? ids : [undefined]
      const responses = await Promise.all(
        nodeIds.map((nodeId) =>
          fetch("/api/figma-import", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: figmaUrl, ...(nodeId ? { nodeId } : {}) }),
          }).then(async (r) => ({ status: r.status, data: await r.json() }))
        )
      )

      for (const { status, data } of responses) {
        if (data.error) {
          if (status === 401) setFigmaConnected(false)
          toast.error(data.error)
          return
        }
      }
      const results = responses.map((r) => r.data)

      const imported = results.filter((d: { layout?: Layout }) => d.layout).map((d: { layout?: Layout }) => d.layout as Layout)
      if (imported.length === 0) { toast.error("No canvas layout returned."); return }

      // Each frame gets its own canvas tab.
      setLayouts(imported)
      setActiveIdx(0)
      setSelectedId(null)
      setFigmaModalOpen(false)
      toast.success(`Imported ${imported.length} canvas${imported.length !== 1 ? "es" : ""} from Figma.`)
    } catch {
      toast.error("Something went wrong importing from Figma.")
    } finally {
      setFigmaImporting(false)
    }
  }, [figmaUrl, figmaSelectedIds])

  // Aprimo content types — lazy-loaded once when first needed for bindings.
  const [contentTypes, setContentTypes] = useState<{ id: string; name: string }[] | null>(null)
  const [loadingContentTypes, setLoadingContentTypes] = useState(false)
  const loadContentTypes = useCallback(async () => {
    if (!client || contentTypes !== null || loadingContentTypes) return
    setLoadingContentTypes(true)
    try {
      const defs: { id: string; name: string }[] = []
      for await (const result of client.contentTypes.getPaged()) {
        if (!result.ok) break
        const items = (result.data?.items ?? []) as unknown as { id: string; name: string }[]
        defs.push(...items.filter((c) => c.id && c.name))
      }
      setContentTypes(defs.sort((a, b) => a.name.localeCompare(b.name)))
    } catch {
      setContentTypes([])
    } finally {
      setLoadingContentTypes(false)
    }
  }, [client, contentTypes, loadingContentTypes])

  // Aprimo field definitions — lazy-loaded once when first needed for bindings.
  type FieldDef = { id: string; name: string; label: string; scope: string; memberships: string[] }
  const [fieldDefs, setFieldDefs] = useState<FieldDef[] | null>(null)
  const [loadingFieldDefs, setLoadingFieldDefs] = useState(false)
  const loadFieldDefs = useCallback(async () => {
    if (!client || fieldDefs !== null || loadingFieldDefs) return
    setLoadingFieldDefs(true)
    try {
      const defs: FieldDef[] = []
      for await (const result of client.fieldDefinitions.getPaged()) {
        if (!result.ok) break
        const items = (result.data?.items ?? []) as unknown as { id: string; name: string; label?: string; dataType?: string; scope?: string; memberships?: string[] }[]
        defs.push(...items
          .filter((f) => f.id && f.name && TEXT_FIELD_TYPES.has(f.dataType ?? ""))
          .map((f) => ({ id: f.id, name: f.name, label: f.label || f.name, scope: f.scope ?? "", memberships: f.memberships ?? [] }))
        )
      }
      setFieldDefs(defs)
    } catch {
      setFieldDefs([])
    } finally {
      setLoadingFieldDefs(false)
    }
  }, [client, fieldDefs, loadingFieldDefs])

  // Source content type metadata — direct field IDs + group IDs — reloads on sourceContentTypeId change.
  const [sourceCtMeta, setSourceCtMeta] = useState<{ directFieldIds: Set<string>; groupIds: Set<string> } | null>(null)
  useEffect(() => {
    if (!client || !sourceContentTypeId) { setSourceCtMeta(null); return }
    let cancelled = false
    ;(async () => {
      try {
        const res = await client.contentTypes.getById(sourceContentTypeId)
        if (cancelled || !res.ok) return
        const ct = res.data as unknown as {
          registeredFields?: { fieldId: string }[]
          registeredFieldGroups?: { fieldGroupId: string }[]
        }
        const directFieldIds = new Set((ct.registeredFields ?? []).map((f) => f.fieldId))
        const groupIds = new Set(
          (ct.registeredFieldGroups ?? []).map(
            (g) => (g as { fieldGroupId?: string; id?: string }).fieldGroupId ?? (g as { id?: string }).id ?? ""
          ).filter(Boolean)
        )
        if (!cancelled) setSourceCtMeta({ directFieldIds, groupIds })
      } catch { /* non-fatal — fall back to all fields */ }
    })()
    return () => { cancelled = true }
  }, [client, sourceContentTypeId])

  // --- layer mutation helpers (recursive over the layer tree) ---
  const patchLayer = useCallback((id: string, patch: Partial<Layer>) => {
    setLayout((p) => ({ ...p, layers: updateLayers(p.layers, id, (l) => ({ ...l, ...patch }) as Layer) }))
  }, [])
  const patchContent = useCallback((id: string, patch: Partial<AnyContent>) => {
    setLayout((p) => ({
      ...p,
      layers: updateLayers(p.layers, id, (l) => ({ ...l, content: { ...l.content, ...patch } }) as Layer),
    }))
  }, [])
  const addLayer = useCallback(
    (layer: Layer) => {
      // If a shape is selected, nest the new layer inside it; otherwise add to root.
      setLayout((p) => {
        const sel = selectedId ? findLayer(p.layers, selectedId) : null
        if (sel?.type === "shape") return { ...p, layers: addChildTo(p.layers, sel.id, layer) }
        return { ...p, layers: [...p.layers, layer] }
      })
      setSelectedId(layer.id)
    },
    [selectedId]
  )
  const removeLayer = useCallback((id: string) => {
    setLayout((p) => ({ ...p, layers: removeFromLayers(p.layers, id) }))
    setSelectedId((s) => (s === id ? null : s))
  }, [])
  const reorder = useCallback((id: string, dir: -1 | 1) => {
    setLayout((p) => ({ ...p, layers: reorderInLayers(p.layers, id, dir) }))
  }, [])
  const indent = useCallback((id: string) => {
    setLayout((p) => ({ ...p, layers: indentLayer(p.layers, id) }))
  }, [])
  const outdent = useCallback((id: string) => {
    setLayout((p) => ({ ...p, layers: outdentLayer(p.layers, id) }))
  }, [])

  // --- drag to move / resize (canvas is 1:1 px, so client deltas == canvas deltas) ---
  const dragRef = useRef<null | { mode: "move" | "resize"; id: string; sx: number; sy: number; ox: number; oy: number; ow: number; oh: number }>(null)
  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = dragRef.current
    if (!d) return
    const dx = e.clientX - d.sx
    const dy = e.clientY - d.sy
    setLayout((p) => ({
      ...p,
      layers: updateLayers(p.layers, d.id, (l) =>
        d.mode === "move"
          ? { ...l, x: Math.round(d.ox + dx), y: Math.round(d.oy + dy) }
          : { ...l, width: Math.max(8, Math.round(d.ow + dx)), height: Math.max(8, Math.round(d.oh + dy)) }
      ),
    }))
  }, [])
  const endDrag = useCallback(() => {
    dragRef.current = null
    window.removeEventListener("pointermove", onPointerMove)
  }, [onPointerMove])
  const startDrag = useCallback(
    (e: React.PointerEvent, layer: Layer, mode: "move" | "resize") => {
      e.stopPropagation()
      setSelectedId(layer.id)
      if (layer.locked) return // select but don't move/resize
      dragRef.current = { mode, id: layer.id, sx: e.clientX, sy: e.clientY, ox: layer.x, oy: layer.y, ow: layer.width, oh: layer.height }
      window.addEventListener("pointermove", onPointerMove)
      window.addEventListener("pointerup", endDrag, { once: true })
    },
    [onPointerMove, endDrag]
  )

  const json = useMemo(() => JSON.stringify(layout, null, 2), [layout])

  // Scale the HTML preview iframe down so it fits within the modal (max 800px wide).
  const htmlPreviewScale = useMemo(() => Math.min(1, 800 / Math.max(layout.width, 1)), [layout.width])

  const loadHtmlIntoCanvas = useCallback(() => {
    if (!htmlSource.trim()) return
    const converted = htmlToLayout(htmlSource, layout.width, layout.height)
    setLayout(converted)
    setSelectedId(null)
    setHtmlModalOpen(false)
    toast.success(`Loaded ${converted.layers.length} layer${converted.layers.length !== 1 ? "s" : ""} from HTML.`)
  }, [htmlSource, layout.width, layout.height])

  const count = (t: Layer["type"]) => layout.layers.filter((l) => l.type === t).length

  // Interaction-only layer divs. Canvas draws the visuals; these are transparent
  // hit-targets that capture pointer events and show selection outlines/handles.
  const renderLayer = (l: Layer): ReactNode => {
    if (!l.visible) return null
    return (
      <div
        key={l.id}
        onPointerDown={(e) => startDrag(e, l, "move")}
        onDoubleClick={(e) => {
          if (l.type === "text" && !l.locked) { e.stopPropagation(); setEditingId(l.id) }
        }}
        className={cn(
          "absolute",
          l.locked ? "cursor-pointer" : "cursor-move",
          selectedId === l.id && "outline outline-2 outline-primary"
        )}
        style={{
          left: l.x,
          top: l.y,
          width: l.width,
          height: l.height,
          transform: l.rotation ? `rotate(${l.rotation}deg)` : undefined,
        }}
      >
        {/* Inline text editor overlay — only visible while editing */}
        {l.type === "text" && editingId === l.id && (
          <InlineTextEditor
            layer={l}
            onSave={(text) => { patchContent(l.id, { text, spans: undefined }); setEditingId(null) }}
            onCancel={() => setEditingId(null)}
          />
        )}
        {/* Shape children need interaction divs too (same transparent approach) */}
        {l.type === "shape" && l.children.map(renderLayer)}
        {/* Resize handle */}
        {selectedId === l.id && !l.locked && (
          <div
            onPointerDown={(e) => startDrag(e, l, "resize")}
            className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-nwse-resize rounded-sm border border-white bg-primary"
          />
        )}
      </div>
    )
  }

  // Recursive layers-panel row (indented tree; shape children nested under it).
  const renderRow = (l: Layer, depth: number): ReactNode => {
    const isShape = l.type === "shape"
    const collapsed = isShape && collapsedShapes.has(l.id)
    return (
      <div key={l.id}>
        <div
          onClick={() => setSelectedId(l.id)}
          style={{ paddingLeft: 8 + depth * 12 }}
          className={cn(
            "flex items-center gap-1.5 rounded py-1 pr-2 text-xs cursor-pointer min-w-max",
            selectedId === l.id ? "bg-primary/15" : "hover:bg-muted/60"
          )}
        >
          {isShape ? (
            <button
              onClick={(e) => { e.stopPropagation(); toggleCollapsed(l.id) }}
              className="shrink-0 text-muted-foreground hover:text-foreground"
              title={collapsed ? "Expand" : "Collapse"}
            >
              {collapsed
                ? <ChevronRight className="h-3.5 w-3.5" />
                : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="h-3.5 w-3.5 shrink-0" />
          )}
          {l.type === "text" ? (
            <Type className="h-3.5 w-3.5 shrink-0" />
          ) : l.type === "image" ? (
            <ImageIcon className="h-3.5 w-3.5 shrink-0" />
          ) : l.type === "shape" ? (
            <Square className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <MousePointerClick className="h-3.5 w-3.5 shrink-0" />
          )}
          <span className="whitespace-nowrap">{l.name}</span>
          <button onClick={(e) => { e.stopPropagation(); patchLayer(l.id, { visible: !l.visible }) }} title="Visibility">
            {l.visible ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5 text-muted-foreground/50" />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); patchLayer(l.id, { locked: !l.locked }) }} title="Lock">
            {l.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5 text-muted-foreground/50" />}
          </button>
          <button onClick={(e) => { e.stopPropagation(); reorder(l.id, 1) }} title="Bring forward">
            <ArrowUp className="h-3.5 w-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); reorder(l.id, -1) }} title="Send backward">
            <ArrowDown className="h-3.5 w-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); indent(l.id) }} title="Move into group above">
            <IndentIncrease className="h-3.5 w-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); outdent(l.id) }} title="Move out of group">
            <IndentDecrease className="h-3.5 w-3.5" />
          </button>
          <button onClick={(e) => { e.stopPropagation(); removeLayer(l.id) }} title="Delete">
            <Trash2 className="h-3.5 w-3.5 text-destructive/80" />
          </button>
        </div>
        {isShape && !collapsed && l.children.map((c) => renderRow(c, depth + 1))}
      </div>
    )
  }

  // Floating toolbar — rendered inside the canvas div, positioned above (or below) the selected layer.
  const renderFloatingToolbar = (): ReactNode => {
    if (!selected) return null
    const abs = absolutePos(layout.layers, selected.id) ?? { x: selected.x, y: selected.y }
    const TOOLBAR_H = 44
    const showAbove = abs.y >= TOOLBAR_H + 12
    const ty = showAbove ? abs.y - TOOLBAR_H - 8 : abs.y + selected.height + 8
    const tx = Math.max(0, Math.min(abs.x, layout.width - 8))

    const typeBadge: Record<Layer["type"], string> = { text: "T", image: "IMG", shape: "□", button: "BTN" }
    const typeBadgeBg: Record<Layer["type"], string> = { text: M.clay, image: "#3b82f6", shape: "#8b5cf6", button: M.moss }

    const inputCss: CSSProperties = {
      height: 28, fontSize: 12, borderRadius: 6,
      border: `1px solid ${alpha("ink", 15)}`, padding: "0 8px",
      fontFamily: M.sans, flexShrink: 0, outline: "none", color: M.ink, background: "#fff",
    }
    const iconBtn = (active?: boolean): CSSProperties => ({
      display: "inline-flex", alignItems: "center", justifyContent: "center",
      width: 28, height: 28, borderRadius: 6,
      border: `1px solid ${alpha("ink", 15)}`,
      background: active ? alpha("ink", 8) : "transparent",
      cursor: "pointer", flexShrink: 0, color: M.ink, padding: 0,
    })
    const Sep = () => <span style={{ display: "inline-block", width: 1, height: 20, background: alpha("ink", 10), margin: "0 4px", flexShrink: 0 }} />

    return (
      <div
        style={{
          position: "absolute", left: tx, top: ty, zIndex: 20,
          display: "inline-flex", alignItems: "center", gap: 3,
          background: "#fff", border: `1px solid ${alpha("ink", 12)}`,
          borderRadius: 12, padding: "0 8px", height: TOOLBAR_H,
          boxShadow: "0 4px 20px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.06)",
          whiteSpace: "nowrap", pointerEvents: "auto",
        }}
        onPointerDown={(e) => e.stopPropagation()}
      >
        {/* Type badge */}
        <span style={{ background: typeBadgeBg[selected.type], color: "#fff", borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", flexShrink: 0 }}>
          {typeBadge[selected.type]}
        </span>
        <span style={{ fontSize: 12, fontWeight: 500, color: alpha("ink", 60), maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", padding: "0 4px", flexShrink: 1 }}>
          {selected.name}
        </span>

        <Sep />

        {selected.locked ? (
          <span style={{ fontSize: 11, color: alpha("ink", 45), padding: "0 4px" }}>Locked</span>
        ) : (
          <>
            {/* Text controls */}
            {selected.type === "text" && (
              <>
                {selected.content.spans ? (
                  // ── Color-run mode: one color swatch + text input per run ──
                  <>
                    {selected.content.spans.map((span, i) => {
                      const spans = selected.content.spans!
                      const updateSpan = (patch: Partial<TextSpan>) => {
                        const next = spans.map((s, j) => j === i ? { ...s, ...patch } : s)
                        patchContent(selected.id, { spans: next, text: next.map((s) => s.text).join("") })
                      }
                      return (
                        <Fragment key={i}>
                          <input
                            type="color"
                            value={toHex(span.color ?? selected.content.color)}
                            onChange={(e) => updateSpan({ color: e.target.value })}
                            style={{ width: 24, height: 24, padding: 1, borderRadius: 4, border: `1px solid ${alpha("ink", 15)}`, cursor: "pointer", flexShrink: 0 }}
                            title={`Run ${i + 1} color`}
                          />
                          <input
                            type="text"
                            value={span.text}
                            onChange={(e) => updateSpan({ text: e.target.value })}
                            style={{ ...inputCss, width: 80, fontSize: 11 }}
                            placeholder={`Run ${i + 1}…`}
                          />
                          {spans.length > 1 && (
                            <button
                              onClick={() => {
                                const next = spans.filter((_, j) => j !== i)
                                patchContent(selected.id, { spans: next.length ? next : undefined, text: next.map((s) => s.text).join("") })
                              }}
                              style={{ ...iconBtn(), width: 18, height: 18, borderRadius: 4, fontSize: 12, color: alpha("ink", 45) }}
                              title={`Remove run ${i + 1}`}
                            >×</button>
                          )}
                        </Fragment>
                      )
                    })}
                    {/* Add run */}
                    <button
                      onClick={() => patchContent(selected.id, { spans: [...selected.content.spans!, { text: "", color: selected.content.color }] })}
                      style={{ ...iconBtn(), width: 22, height: 22, borderRadius: 4, fontSize: 14, color: alpha("ink", 50) }}
                      title="Add run"
                    >+</button>
                    {/* Clear all runs */}
                    <button
                      onClick={() => patchContent(selected.id, { spans: undefined })}
                      style={{ ...iconBtn(), width: "auto", padding: "0 8px", fontSize: 10, color: alpha("ink", 50) }}
                      title="Remove all color runs"
                    >Clear runs</button>
                    <Sep />
                    {/* Size / bold / align still available in run mode */}
                    <input type="number" value={selected.content.fontSize} onChange={(e) => patchContent(selected.id, { fontSize: Number(e.target.value) || 1 })}
                      style={{ ...inputCss, width: 52 }} title="Font size" />
                    <button style={iconBtn(selected.content.fontWeight >= 700)} title="Bold"
                      onClick={() => patchContent(selected.id, { fontWeight: selected.content.fontWeight >= 700 ? 400 : 700 })}>
                      <strong style={{ fontSize: 13, fontFamily: "Georgia, serif" }}>B</strong>
                    </button>
                    <button style={iconBtn()} title="Alignment"
                      onClick={() => patchContent(selected.id, { align: selected.content.align === "left" ? "center" : selected.content.align === "center" ? "right" : "left" })}>
                      <span style={{ fontSize: 10, fontWeight: 600 }}>{selected.content.align === "left" ? "≡L" : selected.content.align === "center" ? "≡C" : "≡R"}</span>
                    </button>
                  </>
                ) : (
                  // ── Single-color mode ──
                  <>
                    <input
                      list="font-family-suggestions"
                      value={selected.content.fontFamily}
                      onChange={(e) => patchContent(selected.id, { fontFamily: e.target.value })}
                      style={{ ...inputCss, width: 140 }}
                      title="Font family"
                    />
                    <input type="color" value={toHex(selected.content.color)} onChange={(e) => patchContent(selected.id, { color: e.target.value })}
                      style={{ width: 28, height: 28, padding: 2, borderRadius: 6, border: `1px solid ${alpha("ink", 15)}`, cursor: "pointer", flexShrink: 0 }} title="Color" />
                    <input type="number" value={selected.content.fontSize} onChange={(e) => patchContent(selected.id, { fontSize: Number(e.target.value) || 1 })}
                      style={{ ...inputCss, width: 52 }} title="Font size" />
                    <button style={iconBtn(selected.content.fontWeight >= 700)} title="Bold"
                      onClick={() => patchContent(selected.id, { fontWeight: selected.content.fontWeight >= 700 ? 400 : 700 })}>
                      <strong style={{ fontSize: 13, fontFamily: "Georgia, serif" }}>B</strong>
                    </button>
                    <button style={iconBtn()} title="Alignment"
                      onClick={() => patchContent(selected.id, { align: selected.content.align === "left" ? "center" : selected.content.align === "center" ? "right" : "left" })}>
                      <span style={{ fontSize: 10, fontWeight: 600 }}>{selected.content.align === "left" ? "≡L" : selected.content.align === "center" ? "≡C" : "≡R"}</span>
                    </button>
                    {editingId !== selected.id && (
                      <button onClick={() => setEditingId(selected.id)}
                        style={{ ...iconBtn(), width: "auto", padding: "0 10px", fontSize: 11, fontWeight: 600, color: M.clay, borderColor: alpha("clay", 30), background: alpha("clay", 6) }}>
                        Edit text
                      </button>
                    )}
                    {/* Bootstrap color runs from current text */}
                    <button
                      onClick={() => patchContent(selected.id, { spans: splitIntoRuns(selected.content.text, selected.content.color) })}
                      style={{ ...iconBtn(), width: "auto", padding: "0 8px", fontSize: 10, color: alpha("ink", 55) }}
                      title="Split into color runs"
                    >+ Runs</button>
                  </>
                )}
              </>
            )}

            {/* Image controls */}
            {selected.type === "image" && (
              <>
                <input type="text" value={selected.content.src} onChange={(e) => patchContent(selected.id, { src: e.target.value, source: "free" })}
                  placeholder="Image URL…"
                  style={{ ...inputCss, width: 180, fontFamily: M.mono, fontSize: 11 }} />
                <select value={selected.content.fit} onChange={(e) => patchContent(selected.id, { fit: e.target.value as Fit })}
                  style={{ ...inputCss, padding: "0 6px" }}>
                  <option value="cover">Cover</option>
                  <option value="contain">Contain</option>
                  <option value="fill">Fill</option>
                </select>
              </>
            )}

            {/* Shape controls */}
            {selected.type === "shape" && (
              <>
                {selected.content.fillType === "color" && (
                  <input type="color" value={toHex(selected.content.fill)} onChange={(e) => patchContent(selected.id, { fill: e.target.value })}
                    style={{ width: 28, height: 28, padding: 2, borderRadius: 6, border: `1px solid ${alpha("ink", 15)}`, cursor: "pointer", flexShrink: 0 }} title="Fill" />
                )}
                <span style={{ fontSize: 11, color: alpha("ink", 50) }}>Fill</span>
              </>
            )}

            {/* Button controls */}
            {selected.type === "button" && (
              <>
                <input type="text" value={selected.content.label} onChange={(e) => patchContent(selected.id, { label: e.target.value })}
                  placeholder="Label…" style={{ ...inputCss, width: 100 }} />
                <input type="color" value={toHex(selected.content.background)} onChange={(e) => patchContent(selected.id, { background: e.target.value })}
                  style={{ width: 28, height: 28, padding: 2, borderRadius: 6, border: `1px solid ${alpha("ink", 15)}`, cursor: "pointer", flexShrink: 0 }} title="Background" />
                <input type="color" value={toHex(selected.content.color)} onChange={(e) => patchContent(selected.id, { color: e.target.value })}
                  style={{ width: 28, height: 28, padding: 2, borderRadius: 6, border: `1px solid ${alpha("ink", 15)}`, cursor: "pointer", flexShrink: 0 }} title="Text color" />
              </>
            )}

            <Sep />
          </>
        )}

        {/* Opacity */}
        <input
          type="number"
          min={0}
          max={100}
          value={Math.round(selected.opacity * 100)}
          onChange={(e) => patchLayer(selected.id, { opacity: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
          style={{ ...inputCss, width: 52 }}
          title="Opacity %"
        />
        <span style={{ fontSize: 11, color: alpha("ink", 45), marginLeft: -4 }}>%</span>

        <Sep />

        {/* Lock / Unlock */}
        <button style={iconBtn(selected.locked)} title={selected.locked ? "Unlock" : "Lock"}
          onClick={() => patchLayer(selected.id, { locked: !selected.locked })}>
          {selected.locked ? <Lock style={{ width: 13, height: 13 }} /> : <LockOpen style={{ width: 13, height: 13 }} />}
        </button>

        {/* Delete */}
        <button style={{ ...iconBtn(), color: "#ef4444" }} title="Delete" onClick={() => removeLayer(selected.id)}>
          <Trash2 style={{ width: 13, height: 13 }} />
        </button>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-x-hidden">
      <Navbar showPageHeader={false} />
      <div style={{ flex: 1, padding: 24 }}>
        <div className="space-y-4">
          {/* Canvas tabs */}
          <div style={{ display: "flex", alignItems: "center", gap: 2, borderBottom: `1px solid ${alpha("ink", 10)}`, overflowX: "auto", paddingBottom: 0 }}>
            {layouts.map((l, i) => (
              <div key={i} style={{ display: "flex", alignItems: "center", position: "relative" }}>
                <button
                  onClick={() => switchCanvas(i)}
                  style={{
                    display: "inline-flex", alignItems: "center", gap: 6,
                    padding: "8px 14px 9px",
                    fontSize: 13, fontFamily: M.sans, fontWeight: i === activeIdx ? 600 : 400,
                    color: i === activeIdx ? M.clay : alpha("ink", 60),
                    background: "transparent", border: "none", cursor: "pointer",
                    borderBottom: i === activeIdx ? `2px solid ${M.clay}` : "2px solid transparent",
                    whiteSpace: "nowrap",
                  }}
                >
                  {l.name}
                </button>
                {layouts.length > 1 && (
                  <button
                    onClick={() => removeCanvas(i)}
                    style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 16, height: 16, borderRadius: "9999px", border: "none", background: "transparent", cursor: "pointer", color: alpha("ink", 40), padding: 0, marginLeft: -4 }}
                    title="Remove canvas"
                  >
                    <X style={{ width: 10, height: 10 }} />
                  </button>
                )}
              </div>
            ))}
            <button
              onClick={addCanvas}
              style={{ display: "inline-flex", alignItems: "center", justifyContent: "center", width: 28, height: 28, borderRadius: "9999px", border: `1px solid ${alpha("ink", 15)}`, background: "transparent", cursor: "pointer", color: alpha("ink", 50), fontSize: 18, marginLeft: 4, flexShrink: 0 }}
              title="Add canvas"
            >
              +
            </button>
          </div>

          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={layout.name}
              onChange={(e) => setLayout((p) => ({ ...p, name: e.target.value }))}
              className="h-9 w-56 text-sm font-medium"
            />
            <Button variant="outline" size="sm" onClick={() => addLayer(newTextLayer(count("text") + 1))}>
              <Type className="h-4 w-4" /> Text
            </Button>
            <Button variant="outline" size="sm" onClick={() => addLayer(newImageLayer(count("image") + 1))}>
              <ImageIcon className="h-4 w-4" /> Image
            </Button>
            <Button variant="outline" size="sm" onClick={() => addLayer(newShapeLayer(count("shape") + 1))}>
              <Square className="h-4 w-4" /> Shape
            </Button>
            <Button variant="outline" size="sm" onClick={() => addLayer(newButtonLayer(count("button") + 1))}>
              <MousePointerClick className="h-4 w-4" /> Button
            </Button>
            <div className="mx-1 h-6 w-px bg-border" />
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              W
              <Input
                type="number"
                value={layout.width}
                onChange={(e) => setLayout((p) => ({ ...p, width: Number(e.target.value) || 1 }))}
                className="h-8 w-20 text-xs"
              />
            </label>
            <label className="flex items-center gap-1 text-xs text-muted-foreground">
              H
              <Input
                type="number"
                value={layout.height}
                onChange={(e) => setLayout((p) => ({ ...p, height: Number(e.target.value) || 1 }))}
                className="h-8 w-20 text-xs"
              />
            </label>
            <input
              type="color"
              value={layout.background}
              onChange={(e) => setLayout((p) => ({ ...p, background: e.target.value }))}
              className="h-8 w-8 rounded border border-border"
              title="Canvas background"
            />
            <div className="ml-auto flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setHtmlModalOpen(true)}>
                <Code2 className="h-4 w-4" /> From HTML
              </Button>
              <Button variant="outline" size="sm" onClick={() => setFigmaModalOpen(true)}>
                <Layers className="h-4 w-4" /> From Figma
              </Button>
              <div className="mx-1 h-6 w-px bg-border" />
              <Button size="sm" onClick={() => void saveToAprimo()} disabled={savingTemplate} title="Save to Aprimo (Ctrl+S / ⌘S)">
                <Save className="h-4 w-4" /> {savingTemplate ? "Saving…" : "Save to Aprimo"}
              </Button>
              <div className="mx-1 h-6 w-px bg-border" />
              <Button variant={showJson ? "default" : "outline"} size="sm" onClick={() => setShowJson((v) => !v)}>
                {showJson ? "Hide JSON" : "View JSON"}
              </Button>
            </div>
          </div>

          {/* Source asset type */}
          <div className="flex items-center gap-4 rounded-lg border border-border bg-card px-4 py-3">
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold">Source asset type</p>
              <p className="text-xs text-muted-foreground mt-0.5">Content type of Aprimo records used to fill this template.</p>
            </div>
            <Select
              value={sourceContentTypeId || "__none__"}
              onValueChange={(v) => {
                const id = v === "__none__" ? "" : v
                const ct = (contentTypes ?? []).find((c) => c.id === id)
                setSourceContentTypeId(id)
                setSourceContentTypeName(ct?.name ?? "")
              }}
              onOpenChange={(open) => { if (open) void loadContentTypes() }}
            >
              <SelectTrigger className="h-9 w-72 text-sm shrink-0">
                <SelectValue placeholder={loadingContentTypes ? "Loading…" : "Any content type"} />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">Any content type</SelectItem>
                {(contentTypes ?? []).map((ct) => (
                  <SelectItem key={ct.id} value={ct.id}>{ct.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-start gap-0">
            {/* Left panel: layers */}
            <aside
              style={{ width: layersOpen ? layersWidth : 0 }}
              className={cn(
                "flex flex-col rounded-xl border border-border bg-card overflow-hidden shrink-0 transition-[opacity,border-color] duration-200",
                layersOpen ? "opacity-100" : "border-transparent opacity-0"
              )}
            >
              <div className="border-b border-border px-3 py-2 text-sm font-semibold shrink-0">Layers</div>
              <div className="p-1 overflow-y-auto overflow-x-auto flex-1">
                {layout.layers.length === 0 && (
                  <p className="p-2 text-xs text-muted-foreground">Add a layer to begin.</p>
                )}
                {layout.layers.map((l) => renderRow(l, 0))}
              </div>
            </aside>

            {/* Layers resize handle */}
            {layersOpen && (
              <div
                onMouseDown={onLayersResizeStart}
                className="w-1 self-stretch cursor-col-resize hover:bg-primary/40 active:bg-primary/60 shrink-0 transition-colors"
              />
            )}

            {/* Layers toggle handle */}
            <button
              onClick={() => setLayersOpen((v) => !v)}
              title={layersOpen ? "Hide layers" : "Show layers"}
              className="flex items-center justify-center w-5 self-stretch shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer border-none bg-transparent"
            >
              {layersOpen ? <ChevronLeft className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>

            {/* Canvas area */}
            <div className="flex-1 min-w-0 flex flex-col gap-2">
              {/* Zoom controls */}
              <div className="flex items-center justify-end gap-1.5">
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomOut}>
                  <Minus className="h-3 w-3" />
                </Button>
                <span className="text-xs font-mono w-11 text-center text-muted-foreground">
                  {Math.round(displayScale * 100)}%
                </span>
                <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomIn}>
                  <Plus className="h-3 w-3" />
                </Button>
                <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => setZoom(null)}>
                  Fit
                </Button>
              </div>

              {/* Canvas */}
              <div className="overflow-x-auto overflow-y-visible rounded-xl border border-border bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:20px_20px] p-6 min-h-[70vh]">
                <div style={{ width: layout.width * displayScale, height: layout.height * displayScale, position: "relative" }}>
                  <div
                    className="relative shadow-sm"
                    style={{ width: layout.width, height: layout.height, transformOrigin: "top left", transform: `scale(${displayScale})` }}
                    onPointerDown={() => { setSelectedId(null); setEditingId(null) }}
                  >
                    {loadingItem && (
                      <div className="absolute inset-0 z-50 flex items-center justify-center rounded bg-background/80 backdrop-blur-sm">
                        <span className="text-sm text-muted-foreground">Loading template…</span>
                      </div>
                    )}
                    {/* Canvas for all visual rendering */}
                    <canvas
                      ref={canvasRef}
                      width={layout.width}
                      height={layout.height}
                      className="absolute inset-0"
                    />
                    {/* Transparent interaction layer on top */}
                    {layout.layers.map(renderLayer)}
                    {renderFloatingToolbar()}
                  </div>
                </div>
              </div>
            </div>

            {/* Properties toggle handle */}
            <button
              onClick={() => setPropertiesOpen((v) => !v)}
              title={propertiesOpen ? "Hide properties" : "Show properties"}
              className="flex items-center justify-center w-5 self-stretch shrink-0 text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors cursor-pointer border-none bg-transparent"
            >
              {propertiesOpen ? <ChevronRight className="h-3.5 w-3.5" /> : <ChevronLeft className="h-3.5 w-3.5" />}
            </button>

            {/* Right panel: properties */}
            <aside className={cn(
              "flex flex-col gap-4 overflow-y-auto shrink-0 transition-all duration-200",
              propertiesOpen ? "w-[17rem] opacity-100" : "w-0 opacity-0 overflow-hidden"
            )}>
              {selected && (
                <div className={cn("space-y-2 rounded-xl border border-border bg-card p-3 text-xs", selected.locked && "opacity-50 pointer-events-none")}>
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-semibold">Properties</span>
                    <button
                      onClick={() => patchLayer(selected.id, { locked: !selected.locked })}
                      className="pointer-events-auto text-muted-foreground hover:text-foreground transition-colors"
                      title={selected.locked ? "Unlock" : "Lock"}
                    >
                      {selected.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
                    </button>
                  </div>
                  <label className="block">
                    <span className="text-muted-foreground">Name</span>
                    <Input value={selected.name} onChange={(e) => patchLayer(selected.id, { name: e.target.value })} className="mt-1 h-8 text-xs" />
                  </label>
                  <div className="grid grid-cols-4 gap-2">
                    {(["x", "y", "width", "height"] as const).map((k) => (
                      <label key={k} className="block">
                        <span className="uppercase text-muted-foreground">{k[0]}</span>
                        <Input
                          type="number"
                          value={selected[k]}
                          onChange={(e) => patchLayer(selected.id, { [k]: Number(e.target.value) || 0 } as Partial<Layer>)}
                          className="mt-1 h-8 px-1.5 text-xs"
                        />
                      </label>
                    ))}
                    <label className="block">
                      <span className="uppercase text-muted-foreground">Opacity %</span>
                      <Input
                        type="number"
                        min={0}
                        max={100}
                        value={Math.round(selected.opacity * 100)}
                        onChange={(e) => patchLayer(selected.id, { opacity: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
                        className="mt-1 h-8 px-1.5 text-xs"
                      />
                    </label>
                  </div>

                  {selected.type === "text" && (
                    <div className="space-y-2 border-t border-border pt-2">
                      {/* Aprimo field binding */}
                      <div className="space-y-1.5">
                        <span className="text-muted-foreground">Source</span>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => patchContent(selected.id, { aprimoField: undefined })}
                            className={cn(
                              "flex-1 rounded-md border px-2 py-1 text-xs transition-colors",
                              !selected.content.aprimoField
                                ? "border-primary bg-primary/10 text-primary font-medium"
                                : "border-border text-muted-foreground hover:border-ring"
                            )}
                          >
                            Free text
                          </button>
                          <button
                            onClick={() => {
                              if (!selected.content.aprimoField) {
                                patchContent(selected.id, { aprimoField: { id: "", name: "" } })
                                void loadFieldDefs()
                              }
                            }}
                            className={cn(
                              "flex-1 rounded-md border px-2 py-1 text-xs transition-colors",
                              selected.content.aprimoField
                                ? "border-primary bg-primary/10 text-primary font-medium"
                                : "border-border text-muted-foreground hover:border-ring"
                            )}
                          >
                            Aprimo field
                          </button>
                        </div>

                        {selected.content.aprimoField !== undefined && (
                          <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2">
                            {(() => {
                              const visible = (sourceCtMeta
                                ? (fieldDefs ?? []).filter((f) =>
                                    f.scope === "RecordContentGlobal" ||
                                    f.scope === "RecordContentFloating" ||
                                    f.scope === "RecordContentClassDependent" ||
                                    f.scope === "FileGlobal" ||
                                    f.scope === "FileFloating" ||
                                    sourceCtMeta.directFieldIds.has(f.id) ||
                                    f.memberships.some((m) => sourceCtMeta.groupIds.has(m))
                                  )
                                : (fieldDefs ?? [])
                              ).sort((a, b) => a.label.localeCompare(b.label))
                              return (
                                <label className="block">
                                  <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                                    Field{sourceCtMeta ? ` (${visible.length})` : ""}
                                  </span>
                                  <select
                                    value={selected.content.aprimoField.id}
                                    onFocus={() => void loadFieldDefs()}
                                    onChange={(e) => {
                                      const def = fieldDefs?.find((f) => f.id === e.target.value)
                                      if (def)
                                        patchContent(selected.id, {
                                          aprimoField: { id: def.id, name: def.name },
                                        })
                                    }}
                                    className="mt-0.5 h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                                  >
                                    <option value="">Select field…</option>
                                    {loadingFieldDefs && <option disabled value="__loading__">Loading…</option>}
                                    {visible.map((f) => (
                                      <option key={f.id} value={f.id}>{f.label}</option>
                                    ))}
                                  </select>
                                </label>
                              )
                            })()}
                            {selected.content.aprimoField.id && (
                              <p className="text-[10px] text-muted-foreground">
                                Value filled from <strong className="text-foreground">{selected.content.aprimoField.name}</strong> when using Fill from record.
                              </p>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Text content: single textarea OR per-run editor */}
                      {!selected.content.spans ? (
                        <>
                          <textarea
                            value={selected.content.text}
                            onChange={(e) => patchContent(selected.id, { text: e.target.value })}
                            rows={2}
                            className="w-full rounded-md border border-border bg-background p-2 text-xs outline-none focus:border-ring"
                          />
                          <button
                            onClick={() => patchContent(selected.id, { spans: splitIntoRuns(selected.content.text, selected.content.color) })}
                            className="w-full rounded-md border border-dashed border-border py-1 text-[10px] text-muted-foreground hover:border-ring hover:text-foreground"
                          >
                            + Add color runs
                          </button>
                        </>
                      ) : (
                        <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2">
                          <div className="flex items-center justify-between pb-1">
                            <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Color runs</span>
                            <div className="flex gap-2">
                              <button
                                onClick={() => {
                                  const newSpan: TextSpan = { text: "", color: selected.content.color }
                                  patchContent(selected.id, { spans: [...selected.content.spans!, newSpan] })
                                }}
                                className="text-[10px] text-muted-foreground underline hover:text-foreground"
                              >
                                + Run
                              </button>
                              <button
                                onClick={() => patchContent(selected.id, { spans: undefined })}
                                className="text-[10px] text-muted-foreground underline hover:text-foreground"
                              >
                                Clear
                              </button>
                            </div>
                          </div>
                          {selected.content.spans.map((span, i) => {
                            const spans = selected.content.spans!
                            const updateSpan = (patch: Partial<TextSpan>) => {
                              const next = spans.map((s, j) => j === i ? { ...s, ...patch } : s)
                              const newText = next.map((s) => s.text).join("")
                              patchContent(selected.id, { spans: next, text: newText })
                            }
                            return (
                              <div key={i} className="flex items-center gap-1.5">
                                <input
                                  type="color"
                                  value={toHex(span.color ?? selected.content.color)}
                                  onChange={(e) => updateSpan({ color: e.target.value })}
                                  className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border"
                                  title="Run color"
                                />
                                <input
                                  type="text"
                                  value={span.text}
                                  onChange={(e) => updateSpan({ text: e.target.value })}
                                  className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 font-mono text-[10px] outline-none focus:border-ring"
                                  placeholder="Run text…"
                                />
                                {spans.length > 1 && (
                                  <button
                                    onClick={() => {
                                      const next = spans.filter((_, j) => j !== i)
                                      patchContent(selected.id, { spans: next, text: next.map((s) => s.text).join("") })
                                    }}
                                    className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                                    title="Remove run"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}

                      <label className="block">
                        <span className="text-muted-foreground">Font family</span>
                        <input
                          list="font-family-suggestions"
                          value={selected.content.fontFamily}
                          onChange={(e) => patchContent(selected.id, { fontFamily: e.target.value })}
                          className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring"
                          placeholder="Inter, sans-serif"
                        />
                        <datalist id="font-family-suggestions">
                          <option value="Inter, sans-serif" />
                          <option value="Roboto, sans-serif" />
                          <option value="Open Sans, sans-serif" />
                          <option value="Lato, sans-serif" />
                          <option value="Montserrat, sans-serif" />
                          <option value="Poppins, sans-serif" />
                          <option value="Raleway, sans-serif" />
                          <option value="Nunito, sans-serif" />
                          <option value="Ubuntu, sans-serif" />
                          <option value="Playfair Display, serif" />
                          <option value="Merriweather, serif" />
                          <option value="Georgia, serif" />
                          <option value="Fraunces, Georgia, serif" />
                          <option value="JetBrains Mono, monospace" />
                          <option value="Source Code Pro, monospace" />
                        </datalist>
                      </label>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-muted-foreground">Size</span>
                          <Input type="number" value={selected.content.fontSize} onChange={(e) => patchContent(selected.id, { fontSize: Number(e.target.value) || 1 })} className="mt-1 h-8 text-xs" />
                        </label>
                        <label className="block">
                          <span className="text-muted-foreground">Weight</span>
                          <Input type="number" value={selected.content.fontWeight} onChange={(e) => patchContent(selected.id, { fontWeight: Number(e.target.value) || 400 })} className="mt-1 h-8 text-xs" />
                        </label>
                      </div>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="checkbox"
                          checked={!!selected.content.noWrap}
                          onChange={(e) => patchContent(selected.id, { noWrap: e.target.checked })}
                          className="rounded border-border"
                        />
                        <span className="text-muted-foreground">No wrap</span>
                      </label>
                      <div className="flex items-center gap-2">
                        <input type="color" value={toHex(selected.content.color)} onChange={(e) => patchContent(selected.id, { color: e.target.value })} className="h-8 w-8 rounded border border-border" title={selected.content.spans ? "Fallback color" : "Text color"} />
                        <select
                          value={selected.content.align}
                          onChange={(e) => patchContent(selected.id, { align: e.target.value as Align })}
                          className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                        >
                          <option value="left">Left</option>
                          <option value="center">Center</option>
                          <option value="right">Right</option>
                        </select>
                      </div>
                    </div>
                  )}
                  {selected.type === "image" && (
                    <div className="space-y-2 border-t border-border pt-2">
                      <div className="space-y-1.5">
                        <span className="text-muted-foreground">Source</span>
                        <div className="flex gap-1.5">
                          {(["free", "asset"] as const).map((mode) => (
                            <button key={mode}
                              onClick={() => patchContent(selected.id, { source: mode })}
                              className={cn(
                                "flex-1 rounded-md border px-2 py-1 text-xs transition-colors",
                                (selected.content.source ?? "asset") === mode
                                  ? "border-primary bg-primary/10 text-primary font-medium"
                                  : "border-border text-muted-foreground hover:border-ring"
                              )}
                            >
                              {mode === "asset" ? "Source asset" : "Free select"}
                            </button>
                          ))}
                        </div>
                        {(selected.content.source ?? "asset") === "asset" && (
                          <p className="text-[10px] text-muted-foreground">Image filled from the source asset when using Fill from record.</p>
                        )}
                      </div>
                      {(selected.content.source ?? "asset") === "free" && (
                        <label className="block">
                          <span className="text-muted-foreground">Preview URL</span>
                          <Input value={selected.content.src} onChange={(e) => patchContent(selected.id, { src: e.target.value })} placeholder="https://…" className="mt-1 h-8 text-xs" />
                        </label>
                      )}
                      <select
                        value={selected.content.fit}
                        onChange={(e) => patchContent(selected.id, { fit: e.target.value as Fit })}
                        className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                      >
                        <option value="cover">Cover</option>
                        <option value="contain">Contain</option>
                        <option value="fill">Fill</option>
                      </select>
                    </div>
                  )}
                  {selected.type === "shape" && (
                    <div className="space-y-2 border-t border-border pt-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={selected.content.shape}
                          onChange={(e) => patchContent(selected.id, { shape: e.target.value as ShapeContent["shape"] })}
                          className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                        >
                          <option value="rectangle">Rectangle</option>
                          <option value="ellipse">Ellipse</option>
                        </select>
                        <select
                          value={selected.content.fillType}
                          onChange={(e) => patchContent(selected.id, { fillType: e.target.value as ShapeContent["fillType"] })}
                          className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                        >
                          <option value="color">Color fill</option>
                          <option value="none">Transparent</option>
                          <option value="image">Image fill</option>
                        </select>
                      </div>

                      {selected.content.fillType === "color" && (
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground">Fill</span>
                          <input type="color" value={selected.content.fill} onChange={(e) => patchContent(selected.id, { fill: e.target.value })} className="h-8 w-8 rounded border border-border" />
                        </div>
                      )}
                      {selected.content.fillType === "image" && (
                        <div className="space-y-2">
                          <Input value={selected.content.src} onChange={(e) => patchContent(selected.id, { src: e.target.value })} placeholder="Image URL https://…" className="h-8 text-xs" />
                          <select
                            value={selected.content.imageFit}
                            onChange={(e) => patchContent(selected.id, { imageFit: e.target.value as Fit })}
                            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
                          >
                            <option value="cover">Cover</option>
                            <option value="contain">Contain</option>
                            <option value="fill">Fill</option>
                          </select>
                        </div>
                      )}

                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Stroke</span>
                        <input type="color" value={selected.content.stroke} onChange={(e) => patchContent(selected.id, { stroke: e.target.value })} className="h-8 w-8 rounded border border-border" />
                        <label className="flex flex-1 items-center gap-1">
                          <span className="text-muted-foreground">w</span>
                          <Input type="number" value={selected.content.strokeWidth} onChange={(e) => patchContent(selected.id, { strokeWidth: Number(e.target.value) || 0 })} className="h-8 text-xs" />
                        </label>
                        <label className="flex flex-1 items-center gap-1">
                          <span className="text-muted-foreground">r</span>
                          <Input type="number" value={selected.content.radius} onChange={(e) => patchContent(selected.id, { radius: Number(e.target.value) || 0 })} className="h-8 text-xs" disabled={selected.content.shape === "ellipse"} />
                        </label>
                      </div>
                      <p className="text-[10px] text-muted-foreground">Add layers while this shape is selected to nest them inside it.</p>
                    </div>
                  )}
                  {selected.type === "button" && (
                    <div className="space-y-2 border-t border-border pt-2">
                      <label className="block">
                        <span className="text-muted-foreground">Label</span>
                        <Input value={selected.content.label} onChange={(e) => patchContent(selected.id, { label: e.target.value })} className="mt-1 h-8 text-xs" />
                      </label>
                      <div className="flex items-center gap-2">
                        <span className="text-muted-foreground">Text</span>
                        <input type="color" value={selected.content.color} onChange={(e) => patchContent(selected.id, { color: e.target.value })} className="h-8 w-8 rounded border border-border" />
                        <span className="text-muted-foreground">Fill</span>
                        <input type="color" value={selected.content.background} onChange={(e) => patchContent(selected.id, { background: e.target.value })} className="h-8 w-8 rounded border border-border" />
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <label className="block">
                          <span className="text-muted-foreground">Size</span>
                          <Input type="number" value={selected.content.fontSize} onChange={(e) => patchContent(selected.id, { fontSize: Number(e.target.value) || 1 })} className="mt-1 h-8 text-xs" />
                        </label>
                        <label className="block">
                          <span className="text-muted-foreground">Radius</span>
                          <Input type="number" value={selected.content.radius} onChange={(e) => patchContent(selected.id, { radius: Number(e.target.value) || 0 })} className="mt-1 h-8 text-xs" />
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {showJson && (
                <pre className="max-h-[50vh] overflow-auto rounded-xl border border-border bg-muted p-3 font-mono text-[11px] leading-relaxed">
                  {json}
                </pre>
              )}
            </aside>
          </div>
        </div>
      </div>

      {/* Figma import modal */}
      <Dialog open={figmaModalOpen} onOpenChange={setFigmaModalOpen}>
        <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Import from Figma</DialogTitle>
            <DialogDescription>Paste a Figma file or frame URL, find frames, then import directly into the canvas.</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-y-auto flex flex-col gap-5 py-2">
            {figmaConnected === null && (
              <p className="text-sm text-muted-foreground">Checking Figma connection…</p>
            )}
            {figmaConnected === false && (
              <div className="rounded-lg border border-yellow-300 bg-yellow-50 p-4">
                <p className="font-semibold text-sm mb-2">Not connected to Figma</p>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault()
                    const params = new URLSearchParams()
                    const cid = localStorage.getItem("figma_client_id")
                    const csec = localStorage.getItem("figma_client_secret")
                    const redir = localStorage.getItem("figma_oauth_redirect")
                    if (cid) params.set("figma_client_id", cid)
                    if (csec) params.set("figma_client_secret", csec)
                    if (redir) params.set("figma_oauth_redirect", redir)
                    const qs = params.toString()
                    window.location.href = `/api/figma-import/oauth/start${qs ? `?${qs}` : ""}`
                  }}
                  className="inline-flex items-center gap-2 bg-primary text-primary-foreground text-sm font-medium px-4 py-2 rounded-full hover:opacity-90 transition-opacity no-underline cursor-pointer"
                >
                  Connect to Figma →
                </a>
              </div>
            )}
            {figmaConnected === true && (
              <>
                <div className="flex gap-2">
                  <Input
                    value={figmaUrl}
                    onChange={(e) => { setFigmaUrl(e.target.value); setFigmaPages(null); setFigmaSelectedIds(new Set()) }}
                    onKeyDown={(e) => e.key === "Enter" && findFigmaFrames()}
                    placeholder="https://www.figma.com/design/…"
                    className="flex-1"
                  />
                  <Button onClick={findFigmaFrames} disabled={!figmaUrl.trim() || figmaFinding} variant="outline">
                    {figmaFinding ? "Finding…" : "Find frames"}
                  </Button>
                </div>

                {figmaPages && figmaPages.length === 0 && (
                  <p className="text-sm text-muted-foreground">No frames found in this file.</p>
                )}
                {figmaPages && figmaPages.length > 0 && (
                  <div className="flex flex-col gap-4">
                    {figmaPages.map((page) => (
                      <div key={page.id}>
                        <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">{page.name}</p>
                        <div className="flex flex-wrap gap-2">
                          {page.frames.map((frame) => {
                            const active = figmaSelectedIds.has(frame.id)
                            return (
                              <button
                                key={frame.id}
                                onClick={() => setFigmaSelectedIds((prev) => {
                                  const next = new Set(prev)
                                  if (next.has(frame.id)) next.delete(frame.id)
                                  else next.add(frame.id)
                                  return next
                                })}
                                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium border transition-colors cursor-pointer ${active ? "border-primary bg-primary/10 text-primary" : "border-border bg-background text-foreground hover:border-primary/50"}`}
                              >
                                <Layers className="h-3 w-3" />
                                {frame.name}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          <DialogFooter className="flex-row items-center justify-between gap-3 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {figmaSelectedIds.size > 0 ? `${figmaSelectedIds.size} frame${figmaSelectedIds.size !== 1 ? "s" : ""} selected — each becomes its own canvas tab.` : "Select one or more frames above, or paste a direct frame URL to import it."}
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setFigmaModalOpen(false)}>Cancel</Button>
              <Button onClick={importFigmaFrames} disabled={!figmaUrl.trim() || figmaImporting || figmaConnected !== true}>
                {figmaImporting ? "Importing…" : "Import"}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* HTML modal */}
      <Dialog open={htmlModalOpen} onOpenChange={setHtmlModalOpen}>
        <DialogContent className="sm:max-w-[90vw] max-h-[92vh] flex flex-col">
          <DialogHeader>
            <DialogTitle>Paste HTML</DialogTitle>
            <DialogDescription>Preview renders at canvas dimensions — {layout.width} × {layout.height} px</DialogDescription>
          </DialogHeader>

          <div className="flex-1 overflow-hidden grid grid-cols-2 gap-0 border border-border rounded-lg min-h-0">
            <div className="flex flex-col border-r border-border p-4">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground mb-2">HTML source</p>
              <textarea
                value={htmlSource}
                onChange={(e) => setHtmlSource(e.target.value)}
                placeholder={"<!DOCTYPE html>\n<html>\n  <body>\n    …\n  </body>\n</html>"}
                spellCheck={false}
                className="flex-1 font-mono text-xs leading-relaxed border border-border rounded-lg p-3 outline-none resize-none bg-background text-foreground"
              />
            </div>
            <div className="p-4 bg-muted/30 overflow-auto flex flex-col gap-3">
              <p className="text-xs font-mono uppercase tracking-widest text-muted-foreground">
                Preview — {layout.width} × {layout.height} px
              </p>
              <div style={{ position: "relative", width: layout.width * htmlPreviewScale, height: layout.height * htmlPreviewScale, flexShrink: 0 }} className="border border-border rounded-lg overflow-hidden bg-white">
                <iframe
                  key={htmlSource}
                  srcDoc={htmlSource.trim() || `<body style="margin:0;height:100vh;display:flex;align-items:center;justify-content:center;color:#bbb;font-family:sans-serif;font-size:13px">Paste HTML to preview</body>`}
                  sandbox="allow-scripts"
                  style={{ position: "absolute", left: 0, top: 0, width: layout.width, height: layout.height, border: "none", transform: `scale(${htmlPreviewScale})`, transformOrigin: "top left" }}
                />
              </div>
            </div>
          </div>

          <DialogFooter className="flex-row items-center justify-between gap-3 sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Converts the HTML to canvas layers using the current canvas dimensions ({layout.width} × {layout.height} px).
            </p>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setHtmlModalOpen(false)}>Cancel</Button>
              <Button onClick={loadHtmlIntoCanvas} disabled={!htmlSource.trim()}>Load into canvas</Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
