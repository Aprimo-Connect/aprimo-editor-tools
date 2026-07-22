"use client"

import { useEffect, useRef, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { Expander } from "aprimo-js"
import type { Record as AprimoRecord, FileVersion } from "aprimo-js/model"
import { Button } from "@/components/ui/button"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Loader2, CheckCircle2, XCircle, ExternalLink, Languages } from "lucide-react"
import { toast } from "sonner"

// ── Constants ─────────────────────────────────────────────────────────────────

const DUBBING_LANGUAGES: { code: string; label: string }[] = [
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "pl", label: "Polish" },
  { code: "hi", label: "Hindi" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "ar", label: "Arabic" },
  { code: "nl", label: "Dutch" },
  { code: "tr", label: "Turkish" },
  { code: "sv", label: "Swedish" },
]

// ── Types ─────────────────────────────────────────────────────────────────────

type PipelineStep =
  | "idle"
  | "ordering"   // Aprimo download order → video URL
  | "submitting" // Sending URL to ElevenLabs
  | "dubbing"    // ElevenLabs processing
  | "downloading"// Fetching dubbed video through proxy
  | "uploading"  // Uploading dubbed video to Aprimo
  | "creating"   // Creating new Aprimo record
  | "done"
  | "error"

const STEP_LABELS: Record<PipelineStep, string> = {
  idle:        "Ready",
  ordering:    "Preparing video…",
  submitting:  "Submitting to ElevenLabs…",
  dubbing:     "Dubbing in progress…",
  downloading: "Downloading dubbed video…",
  uploading:   "Uploading to Aprimo…",
  creating:    "Creating record…",
  done:        "Done",
  error:       "Error",
}

const PIPELINE_ORDER: PipelineStep[] = [
  "ordering", "submitting", "dubbing", "downloading", "uploading", "creating", "done",
]

// ── Main content ──────────────────────────────────────────────────────────────

function DubVideoContent() {
  const searchParams = useSearchParams()
  const recordId = searchParams.get("record")
  const { client, isConnected } = useAprimo()

  const [record, setRecord] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [targetLang, setTargetLang] = useState("es")
  const [step, setStep] = useState<PipelineStep>("idle")
  const [stepDetail, setStepDetail] = useState<string>("")
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [newRecordId, setNewRecordId] = useState<string | null>(null)
  const [uploadProgress, setUploadProgress] = useState(0)

  const abortRef = useRef(false)

  const thumbnailUrl = record?._embedded?.masterfilelatestversion?._embedded?.thumbnail?.uri as string | undefined
  const recordTitle = record?.title ?? record?._embedded?.masterfilelatestversion?.fileName ?? recordId
  const aprimoBase = record ? `https://${record._links?.self?.href?.split("/")?.[2]?.replace("api.", "") ?? ""}` : ""

  // ── Fetch record ────────────────────────────────────────────────────────────

  useEffect(() => {
    if (!recordId || !client || !isConnected) return

    setLoading(true)
    setFetchError(null)

    const expander = Expander.create()
      .for<AprimoRecord>("Record").expand("masterfilelatestversion")
      .for<FileVersion>("FileVersion").expand("thumbnail")

    client.records.getById(recordId, expander)
      .then((result) => {
        if (!result.ok) throw new Error(result.error?.message ?? "Failed to fetch record")
        setRecord(result.data as any)
      })
      .catch((e) => setFetchError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [recordId, client, isConnected])

  // ── Pipeline ────────────────────────────────────────────────────────────────

  async function runPipeline() {
    if (!client || !recordId || !record) return

    abortRef.current = false
    setPipelineError(null)
    setNewRecordId(null)
    setUploadProgress(0)

    try {
      // ── Step 1: Aprimo download order → video URL ───────────────────────────

      setStep("ordering")
      setStepDetail("Creating download order…")

      const orderRes = await client.orders.create({
        type: "download",
        targets: [{ recordId, targetTypes: ["Document"], assetType: "LatestVersionOfMasterFile" } as never],
      })
      if (!orderRes.ok || !orderRes.data) throw new Error("Failed to create download order")

      const orderId = (orderRes.data as any).id
      let videoUrl: string | null = null

      setStepDetail("Waiting for download order…")
      for (let attempt = 0; attempt < 60; attempt++) {
        if (abortRef.current) throw new Error("Cancelled")
        await new Promise((r) => setTimeout(r, 2000))

        const pollRes = await client.orders.getById(orderId)
        const order = pollRes.data as any
        if (!order) continue
        if (order.status === "Failed") throw new Error("Download order failed")
        if (order.status === "Completed" || order.status === "Success") {
          const delivered = order.deliveredFiles
          if (Array.isArray(delivered) && delivered.length > 0) {
            videoUrl = delivered[0]
            break
          }
        }
      }
      if (!videoUrl) throw new Error("Download order timed out — no delivery URL")

      // ── Step 2: Submit URL to ElevenLabs dubbing ────────────────────────────

      setStep("submitting")
      setStepDetail("")

      const dubRes = await fetch("/api/elevenlabs/dub", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoUrl, targetLang }),
      })
      if (!dubRes.ok) {
        const err = await dubRes.json().catch(() => ({ error: "Dubbing request failed" }))
        throw new Error(err.error ?? "ElevenLabs dubbing failed")
      }
      const { dubbingId, expectedDurationSec } = await dubRes.json()
      const etaLabel = expectedDurationSec ? ` (ETA ~${Math.ceil(expectedDurationSec / 60)} min)` : ""

      // ── Step 3: Poll until dubbed ───────────────────────────────────────────

      setStep("dubbing")
      setStepDetail(etaLabel.trim())

      let dubbingComplete = false
      for (let attempt = 0; attempt < 180; attempt++) {
        if (abortRef.current) throw new Error("Cancelled")
        await new Promise((r) => setTimeout(r, 5000))

        const statusRes = await fetch(`/api/elevenlabs/dub/${dubbingId}`)
        if (!statusRes.ok) continue
        const status = await statusRes.json()

        if (status.status === "failed") throw new Error(status.error ?? "ElevenLabs dubbing failed")
        if (status.status === "dubbed") { dubbingComplete = true; break }
      }
      if (!dubbingComplete) throw new Error("Dubbing timed out — ElevenLabs did not complete within 15 minutes")

      // ── Step 4: Download dubbed video via proxy ─────────────────────────────

      setStep("downloading")
      setStepDetail("")

      const videoRes = await fetch(`/api/elevenlabs/dub/${dubbingId}/video?lang=${targetLang}`)
      if (!videoRes.ok) {
        const err = await videoRes.json().catch(() => ({ error: "Download failed" }))
        throw new Error(err.error ?? "Failed to download dubbed video")
      }
      const videoBlob = await videoRes.blob()
      const langLabel = DUBBING_LANGUAGES.find((l) => l.code === targetLang)?.label ?? targetLang
      const originalFileName = record?._embedded?.masterfilelatestversion?.fileName as string | undefined
      const dotIdx = originalFileName ? originalFileName.lastIndexOf(".") : -1
      const baseName = dotIdx > 0 ? originalFileName!.slice(0, dotIdx) : (originalFileName ?? "dubbed")
      const ext = dotIdx > 0 ? originalFileName!.slice(dotIdx) : ".mp4"
      const dubbedFileName = `[${langLabel}] ${baseName}${ext}`
      const dubbedFile = new File([videoBlob], dubbedFileName, { type: "video/mp4" })

      // ── Step 5: Upload dubbed video to Aprimo ───────────────────────────────

      setStep("uploading")
      setUploadProgress(0)

      const uploadResult = await client.uploader.uploadFile(dubbedFile, {
        parallelLimit: 4,
        onProgress: (uploaded, total) => {
          setUploadProgress(total > 0 ? Math.round((uploaded / total) * 100) : 0)
        },
      })
      const uploadData = uploadResult.data as unknown as { token?: string }
      if (!uploadResult.ok || !uploadData?.token) {
        throw new Error(uploadResult.error?.message ?? "Upload failed")
      }
      const token = uploadData.token

      // ── Step 6: Create new Aprimo record ────────────────────────────────────

      setStep("creating")
      setStepDetail("")

      const createBody: Record<string, unknown> = {
        status: "draft",
        title: dubbedFileName,
        files: {
          master: token,
          addOrUpdate: [{ versions: { addOrUpdate: [{ id: token, fileName: dubbedFile.name }] } }],
        },
      }

      if (record.contentTypeId) createBody.contentTypeId = record.contentTypeId

      const createResult = await client.records.create(createBody as never)
      if (!createResult.ok || !(createResult.data as any)?.id) {
        throw new Error(createResult.error?.message ?? "Record creation failed")
      }
      const dubbedRecord = createResult.data as any
      setNewRecordId(dubbedRecord.id)

      setStep("done")
      setStepDetail("")
      toast.success("Dubbed video saved to Aprimo")
    } catch (e) {
      if ((e as Error).message === "Cancelled") return
      const msg = e instanceof Error ? e.message : String(e)
      setPipelineError(msg)
      setStep("error")
      toast.error(msg)
    }
  }

  // ── Early returns ───────────────────────────────────────────────────────────

  if (!recordId) {
    return (
      <main className="p-8">
        <p className="text-sm text-muted-foreground">
          No record ID provided. Pass{" "}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">?record=&lt;id&gt;</code> in the URL.
        </p>
      </main>
    )
  }

  if (!isConnected) {
    return (
      <main className="p-8">
        <p className="text-sm text-muted-foreground">Connect to Aprimo to use this tool.</p>
      </main>
    )
  }

  if (loading) {
    return (
      <main className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </main>
    )
  }

  if (fetchError) {
    return (
      <main className="p-8">
        <p className="text-sm text-destructive">{fetchError}</p>
      </main>
    )
  }

  if (!record) return null

  const isRunning = !["idle", "done", "error"].includes(step)
  const currentStepIdx = PIPELINE_ORDER.indexOf(step)

  // ── Render ──────────────────────────────────────────────────────────────────

  return (
    <main className="flex-1 p-6 flex flex-col gap-6 max-w-3xl mx-auto w-full">

      {/* Record info */}
      <div className="flex items-start gap-4">
        {thumbnailUrl && (
          <img src={thumbnailUrl} alt={recordTitle} className="h-20 w-32 object-cover rounded-md bg-muted flex-shrink-0" />
        )}
        <div className="flex flex-col gap-1 min-w-0">
          <h1 className="text-xl font-semibold leading-tight">{recordTitle}</h1>
          <p className="text-xs text-muted-foreground font-mono">{recordId}</p>
        </div>
      </div>

      <Separator />

      {/* Controls */}
      {(step === "idle" || step === "error") && (
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2">
            <Languages className="h-4 w-4" />
            <h2 className="text-base font-semibold">Translate Video</h2>
            <Badge variant="secondary" className="text-xs">ElevenLabs</Badge>
          </div>

          <div className="flex flex-wrap items-end gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs text-muted-foreground font-medium">Target language</label>
              <Select value={targetLang} onValueChange={setTargetLang}>
                <SelectTrigger className="w-44 h-8 text-sm">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {DUBBING_LANGUAGES.map((l) => (
                    <SelectItem key={l.code} value={l.code}>{l.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <Button onClick={runPipeline} size="sm" className="h-8">
              <Languages className="h-3.5 w-3.5 mr-1.5" />
              {step === "error" ? "Retry" : "Start translation"}
            </Button>
          </div>

        </div>
      )}

      {/* Progress steps */}
      {step !== "idle" && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium mb-1">Progress</h2>
          {PIPELINE_ORDER.map((s, idx) => {
            const isCompleted = step === "done" || (currentStepIdx > idx && step !== "error")
            const isCurrent = s === step && step !== "done"
            const isFailed = step === "error" && s === PIPELINE_ORDER[currentStepIdx === -1 ? 0 : currentStepIdx]

            let icon
            if (isCompleted) {
              icon = <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            } else if (isFailed) {
              icon = <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
            } else if (isCurrent) {
              icon = <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
            } else {
              icon = <div className="h-4 w-4 rounded-full border border-muted-foreground/30 flex-shrink-0" />
            }

            return (
              <div key={s} className={`flex items-center gap-3 text-sm ${isCurrent ? "text-foreground font-medium" : isCompleted ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                {icon}
                <span>{STEP_LABELS[s]}</span>
                {isCurrent && stepDetail && (
                  <span className="text-xs text-muted-foreground">{stepDetail}</span>
                )}
                {s === "uploading" && isCurrent && uploadProgress > 0 && (
                  <span className="text-xs text-muted-foreground">{uploadProgress}%</span>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Error message */}
      {step === "error" && pipelineError && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{pipelineError}</p>
      )}

      {/* Success result */}
      {step === "done" && newRecordId && (
        <div className="flex flex-col gap-3 bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">
            Dubbed video saved successfully
          </p>
          <p className="text-xs text-muted-foreground font-mono">{newRecordId}</p>
          {process.env.NEXT_PUBLIC_APRIMO_ENVIRONMENT && (
            <a
              href={`https://${process.env.NEXT_PUBLIC_APRIMO_ENVIRONMENT}.dam.aprimo.com/dam/records/${newRecordId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline w-fit"
            >
              <ExternalLink className="h-3.5 w-3.5" />
              Open in Aprimo
            </a>
          )}
          <Button
            variant="outline"
            size="sm"
            className="w-fit h-8"
            onClick={() => { setStep("idle"); setNewRecordId(null); setPipelineError(null) }}
          >
            Translate another language
          </Button>
        </div>
      )}
    </main>
  )
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function TranslateVideoPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <Suspense fallback={
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      }>
        <DubVideoContent />
      </Suspense>
      <Footer />
    </div>
  )
}
