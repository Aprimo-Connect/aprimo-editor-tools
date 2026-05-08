"use client"

import { useCallback, useMemo, useState } from "react"
import { toast } from "sonner"
import { Expander } from "aprimo-js"
import { useAprimo } from "@/context/aprimo-context"
import { extractRecordIdFromUrl } from "@/lib/aprimo-cdn"
import { renderFullRes } from "../lib/renderer"
import {
  selectSourceUrl,
  useTemplateBuilder,
} from "../stores/use-template-builder"
import type { DrawState, Format, FormatId } from "../types"

export interface UsePublishRenditionsDeps {
  drawState: DrawState
  croppedEls: Record<FormatId, HTMLImageElement>
  logoEl: HTMLImageElement | null
}

export interface RenditionsPublisher {
  publishing: boolean
  progress: string
  canPublish: boolean
  damUrl: string
  publishAll: () => Promise<void>
  reset: () => void
}

interface AdditionalFileEntry {
  id?: string
  type?: string
  // SDK can return either casing depending on resource shape — handle both.
  label?: string
  presetName?: string
  filename?: string
  fileName?: string
}

async function renderToPngBlob(
  fmt: Format,
  drawState: DrawState,
  croppedEls: Record<FormatId, HTMLImageElement>,
  logoEl: HTMLImageElement | null,
): Promise<Blob | null> {
  // Try with logo first; fall back to no-logo on tainted-canvas failure.
  for (const includeLogo of [true, false]) {
    try {
      const canvas = renderFullRes(fmt, drawState, croppedEls, logoEl, { includeLogo })
      const blob = await new Promise<Blob | null>((resolve, reject) => {
        canvas.toBlob((b) => {
          if (b) resolve(b)
          else reject(new Error("null blob"))
        }, "image/png")
      })
      if (blob) return blob
    } catch {
      if (!includeLogo) break
    }
  }
  return null
}

/**
 * Publish each format as an additional file (rendition) on the source DAM
 * record.
 *
 * Two-pass implementation:
 *   1. Render + upload every format (collect upload tokens)
 *   2. Single records.update that:
 *        - removes existing additional files whose label matches one of the
 *          new renditions (de-duplication — a re-publish replaces the old)
 *        - addOrUpdate with the new tokens
 *
 * Doing this in one batched update (instead of per-format updates in a
 * loop) prevents later iterations from accidentally removing additional
 * files we just added in earlier ones.
 */
export function usePublishRenditions(deps: UsePublishRenditionsDeps): RenditionsPublisher {
  const { drawState, croppedEls, logoEl } = deps
  const { client, connection, isConnected } = useAprimo()

  const [publishing, setPublishing] = useState(false)
  const [progress, setProgress] = useState("")
  const [publishedRecordId, setPublishedRecordId] = useState("")

  const sourceUrl = useTemplateBuilder(selectSourceUrl)

  const canPublish = useMemo(() => {
    if (!isConnected || !client) return false
    if (!sourceUrl) return false
    return !!extractRecordIdFromUrl(sourceUrl)
  }, [isConnected, client, sourceUrl])

  const damUrl = useMemo(() => {
    if (!publishedRecordId || !connection?.environment) return ""
    return `https://${connection.environment}.dam.aprimo.com/dam/contentitems/${publishedRecordId}`
  }, [publishedRecordId, connection])

  const reset = useCallback(() => setPublishedRecordId(""), [])

  const publishAll = useCallback(async () => {
    if (!canPublish || publishing || !client) return

    const recordId = extractRecordIdFromUrl(sourceUrl)
    if (!recordId) {
      useTemplateBuilder
        .getState()
        .setStatus("Cannot publish — source is not from the DAM", "err")
      return
    }

    const formats = useTemplateBuilder.getState().formats
    setPublishing(true)
    setPublishedRecordId("")
    setProgress(`0/${formats.length}`)
    useTemplateBuilder.getState().setStatus("Publishing renditions...", "load")

    try {
      // Fetch the record once to learn the master file + version IDs and
      // the existing additional files (so we can dedupe by label).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expander = (Expander.create() as any)
        .for("Record")
        .expand("masterfile")
        .for("File")
        .expand("fileversions")
        .for("FileVersion")
        .expand("additionalfiles")

      const recordRes = await client.search.records(
        { searchExpression: { expression: `id='${recordId}'` } },
        expander,
      )
      if (!recordRes.ok) throw new Error("Could not fetch source record")

      const record = (recordRes.data as { items?: unknown[] })?.items?.[0] as
        | {
            _embedded?: {
              masterfile?: {
                id?: string
                _embedded?: {
                  fileversions?: {
                    items?: Array<{
                      id?: string
                      isLatest?: boolean
                      _embedded?: {
                        additionalfiles?: { items?: AdditionalFileEntry[] }
                      }
                      additionalFiles?: { items?: AdditionalFileEntry[] }
                    }>
                  }
                }
              }
            }
          }
        | undefined
      const masterFile = record?._embedded?.masterfile
      const versions = masterFile?._embedded?.fileversions?.items ?? []
      const latestVersion =
        versions.find((v) => v.isLatest) ?? versions[versions.length - 1]
      const masterFileId = masterFile?.id
      const latestVersionId = latestVersion?.id
      if (!masterFileId || !latestVersionId) {
        console.warn("[publish-renditions] No master file on record:", record)
        throw new Error("Source record has no master file")
      }

      // Existing additional files — defensive both-paths lookup since the
      // SDK can flatten or keep HAL embedding depending on resource shape.
      const existing: AdditionalFileEntry[] =
        latestVersion?._embedded?.additionalfiles?.items ??
        latestVersion?.additionalFiles?.items ??
        []

      // ── Pass 1: render + upload, collect successful upload tokens ──
      const uploads: Array<{ name: string; filename: string; token: string }> = []
      let failed = 0

      for (let i = 0; i < formats.length; i++) {
        const fmt = formats[i]
        const name = fmt.label || `${fmt.w}x${fmt.h}`
        const filename = `${name.replace(/[^a-zA-Z0-9_ -]/g, "_")}-${fmt.w}x${fmt.h}.png`
        setProgress(`Uploading ${i + 1}/${formats.length}`)

        try {
          const blob = await renderToPngBlob(fmt, drawState, croppedEls, logoEl)
          if (!blob) {
            failed++
            continue
          }

          const file = new File([blob], filename, { type: "image/png" })
          const uploadResult = await client.uploader.uploadFile(file, {})
          if (!uploadResult.ok || !uploadResult.data?.token) {
            failed++
            continue
          }
          uploads.push({ name, filename, token: uploadResult.data.token })
        } catch (e) {
          console.error(`Rendition "${name}" upload error:`, e)
          failed++
        }
      }

      // ── Pass 2: dedupe (separate call), then add new renditions ──
      // Aprimo's records.update doesn't accept `remove` and `addOrUpdate`
      // in the same `additionalFiles` payload — the AprimoApi backend
      // splits them into two PUT requests for the same reason. We do the
      // same: remove existing same-named files first, then add the new
      // ones in a second call.
      let succeeded = 0
      let replaced = 0

      if (uploads.length > 0) {
        setProgress("Saving to DAM…")

        // Build remove list: existing Custom additional files whose
        // fileName (or label) matches one of the new renditions.
        const newFilenames = new Set(uploads.map((u) => u.filename))
        const newNames = new Set(uploads.map((u) => u.name))
        const removeItems: Array<{ id: string }> = []
        for (const af of existing) {
          if (!af?.id || af.type !== "Custom") continue
          const fname = af.fileName ?? af.filename
          const label = af.label ?? af.presetName
          if (
            (fname && newFilenames.has(fname)) ||
            (label && newNames.has(label))
          ) {
            removeItems.push({ id: af.id })
          }
        }
        replaced = removeItems.length

        // Step 1: remove duplicates (best-effort — failure here is logged
        // but doesn't block the add step; user just gets duplicates).
        if (removeItems.length > 0) {
          try {
            const removeRes = await client.records.update(recordId, {
              files: {
                addOrUpdate: [
                  {
                    id: masterFileId,
                    versions: {
                      addOrUpdate: [
                        {
                          id: latestVersionId,
                          additionalFiles: { remove: removeItems },
                        },
                      ],
                    },
                  },
                ],
              },
            } as never)
            if (!removeRes.ok) {
              console.warn(
                "[publish-renditions] dedupe call failed — proceeding with add anyway:",
                removeRes.error,
              )
              replaced = 0
            }
          } catch (e) {
            console.warn("[publish-renditions] dedupe call threw:", e)
            replaced = 0
          }
        }

        // Step 2: add the new renditions.
        try {
          const updateRes = await client.records.update(recordId, {
            files: {
              addOrUpdate: [
                {
                  id: masterFileId,
                  versions: {
                    addOrUpdate: [
                      {
                        id: latestVersionId,
                        additionalFiles: {
                          addOrUpdate: uploads.map((u) => ({
                            id: u.token,
                            label: u.name,
                            filename: u.filename,
                            type: "Custom",
                          })),
                        },
                      },
                    ],
                  },
                },
              ],
            },
          } as never)

          if (updateRes.ok) {
            succeeded = uploads.length
          } else {
            console.error(
              "[publish-renditions] add call failed:",
              updateRes.error,
            )
            failed += uploads.length
          }
        } catch (e) {
          console.error("[publish-renditions] add call threw:", e)
          failed += uploads.length
        }
      }

      // ── Status / toast ──
      const tplState = useTemplateBuilder.getState()
      const successPlural = succeeded === 1 ? "" : "s"
      const replacedSuffix = replaced > 0 ? ` (replaced ${replaced})` : ""

      if (failed === 0 && succeeded > 0) {
        setPublishedRecordId(recordId)
        tplState.setStatus(
          `Published ${succeeded} rendition${successPlural} to DAM${replacedSuffix}`,
          "ok",
        )
        toast.success("Renditions published", {
          description: `${succeeded} rendition${successPlural} saved to DAM${replacedSuffix}`,
        })
      } else if (succeeded > 0) {
        setPublishedRecordId(recordId)
        tplState.setStatus(
          `Published ${succeeded} rendition${successPlural}, ${failed} failed`,
          "err",
        )
        toast.warning("Partially published", {
          description: `${succeeded} succeeded, ${failed} failed — check console for details`,
        })
      } else {
        tplState.setStatus("Publishing failed — check console for details", "err")
        toast.error("Publishing failed", {
          description: "No renditions were saved. Check the console for details.",
        })
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      useTemplateBuilder.getState().setStatus(`Publishing failed: ${msg}`, "err")
      toast.error("Publishing failed", { description: msg })
    } finally {
      setPublishing(false)
      setProgress("")
    }
  }, [canPublish, publishing, client, sourceUrl, drawState, croppedEls, logoEl])

  return {
    publishing,
    progress,
    canPublish,
    damUrl,
    publishAll,
    reset,
  }
}
