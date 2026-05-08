"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import "./focal-point-picker.css"

export interface FocalPointPickerProps {
  sourceUrl: string
  focalX: number
  focalY: number
  focalW: number
  focalH: number
  /** Single change handler — called whenever any focal value moves. */
  onChange: (focal: { focalX: number; focalY: number; focalW: number; focalH: number }) => void
}

const MIN_SIZE = 0.08

type DragMode = "move" | "nw" | "ne" | "sw" | "se" | null

interface DragStart {
  mx: number
  my: number
  ox: number
  oy: number
  ow: number
  oh: number
}

function r(v: number): number {
  return Math.round(v * 1000) / 1000
}

function clampBox(
  x: number,
  y: number,
  w: number,
  h: number,
): { x: number; y: number; w: number; h: number } {
  w = Math.max(MIN_SIZE, Math.min(1, w))
  h = Math.max(MIN_SIZE, Math.min(1, h))
  x = Math.max(w / 2, Math.min(1 - w / 2, x))
  y = Math.max(h / 2, Math.min(1 - h / 2, y))
  return { x: r(x), y: r(y), w: r(w), h: r(h) }
}

export function FocalPointPicker({
  sourceUrl,
  focalX,
  focalY,
  focalW,
  focalH,
  onChange,
}: FocalPointPickerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [natW, setNatW] = useState(1600)
  const [natH, setNatH] = useState(1000)
  const [containerW, setContainerW] = useState(300)
  const [containerH, setContainerH] = useState(200)

  // Drag state — refs (don't trigger renders during drag)
  const draggingRef = useRef(false)
  const dragModeRef = useRef<DragMode>(null)
  const dragStartRef = useRef<DragStart | null>(null)
  // Mirror dragging state for cursor styling
  const [dragging, setDragging] = useState(false)

  // ── Image area within container (object-fit: contain) ──
  const imgArea = useMemo(() => {
    const cw = containerW
    const ch = containerH
    const imgAspect = natW / natH
    const containerAspect = cw / ch
    let iw, ih, ix, iy
    if (containerAspect > imgAspect) {
      ih = ch
      iw = ch * imgAspect
      ix = (cw - iw) / 2
      iy = 0
    } else {
      iw = cw
      ih = cw / imgAspect
      ix = 0
      iy = (ch - ih) / 2
    }
    return { x: ix, y: iy, w: iw, h: ih }
  }, [containerW, containerH, natW, natH])

  const imgAreaStyle: React.CSSProperties = {
    left: imgArea.x + "px",
    top: imgArea.y + "px",
    width: imgArea.w + "px",
    height: imgArea.h + "px",
  }

  const aspectStyle: React.CSSProperties = { aspectRatio: `${natW} / ${natH}` }

  const boxLeft = (focalX - focalW / 2) * 100 + "%"
  const boxTop = (focalY - focalH / 2) * 100 + "%"
  const boxWidth = focalW * 100 + "%"
  const boxHeight = focalH * 100 + "%"
  const crossX = focalX * 100 + "%"
  const crossY = focalY * 100 + "%"

  // Track container size with ResizeObserver
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const measure = () => {
      setContainerW(el.clientWidth)
      setContainerH(el.clientHeight)
    }
    measure()
    if (typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(() => measure())
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Reset img-loaded flag when sourceUrl changes
  useEffect(() => {
    setImgLoaded(false)
  }, [sourceUrl])

  function onImgLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget
    setImgLoaded(true)
    if (img.naturalWidth && img.naturalHeight) {
      setNatW(img.naturalWidth)
      setNatH(img.naturalHeight)
    }
    const el = containerRef.current
    if (el) {
      setContainerW(el.clientWidth)
      setContainerH(el.clientHeight)
    }
  }

  /**
   * Map a pointer event to normalised (0–1) coordinates within the visible
   * image area (not the container). Critical for object-fit:contain.
   */
  function getNormPos(e: React.PointerEvent<HTMLDivElement>) {
    const el = containerRef.current
    if (!el) return { nx: 0.5, ny: 0.5 }
    const rect = el.getBoundingClientRect()
    const cs = getComputedStyle(el)
    const bL = parseFloat(cs.borderLeftWidth) || 0
    const bT = parseFloat(cs.borderTopWidth) || 0
    return {
      nx: Math.max(
        0,
        Math.min(1, (e.clientX - rect.left - bL - imgArea.x) / imgArea.w),
      ),
      ny: Math.max(
        0,
        Math.min(1, (e.clientY - rect.top - bT - imgArea.y) / imgArea.h),
      ),
    }
  }

  function emitBox(x: number, y: number, w: number, h: number) {
    const c = clampBox(x, y, w, h)
    onChange({ focalX: c.x, focalY: c.y, focalW: c.w, focalH: c.h })
  }

  function hitTest(e: React.PointerEvent<HTMLDivElement>): DragMode | "reposition" {
    const { nx, ny } = getNormPos(e)
    const x1 = focalX - focalW / 2
    const y1 = focalY - focalH / 2
    const x2 = x1 + focalW
    const y2 = y1 + focalH
    const pxThresh = imgArea.w > 0 ? 12 / Math.min(imgArea.w, imgArea.h) : 0.04

    if (Math.abs(nx - x1) < pxThresh && Math.abs(ny - y1) < pxThresh) return "nw"
    if (Math.abs(nx - x2) < pxThresh && Math.abs(ny - y1) < pxThresh) return "ne"
    if (Math.abs(nx - x1) < pxThresh && Math.abs(ny - y2) < pxThresh) return "sw"
    if (Math.abs(nx - x2) < pxThresh && Math.abs(ny - y2) < pxThresh) return "se"
    if (nx >= x1 && nx <= x2 && ny >= y1 && ny <= y2) return "move"
    return "reposition"
  }

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    const mode = hitTest(e)
    const { nx, ny } = getNormPos(e)

    if (mode === "reposition") {
      emitBox(nx, ny, focalW, focalH)
      dragModeRef.current = "move"
    } else {
      dragModeRef.current = mode
    }

    draggingRef.current = true
    setDragging(true)
    dragStartRef.current = {
      mx: nx,
      my: ny,
      ox: focalX,
      oy: focalY,
      ow: focalW,
      oh: focalH,
    }

    try {
      containerRef.current?.setPointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!draggingRef.current) {
      const mode = hitTest(e)
      const el = containerRef.current
      if (!el) return
      if (mode === "nw" || mode === "se") el.style.cursor = "nwse-resize"
      else if (mode === "ne" || mode === "sw") el.style.cursor = "nesw-resize"
      else if (mode === "move") el.style.cursor = "move"
      else el.style.cursor = "crosshair"
      return
    }

    const { nx, ny } = getNormPos(e)
    const start = dragStartRef.current
    if (!start) return
    const { mx, my, ox, oy, ow, oh } = start
    const dx = nx - mx
    const dy = ny - my
    const mode = dragModeRef.current

    if (mode === "move") {
      emitBox(ox + dx, oy + dy, ow, oh)
    } else if (mode === "nw") {
      const anchorR = ox + ow / 2
      const anchorB = oy + oh / 2
      const newLeft = Math.min(anchorR - MIN_SIZE, ox - ow / 2 + dx)
      const newTop = Math.min(anchorB - MIN_SIZE, oy - oh / 2 + dy)
      const newW = anchorR - newLeft
      const newH = anchorB - newTop
      emitBox(newLeft + newW / 2, newTop + newH / 2, newW, newH)
    } else if (mode === "ne") {
      const anchorL = ox - ow / 2
      const anchorB = oy + oh / 2
      const newRight = Math.max(anchorL + MIN_SIZE, ox + ow / 2 + dx)
      const newTop = Math.min(anchorB - MIN_SIZE, oy - oh / 2 + dy)
      const newW = newRight - anchorL
      const newH = anchorB - newTop
      emitBox(anchorL + newW / 2, newTop + newH / 2, newW, newH)
    } else if (mode === "sw") {
      const anchorR = ox + ow / 2
      const anchorT = oy - oh / 2
      const newLeft = Math.min(anchorR - MIN_SIZE, ox - ow / 2 + dx)
      const newBottom = Math.max(anchorT + MIN_SIZE, oy + oh / 2 + dy)
      const newW = anchorR - newLeft
      const newH = newBottom - anchorT
      emitBox(newLeft + newW / 2, anchorT + newH / 2, newW, newH)
    } else if (mode === "se") {
      const anchorL = ox - ow / 2
      const anchorT = oy - oh / 2
      const newRight = Math.max(anchorL + MIN_SIZE, ox + ow / 2 + dx)
      const newBottom = Math.max(anchorT + MIN_SIZE, oy + oh / 2 + dy)
      const newW = newRight - anchorL
      const newH = newBottom - anchorT
      emitBox(anchorL + newW / 2, anchorT + newH / 2, newW, newH)
    }
  }

  function onPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    draggingRef.current = false
    dragModeRef.current = null
    setDragging(false)
    try {
      containerRef.current?.releasePointerCapture(e.pointerId)
    } catch {
      /* ignore */
    }
  }

  return (
    <div
      ref={containerRef}
      className={`fp-picker${dragging ? " dragging" : ""}`}
      style={aspectStyle}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
    >
      {sourceUrl && (
        <img
          src={sourceUrl}
          className="fp-img"
          crossOrigin="anonymous"
          onLoad={onImgLoad}
          draggable={false}
          alt=""
        />
      )}
      {(!sourceUrl || !imgLoaded) && <div className="fp-placeholder">No image</div>}

      {imgLoaded && (
        <div className="fp-img-area" style={imgAreaStyle}>
          <div className="fp-dim fp-dim-top" style={{ height: boxTop }} />
          <div
            className="fp-dim fp-dim-bottom"
            style={{
              top: `calc(${boxTop} + ${boxHeight})`,
              height: `calc(100% - ${boxTop} - ${boxHeight})`,
            }}
          />
          <div
            className="fp-dim fp-dim-left"
            style={{ top: boxTop, height: boxHeight, width: boxLeft }}
          />
          <div
            className="fp-dim fp-dim-right"
            style={{
              top: boxTop,
              height: boxHeight,
              left: `calc(${boxLeft} + ${boxWidth})`,
              width: `calc(100% - ${boxLeft} - ${boxWidth})`,
            }}
          />

          <div
            className="fp-box"
            style={{ left: boxLeft, top: boxTop, width: boxWidth, height: boxHeight }}
          >
            <div className="fp-handle fp-handle-nw" />
            <div className="fp-handle fp-handle-ne" />
            <div className="fp-handle fp-handle-sw" />
            <div className="fp-handle fp-handle-se" />
          </div>

          <div className="fp-crosshair" style={{ left: crossX, top: crossY }}>
            <div className="fp-line fp-line-h" />
            <div className="fp-line fp-line-v" />
            <div className="fp-dot" />
          </div>

          <div className="fp-grid">
            <div className="fp-grid-line fp-grid-v1" />
            <div className="fp-grid-line fp-grid-v2" />
            <div className="fp-grid-line fp-grid-h1" />
            <div className="fp-grid-line fp-grid-h2" />
          </div>
        </div>
      )}
    </div>
  )
}
