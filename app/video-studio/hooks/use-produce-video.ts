"use client"

import { useState, useEffect } from "react"
import { toast } from "sonner"
import { Expander } from "aprimo-js"
import type { Record as AprimoRecord } from "aprimo-js/model"
import { VideoClip, AudioClip, TransitionClip, TextClip, SelectedAsset } from "../types"
import { runPipeline } from "../ffmpeg-pipeline"
import { buildVfFilter } from "../../video-resizer/constants"
import { useAprimo } from "@/context/aprimo-context"

interface UseProduceVideoParams {
  sortedClips: VideoClip[]
  audioClips: AudioClip[]
  assets: SelectedAsset[]
  durations: Record<string, number>
  transitionClips: TransitionClip[]
  textClips: TextClip[]
  platform: string
  selectedFormat: { label?: string; width: number; height: number }
  cropMode: "fill" | "fit"
  zoom: number
  rotation: number
  outputFormat: string
  previewWidth: 360 | 720 | 1280
  disableFades: boolean
  initialRecordId?: string | null
}


function codecArgs(format: string): string[] {
  return format === "WebM"
    ? ["-c:v", "libvpx-vp9", "-c:a", "libopus", "-lag-in-frames", "0"]
    : ["-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-preset", "fast", "-bf", "0", "-x264-params", "rc-lookahead=0"]
}

export function useProduceVideo({
  sortedClips, audioClips, assets, durations, transitionClips, textClips,
  platform, selectedFormat, cropMode, zoom, rotation, outputFormat, previewWidth,
  disableFades, initialRecordId,
}: UseProduceVideoParams) {
  const { client, connection } = useAprimo()

  const [producing, setProducing] = useState(false)
  const [produceProgress, setProduceProgress] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [previewProgress, setPreviewProgress] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadProgress, setDownloadProgress] = useState<string | null>(null)
  const [savedRecordId, setSavedRecordId] = useState<string | null>(initialRecordId ?? null)
  const [savedFileName, setSavedFileName] = useState<string | null>(null)
  const [savedRecordUrl, setSavedRecordUrl] = useState<string | null>(null)

  useEffect(() => {
    if (initialRecordId && connection && !savedRecordUrl) {
      setSavedRecordUrl(`https://${connection.environment}.dam.aprimo.com/dam/contentitems/${initialRecordId.replace(/-/g, "")}`)
    }
  }, [initialRecordId, connection])

  function clearPreview() {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
  }

  const pipelineBase = { sortedClips, audioClips, transitionClips, textClips, assets, durations, cropMode, zoom, rotation, disableFades }

  async function produceVideo(projectName?: string) {
    if (sortedClips.length === 0) { toast.error("Add clips to the video track first"); return }
    if (!client) { toast.error("Not connected to Aprimo"); return }

    setProducing(true)
    setProduceProgress("")
    try {
      const ext = outputFormat.toLowerCase()
      const mime = outputFormat === "WebM" ? "video/webm" : outputFormat === "MOV" ? "video/quicktime" : "video/mp4"

      const blob = await runPipeline({
        ...pipelineBase,
        format: selectedFormat,
        codecArgs: codecArgs(outputFormat),
        outputFile: `output.${ext}`,
        mime,
        setProgress: setProduceProgress,
      })

      const filename = projectName ? `${projectName}.${ext}` : savedFileName ?? `video-studio-${Date.now()}.${ext}`
      const file = new File([blob], filename, { type: mime })

      setProduceProgress("Uploading…")
      const uploadResult = await client.uploader.uploadFile(file, {
        parallelLimit: 4,
        onProgress: (uploaded: number, total: number) => {
          setProduceProgress(`Uploading… ${Math.round((uploaded / total) * 100)}%`)
        },
      })
      if (!uploadResult.ok) throw new Error(uploadResult.error?.message ?? "Upload failed")
      const token = uploadResult.data!.token

      const jsonFieldName = process.env.NEXT_PUBLIC_VIDEO_STUDIO_JSON_FIELD ?? ""
      const assocAssetsFieldName = process.env.NEXT_PUBLIC_ASSOCIATED_ASSETS_RECORD_LINK_FIELD ?? ""
      let jsonFieldId: string | null = null
      let assocAssetsFieldId: string | null = null
      if (jsonFieldName || assocAssetsFieldName) {
        outer: for await (const result of client.fieldDefinitions.getPaged()) {
          if (!result.ok) break
          const items = (result.data?.items ?? []) as unknown as { id: string; name: string }[]
          for (const item of items) {
            if (jsonFieldName && !jsonFieldId && item.name === jsonFieldName) jsonFieldId = item.id
            if (assocAssetsFieldName && !assocAssetsFieldId && item.name === assocAssetsFieldName) assocAssetsFieldId = item.id
            if ((!jsonFieldName || jsonFieldId) && (!assocAssetsFieldName || assocAssetsFieldId)) break outer
          }
        }
      }

      const usedAssetIds = assets.filter((a) => a.mediaType !== "text").map((a) => a.id)

      const metadata = {
        output: { platform, format: selectedFormat, cropMode, zoom, rotation, outputFormat },
        assets: assets.map((a) => ({ ...a, duration: durations[a.id] ?? null })),
        videoClips: sortedClips, transitionClips, audioClips,
        textClips: textClips.map((tc) => ({ ...tc, asset: assets.find((a) => a.id === tc.assetId) })),
      }

      if (savedRecordId) {
        setProduceProgress("Updating asset…")
        const expander = Expander.create()
          .for<AprimoRecord>("Record").expand("masterfile")
        const recRes = await client.records.getById(savedRecordId!, expander)
        if (!recRes.ok) throw new Error((recRes as any).error?.message ?? "Failed to fetch record")
        const masterFileId = (recRes.data as any)?._embedded?.masterfile?.id as string | undefined
        if (!masterFileId) throw new Error("Could not determine master file ID")

        const updateBody: any = {
          files: { addOrUpdate: [{ id: masterFileId, versions: { addOrUpdate: [{ id: token, fileName: filename }] } }] },
        }
        const fieldUpdates: any[] = []
        if (jsonFieldId) fieldUpdates.push({ id: jsonFieldId, localizedValues: [{ value: JSON.stringify(metadata) }] })
        if (assocAssetsFieldId && usedAssetIds.length > 0) {
          fieldUpdates.push({ id: assocAssetsFieldId, localizedValues: [{ links: usedAssetIds.map((id) => ({ recordId: id })) }] })
        }
        if (fieldUpdates.length > 0) updateBody.fields = { addOrUpdate: fieldUpdates }
        const updateRes = await client.records.update(savedRecordId, updateBody as never)
        if (!updateRes.ok) throw new Error((updateRes as any).error?.message ?? "Failed to update asset")
        setSavedFileName(filename)
        toast.success("Asset updated in Aprimo", { description: filename })
      } else {
        setProduceProgress("Creating asset…")
        const contentType = process.env.NEXT_PUBLIC_VIDEO_STUDIO_CONTENT_TYPE ?? ""
        const classificationId = process.env.NEXT_PUBLIC_VIDEO_STUDIO_CLASSIFICATION_ID ?? ""

        const recordBody: any = {
          title: filename,
          files: { master: token, addOrUpdate: [{ versions: { addOrUpdate: [{ id: token, fileName: filename }] } }] },
        }
        if (contentType) recordBody.contentType = contentType
        if (classificationId) recordBody.classifications = { addOrUpdate: [{ id: classificationId }] }
        const createFieldUpdates: any[] = []
        if (jsonFieldId) createFieldUpdates.push({ id: jsonFieldId, localizedValues: [{ value: JSON.stringify(metadata) }] })
        if (assocAssetsFieldId && usedAssetIds.length > 0) {
          createFieldUpdates.push({ id: assocAssetsFieldId, localizedValues: [{ links: usedAssetIds.map((id) => ({ recordId: id })) }] })
        }
        if (createFieldUpdates.length > 0) recordBody.fields = { addOrUpdate: createFieldUpdates }

        const createRes = await client.records.create(recordBody as never)
        if (!createRes.ok) throw new Error(createRes.error?.message ?? "Failed to create asset")

        const recordId = (createRes.data as any)?.id
        if (recordId) {
          setSavedRecordId(recordId)
          setSavedFileName(filename)
          if (connection) {
            setSavedRecordUrl(`https://${connection.environment}.dam.aprimo.com/dam/contentitems/${recordId.replace(/-/g, "")}`)
          }
        }
        toast.success("Asset saved to Aprimo", { description: filename })
      }
    } catch (err) {
      toast.error(`Save failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setProducing(false)
      setProduceProgress(null)
    }
  }

  async function downloadVideo() {
    if (sortedClips.length === 0) { toast.error("Add clips to the video track first"); return }

    setDownloading(true)
    setDownloadProgress("")
    try {
      const ext = outputFormat.toLowerCase()
      const mime = outputFormat === "WebM" ? "video/webm" : outputFormat === "MOV" ? "video/quicktime" : "video/mp4"

      const blob = await runPipeline({
        ...pipelineBase,
        format: selectedFormat,
        codecArgs: codecArgs(outputFormat),
        outputFile: `output.${ext}`,
        mime,
        setProgress: setDownloadProgress,
      })

      const filename = `video-studio-${Date.now()}.${ext}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) {
      toast.error(`Download failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setDownloading(false)
      setDownloadProgress(null)
    }
  }

  async function generatePreview() {
    if (sortedClips.length === 0) { toast.error("Add clips to the video track first"); return }

    setPreviewing(true)
    setPreviewProgress("")
    try {
      const maxW = previewWidth === 1280 ? 1920 : previewWidth === 720 ? 1280 : 640
      const pw = Math.min(maxW, Math.floor(selectedFormat.width / 2) * 2)
      const ph = Math.round((pw * selectedFormat.height) / selectedFormat.width / 2) * 2
      const isSmall = previewWidth === 360
      const isMedium = previewWidth === 720

      const blob = await runPipeline({
        ...pipelineBase,
        format: { width: pw, height: ph },
        vfOverride: buildVfFilter(pw, ph, cropMode, zoom, rotation),
        normFps: isSmall ? 10 : undefined,
        codecArgs: isSmall
          ? ["-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-preset", "ultrafast", "-tune", "zerolatency", "-crf", "40", "-b:a", "64k", "-ar", "22050"]
          : isMedium
            ? ["-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "28", "-bf", "0", "-x264-params", "rc-lookahead=0"]
            : ["-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-preset", "fast", "-crf", "23", "-bf", "0", "-x264-params", "rc-lookahead=0"],
        outputFile: "preview.mp4",
        mime: "video/mp4",
        setProgress: setPreviewProgress,
      })

      if (previewUrl) URL.revokeObjectURL(previewUrl)
      setPreviewUrl(URL.createObjectURL(blob))
    } catch (err) {
      toast.error(`Preview failed: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setPreviewing(false)
      setPreviewProgress(null)
    }
  }

  return {
    produceVideo, producing, produceProgress,
    savedRecordId, savedRecordUrl,
    downloadVideo, downloading, downloadProgress,
    generatePreview, previewing, previewProgress,
    previewUrl, clearPreview,
  }
}
