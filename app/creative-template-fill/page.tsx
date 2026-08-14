"use client"

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { ImageIcon, Link2, Minus, Plus, Save, Type } from "lucide-react"
import { Navbar } from "@/components/navbar"
import { toast } from "sonner"
import { Expander } from "aprimo-js"
import { cn, toHex } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { drawLayout, type Fit, type Layer, type Layout, type TextSpan, type TextLayer, type ImageLayer } from "@/lib/creative-template-render"
import { type CanvasTemplate, type ImageEdit, type FieldEdit, type PendingField, isHtml, stripHtml, collectEditable, applyEdits } from "./utils"
import { useAprimo } from "@/context/aprimo-context"
import { useContentSelector, type SelectedRecord } from "@/lib/use-content-selector"

const OUTPUT_CLASSIFICATION_ID = process.env.NEXT_PUBLIC_CANVAS_TEMPLATE_CLASSIFICATION_ID ?? ""

// ── Page ─────────────────────────────────────────────────────────────────────
export default function FillTemplatePage() {
  return <Suspense><FillCanvasTemplatePage /></Suspense>
}

function FillCanvasTemplatePage() {
  const { client } = useAprimo()
  const searchParams = useSearchParams()
  const recordFromParam = searchParams.get("record")

  const [selected, setSelected]     = useState<CanvasTemplate | null>(null)
  const [loadingItem, setLoadingItem] = useState(false)
  const hasLoadedItem = useRef(false)
  const [sourceContentTypeId, setSourceContentTypeId] = useState("")
  const [sourceContentTypeName, setSourceContentTypeName] = useState("")
  const [tabIdx, setTabIdx]         = useState(0)
  const [edits, setEdits]           = useState<Record<string, FieldEdit>>({})
  const [htmlEdits, setHtmlEdits]   = useState<Record<string, string>>({})
  const pendingFieldRef = useRef<PendingField | null>(null)
  const [bulkLoading, setBulkLoading] = useState(false)
  const [fillData, setFillData] = useState<{ fieldValues: any[]; imageUri?: string } | null>(null)
  const [tenantLanguages, setTenantLanguages] = useState<{ id: string; name: string; culture: string }[]>([])
  const [languageOptions, setLanguageOptions] = useState<{ id: string; name: string }[]>([])
  const [selectedLanguageId, setSelectedLanguageId] = useState("")

  const canvasRef = useRef<HTMLCanvasElement>(null)

  // Save-to-Aprimo dialog state.
  const [saveOpen, setSaveOpen]         = useState(false)
  const [assetName, setAssetName]       = useState("")
  const [outputCt, setOutputCt]         = useState("")
  const [contentTypes, setContentTypes] = useState<{ id: string; name: string }[]>([])
  const [preview, setPreview]           = useState<string | null>(null)
  const [capturing, setCapturing]       = useState(false)
  const [saving, setSaving]             = useState(false)

  // Load content types once the Aprimo client is ready.
  useEffect(() => {
    if (!client) return
    let cancelled = false
    ;(async () => {
      try {
        const cts: { id: string; name: string }[] = []
        for await (const page of client.contentTypes.getPaged({ pageSize: 1000 }))
          for (const ct of page.data?.items ?? []) cts.push({ id: ct.id, name: ct.labels?.[0]?.value || ct.name })
        if (!cancelled) setContentTypes(cts.sort((a, b) => a.name.localeCompare(b.name)))
      } catch { /* non-fatal */ }
    })()
    return () => { cancelled = true }
  }, [client])

  // Load tenant languages for the language picker.
  useEffect(() => {
    if (!client) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await client.languages.get({ pageSize: 200 })
        if (!cancelled && res.ok)
          setTenantLanguages((res.data?.items ?? []).map((l) => ({ id: l.id, name: l.name || l.culture, culture: l.culture })))
      } catch { /* non-fatal */ }
    })()
    return () => { cancelled = true }
  }, [client])

  const pickTemplate = useCallback((t: CanvasTemplate) => {
    setSelected(t)
    setTabIdx(0)
    const init: Record<string, FieldEdit> = {}
    for (const layout of t.layouts as Layout[]) {
      for (const l of collectEditable(layout.layers)) {
        if (l.type === "text")  init[l.id] = { type: "text",  text: l.content.text, spans: l.content.spans }
        if (l.type === "image") init[l.id] = { type: "image", src: l.content.src, fit: l.content.fit }
      }
    }
    setEdits(init)
  }, [])

  // Load a template directly from an Aprimo record when ?record= is in the URL.
  useEffect(() => {
    if (!recordFromParam || !client || hasLoadedItem.current) return
    hasLoadedItem.current = true
    setLoadingItem(true)
    ;(async () => {
      try {
        const jsonFieldName = process.env.NEXT_PUBLIC_CANVAS_TEMPLATE_JSON_FIELD
        if (!jsonFieldName) throw new Error("NEXT_PUBLIC_CANVAS_TEMPLATE_JSON_FIELD is not set.")

        let jsonFieldId: string | undefined
        for await (const page of client.fieldDefinitions.getPaged({ pageSize: 500 })) {
          const match = (page.data?.items ?? []).find(
            (f: { id: string; name?: string }) => f.name?.toLowerCase() === jsonFieldName.toLowerCase()
          )
          if (match) { jsonFieldId = match.id; break }
        }
        if (!jsonFieldId) throw new Error(`Field "${jsonFieldName}" not found.`)

        const expander = (Expander as any).create().for("Record").expand("fields")
        const recRes = await client.records.getById(recordFromParam, expander)
        if (!recRes.ok) throw new Error(recRes.error?.message ?? "Could not load record.")

        const embedded = (recRes.data as unknown as { _embedded?: { fields?: { items?: any[] } } })._embedded
        const fieldValues = embedded?.fields?.items ?? []
        const fieldMatch = fieldValues.find((fv: any) => fv.id === jsonFieldId)
        if (!fieldMatch) throw new Error("No template data found on this record.")

        const jsonStr = fieldMatch.localizedValues?.[0]?.value
        if (!jsonStr) throw new Error("Template field is empty.")

        const parsed = JSON.parse(jsonStr) as { sourceContentTypeId?: string; sourceContentTypeName?: string; layouts?: unknown }
        if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.layouts)) {
          throw new Error("Record does not contain valid template data.")
        }
        setSourceContentTypeId(parsed.sourceContentTypeId ?? "")
        setSourceContentTypeName(parsed.sourceContentTypeName ?? "")
        const syntheticTemplate: CanvasTemplate = {
          id: recordFromParam,
          name: "Canvas Template",
          layouts: parsed.layouts as Layout[],
          savedAt: Date.now(),
        }
        pickTemplate(syntheticTemplate)
      } catch (err) {
        toast.error(`Could not load template: ${err instanceof Error ? err.message : String(err)}`)
      } finally {
        setLoadingItem(false)
      }
    })()
  }, [client, recordFromParam, pickTemplate])

  const baseLayout = useMemo<Layout | null>(() =>
    selected ? ((selected.layouts as Layout[])[tabIdx] ?? null) : null
  , [selected, tabIdx])

  const liveLayout = useMemo<Layout | null>(() =>
    baseLayout ? { ...baseLayout, layers: applyEdits(baseLayout.layers, edits) } : null
  , [baseLayout, edits])

  const fields = useMemo<Layer[]>(() =>
    baseLayout ? collectEditable(baseLayout.layers) : []
  , [baseLayout])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !liveLayout) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return
    void drawLayout(ctx, liveLayout)
  }, [liveLayout])

  const setTextEdit = useCallback((id: string, text: string, spans?: TextSpan[]) => setEdits((p) => ({ ...p, [id]: { type: "text", text, spans } })), [])

  const setImageSrc = useCallback((id: string, src: string) => setEdits((p) => {
    const prev = p[id]; const fit = prev?.type === "image" ? prev.fit : undefined
    return { ...p, [id]: { type: "image", src, fit } }
  }), [])
  const setImageFit = useCallback((id: string, fit: Fit) => setEdits((p) => {
    const prev = p[id]; const src = prev?.type === "image" ? prev.src : ""
    return { ...p, [id]: { type: "image", src, fit } }
  }), [])

  // Resolve an Aprimo record's master file public URI, trying multiple SDK paths.
  function pickPublicUri(rec: Record<string, unknown>): string | undefined {
    const candidates: unknown[] = [
      (rec as any)?.masterFileLatestVersion?.publicUris?.items,
      (rec as any)?.masterFileLatestVersion?.publicuris?.items,
      (rec as any)?.masterFileLatestVersion?._embedded?.publicuris?.items,
      (rec as any)?._embedded?.masterfilelatestversion?._embedded?.publicuris?.items,
      (rec as any)?._embedded?.masterfilelatestversion?.publicUris?.items,
    ]
    for (const c of candidates) {
      if (!Array.isArray(c) || c.length === 0) continue
      const orig = c.find((u: any) => u.renditionName === "Original file") ?? c[0]
      if (orig?.uri) return orig.uri as string
    }
    return undefined
  }

  const handleImageAccept = useCallback(async (selection: SelectedRecord[]) => {
    const record = selection[0]
    const pending = pendingFieldRef.current
    if (!record || !pending || pending.kind !== "image") return
    pendingFieldRef.current = null
    try {
      // singlerendition mode — rendition.publicuri is the chosen rendition URL.
      const url = (record.rendition as any)?.publicuri as string | undefined
      if (url) setImageSrc(pending.id, url)
      else toast.error("This rendition has no public URI.")
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to load from Aprimo.")
    }
  }, [setImageSrc])

  const applyFill = useCallback((languageId: string, data: { fieldValues: any[]; imageUri?: string }) => {
    const { fieldValues, imageUri } = data

    // Pre-compute HTML field values so we can track them outside setEdits
    const htmlMap: Record<string, string> = {}
    for (const field of fields) {
      if (field.type === "text") {
        const af = (field as TextLayer).content.aprimoField
        if (af) {
          const match = fieldValues.find((fv: any) => fv.id === af.id)
          const lv = (match?.localizedValues ?? []).find((v: any) => v.languageId === languageId)
          const value: string | undefined = lv?.value ?? match?.localizedValues?.[0]?.value
          if (value !== undefined && isHtml(value)) htmlMap[field.id] = value
        }
      }
    }

    setEdits((prev) => {
      const next = { ...prev }
      for (const field of fields) {
        if (field.type === "image" && (field as ImageLayer).content.source !== "free") {
          if (imageUri) {
            const prevFit = prev[field.id]?.type === "image" ? (prev[field.id] as ImageEdit).fit : undefined
            next[field.id] = { type: "image", src: imageUri, fit: prevFit }
          }
        }
        if (field.type === "text") {
          const af = (field as TextLayer).content.aprimoField
          if (af) {
            const match = fieldValues.find((fv: any) => fv.id === af.id)
            const lv = (match?.localizedValues ?? []).find((v: any) => v.languageId === languageId)
            const value: string | undefined = lv?.value ?? match?.localizedValues?.[0]?.value
            if (value !== undefined) next[field.id] = { type: "text", text: isHtml(value) ? stripHtml(value) : value }
          }
        }
      }
      return next
    })
    setHtmlEdits(htmlMap)
  }, [fields])

  const handleBulkAccept = useCallback(async (selection: SelectedRecord[]) => {
    const record = selection[0]
    if (!record || !client) return
    setBulkLoading(true)
    try {
      const hasAssetImages = fields.some(
        (f) => f.type === "image" && (f as ImageLayer).content.source !== "free"
      )

      // Expand fields for text binding + masterfilelatestversion → publicuris for images
      const exp = (Expander as any).create()
        .for("Record").expand("fields", "masterfilelatestversion")
        .for("FileVersion").expand("publicuris")
      const r = await client.records.getById(record.id, exp, "*")
      if (!r.ok) throw new Error(r.error?.message ?? "Could not load record.")

      const recData = r.data as any
      const fieldValues: any[] = recData?._embedded?.fields?.items ?? []

      let imageUri: string | undefined
      if (hasAssetImages) {
        imageUri = pickPublicUri(recData)
        if (!imageUri) {
          const orderRes = await client.orders.create({
            type: "download",
            targets: [{ recordId: record.id, targetTypes: ["Document"], assetType: "LatestVersionOfMasterFile" } as never],
          })
          if (!orderRes.ok) throw new Error(orderRes.error?.message ?? "Failed to create download order")
          let order = orderRes.data as any
          for (let i = 0; i < 60 && order?.status !== "Completed" && order?.status !== "Success" && order?.status !== "Failed"; i++) {
            await new Promise((res) => setTimeout(res, 1000))
            const poll = await client.orders.getById(order.id)
            if (poll.ok) order = poll.data
          }
          imageUri = (order?.deliveredFiles as string[] | undefined)?.[0]
        }
      }

      // Collect unique language IDs from bound text fields
      const boundTextFields = fields.filter(
        (f): f is TextLayer => f.type === "text" && !!(f as TextLayer).content.aprimoField
      )
      const langIds = new Set<string>()
      for (const f of boundTextFields) {
        const match = fieldValues.find((fv: any) => fv.id === f.content.aprimoField!.id)
        for (const lv of (match?.localizedValues ?? [])) {
          if (lv.languageId && lv.value?.trim()) langIds.add(lv.languageId)
        }
      }

      const data = { fieldValues, imageUri }
      setFillData(data)

      if (langIds.size > 1) {
        const opts = [...langIds].map((id) => {
          const lang = tenantLanguages.find((l) => l.id === id)
          return { id, name: lang?.name ?? id, culture: lang?.culture ?? "" }
        })
        const englishOpt = opts.find(
          (o) => o.name.toLowerCase().includes("english") || o.culture.toLowerCase().startsWith("en")
        )
        const defaultOpt = englishOpt ?? opts[0]
        setLanguageOptions(opts)
        setSelectedLanguageId(defaultOpt.id)
        applyFill(defaultOpt.id, data)
      } else {
        setLanguageOptions([])
        const firstLangId = [...langIds][0] ?? ""
        setSelectedLanguageId(firstLangId)
        applyFill(firstLangId, data)
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to fill from record.")
    } finally {
      setBulkLoading(false)
    }
  }, [client, fields, tenantLanguages, applyFill])

  const imageSelector = useContentSelector({ select: "singlerendition", onAccept: handleImageAccept })
  const bulkSelector  = useContentSelector({ select: "single", onAccept: handleBulkAccept, contentTypeName: sourceContentTypeName || undefined })

  const [zoom, setZoom] = useState<number | null>(null)
  const displayScale = zoom ?? 1
  const zoomIn  = useCallback(() => setZoom((z) => Math.min(3, Math.round(((z ?? 1) + 0.1) * 100) / 100)), [])
  const zoomOut = useCallback(() => setZoom((z) => Math.max(0.1, Math.round(((z ?? 1) - 0.1) * 100) / 100)), [])

  useEffect(() => { setZoom(null) }, [selected, tabIdx])

  const captureImage = useCallback(async (): Promise<string | null> => {
    if (!liveLayout) return null
    try {
      const off = document.createElement("canvas")
      off.width  = liveLayout.width
      off.height = liveLayout.height
      const ctx = off.getContext("2d")
      if (!ctx) return null
      await drawLayout(ctx, liveLayout)
      return off.toDataURL("image/png")
    } catch (err) {
      console.error("[fill-canvas] capture failed:", err)
      return null
    }
  }, [liveLayout])

  const openSaveDialog = useCallback(async () => {
    if (!client) return toast.error("Not connected to Aprimo.")
    setAssetName(selected?.name ? `${selected.name} — asset` : "New asset")
    setSaveOpen(true)
    setCapturing(true)
    setPreview(await captureImage())
    setCapturing(false)
  }, [client, selected, captureImage])

  const saveToAprimo = useCallback(async () => {
    if (!client || !preview) return
    if (!outputCt) return toast.error("Choose a content type.")
    setSaving(true)
    try {
      const blob = await (await fetch(preview)).blob()
      const file = new File([blob], `${assetName || "asset"}.png`, { type: "image/png" })
      const up = await client.uploader.uploadFile(file)
      if (!up.ok || !up.data?.token) throw new Error("Image upload failed.")
      const token = up.data.token
      const req = {
        status: "draft",
        contentType: outputCt,
        classifications: { addOrUpdate: [{ id: OUTPUT_CLASSIFICATION_ID }] },
        files: { master: token, addOrUpdate: [{ versions: { addOrUpdate: [{ id: token, fileName: file.name }] } }] },
      } as unknown as Parameters<typeof client.records.create>[0]
      const created = await client.records.create(req)
      if (!created.ok) throw new Error(created.error?.message ?? "Record create failed.")
      toast.success(`Asset created (${created.data?.id ?? ""}).`)
      setSaveOpen(false)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save to Aprimo.")
    } finally {
      setSaving(false)
    }
  }, [client, preview, outputCt, assetName])

  // ── Loading / no-template screen ─────────────────────────────────────────
  if (!selected) {
    return (
      <div className="min-h-screen bg-background text-foreground flex flex-col overflow-x-hidden">
        <Navbar />
        <div className="flex flex-1 items-center justify-center">
          <p className="text-sm text-muted-foreground">
            {loadingItem ? "Loading template…" : "No template provided. Open this page from an Aprimo canvas template record."}
          </p>
        </div>
      </div>
    )
  }

  // ── Fill screen ───────────────────────────────────────────────────────────
  const allLayouts = selected.layouts as Layout[]
  const fitOpts: Fit[] = ["cover", "contain", "fill"]

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-x-hidden">
      <Navbar />

      {/* Header bar */}
      <div className="border-b border-border px-6 py-3 flex items-center gap-3">
        <span className="text-sm font-semibold">{selected.name}</span>
        {sourceContentTypeName && (
          <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-0.5 text-xs text-muted-foreground">
            {sourceContentTypeName}
          </span>
        )}
        <div className="ml-auto">
          <Button size="sm" onClick={openSaveDialog}>
            <Save className="h-4 w-4" /> Save asset
          </Button>
        </div>
      </div>

      {/* Two-column layout */}
      <div className="flex-1 overflow-hidden grid" style={{ gridTemplateColumns: "1fr 20rem" }}>

        {/* ── Canvas area ── */}
        <div className="overflow-auto rounded-xl border border-border bg-[repeating-conic-gradient(#f3f4f6_0%_25%,#fff_0%_50%)] bg-[length:20px_20px] p-6">
          {allLayouts.length > 1 && (
            <div className="flex gap-0.5 mb-5 border-b border-border">
              {allLayouts.map((l, i) => (
                <button key={i} onClick={() => setTabIdx(i)}
                  className={cn(
                    "px-3.5 py-1.5 text-sm border-b-2 -mb-px bg-transparent border-x-0 border-t-0 cursor-pointer transition-colors",
                    i === tabIdx ? "font-semibold text-primary border-primary" : "font-normal text-muted-foreground border-transparent hover:text-foreground"
                  )}>
                  {l.name}
                </button>
              ))}
            </div>
          )}

          {/* Zoom controls */}
          <div className="flex items-center justify-end gap-1.5 mb-4">
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomOut}>
              <Minus className="h-3 w-3" />
            </Button>
            <span className="text-xs font-mono w-11 text-center text-muted-foreground">
              {Math.round(displayScale * 100)}%
            </span>
            <Button variant="outline" size="icon" className="h-7 w-7" onClick={zoomIn}>
              <Plus className="h-3 w-3" />
            </Button>
            <Button variant="outline" size="sm" className="h-7 text-xs px-2" onClick={() => setZoom(null)}>
              Fit
            </Button>
          </div>

          {liveLayout && (
            <div className="flex justify-center">
              <div className="relative shadow-sm flex-shrink-0"
                style={{ width: liveLayout.width * displayScale, height: liveLayout.height * displayScale }}>
                <canvas
                  ref={canvasRef}
                  width={liveLayout.width}
                  height={liveLayout.height}
                  style={{ position: "absolute", top: 0, left: 0, transformOrigin: "top left", transform: `scale(${displayScale})` }}
                />
              </div>
            </div>
          )}
        </div>

        {/* ── Fields panel ── */}
        <aside className="flex flex-col overflow-hidden border-l border-border bg-card">
          <div className="px-4 py-3 border-b border-border flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-sm font-semibold">Content fields</p>
              <p className="text-xs text-muted-foreground">{fields.length} editable field{fields.length !== 1 ? "s" : ""}</p>
            </div>
            <Button className="w-full gap-2"
              onClick={() => bulkSelector.open()}
              disabled={!bulkSelector.canOpen || bulkLoading || fields.length === 0}>
              <Link2 className="h-4 w-4" />
              {bulkLoading ? "Filling…" : "Fill from record"}
            </Button>
            {languageOptions.length > 1 && (
              <Select value={selectedLanguageId} onValueChange={(id) => {
                setSelectedLanguageId(id)
                if (fillData) applyFill(id, fillData)
              }}>
                <SelectTrigger className="h-8 text-xs w-full">
                  <SelectValue placeholder="Select language…" />
                </SelectTrigger>
                <SelectContent>
                  {languageOptions.map((lang) => (
                    <SelectItem key={lang.id} value={lang.id} className="text-xs">{lang.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>
          <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-5">
            {fields.length === 0 && (
              <p className="text-sm text-muted-foreground leading-relaxed">
                No editable fields on this canvas. Open it in the Template Canvas editor and unlock the layers you want users to fill.
              </p>
            )}
            {fields.map((field) => (
              <div key={field.id}>
                <div className="flex items-center gap-1.5 mb-2">
                  <span className={cn("inline-flex items-center justify-center h-5 w-5 rounded", field.type === "text" ? "bg-primary/10" : "bg-muted")}>
                    {field.type === "text"
                      ? <Type className="h-3 w-3 text-primary" />
                      : <ImageIcon className="h-3 w-3 text-muted-foreground" />}
                  </span>
                  <Label className="text-xs font-semibold">{field.name}</Label>
                </div>

                {field.type === "text" && (() => {
                  const edit  = edits[field.id]
                  const spans = (edit?.type === "text" ? edit.spans : undefined) ?? (field as TextLayer).content.spans
                  const text  = (edit?.type === "text" ? edit.text  : undefined) ?? (field as TextLayer).content.text
                  const af    = (field as TextLayer).content.aprimoField
                  if (spans && spans.length > 0) {
                    return (
                      <div className="flex flex-col gap-1.5 p-3 bg-muted/40 rounded-lg border border-border">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Color runs</p>
                        {spans.map((span, i) => (
                          <div key={i} className="flex items-center gap-2">
                            <input type="color" value={toHex(span.color ?? (field as TextLayer).content.color)}
                              onChange={(e) => { const next = spans.map((s, j) => j === i ? { ...s, color: e.target.value } : s); setTextEdit(field.id, next.map((s) => s.text).join(""), next) }}
                              className="h-8 w-8 rounded border border-border cursor-pointer flex-shrink-0 p-0.5" />
                            <Input value={span.text}
                              onChange={(e) => { const next = spans.map((s, j) => j === i ? { ...s, text: e.target.value } : s); setTextEdit(field.id, next.map((s) => s.text).join(""), next) }}
                              className="h-8 text-xs flex-1" placeholder={`Part ${i + 1}…`} />
                          </div>
                        ))}
                      </div>
                    )
                  }
                  return (
                    <div className="flex flex-col gap-1.5">
                      {af && (
                        <p className="text-[10px] text-muted-foreground">
                          Bound to <span className="font-medium text-foreground">{af.name}</span>
                        </p>
                      )}
                      {af && htmlEdits[field.id] ? (
                        <div
                          className="text-xs p-2 rounded-md border border-border bg-muted/40 text-foreground [&_p]:mb-1 [&_p:last-child]:mb-0 [&_strong]:font-semibold [&_em]:italic [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:mb-0.5"
                          dangerouslySetInnerHTML={{ __html: htmlEdits[field.id] }}
                        />
                      ) : (
                        <Textarea value={text} readOnly={!!af}
                          onChange={af ? undefined : (e) => setTextEdit(field.id, e.target.value, undefined)}
                          rows={2}
                          className={cn("resize-y text-xs", af && "bg-muted/40 text-muted-foreground cursor-default")} />
                      )}
                    </div>
                  )
                })()}

                {field.type === "image" && (() => {
                  const imageEdit = edits[field.id]?.type === "image" ? edits[field.id] as ImageEdit : undefined
                  const src       = imageEdit?.src ?? (field as ImageLayer).content.src
                  const fit       = imageEdit?.fit ?? (field as ImageLayer).content.fit ?? "cover"
                  const isFree    = (field as ImageLayer).content.source === "free"
                  return (
                    <div className="flex flex-col gap-2">
                      {(() => {
                        const fitPicker = (
                          <div className="flex gap-0.5 bg-muted rounded-md p-0.5">
                            {fitOpts.map((f) => (
                              <button key={f} onClick={() => setImageFit(field.id, f)}
                                className={cn(
                                  "px-2 py-0.5 rounded text-[11px] font-medium transition-colors cursor-pointer border-none capitalize",
                                  fit === f ? "bg-primary text-primary-foreground" : "bg-transparent text-muted-foreground hover:text-foreground"
                                )}>
                                {f}
                              </button>
                            ))}
                          </div>
                        )
                        return isFree ? (
                          <div className="flex gap-2">
                            <Button size="sm" variant="outline" className="flex-1 h-8 text-xs"
                              onClick={() => { pendingFieldRef.current = { id: field.id, kind: "image" }; imageSelector.open() }}
                              disabled={!imageSelector.canOpen}>
                              <ImageIcon className="h-3 w-3" />
                              Browse DAM
                            </Button>
                            {fitPicker}
                          </div>
                        ) : (
                          <div className="flex items-center justify-between">
                            <p className="text-[10px] text-muted-foreground">Filled from source asset</p>
                            {fitPicker}
                          </div>
                        )
                      })()}
                      {src && (
                        <div className="w-full h-28 rounded-lg overflow-hidden border border-border">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={src} alt={field.name} className="w-full h-full" style={{ objectFit: fit }} />
                        </div>
                      )}
                      {isFree && (
                        <Input value={src} onChange={(e) => setImageSrc(field.id, e.target.value)}
                          placeholder="or paste a URL…" className="h-8 text-xs font-mono" />
                      )}
                    </div>
                  )
                })()}
              </div>
            ))}
          </div>
        </aside>
      </div>

      {/* ── Save asset dialog ── */}
      <Dialog open={saveOpen} onOpenChange={(o) => { if (!saving) setSaveOpen(o) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Save asset</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col gap-4">
            <div className="w-full h-44 rounded-lg overflow-hidden bg-muted border border-border flex items-center justify-center">
              {capturing ? (
                <p className="text-sm text-muted-foreground">Rendering…</p>
              ) : preview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={preview} alt="Preview" className="max-w-full max-h-full object-contain" />
              ) : (
                <p className="text-sm text-muted-foreground">Capture failed.</p>
              )}
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Asset name</Label>
              <Input value={assetName} onChange={(e) => setAssetName(e.target.value)} placeholder="Asset name…" className="h-8 text-sm" />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Content type</Label>
              <Select value={outputCt} onValueChange={setOutputCt}>
                <SelectTrigger className="h-8 text-sm">
                  <SelectValue placeholder="Select content type…" />
                </SelectTrigger>
                <SelectContent>
                  {contentTypes.map((ct) => <SelectItem key={ct.id} value={ct.name}>{ct.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveOpen(false)} disabled={saving}>Cancel</Button>
            <Button onClick={saveToAprimo} disabled={saving || capturing || !preview || !outputCt || !assetName.trim()}>
              {saving ? "Saving…" : "Save asset"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
