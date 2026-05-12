"use client"

import { useState } from "react"
import { toast } from "sonner"
import { buildVfFilter } from "../constants"

interface Format {
  label: string
  width: number
  height: number
}

interface UseVideoProcessingOptions {
  videoUrl: string | null
  client: any
  recordId: string | null
  masterFileId: string | null
  latestVersionId: string | null
  selectedFormat: Format
  platform: string
  cropMode: "fill" | "fit"
  zoom: number
  rotation: number
  outputFormat: string
}

interface UseVideoProcessingResult {
  isProcessing: boolean
  progress: string | null
  progressPct: number
  handleCreateRendition: () => Promise<void>
  handleCreateAndDownload: () => Promise<void>
}

export function useVideoProcessing({
  videoUrl,
  client,
  recordId,
  masterFileId,
  latestVersionId,
  selectedFormat,
  platform,
  cropMode,
  zoom,
  rotation,
  outputFormat,
}: UseVideoProcessingOptions): UseVideoProcessingResult {
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [progressPct, setProgressPct] = useState(0)

  async function processVideo(): Promise<{ blob: Blob; filename: string }> {
    if (!videoUrl) throw new Error("No video loaded")

    const { FFmpeg } = await import("@ffmpeg/ffmpeg")
    const { fetchFile, toBlobURL } = await import("@ffmpeg/util")

    setProgress("Loading FFmpeg…")
    const ffmpeg = new FFmpeg()
    ffmpeg.on("progress", ({ progress: p }) => {
      const pct = Math.round(p * 100)
      setProgress(`Processing… ${pct}%`)
      setProgressPct(pct)
    })

    const baseURL = "https://unpkg.com/@ffmpeg/core@0.12.6/dist/umd"
    await ffmpeg.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, "text/javascript"),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, "application/wasm"),
    })

    setProgress("Fetching video…")
    await ffmpeg.writeFile("input.mp4", await fetchFile(videoUrl))

    const ext = outputFormat === "WebM" ? "webm" : "mp4"
    const outputFile = `output.${ext}`
    const vf = buildVfFilter(selectedFormat.width, selectedFormat.height, cropMode, zoom, rotation)

    const codecArgs =
      outputFormat === "WebM"
        ? ["-c:v", "libvpx-vp9", "-c:a", "libopus", "-b:v", "0", "-crf", "30"]
        : ["-c:v", "libx264", "-c:a", "aac", "-pix_fmt", "yuv420p", "-preset", "fast"]

    setProgress("Processing… 0%")
    await ffmpeg.exec(["-i", "input.mp4", "-vf", vf, ...codecArgs, outputFile])

    const data = await ffmpeg.readFile(outputFile)
    const mimeType = outputFormat === "WebM" ? "video/webm" : "video/mp4"
    const blob = new Blob([data], { type: mimeType })
    const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "")
    const filename = `${slug(platform)}_${slug(selectedFormat.label)}_${selectedFormat.width}x${selectedFormat.height}.${ext}`

    return { blob, filename }
  }

  async function handleCreateRendition() {
    if (!client || !recordId) return
    setIsProcessing(true)
    setProgressPct(0)

    try {
      const { blob, filename } = await processVideo()

      const file = new File([blob], filename, { type: blob.type })
      setProgress("Uploading…")
      setProgressPct(0)
      const uploadResult = await client.uploader.uploadFile(file, {
        parallelLimit: 4,
        onProgress: (uploaded: number, total: number) => {
          const pct = Math.round((uploaded / total) * 100)
          setProgress(`Uploading… ${pct}%`)
          setProgressPct(pct)
        },
      })
      if (!uploadResult.ok) throw new Error(uploadResult.error?.message ?? "Upload failed")
      const token = uploadResult.data!.token

      setProgress("Saving to Aprimo…")
      setProgressPct(95)
      if (!masterFileId || !latestVersionId) throw new Error("Master file info not available")

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
                      addOrUpdate: [
                        {
                          id: token,
                          label: `${platform} — ${selectedFormat.label}`,
                          filename,
                          type: "Custom",
                        },
                      ],
                    },
                  },
                ],
              },
            },
          ],
        },
      } as never)
      if (!updateRes.ok) throw new Error(updateRes.error?.message ?? "Failed to attach rendition")

      setProgress(null)
      setProgressPct(0)
      toast.success("Rendition saved", { description: `${platform} — ${selectedFormat.label} attached to the asset` })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Rendition creation failed"
      setProgress(null)
      setProgressPct(0)
      toast.error("Rendition failed", { description: msg })
    } finally {
      setIsProcessing(false)
    }
  }

  async function handleCreateAndDownload() {
    setIsProcessing(true)
    setProgressPct(0)

    try {
      const { blob, filename } = await processVideo()

      setProgress("Preparing download…")
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = filename
      a.click()
      URL.revokeObjectURL(url)
      setProgress(null)
      setProgressPct(0)
      toast.success("Download started", { description: filename })
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Processing failed"
      setProgress(null)
      setProgressPct(0)
      toast.error("Processing failed", { description: msg })
    } finally {
      setIsProcessing(false)
    }
  }

  return { isProcessing, progress, progressPct, handleCreateRendition, handleCreateAndDownload }
}
