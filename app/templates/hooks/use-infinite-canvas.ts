"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  CARD_GAP,
  DEFAULT_ZOOM,
  MAX_ZOOM,
  MIN_ZOOM,
  ZOOM_STEP,
} from "../lib/constants"
import { useTemplateBuilder } from "../stores/use-template-builder"
import type { CanvasPosition, Format, FormatId } from "../types"

// Snap threshold in screen pixels. Divided by current zoom inside computeSnap
// so the visual feel stays consistent regardless of how zoomed in/out you
// are. 8 is more forgiving than the original Vue's 4 (which felt too tight).
const SNAP_THRESHOLD = 8

export type ResizeHandle = "n" | "s" | "e" | "w" | "ne" | "nw" | "se" | "sw"

export interface SnapGuide {
  axis: "x" | "y"
  pos: number
}

interface DrawRectState {
  active: boolean
  startX: number
  startY: number
  endX: number
  endY: number
}

export interface UseInfiniteCanvasOptions {
  canDraw?: () => boolean
  onFormatCreated?: (id: FormatId) => void
  onFormatResized?: (id: FormatId) => void
}

export interface InfiniteCanvas {
  // Container — assign as `ref={containerRef}` on the viewport element
  containerRef: (el: HTMLElement | null) => void

  // Viewport state (read by render)
  panX: number
  panY: number
  zoom: number
  zoomPercent: number
  worldStyle: React.CSSProperties

  // Interaction state
  isPanning: boolean
  isSpaceHeld: boolean
  isDraggingCard: boolean
  isResizingCard: boolean
  dragCardId: FormatId | null
  selectedFormatId: FormatId | null
  setSelectedFormatId: (id: FormatId | null) => void
  resizeHandle: ResizeHandle | null
  cursorClass: string

  // Snap guides (rendered as DOM lines)
  snapGuides: SnapGuide[]

  // Draw-to-create rectangle
  drawRect: DrawRectState
  drawRectStyle: React.CSSProperties | null

  // Coordinate transforms
  worldToScreen: (wx: number, wy: number) => { x: number; y: number }
  screenToWorld: (sx: number, sy: number) => { x: number; y: number }

  // Layout / zoom
  autoLayout: () => void
  fitAll: () => void
  zoomToFormat: (formatId: FormatId) => void
  resetZoom: () => void
  zoomIn: () => void
  zoomOut: () => void
  zoomAtPoint: (cx: number, cy: number, factor: number) => void

  // Pointer event handlers (bind to viewport)
  onPointerDown: (e: React.PointerEvent) => void
  onPointerMove: (e: React.PointerEvent) => void
  onPointerUp: (e: React.PointerEvent) => void
}

export function useInfiniteCanvas(
  opts: UseInfiniteCanvasOptions = {},
): InfiniteCanvas {
  // ── Viewport state ──────────────────────────────────────────────
  const [panX, setPanX] = useState(0)
  const [panY, setPanY] = useState(0)
  const [zoom, setZoom] = useState(DEFAULT_ZOOM)

  const panXRef = useRef(panX)
  const panYRef = useRef(panY)
  const zoomRef = useRef(zoom)
  panXRef.current = panX
  panYRef.current = panY
  zoomRef.current = zoom

  // ── Interaction state ────────────────────────────────────────────
  const [isPanning, setIsPanning] = useState(false)
  const [isSpaceHeld, setIsSpaceHeld] = useState(false)
  const [isDraggingCard, setIsDraggingCard] = useState(false)
  const [isResizingCard, setIsResizingCard] = useState(false)
  const [dragCardId, setDragCardId] = useState<FormatId | null>(null)
  const [selectedFormatId, setSelectedFormatIdState] = useState<FormatId | null>(null)
  const [resizeHandle, setResizeHandle] = useState<ResizeHandle | null>(null)

  const isPanningRef = useRef(false)
  const isSpaceHeldRef = useRef(false)
  const isDraggingCardRef = useRef(false)
  const isResizingCardRef = useRef(false)
  const dragCardIdRef = useRef<FormatId | null>(null)
  const selectedFormatIdRef = useRef<FormatId | null>(null)
  const resizeHandleRef = useRef<ResizeHandle | null>(null)
  isPanningRef.current = isPanning
  isSpaceHeldRef.current = isSpaceHeld
  isDraggingCardRef.current = isDraggingCard
  isResizingCardRef.current = isResizingCard
  dragCardIdRef.current = dragCardId
  selectedFormatIdRef.current = selectedFormatId
  resizeHandleRef.current = resizeHandle

  // ── Transient interaction refs ──────────────────────────────────
  const panStartRef = useRef<{ x: number; y: number; px: number; py: number } | null>(null)
  const dragStartRef = useRef<{ wx: number; wy: number } | null>(null)
  const dragOrigPosRef = useRef<{ x: number; y: number } | null>(null)
  const resizeStartRef = useRef<{ wx: number; wy: number } | null>(null)
  const resizeOrigRectRef = useRef<{ x: number; y: number; w: number; h: number } | null>(null)

  // ── Snap guides ──────────────────────────────────────────────────
  const [snapGuides, setSnapGuides] = useState<SnapGuide[]>([])

  // ── Draw-to-create ───────────────────────────────────────────────
  const [drawRect, setDrawRect] = useState<DrawRectState>({
    active: false, startX: 0, startY: 0, endX: 0, endY: 0,
  })
  const drawRectRef = useRef(drawRect)
  drawRectRef.current = drawRect

  // ── Container ref ────────────────────────────────────────────────
  // We need addEventListener('wheel', ..., { passive: false }) so React's
  // synthetic onWheel won't work — it attaches passively. Use a callback
  // ref so wheel listener (re)attaches as the element mounts/unmounts.
  const elRef = useRef<HTMLElement | null>(null)
  const wheelHandlerRef = useRef<((e: WheelEvent) => void) | null>(null)

  // ── Coordinate transforms ───────────────────────────────────────
  const worldToScreen = useCallback(
    (wx: number, wy: number) => ({
      x: wx * zoomRef.current + panXRef.current,
      y: wy * zoomRef.current + panYRef.current,
    }),
    [],
  )

  const screenToWorld = useCallback(
    (sx: number, sy: number) => ({
      x: (sx - panXRef.current) / zoomRef.current,
      y: (sy - panYRef.current) / zoomRef.current,
    }),
    [],
  )

  // ── Snap helpers ────────────────────────────────────────────────
  const collectSnapEdges = useCallback((excludeId: FormatId | null) => {
    const xs: number[] = []
    const ys: number[] = []
    const state = useTemplateBuilder.getState()
    for (const fmt of state.formats) {
      if (fmt.id === excludeId) continue
      const p = state.canvasPositions[fmt.id]
      if (!p) continue
      xs.push(p.x, p.x + fmt.w / 2, p.x + fmt.w)
      ys.push(p.y, p.y + fmt.h / 2, p.y + fmt.h)
    }
    return { xs, ys }
  }, [])

  type CardRect = { x: number; y: number; w: number; h: number }
  type EdgeName = "left" | "right" | "top" | "bottom"
  type SnapResult = { dx: number; dy: number; guides: SnapGuide[] }

  const computeSnap = useCallback(
    (rect: CardRect, excludeId: FormatId | null, onlyEdges?: EdgeName[]): SnapResult => {
      const edges = collectSnapEdges(excludeId)
      const guides: SnapGuide[] = []
      let dx = 0
      let dy = 0

      // Threshold scales inversely with zoom so snap feels the same whether
      // zoomed in or out. At zoom 1.0 it's SNAP_THRESHOLD world pixels; at
      // zoom 0.5 it's 2× world pixels (still SNAP_THRESHOLD screen pixels).
      const threshold = SNAP_THRESHOLD / Math.max(0.1, zoomRef.current)

      const allXs = { left: rect.x, centerX: rect.x + rect.w / 2, right: rect.x + rect.w }
      const allYs = { top: rect.y, centerY: rect.y + rect.h / 2, bottom: rect.y + rect.h }

      let cardXs: number[]
      let cardYs: number[]
      if (onlyEdges) {
        cardXs = []
        cardYs = []
        if (onlyEdges.includes("left")) cardXs.push(allXs.left)
        if (onlyEdges.includes("right")) cardXs.push(allXs.right)
        if (onlyEdges.includes("top")) cardYs.push(allYs.top)
        if (onlyEdges.includes("bottom")) cardYs.push(allYs.bottom)
      } else {
        cardXs = [allXs.left, allXs.centerX, allXs.right]
        cardYs = [allYs.top, allYs.centerY, allYs.bottom]
      }

      let bestDx = Infinity
      let bestSnapX: number | null = null
      for (const cx of cardXs) {
        for (const ex of edges.xs) {
          const d = Math.abs(cx - ex)
          if (d < threshold && d < Math.abs(bestDx)) {
            bestDx = ex - cx
            bestSnapX = ex
          }
        }
      }

      let bestDy = Infinity
      let bestSnapY: number | null = null
      for (const cy of cardYs) {
        for (const ey of edges.ys) {
          const d = Math.abs(cy - ey)
          if (d < threshold && d < Math.abs(bestDy)) {
            bestDy = ey - cy
            bestSnapY = ey
          }
        }
      }

      if (bestSnapX !== null) {
        dx = bestDx
        guides.push({ axis: "x", pos: bestSnapX })
      }
      if (bestSnapY !== null) {
        dy = bestDy
        guides.push({ axis: "y", pos: bestSnapY })
      }

      return { dx, dy, guides }
    },
    [collectSnapEdges],
  )

  // ── Auto-layout ──────────────────────────────────────────────────
  const autoLayout = useCallback(() => {
    const state = useTemplateBuilder.getState()
    const formats = state.formats
    if (!formats.length) return

    const unplaced = formats.filter((f) => !state.canvasPositions[f.id])
    const placed = formats.filter((f) => state.canvasPositions[f.id])
    if (!unplaced.length) return

    unplaced.sort((a, b) => a.h / a.w - b.h / b.w)

    const MAX_ROW_W = 3600
    let cx = 0
    let cy = 0
    let rowH = 0

    if (placed.length) {
      let maxY = 0
      for (const f of placed) {
        const p = state.canvasPositions[f.id]
        maxY = Math.max(maxY, p.y + f.h)
      }
      cy = maxY + CARD_GAP * 2
    }

    for (const fmt of unplaced) {
      if (cx + fmt.w > MAX_ROW_W && cx > CARD_GAP) {
        cx = CARD_GAP
        cy += rowH + CARD_GAP
        rowH = 0
      }
      useTemplateBuilder.getState().setCanvasPosition(fmt.id, { x: cx, y: cy })
      cx += fmt.w + CARD_GAP
      rowH = Math.max(rowH, fmt.h)
    }
  }, [])

  // ── Fit all / zoom to format ─────────────────────────────────────
  const fitAll = useCallback(() => {
    const el = elRef.current
    if (!el) return
    const state = useTemplateBuilder.getState()
    if (!state.formats.length) return

    const { width: vw, height: vh } = el.getBoundingClientRect()
    if (!vw || !vh) return

    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity
    for (const fmt of state.formats) {
      const pos: CanvasPosition = state.canvasPositions[fmt.id] ?? { x: 0, y: 0 }
      minX = Math.min(minX, pos.x)
      minY = Math.min(minY, pos.y)
      maxX = Math.max(maxX, pos.x + fmt.w)
      maxY = Math.max(maxY, pos.y + fmt.h)
    }

    const worldW = maxX - minX
    const worldH = maxY - minY
    if (worldW <= 0 || worldH <= 0) return

    const PAD = 60
    const zx = (vw - PAD * 2) / worldW
    const zy = (vh - PAD * 2) / worldH
    const z = Math.max(MIN_ZOOM, Math.min(zx, zy, 1.0))

    setZoom(z)
    setPanX((vw - worldW * z) / 2 - minX * z)
    setPanY((vh - worldH * z) / 2 - minY * z)
  }, [])

  const zoomToFormat = useCallback((formatId: FormatId) => {
    const el = elRef.current
    if (!el) return
    const state = useTemplateBuilder.getState()
    const fmt = state.formats.find((f) => f.id === formatId)
    if (!fmt) return
    const pos: CanvasPosition = state.canvasPositions[fmt.id] ?? { x: 0, y: 0 }
    const { width: vw, height: vh } = el.getBoundingClientRect()
    if (!vw || !vh) return

    const PAD = 80
    const zx = (vw - PAD * 2) / fmt.w
    const zy = (vh - PAD * 2) / fmt.h
    const z = Math.max(MIN_ZOOM, Math.min(zx, zy, 1.0))

    setZoom(z)
    setPanX((vw - fmt.w * z) / 2 - pos.x * z)
    setPanY((vh - fmt.h * z) / 2 - pos.y * z)
  }, [])

  // ── Zoom ─────────────────────────────────────────────────────────
  const zoomAtPoint = useCallback((cx: number, cy: number, factor: number) => {
    const oldZoom = zoomRef.current
    const newZoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, oldZoom * factor))
    const newPanX = cx - (cx - panXRef.current) * (newZoom / oldZoom)
    const newPanY = cy - (cy - panYRef.current) * (newZoom / oldZoom)
    setPanX(newPanX)
    setPanY(newPanY)
    setZoom(newZoom)
  }, [])

  const zoomIn = useCallback(() => {
    const el = elRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    zoomAtPoint(width / 2, height / 2, ZOOM_STEP * ZOOM_STEP)
  }, [zoomAtPoint])

  const zoomOut = useCallback(() => {
    const el = elRef.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    zoomAtPoint(width / 2, height / 2, 1 / (ZOOM_STEP * ZOOM_STEP))
  }, [zoomAtPoint])

  const resetZoom = useCallback(() => {
    const el = elRef.current
    if (!el) {
      setZoom(1)
      return
    }
    const { width: vw, height: vh } = el.getBoundingClientRect()
    const cx = vw / 2,
      cy = vh / 2
    const worldCX = (cx - panXRef.current) / zoomRef.current
    const worldCY = (cy - panYRef.current) / zoomRef.current
    setZoom(1)
    setPanX(cx - worldCX)
    setPanY(cy - worldCY)
  }, [])

  // ── Selected format setter (also sets store activeSettingsId) ───
  const setSelectedFormatId = useCallback((id: FormatId | null) => {
    setSelectedFormatIdState(id)
    useTemplateBuilder.getState().setActiveSettingsId(id)
  }, [])

  // ── Pointer handlers ─────────────────────────────────────────────
  const getMouseWorld = useCallback(
    (e: React.PointerEvent | PointerEvent) => {
      const el = elRef.current
      if (!el) return { mx: 0, my: 0, wx: 0, wy: 0 }
      const rect = el.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const w = screenToWorld(mx, my)
      return { mx, my, wx: w.x, wy: w.y }
    },
    [screenToWorld],
  )

  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const el = elRef.current
      if (!el) return
      const { wx, wy } = getMouseWorld(e)

      // Middle-click or Space+left-click → pan
      if (e.button === 1 || (e.button === 0 && isSpaceHeldRef.current)) {
        e.preventDefault()
        setIsPanning(true)
        panStartRef.current = {
          x: e.clientX,
          y: e.clientY,
          px: panXRef.current,
          py: panYRef.current,
        }
        el.setPointerCapture(e.pointerId)
        return
      }

      if (e.button !== 0) return

      // Resize handle?
      const target = e.target as HTMLElement
      const handleEl = target.closest<HTMLElement>("[data-resize-handle]")
      if (handleEl) {
        const cardEl = handleEl.closest<HTMLElement>("[data-format-id]")
        if (cardEl) {
          const fmtId = cardEl.dataset.formatId
          const handle = handleEl.dataset.resizeHandle as ResizeHandle | undefined
          const state = useTemplateBuilder.getState()
          const fmt = fmtId ? state.formats.find((f) => f.id === fmtId) : null
          const pos = fmtId ? state.canvasPositions[fmtId] ?? { x: 0, y: 0 } : null
          if (fmt && fmtId && handle && pos) {
            e.stopPropagation()
            setSelectedFormatId(fmtId)
            setIsResizingCard(true)
            setDragCardId(fmtId)
            setResizeHandle(handle)
            resizeStartRef.current = { wx, wy }
            resizeOrigRectRef.current = { x: pos.x, y: pos.y, w: fmt.w, h: fmt.h }
            el.setPointerCapture(e.pointerId)
            return
          }
        }
      }

      // Card drag?
      const cardEl = target.closest<HTMLElement>("[data-format-id]")
      if (cardEl) {
        if (target.closest("button")) return
        const fmtId = cardEl.dataset.formatId
        if (!fmtId) return
        setSelectedFormatId(fmtId)

        setIsDraggingCard(true)
        setDragCardId(fmtId)
        const pos = useTemplateBuilder.getState().canvasPositions[fmtId] ?? { x: 0, y: 0 }
        dragStartRef.current = { wx, wy }
        dragOrigPosRef.current = { x: pos.x, y: pos.y }
        el.setPointerCapture(e.pointerId)
        return
      }

      // Empty space — draw-to-create or deselect
      setSelectedFormatId(null)

      if (opts.canDraw && !opts.canDraw()) return

      setDrawRect({ active: true, startX: wx, startY: wy, endX: wx, endY: wy })
      el.setPointerCapture(e.pointerId)
    },
    [getMouseWorld, opts, setSelectedFormatId],
  )

  const onPointerMove = useCallback(
    (e: React.PointerEvent) => {
      // Pan
      if (isPanningRef.current && panStartRef.current) {
        const start = panStartRef.current
        setPanX(start.px + (e.clientX - start.x))
        setPanY(start.py + (e.clientY - start.y))
        return
      }

      // Resize
      if (
        isResizingCardRef.current &&
        resizeStartRef.current &&
        resizeOrigRectRef.current &&
        dragCardIdRef.current &&
        resizeHandleRef.current
      ) {
        const { wx, wy } = getMouseWorld(e)
        const dx = wx - resizeStartRef.current.wx
        const dy = wy - resizeStartRef.current.wy
        const h = resizeHandleRef.current
        const orig = resizeOrigRectRef.current
        const MIN_SIZE = 40

        let nx = orig.x,
          ny = orig.y,
          nw = orig.w,
          nh = orig.h

        if (h.includes("e")) {
          nw = Math.max(MIN_SIZE, Math.round(orig.w + dx))
        } else if (h.includes("w")) {
          const dw = Math.min(dx, orig.w - MIN_SIZE)
          nx = Math.round(orig.x + dw)
          nw = Math.round(orig.w - dw)
        }

        if (h.includes("s")) {
          nh = Math.max(MIN_SIZE, Math.round(orig.h + dy))
        } else if (h.includes("n")) {
          const dh = Math.min(dy, orig.h - MIN_SIZE)
          ny = Math.round(orig.y + dh)
          nh = Math.round(orig.h - dh)
        }

        const movingEdges: EdgeName[] = []
        if (h.includes("e")) movingEdges.push("right")
        if (h.includes("w")) movingEdges.push("left")
        if (h.includes("s")) movingEdges.push("bottom")
        if (h.includes("n")) movingEdges.push("top")

        const snapRect: CardRect = { x: nx, y: ny, w: nw, h: nh }
        const snap = computeSnap(snapRect, dragCardIdRef.current, movingEdges)

        if (snap.dx !== 0) {
          if (h.includes("e")) nw += snap.dx
          else if (h.includes("w")) {
            nx += snap.dx
            nw -= snap.dx
          }
        }
        if (snap.dy !== 0) {
          if (h.includes("s")) nh += snap.dy
          else if (h.includes("n")) {
            ny += snap.dy
            nh -= snap.dy
          }
        }
        setSnapGuides(snap.guides)

        const id = dragCardIdRef.current
        const store = useTemplateBuilder.getState()
        store.setCanvasPosition(id, { x: nx, y: ny })
        store.updateFormat(id, "w", Math.max(MIN_SIZE, nw))
        store.updateFormat(id, "h", Math.max(MIN_SIZE, nh))
        return
      }

      // Card drag
      if (
        isDraggingCardRef.current &&
        dragStartRef.current &&
        dragOrigPosRef.current &&
        dragCardIdRef.current
      ) {
        const { wx, wy } = getMouseWorld(e)
        const dx = wx - dragStartRef.current.wx
        const dy = wy - dragStartRef.current.wy
        let newX = Math.round(dragOrigPosRef.current.x + dx)
        let newY = Math.round(dragOrigPosRef.current.y + dy)

        const id = dragCardIdRef.current
        const store = useTemplateBuilder.getState()
        const fmt: Format | undefined = store.formats.find((f) => f.id === id)
        if (fmt) {
          const snap = computeSnap(
            { x: newX, y: newY, w: fmt.w, h: fmt.h },
            id,
          )
          newX += snap.dx
          newY += snap.dy
          setSnapGuides(snap.guides)
        }

        store.setCanvasPosition(id, { x: newX, y: newY })
        return
      }

      // Draw-to-create
      if (drawRectRef.current.active) {
        const { wx, wy } = getMouseWorld(e)
        setDrawRect((prev) => ({ ...prev, endX: wx, endY: wy }))
      }
    },
    [getMouseWorld, computeSnap],
  )

  const onPointerUp = useCallback(
    (_e: React.PointerEvent) => {
      setSnapGuides([])

      if (isPanningRef.current) {
        setIsPanning(false)
        panStartRef.current = null
        return
      }

      if (isResizingCardRef.current) {
        // Capture id before clearing — original passed null to onFormatResized.
        const resizedId = dragCardIdRef.current
        setIsResizingCard(false)
        setResizeHandle(null)
        setDragCardId(null)
        resizeStartRef.current = null
        resizeOrigRectRef.current = null
        if (resizedId && opts.onFormatResized) opts.onFormatResized(resizedId)
        return
      }

      if (isDraggingCardRef.current) {
        setIsDraggingCard(false)
        setDragCardId(null)
        dragStartRef.current = null
        dragOrigPosRef.current = null
        return
      }

      if (drawRectRef.current.active) {
        const dr = drawRectRef.current
        setDrawRect({ active: false, startX: 0, startY: 0, endX: 0, endY: 0 })
        const w = Math.round(Math.abs(dr.endX - dr.startX))
        const h = Math.round(Math.abs(dr.endY - dr.startY))
        if (w > 50 && h > 50) {
          const x = Math.round(Math.min(dr.startX, dr.endX))
          const y = Math.round(Math.min(dr.startY, dr.endY))
          const label = `Custom ${w}×${h}`
          const id = useTemplateBuilder.getState().addFormat(label, w, h, x, y)
          setSelectedFormatId(id)
          opts.onFormatCreated?.(id)
        }
      }
    },
    [opts, setSelectedFormatId],
  )

  // ── Wheel listener (manual — must be non-passive) ───────────────
  const containerRef = useCallback((el: HTMLElement | null) => {
    // Detach old
    if (elRef.current && wheelHandlerRef.current) {
      elRef.current.removeEventListener("wheel", wheelHandlerRef.current)
    }
    elRef.current = el
    if (el) {
      const handler = (e: WheelEvent) => {
        e.preventDefault()
        const rect = el.getBoundingClientRect()
        const mx = e.clientX - rect.left
        const my = e.clientY - rect.top
        const factor = e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP
        zoomAtPoint(mx, my, factor)
      }
      el.addEventListener("wheel", handler, { passive: false })
      wheelHandlerRef.current = handler
    } else {
      wheelHandlerRef.current = null
    }
  }, [zoomAtPoint])

  // ── Keyboard listener ───────────────────────────────────────────
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      const inField =
        tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT"

      if (e.code === "Space" && !e.repeat) {
        if (inField) return
        e.preventDefault()
        setIsSpaceHeld(true)
      }

      if (e.key === "0" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        resetZoom()
        return
      }

      if (e.key === "1" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault()
        fitAll()
        return
      }

      if ((e.key === "Delete" || e.key === "Backspace") && selectedFormatIdRef.current) {
        if (tag === "INPUT" || tag === "TEXTAREA") return
        const id = selectedFormatIdRef.current
        useTemplateBuilder.getState().removeFormat(id)
        setSelectedFormatId(null)
      }
    }

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space") setIsSpaceHeld(false)
    }

    document.addEventListener("keydown", onKeyDown)
    document.addEventListener("keyup", onKeyUp)
    return () => {
      document.removeEventListener("keydown", onKeyDown)
      document.removeEventListener("keyup", onKeyUp)
    }
  }, [fitAll, resetZoom, setSelectedFormatId])

  // ── Computed values ─────────────────────────────────────────────
  const cursorClass = useMemo(() => {
    if (isPanning) return "cursor-grabbing"
    if (isSpaceHeld) return "cursor-grab"
    if (isResizingCard) {
      const h = resizeHandle
      if (h === "n" || h === "s") return "cursor-ns"
      if (h === "e" || h === "w") return "cursor-ew"
      if (h === "nw" || h === "se") return "cursor-nwse"
      if (h === "ne" || h === "sw") return "cursor-nesw"
      return "cursor-nwse"
    }
    if (isDraggingCard) return "cursor-move"
    return "cursor-default"
  }, [isPanning, isSpaceHeld, isResizingCard, isDraggingCard, resizeHandle])

  const worldStyle = useMemo<React.CSSProperties>(
    () => ({
      transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
      transformOrigin: "0 0",
    }),
    [panX, panY, zoom],
  )

  const zoomPercent = useMemo(() => Math.round(zoom * 100), [zoom])

  const drawRectStyle = useMemo<React.CSSProperties | null>(() => {
    if (!drawRect.active) return null
    const x = Math.min(drawRect.startX, drawRect.endX)
    const y = Math.min(drawRect.startY, drawRect.endY)
    const w = Math.abs(drawRect.endX - drawRect.startX)
    const h = Math.abs(drawRect.endY - drawRect.startY)
    return { left: x + "px", top: y + "px", width: w + "px", height: h + "px" }
  }, [drawRect])

  return {
    containerRef,
    panX, panY, zoom, zoomPercent, worldStyle,
    isPanning, isSpaceHeld, isDraggingCard, isResizingCard,
    dragCardId, selectedFormatId, setSelectedFormatId,
    resizeHandle, cursorClass,
    snapGuides,
    drawRect, drawRectStyle,
    worldToScreen, screenToWorld,
    autoLayout, fitAll, zoomToFormat, resetZoom,
    zoomIn, zoomOut, zoomAtPoint,
    onPointerDown, onPointerMove, onPointerUp,
  }
}
