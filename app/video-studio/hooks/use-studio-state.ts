"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { Expander } from "aprimo-js"
import type { Record as AprimoRecord } from "aprimo-js/model"
import { useAprimo } from "@/context/aprimo-context"
import { supabase } from "@/lib/supabase"
import { PLATFORMS } from "../../video-resizer/constants"
import { SelectedAsset, VideoClip, TransitionClip, AudioClip, TextClip } from "../types"

export function useStudioState({ recordParam, basketParam }: { recordParam: string | null; basketParam: string | null }) {
  const { isConnected, client } = useAprimo()

  // Assets
  const [assets, setAssets] = useState<SelectedAsset[]>([])
  const [durations, setDurations] = useState<Record<string, number>>({})
  const [draggingId, setDraggingId] = useState<string | null>(null)
  const [draggingTransitionType, setDraggingTransitionType] = useState<string | null>(null)

  // Timeline clips
  const [videoClips, setVideoClips] = useState<VideoClip[]>([])
  const [transitionClips, setTransitionClips] = useState<TransitionClip[]>([])
  const [audioClips, setAudioClips] = useState<AudioClip[]>([])
  const [textClips, setTextClips] = useState<TextClip[]>([])
  const [trimClipId, setTrimClipId] = useState<string | null>(null)

  // Output settings
  const [platform, setPlatform] = useState("YouTube")
  const [formatIndex, setFormatIndex] = useState(0)
  const [cropMode, setCropMode] = useState<"fill" | "fit">("fit")
  const [zoom, setZoom] = useState(100)
  const [rotation, setRotation] = useState(0)
  const [outputFormat, setOutputFormat] = useState("MP4")

  // Preview
  const [previewWidth, setPreviewWidth] = useState<360 | 720 | 1280>(360)
  const [disableFades, setDisableFades] = useState(false)

  // State inspector / loader
  const [stateJson, setStateJson] = useState<string | null>(null)
  const [loadDialogOpen, setLoadDialogOpen] = useState(false)
  const [loadInput, setLoadInput] = useState("")
  const [loadError, setLoadError] = useState<string | null>(null)

  // Save to Aprimo
  const [saveDialogOpen, setSaveDialogOpen] = useState(false)
  const [projectNameInput, setProjectNameInput] = useState("")

  // VS settings availability
  const [vsSettingsReady, setVsSettingsReady] = useState(false)
  useEffect(() => {
    const ct = process.env.NEXT_PUBLIC_VIDEO_STUDIO_CONTENT_TYPE || localStorage.getItem("aprimo_vs_content_type")
    const cid = process.env.NEXT_PUBLIC_VIDEO_STUDIO_CLASSIFICATION_ID || localStorage.getItem("aprimo_vs_classification_id")
    const jf = process.env.NEXT_PUBLIC_VIDEO_STUDIO_JSON_FIELD || localStorage.getItem("aprimo_vs_json_field")
    setVsSettingsReady(!!(ct && cid && jf))
  }, [])

  // Record auto-load
  const [loadingRecord, setLoadingRecord] = useState(false)
  const recordLoadedRef = useRef(false)

  // Basket auto-load
  const [pendingBasketAssets, setPendingBasketAssets] = useState<{ id: string; title: string }[]>([])
  const basketLoadedRef = useRef(false)

  // ── derived ──────────────────────────────────────────────────────────────────

  const formats = PLATFORMS[platform] ?? PLATFORMS["YouTube"]
  const selectedFormat = formats[Math.min(formatIndex, formats.length - 1)]
  const sortedClips = [...videoClips].sort((a, b) => a.startTime - b.startTime)
  const videoEndTime = sortedClips.length > 0 ? Math.max(...sortedClips.map((c) => c.startTime + c.duration)) : 0
  const trimClip = trimClipId ? videoClips.find((c) => c.assetId === trimClipId) ?? null : null
  const trimAsset = trimClip ? assets.find((a) => a.id === trimClip.assetId) ?? null : null

  // ── functions ─────────────────────────────────────────────────────────────────

  function loadState(json: string) {
    const s = JSON.parse(json)

    const restoredAssets: SelectedAsset[] = (s.assets ?? []).map(({ duration: _d, ...a }: any) => ({
      ...a, thumbnailUrl: a.thumbnailUrl ?? null, loading: false, error: null,
    }))
    setAssets(restoredAssets)

    const restoredDurations: Record<string, number> = {}
    ;(s.assets ?? []).forEach((a: any) => { if (a.duration != null) restoredDurations[a.id] = a.duration })
    setDurations(restoredDurations)

    setVideoClips(s.videoClips ?? [])
    setTransitionClips(s.transitionClips ?? [])
    setAudioClips(s.audioClips ?? [])
    setTextClips((s.textClips ?? []).map(({ asset: _a, ...tc }: any) => tc))

    if (s.output) {
      const p = s.output.platform ?? "YouTube"
      setPlatform(p)
      setCropMode(s.output.cropMode ?? "fit")
      setZoom(s.output.zoom ?? 100)
      setRotation(s.output.rotation ?? 0)
      setOutputFormat(s.output.outputFormat ?? "MP4")
      const fmts = PLATFORMS[p] ?? []
      setFormatIndex(Math.max(0, fmts.findIndex((f) => f.label === s.output.format?.label)))
    }
  }

  function buildStateJson() {
    const state = {
      output: { platform, format: selectedFormat, cropMode, zoom, rotation, outputFormat },
      assets: assets.map((a) => ({ ...a, duration: durations[a.id] ?? null })),
      videoClips: sortedClips,
      transitionClips,
      audioClips,
      textClips: textClips.map((tc) => ({ ...tc, asset: assets.find((a) => a.id === tc.assetId) })),
    }
    setStateJson(JSON.stringify(state, null, 2))
  }

  function handleTrimChange(trimIn: number, duration: number) {
    if (!trimClipId) return
    setVideoClips((prev) => prev.map((c) =>
      c.assetId === trimClipId ? { ...c, trimIn, duration, trimSet: true } : c
    ))
  }

  // ── record auto-load ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!recordParam || !client || !isConnected || recordLoadedRef.current) return
    recordLoadedRef.current = true

    const jsonFieldName = process.env.NEXT_PUBLIC_VIDEO_STUDIO_JSON_FIELD
      || localStorage.getItem("aprimo_vs_json_field")
    if (!jsonFieldName) return

    setLoadingRecord(true)

    const expander = Expander.create()
      .for<AprimoRecord>("Record").expand("fields")
      .selectRecordFields(jsonFieldName)

    client.records.getById(recordParam, expander)
      .then((result: any) => {
        if (!result.ok) throw new Error(result.error?.message ?? "Failed to load record")
        const record = result.data as any
        if (!record) throw new Error("Record not found")

        const fields: any[] = record._embedded?.fields?.items ?? []
        const field = fields.find((f: any) => f.fieldName === jsonFieldName)
        if (!field) throw new Error(`Field "${jsonFieldName}" not found on record`)

        const value = field.localizedValues?.[0]?.value
        if (!value) throw new Error("Field has no value")

        loadState(value)
        toast.success("Project loaded")
      })
      .catch((err: unknown) => {
        toast.error(`Failed to load record: ${err instanceof Error ? err.message : String(err)}`)
      })
      .finally(() => setLoadingRecord(false))
  }, [recordParam, client, isConnected])

  // ── basket auto-load ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (!basketParam || !client || !isConnected || basketLoadedRef.current) return
    basketLoadedRef.current = true

    async function loadBasket() {
      const { data: row } = await supabase
        .from("requested_records")
        .select("recordList")
        .eq("requestId", basketParam)
        .maybeSingle()
      if (!row?.recordList?.length) return

      const ids: string[] = row.recordList
      const expander = Expander.create()
        .for<AprimoRecord>("Record").expand("masterfilelatestversion")

      const BATCH = 50
      const batchResults = await Promise.all(
        Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) => ids.slice(i * BATCH, i * BATCH + BATCH))
          .map((batch) => {
            const expression = batch.map((id) => `id='${id}'`).join(" OR ")
            return client!.search.records({ searchExpression: { expression } }, expander)
          })
      )

      await supabase.from("requested_records").delete().eq("requestId", basketParam)

      const records = batchResults.flatMap((r) => (r.data as any)?.items ?? []) as any[]
      setPendingBasketAssets(
        records.map((r) => ({
          id: r.id,
          title: r.title ?? r._embedded?.masterfilelatestversion?.fileName ?? r.id,
        }))
      )
      toast.success(`${records.length} asset${records.length !== 1 ? "s" : ""} added from basket`)
    }

    loadBasket().catch((err) =>
      toast.error(`Failed to load basket: ${err instanceof Error ? err.message : String(err)}`)
    )
  }, [basketParam, client, isConnected])

  return {
    assets, setAssets,
    durations, setDurations,
    draggingId, setDraggingId,
    draggingTransitionType, setDraggingTransitionType,
    videoClips, setVideoClips,
    transitionClips, setTransitionClips,
    audioClips, setAudioClips,
    textClips, setTextClips,
    trimClipId, setTrimClipId,
    platform, setPlatform,
    formatIndex, setFormatIndex,
    cropMode, setCropMode,
    zoom, setZoom,
    rotation, setRotation,
    outputFormat, setOutputFormat,
    previewWidth, setPreviewWidth,
    disableFades, setDisableFades,
    stateJson, setStateJson,
    loadDialogOpen, setLoadDialogOpen,
    loadInput, setLoadInput,
    loadError, setLoadError,
    saveDialogOpen, setSaveDialogOpen,
    projectNameInput, setProjectNameInput,
    formats, selectedFormat,
    sortedClips, videoEndTime,
    trimClip, trimAsset,
    loadState, buildStateJson, handleTrimChange,
    vsSettingsReady, loadingRecord,
    pendingBasketAssets,
  }
}
