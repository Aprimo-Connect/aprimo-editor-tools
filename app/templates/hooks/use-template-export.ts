"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import { renderFullRes } from "../lib/renderer"
import { BLOB_REVOKE_DELAY } from "../lib/constants"
import { useTemplateBuilder } from "../stores/use-template-builder"
import type { DrawState, Format, FormatId } from "../types"

type CanvasRefMap = Record<FormatId, HTMLCanvasElement | null>

export interface UseTemplateExportDeps {
  drawState: DrawState
  croppedEls: Record<FormatId, HTMLImageElement>
  logoEl: HTMLImageElement | null
  sourceEl: HTMLImageElement | HTMLVideoElement | null
  sourceType: "image" | "video"
  sourceReady: boolean
  /** Refs to each TemplateCanvas's <canvas> DOM node — required for video export's MediaRecorder */
  canvasRefs: React.RefObject<CanvasRefMap>
}

export interface TemplateExporter {
  exportFormat: (id: FormatId) => Promise<void>
  exportAll: () => Promise<void>
  renderFullRes: (fmt: Format, opts?: { includeLogo?: boolean }) => HTMLCanvasElement
}

function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = Object.assign(document.createElement("a"), { href: url, download: filename })
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), BLOB_REVOKE_DELAY)
}

export function useTemplateExport(deps: UseTemplateExportDeps): TemplateExporter {
  const { drawState, croppedEls, logoEl, sourceEl, sourceType, sourceReady, canvasRefs } = deps

  const renderFmt = useCallback(
    (fmt: Format, opts: { includeLogo?: boolean } = {}): HTMLCanvasElement => {
      return renderFullRes(fmt, drawState, croppedEls, logoEl, opts)
    },
    [drawState, croppedEls, logoEl],
  )

  const exportImageFormat = useCallback(
    async (fmt: Format) => {
      // Try with logo; on tainted canvas, retry without
      try {
        const canvas = renderFmt(fmt, { includeLogo: true })
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/png"),
        )
        if (!blob) throw new Error("tainted")
        triggerDownload(blob, `${fmt.id}-${fmt.w}x${fmt.h}.png`)
      } catch {
        const canvas = renderFmt(fmt, { includeLogo: false })
        const blob = await new Promise<Blob | null>((resolve) =>
          canvas.toBlob((b) => resolve(b), "image/png"),
        )
        if (!blob) {
          throw new Error("Export failed — check CORS on the source image URL")
        }
        triggerDownload(blob, `${fmt.id}-${fmt.w}x${fmt.h}.png`)
        useTemplateBuilder
          .getState()
          .setStatus(
            "Downloaded — logo omitted (logo URL doesn't support cross-origin)",
            "ok",
          )
      }
    },
    [renderFmt],
  )

  const exportVideoFormat = useCallback(
    async (fmt: Format) => {
      const displayCanvas = canvasRefs.current?.[fmt.id]
      if (!displayCanvas) throw new Error("Canvas not found")

      if (!(sourceEl instanceof HTMLVideoElement)) {
        throw new Error("Source is not a video")
      }
      const video = sourceEl
      const duration = Math.min((video.duration || 10) * 1000, 30_000)

      const mimeType = MediaRecorder.isTypeSupported("video/webm;codecs=vp9")
        ? "video/webm;codecs=vp9"
        : MediaRecorder.isTypeSupported("video/webm")
          ? "video/webm"
          : null
      if (!mimeType) {
        throw new Error("WebM recording not supported in this browser — use Chrome or Edge.")
      }

      video.currentTime = 0
      await new Promise<void>((resolve) => {
        video.onseeked = () => {
          video.onseeked = null
          resolve()
        }
        setTimeout(resolve, 600)
      })

      const stream = displayCanvas.captureStream(30)
      const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 4_000_000 })
      const chunks: Blob[] = []
      recorder.ondataavailable = (e) => {
        if (e.data.size) chunks.push(e.data)
      }

      recorder.start(100)

      await new Promise<void>((resolve, reject) => {
        setTimeout(() => {
          recorder.stop()
          resolve()
        }, duration)
        recorder.onerror = (e) => {
          const ev = e as ErrorEvent
          reject(ev.error ?? new Error("Recorder error"))
        }
      })

      await new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
        if (recorder.state === "inactive") resolve()
      })

      if (!chunks.length) throw new Error("No video data captured.")

      const blob = new Blob(chunks, { type: "video/webm" })
      triggerDownload(blob, `${fmt.id}-${fmt.w}x${fmt.h}.webm`)
    },
    [canvasRefs, sourceEl],
  )

  const exportFormat = useCallback(
    async (id: FormatId) => {
      const fmt = useTemplateBuilder.getState().formats.find((f) => f.id === id)
      if (!fmt || !sourceReady) return
      try {
        if (sourceType === "video") {
          await exportVideoFormat(fmt)
        } else {
          await exportImageFormat(fmt)
        }
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        toast.error("Export failed", { description: msg })
      }
    },
    [sourceReady, sourceType, exportImageFormat, exportVideoFormat],
  )

  const exportAll = useCallback(async () => {
    if (!sourceReady || sourceType === "video") return
    try {
      const { default: JSZip } = await import("jszip")
      const zip = new JSZip()
      let logoOmitted = false

      for (const fmt of useTemplateBuilder.getState().formats) {
        try {
          const canvas = renderFmt(fmt, { includeLogo: true })
          const blob = await new Promise<Blob | null>((resolve) =>
            canvas.toBlob((b) => resolve(b), "image/png"),
          )
          if (!blob) throw new Error("tainted")
          zip.file(`${fmt.id}-${fmt.w}x${fmt.h}.png`, blob)
        } catch {
          try {
            const canvas = renderFmt(fmt, { includeLogo: false })
            const blob = await new Promise<Blob | null>((resolve) =>
              canvas.toBlob((b) => resolve(b), "image/png"),
            )
            if (blob) zip.file(`${fmt.id}-${fmt.w}x${fmt.h}.png`, blob)
            logoOmitted = true
          } catch {
            /* skip this format */
          }
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" })
      triggerDownload(zipBlob, "brand-banners.zip")
      if (logoOmitted) {
        useTemplateBuilder
          .getState()
          .setStatus(
            "Downloaded — logo omitted (logo URL doesn't support cross-origin)",
            "ok",
          )
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      toast.error("Export failed", { description: msg })
    }
  }, [sourceReady, sourceType, renderFmt])

  return { exportFormat, exportAll, renderFullRes: renderFmt }
}
