"use client"

import { useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { Expander } from "aprimo-js"
import type { Record as AprimoRecord, FileVersion } from "aprimo-js/model"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { Badge } from "@/components/ui/badge"
import { Loader2, CheckCircle2, XCircle, Mic } from "lucide-react"
import { toast } from "sonner"

// ── Types ─────────────────────────────────────────────────────────────────────

type PipelineStep = "idle" | "generating" | "converting" | "uploading" | "attaching" | "creating" | "done" | "error"

const STEP_LABELS: Record<PipelineStep, string> = {
  idle:       "Ready",
  generating: "Generating audio…",
  converting: "Changing content type…",
  uploading:  "Uploading audio…",
  attaching:  "Attaching to record…",
  creating:   "Creating record…",
  done:       "Done",
  error:      "Error",
}

const PIPELINE_WITH_RECORD: PipelineStep[]    = ["generating", "converting", "uploading", "attaching", "done"]
const PIPELINE_WITHOUT_RECORD: PipelineStep[] = ["generating", "uploading", "creating", "done"]

// ── Voice options ─────────────────────────────────────────────────────────────

const VOICES = [
  { id: "21m00Tcm4TlvDq8ikWAM", name: "Rachel" },
  { id: "AZnzlk1XvdvUeBnXmlld", name: "Domi" },
  { id: "EXAVITQu4vr4xnSDxMaL", name: "Bella" },
  { id: "ErXwobaYiN019PkySvjV", name: "Antoni" },
  { id: "MF3mGyEYCl7XYWbV9V6O", name: "Elli" },
  { id: "TxGEqnHWrfWFTfGW9XjX", name: "Josh" },
  { id: "VR6AewLTigWG4xSOukaG", name: "Arnold" },
  { id: "pNInz6obpgDQGcFmaJgB", name: "Adam" },
  { id: "yoZ06aMxZJJ28mfd3POQ", name: "Sam" },
]

const DEFAULT_VOICE_ID = "21m00Tcm4TlvDq8ikWAM" // Rachel

// ── Main content ──────────────────────────────────────────────────────────────

function TextToSpeechContent() {
  const searchParams = useSearchParams()
  const recordId = searchParams.get("record")
  const { client, isConnected, connection } = useAprimo()

  const [record, setRecord] = useState<any>(null)
  const [title, setTitle] = useState<string>("")
  const [script, setScript] = useState<string>("")
  const [displayTitle, setDisplayTitle] = useState<string>("")
  const [loading, setLoading] = useState(false)
  const [fetchError, setFetchError] = useState<string | null>(null)

  const [audioContentType, setAudioContentType] = useState(process.env.NEXT_PUBLIC_AUDIO_CONTENT_TYPE ?? "")
  const classificationId = process.env.NEXT_PUBLIC_TTS_CLASSIFICATION_ID ?? ""
  const [voiceId, setVoiceId] = useState(DEFAULT_VOICE_ID)

  const [step, setStep] = useState<PipelineStep>("idle")
  const [pipelineError, setPipelineError] = useState<string | null>(null)
  const [audioUrl, setAudioUrl] = useState<string | null>(null)
  const [newRecordUrl, setNewRecordUrl] = useState<string | null>(null)

  const pipelineOrder = recordId ? PIPELINE_WITH_RECORD : PIPELINE_WITHOUT_RECORD

  const thumbnailUrl = record?._embedded?.masterfilelatestversion?._embedded?.thumbnail?.uri as string | undefined
  const recordTitle: string = record?.title ?? record?._embedded?.masterfilelatestversion?.fileName ?? recordId ?? ""

  // ── Fetch record + fields ──────────────────────────────────────────────────

  useEffect(() => {
    if (!recordId || !client || !isConnected) return
    setLoading(true)
    setFetchError(null)

    const thumbExpander = Expander.create()
      .for<AprimoRecord>("Record").expand("masterfilelatestversion")
      .for<FileVersion>("FileVersion").expand("thumbnail")

    const fieldsExpander = Expander.create()
      .for<AprimoRecord>("Record").expand("fields")

    Promise.all([
      client.records.getById(recordId, thumbExpander),
      client.records.getById(recordId, fieldsExpander),
    ])
      .then(([thumbRes, fieldsRes]) => {
        if (!thumbRes.ok) throw new Error(thumbRes.error?.message ?? "Failed to fetch record")
        const rec = thumbRes.data as any
        setRecord(rec)
        setTitle(rec?.title ?? "")
        const fields: any[] = (fieldsRes.data as any)?._embedded?.fields?.items ?? []
        const scriptField = fields.find((f: any) => f.fieldName === "_Script")
        setScript(scriptField?.localizedValues?.[0]?.value ?? "")
        const displayTitleField = fields.find((f: any) => f.fieldName === "DisplayTitle")
        setDisplayTitle(displayTitleField?.localizedValues?.[0]?.value ?? "")
      })
      .catch((e) => setFetchError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [recordId, client, isConnected])

  // ── Pipeline ───────────────────────────────────────────────────────────────

  async function runPipeline() {
    if (!client || !script.trim() || !audioContentType.trim()) return

    setPipelineError(null)
    setAudioUrl(null)
    setNewRecordUrl(null)

    try {
      // Step 1: Generate audio via ElevenLabs TTS
      setStep("generating")

      const ttsRes = await fetch("/api/elevenlabs/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: script, voiceId }),
      })
      if (!ttsRes.ok) {
        const err = await ttsRes.json().catch(() => ({ error: "TTS failed" }))
        throw new Error(err.error ?? "ElevenLabs TTS failed")
      }
      const audioBlob = await ttsRes.blob()
      const audioTitle = `${(displayTitle.trim() || title.trim() || recordId || "audio")} Audio`
      const safeTitle = audioTitle.replace(/[^a-z0-9\-_ ]/gi, "_")
      const filename = `${safeTitle}.mp3`
      const audioFile = new File([audioBlob], filename, { type: "audio/mpeg" })
      setAudioUrl(URL.createObjectURL(audioBlob))

      if (recordId) {
        // ── Update existing record ─────────────────────────────────────────

        // Step 2: Change content type + title
        setStep("converting")

        const convertBody: Record<string, unknown> = { title: audioTitle, contentType: audioContentType.trim() }
        if (classificationId.trim()) {
          convertBody.classifications = { addOrUpdate: [{ id: classificationId.trim() }] }
        }
        const convertRes = await client.records.update(recordId, convertBody as never)
        if (!convertRes.ok) throw new Error((convertRes as any).error?.message ?? "Failed to change content type")

        // Step 3: Upload audio
        setStep("uploading")

        const uploadResult = await client.uploader.uploadFile(audioFile, { parallelLimit: 4 })
        const uploadData = uploadResult.data as unknown as { token?: string }
        if (!uploadResult.ok || !uploadData?.token) throw new Error(uploadResult.error?.message ?? "Upload failed")
        const token = uploadData.token

        // Step 4: Attach as master file
        setStep("attaching")

        const masterExpander = Expander.create().for<AprimoRecord>("Record").expand("masterfile")
        const recRes = await client.records.getById(recordId, masterExpander)
        const masterFileId = (recRes.data as any)?._embedded?.masterfile?.id as string | undefined

        const attachBody: Record<string, unknown> = {}
        if (masterFileId) {
          attachBody.files = {
            addOrUpdate: [{ id: masterFileId, versions: { addOrUpdate: [{ id: token, fileName: filename }] } }],
          }
        } else {
          attachBody.files = {
            master: token,
            addOrUpdate: [{ versions: { addOrUpdate: [{ id: token, fileName: filename }] } }],
          }
        }

        const attachRes = await client.records.update(recordId, attachBody as never)
        if (!attachRes.ok) throw new Error((attachRes as any).error?.message ?? "Failed to attach audio")

        if (connection) {
          setNewRecordUrl(`https://${connection.environment}.dam.aprimo.com/dam/records/${recordId}`)
        }

      } else {
        // ── Create new record ──────────────────────────────────────────────

        // Step 2: Upload audio
        setStep("uploading")

        const uploadResult = await client.uploader.uploadFile(audioFile, { parallelLimit: 4 })
        const uploadData = uploadResult.data as unknown as { token?: string }
        if (!uploadResult.ok || !uploadData?.token) throw new Error(uploadResult.error?.message ?? "Upload failed")
        const token = uploadData.token

        // Step 3: Create record with audio as master file
        setStep("creating")

        const createBody: Record<string, unknown> = {
          title: audioTitle,
          contentType: audioContentType.trim(),
          files: {
            master: token,
            addOrUpdate: [{ versions: { addOrUpdate: [{ id: token, fileName: filename }] } }],
          },
        }
        if (classificationId.trim()) {
          createBody.classifications = { addOrUpdate: [{ id: classificationId.trim() }] }
        }
        const createRes = await client.records.create(createBody as never)
        if (!createRes.ok) throw new Error((createRes as any).error?.message ?? "Failed to create record")

        const newId = (createRes.data as any)?.id as string | undefined
        if (newId && connection) {
          setNewRecordUrl(`https://${connection.environment}.dam.aprimo.com/dam/records/${newId}`)
        }
      }

      setStep("done")
      toast.success("Audio saved to Aprimo")
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setPipelineError(msg)
      setStep("error")
      toast.error(msg)
    }
  }

  // ── Early returns ──────────────────────────────────────────────────────────

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

  const currentStepIdx = pipelineOrder.indexOf(step)

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <main className="flex-1 p-6 flex flex-col gap-6 max-w-3xl mx-auto w-full">

      {/* Intro */}
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold">AI Audio Creation</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          This is an example of how you can expose AI-powered audio creation to corporate users while keeping output
          governed and reviewable. Scripts are read from Aprimo records or entered directly here, converted to speech
          via ElevenLabs, and saved back to the DAM — giving content teams a self-service voice-over tool without
          losing visibility or control over what gets produced.
        </p>
      </div>

      <Separator />

      {/* Record info (only when a record was passed in) */}
      {record && (
        <>
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
        </>
      )}

      {/* Editable fields */}
      <div className="flex flex-col gap-4">
        <div className="flex flex-col gap-1.5">
          <label className="text-xs text-muted-foreground font-medium">Title</label>
          <Input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Record title"
            className="text-sm"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex items-center gap-2">
            <label className="text-xs text-muted-foreground font-medium">Script</label>
            <Badge variant="secondary" className="text-xs">_Script</Badge>
          </div>
          <Textarea
            value={script}
            onChange={(e) => setScript(e.target.value)}
            placeholder="Enter the script to convert to audio…"
            className="text-sm min-h-[120px] resize-y"
          />
        </div>
      </div>

      {/* Controls */}
      {(step === "idle" || step === "error") && (
        <div className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">Voice</label>
            <Select value={voiceId} onValueChange={setVoiceId}>
              <SelectTrigger className="h-8 text-sm max-w-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {VOICES.map((v) => (
                  <SelectItem key={v.id} value={v.id}>{v.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs text-muted-foreground font-medium">Audio content type</label>
            <Input
              value={audioContentType}
              onChange={(e) => setAudioContentType(e.target.value)}
              placeholder="e.g. Audio"
              className="h-8 text-sm max-w-xs"
            />
            <p className="text-xs text-muted-foreground">Content type name or ID to apply to the record.</p>
          </div>
          {!recordId && !classificationId && (
            <p className="text-xs text-destructive">
              <code className="font-mono">NEXT_PUBLIC_TTS_CLASSIFICATION_ID</code> must be set to create new records.
            </p>
          )}
          <Button onClick={runPipeline} size="sm" className="w-fit h-8"
            disabled={!audioContentType.trim() || !script.trim() || (!recordId && !classificationId.trim())}>
            <Mic className="h-3.5 w-3.5 mr-1.5" />
            {step === "error" ? "Retry" : "Generate audio"}
          </Button>
        </div>
      )}

      {/* Progress */}
      {step !== "idle" && (
        <div className="flex flex-col gap-2">
          <h2 className="text-sm font-medium mb-1">Progress</h2>
          {pipelineOrder.map((s, idx) => {
            const isCompleted = step === "done" || (currentStepIdx > idx && step !== "error")
            const isCurrent = s === step && step !== "done"
            const isFailed = step === "error" && s === pipelineOrder[currentStepIdx === -1 ? 0 : currentStepIdx]

            let icon
            if (isCompleted) icon = <CheckCircle2 className="h-4 w-4 text-green-500 flex-shrink-0" />
            else if (isFailed) icon = <XCircle className="h-4 w-4 text-destructive flex-shrink-0" />
            else if (isCurrent) icon = <Loader2 className="h-4 w-4 animate-spin text-primary flex-shrink-0" />
            else icon = <div className="h-4 w-4 rounded-full border border-muted-foreground/30 flex-shrink-0" />

            return (
              <div key={s} className={`flex items-center gap-3 text-sm ${isCurrent ? "text-foreground font-medium" : isCompleted ? "text-muted-foreground" : "text-muted-foreground/50"}`}>
                {icon}
                <span>{STEP_LABELS[s]}</span>
              </div>
            )
          })}
        </div>
      )}

      {/* Error */}
      {step === "error" && pipelineError && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{pipelineError}</p>
      )}

      {/* Success */}
      {step === "done" && (
        <div className="flex flex-col gap-3 bg-green-500/10 border border-green-500/20 rounded-lg p-4">
          <p className="text-sm font-medium text-green-700 dark:text-green-400">Audio saved to Aprimo</p>
          {audioUrl && (
            <audio controls src={audioUrl} className="w-full max-w-sm h-10" />
          )}
          <div className="flex gap-2 flex-wrap">
            {newRecordUrl && (
              <a href={newRecordUrl} target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-sm text-primary hover:underline">
                Open in Aprimo
              </a>
            )}
            <Button variant="outline" size="sm" className="h-8"
              onClick={() => { setStep("idle"); setAudioUrl(null) }}>
              Generate again
            </Button>
          </div>
        </div>
      )}
    </main>
  )
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function TextToSpeechPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <Suspense fallback={
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      }>
        <TextToSpeechContent />
      </Suspense>
      <Footer />
    </div>
  )
}
