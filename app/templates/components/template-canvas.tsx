"use client"

import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
} from "react"
import {
  drawTemplate,
  estimateContentHeight,
  focalAreaOnCanvas,
} from "../lib/renderer"
import type { Anchor, DrawState, Format } from "../types"
import "./template-canvas.css"

export interface TemplateCanvasHandle {
  render: () => void
  readonly canvasEl: HTMLCanvasElement | null
}

export interface TemplateCanvasProps {
  format: Format
  drawState: DrawState
  croppedEl?: HTMLImageElement | null
  sourceType?: "image" | "video"
  selected?: boolean
}

export const TemplateCanvas = forwardRef<TemplateCanvasHandle, TemplateCanvasProps>(
  function TemplateCanvas(
    {
      format,
      drawState,
      croppedEl = null,
      sourceType = "image",
      selected = false,
    },
    ref,
  ) {
    const canvasRef = useRef<HTMLCanvasElement | null>(null)
    const renderQueuedRef = useRef(false)

    function render() {
      const canvas = canvasRef.current
      if (!canvas) return
      const bw = format.w
      const bh = format.h
      if (!bw || !bh) return

      // HiDPI: buffer = device pixels, CSS = logical pixels.
      // Draw calls stay in logical coords thanks to ctx.scale(dpr).
      const dpr = window.devicePixelRatio || 1
      canvas.width = bw * dpr
      canvas.height = bh * dpr
      canvas.style.width = bw + "px"
      canvas.style.height = bh + "px"

      const ctx = canvas.getContext("2d")
      if (!ctx) return
      ctx.scale(dpr, dpr)

      const usesCrop = !!croppedEl
      const ds: DrawState = {
        ...drawState,
        el: croppedEl ?? drawState.el,
        focalX: usesCrop ? 0.5 : drawState.focalX ?? 0.5,
        focalY: usesCrop ? 0.5 : drawState.focalY ?? 0.5,
      }
      drawTemplate(ctx, bw, bh, format, ds)
    }

    function queueRender() {
      if (renderQueuedRef.current) return
      renderQueuedRef.current = true
      requestAnimationFrame(() => {
        renderQueuedRef.current = false
        render()
      })
    }

    // Re-render on draw input changes.
    useEffect(() => {
      queueRender()
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [drawState, croppedEl, format])

    // Imperative handle — the page builds a per-format ref map and uses
    // .render() / .canvasEl for renderAllCanvases() and video export.
    // No deps array → handle re-computes each render with fresh closure.
    useImperativeHandle(ref, () => ({
      render,
      get canvasEl() {
        return canvasRef.current
      },
    }))

    // Focal area overlay rect — must mirror exact same params used by
    // drawTemplate so the dashed overlay matches the actual image placement.
    const focalOverlay = useMemo<React.CSSProperties | null>(() => {
      const ds = drawState
      const el = ds.el
      if (!el || croppedEl) return null
      if (ds.focalW == null || ds.focalH == null) return null

      const img = el as HTMLImageElement
      const sw = img.naturalWidth || img.width || 0
      const sh = img.naturalHeight || img.height || 0
      if (!sw || !sh) return null

      const fmt = format
      const anchor = (fmt.anchor || "bl") as Anchor
      const cwPct = fmt.contentWidth ?? 60
      const contentAware = ds.contentAwareFocal !== false
      const fitMode = ds.focalFit || "cover"

      const layers = (ds.layers ?? [])
        .filter((l) => (fmt.visibleLayers ? fmt.visibleLayers.includes(l.id) : true))
        .filter((l) => l.value)

      const contentInfo = {
        layers,
        styles: ds,
        contentScale: fmt.contentScale || 1,
        ctaScale: fmt.ctaScale || 1,
        fmt,
      }
      const estContentH = estimateContentHeight(fmt.w, fmt.h, cwPct, contentInfo)

      const r = focalAreaOnCanvas(
        fmt.w,
        fmt.h,
        sw,
        sh,
        ds.focalX ?? 0.5,
        ds.focalY ?? 0.5,
        ds.focalW,
        ds.focalH,
        anchor,
        contentAware,
        cwPct,
        estContentH,
        fitMode,
      )

      return {
        left: r.x1 * 100 + "%",
        top: r.y1 * 100 + "%",
        width: (r.x2 - r.x1) * 100 + "%",
        height: (r.y2 - r.y1) * 100 + "%",
      }
    }, [drawState, croppedEl, format])

    return (
      <div className={`format-card${selected ? " selected" : ""}`}>
        <div className="canvas-wrap">
          <canvas ref={canvasRef} className="format-canvas" />
          {focalOverlay && (
            <div className="focal-area-overlay" style={focalOverlay} />
          )}
          {sourceType === "video" && (
            <div className="video-live-badge">
              <div className="video-live-dot" /> LIVE
            </div>
          )}
        </div>
        <div className="card-label-bar">
          <span className="card-format-name">{format.label}</span>
          <span className="card-format-dims">
            {format.w} × {format.h}
          </span>
        </div>
      </div>
    )
  },
)
