"use client"

import { useCallback } from "react"
import { toast } from "sonner"
import { drawTemplate } from "../lib/renderer"
import { useTemplateBuilder } from "../stores/use-template-builder"
import { useBulkData } from "../stores/use-bulk-data"
import type { DrawState, FormatId } from "../types"

export interface UseBulkExportDeps {
  drawState: DrawState
  croppedEls: Record<FormatId, HTMLImageElement>
  logoEl: HTMLImageElement | null
  sourceEl: HTMLImageElement | HTMLVideoElement | null
}

export interface BulkExporter {
  exportAllRows: () => Promise<void>
}

function loadImage(url: string): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null)
      return
    }
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => resolve(img)
    img.onerror = () => resolve(null)
    img.src = url
  })
}

function sanitize(s: unknown): string {
  return String(s).replace(/[<>:"/\\|?*]/g, "_").trim().slice(0, 80) || "row"
}

export function useBulkExport(deps: UseBulkExportDeps): BulkExporter {
  const { drawState: baseDrawState, croppedEls, logoEl } = deps

  const exportAllRows = useCallback(async () => {
    const tplState = useTemplateBuilder.getState()
    const bulkState = useBulkData.getState()

    if (!bulkState.rows.length || !tplState.formats.length) return

    bulkState.setIsExporting(true)
    bulkState.setExportProgress(0)

    try {
      const { default: JSZip } = await import("jszip")
      const zip = new JSZip()
      const total = bulkState.rows.length * tplState.formats.length
      let done = 0

      const imgCache = new Map<string, HTMLImageElement | null>()

      for (let i = 0; i < bulkState.rows.length; i++) {
        const rowDS = bulkState.buildRowDrawState(i, baseDrawState)

        const firstCol = bulkState.columns[0]
        const rowVal = firstCol ? bulkState.rows[i][firstCol] : null
        const rowLabel = sanitize(rowVal ?? `row-${i + 1}`)
        const rowFolder = zip.folder(`${String(i + 1).padStart(3, "0")}-${rowLabel}`)
        if (!rowFolder) continue

        let rowSourceEl = baseDrawState.el
        if (rowDS._sourceUrlOverride) {
          if (!imgCache.has(rowDS._sourceUrlOverride)) {
            imgCache.set(rowDS._sourceUrlOverride, await loadImage(rowDS._sourceUrlOverride))
          }
          rowSourceEl = imgCache.get(rowDS._sourceUrlOverride) ?? baseDrawState.el
        }

        let rowLogoEl: HTMLImageElement | null = logoEl
        if (rowDS._logoUrlOverride) {
          if (!imgCache.has(rowDS._logoUrlOverride)) {
            imgCache.set(rowDS._logoUrlOverride, await loadImage(rowDS._logoUrlOverride))
          }
          rowLogoEl = imgCache.get(rowDS._logoUrlOverride) ?? logoEl
        }

        for (const fmt of tplState.formats) {
          const cropped = croppedEls[fmt.id]
          const usesCrop = !!cropped
          const baseDSForFmt: DrawState = {
            ...rowDS,
            el: cropped ?? rowSourceEl,
            focalX: usesCrop ? 0.5 : rowDS.focalX ?? 0.5,
            focalY: usesCrop ? 0.5 : rowDS.focalY ?? 0.5,
          }
          const fmtName = fmt.label || `${fmt.w}x${fmt.h}`
          const fileName = `${sanitize(fmtName)}-${fmt.w}x${fmt.h}.png`

          // Try with logo; on tainted, retry without
          let blob: Blob | null = null
          for (const tryLogo of [rowLogoEl, null]) {
            try {
              const canvas = document.createElement("canvas")
              canvas.width = fmt.w
              canvas.height = fmt.h
              const ctx = canvas.getContext("2d")
              if (!ctx) continue
              drawTemplate(ctx, fmt.w, fmt.h, fmt, { ...baseDSForFmt, logo: tryLogo })
              blob = await new Promise<Blob | null>((resolve, reject) => {
                canvas.toBlob((b) => {
                  if (b) resolve(b)
                  else reject(new Error("null blob"))
                }, "image/png")
              })
              break
            } catch {
              if (!tryLogo) break
            }
          }
          if (blob) rowFolder.file(fileName, blob)

          done++
          bulkState.setExportProgress(done / total)

          // Yield to event loop every 4 renders to keep UI responsive
          if (done % 4 === 0) await new Promise((r) => setTimeout(r, 0))
        }
      }

      const zipBlob = await zip.generateAsync({ type: "blob" })
      const url = URL.createObjectURL(zipBlob)
      const a = Object.assign(document.createElement("a"), {
        href: url,
        download: `bulk-export-${bulkState.rows.length}rows.zip`,
      })
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 30_000)

      tplState.setStatus(
        `Exported ${done} images (${bulkState.rows.length} rows × ${tplState.formats.length} formats)`,
        "ok",
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      tplState.setStatus("Bulk export failed: " + msg, "err")
      toast.error("Bulk export failed", { description: msg })
    } finally {
      bulkState.setIsExporting(false)
    }
  }, [baseDrawState, croppedEls, logoEl])

  return { exportAllRows }
}
