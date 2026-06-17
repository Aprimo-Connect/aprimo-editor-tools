"use client"

import { useCallback, useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { supabase } from "@/lib/supabase"
import { Expander } from "aprimo-js"
import type { Record as AprimoSDKRecord, FileVersion } from "aprimo-js/model"
import { Button } from "@/components/ui/button"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { CheckCircle2, XCircle, Loader2 } from "lucide-react"
import { FieldDefinitionsPanel } from "@/components/field-definitions-panel"
import { exportToExcel } from "@/lib/export"
import { RecordsTableEditable } from "@/components/records-table-editable"
import type { EditValue } from "@/components/records-table-editable"
import type { AprimoRecord, FieldDef, ClassificationNode, OptionItem } from "@/models/aprimo"

interface SaveResult {
  recordId: string
  success: boolean
  error?: string
}

function BasketEditorContent() {
  const searchParams = useSearchParams()
  const requestId = searchParams.get("requestId")
  const { client, isConnected, selectedLanguageId } = useAprimo()

  const [records, setRecords] = useState<AprimoRecord[]>([])
  const [recordIds, setRecordIds] = useState<string[]>([])
  const [requestedCount, setRequestedCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])
  const [classifications, setClassifications] = useState<ClassificationNode[]>([])
  const [classificationsById, setClassificationsById] = useState<Map<string, ClassificationNode>>(new Map())
  const [optionItemsByField, setOptionItemsByField] = useState<Map<string, OptionItem[]>>(new Map())
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [tableFields, setTableFields] = useState<string[]>([])

  const [languages, setLanguages] = useState<{ id: string; name: string }[]>([])
  const [languageId, setLanguageId] = useState<string>("")

  const [edits, setEdits] = useState<Record<string, Record<string, EditValue>>>({})
  const [showContentType, setShowContentType] = useState(true)
  const [showStatus, setShowStatus] = useState(true)
  const [exporting, setExporting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null)
  const [saveResults, setSaveResults] = useState<SaveResult[]>([])

  useEffect(() => {
    if (!isConnected || !client) return

    async function loadFieldDefs() {
      const allDefs: FieldDef[] = []
      for await (const result of client!.fieldDefinitions.getPaged()) {
        if (!result.ok) break
        allDefs.push(...(result.data?.items ?? []) as unknown as FieldDef[])
      }
      const filtered = allDefs
        .filter((d) => !["RecordLink", "Json", "HyperlinkList", "Duration"].includes(d.dataType))
        .sort((a, b) => (a.label ?? a.name).localeCompare(b.label ?? b.name))
      setFieldDefs(filtered)
      setOptionItemsByField(
        new Map(
          filtered
            .filter((d) => d.dataType === "OptionList" && d.items)
            .map((d) => [d.name, d.items!])
        )
      )
    }

    async function loadClassifications() {
      const all: ClassificationNode[] = []
      for await (const result of client!.classifications.getPaged(undefined, undefined, "*")) {
        if (!result.ok) break
        all.push(...(result.data?.items ?? []) as unknown as ClassificationNode[])
      }
      setClassifications(all)
      setClassificationsById(new Map(all.map((c) => [c.id, c])))
    }

    async function loadLanguages() {
      const all: { id: string; name: string }[] = []
      for await (const result of client!.languages.getPaged()) {
        if (!result.ok) break
        const items = (result.data?.items ?? []) as unknown as { id: string; name: string; isEnabledForFields: boolean }[]
        all.push(...items.filter((l) => l.isEnabledForFields))
      }
      setLanguages(all.sort((a, b) => a.name.localeCompare(b.name)))
    }

    loadFieldDefs()
    loadClassifications()
    loadLanguages()
  }, [isConnected, client])

  // Default the save language to the active language when possible.
  useEffect(() => {
    if (languageId || !languages.length) return
    const preferred = selectedLanguageId && selectedLanguageId !== "__system__"
      ? languages.find((l) => l.id === selectedLanguageId)
      : undefined
    setLanguageId((preferred ?? languages[0]).id)
  }, [languages, selectedLanguageId, languageId])

  const fetchRecords = useCallback(async (ids: string[], fields: string[]) => {
    if (!client) return []

    const expander = Expander.create()
      .for<AprimoSDKRecord>("Record").expand("fields", "masterfilelatestversion")
      .for<FileVersion>("FileVersion").expand("thumbnail", "preview")
    if (fields.length > 0) expander.selectRecordFields(...fields)

    const BATCH = 50
    const batches = Array.from({ length: Math.ceil(ids.length / BATCH) }, (_, i) =>
      ids.slice(i * BATCH, i * BATCH + BATCH)
    )
    const batchResults = await Promise.all(
      batches.map((batch) => {
        const expression = batch.map((id) => `id='${id}'`).join(" OR ")
        return client.search.records({ searchExpression: { expression } }, expander)
      })
    )
    return batchResults.flatMap((r) => ((r.data as unknown as { items?: AprimoRecord[] })?.items ?? []))
  }, [client])

  useEffect(() => {
    if (!requestId || !isConnected || !client) return

    async function load() {
      setLoading(true)
      setError(null)

      const { data: row, error: dbError } = await supabase
        .from("requested_records")
        .select("recordList")
        .eq("requestId", requestId)
        .single()

      if (dbError || !row) {
        setError(dbError?.message ?? "Request not found")
        setLoading(false)
        return
      }

      setRequestedCount(row.recordList.length)
      setRecordIds(row.recordList)

      await supabase.from("requested_records").delete().eq("requestId", requestId)

      try {
        const fetched = await fetchRecords(row.recordList, [])
        setRecords(fetched)
      } catch (err) {
        setError(err instanceof Error ? err.message : "Search failed")
      }

      setLoading(false)
    }

    load()
  }, [requestId, isConnected, client, fetchRecords])

  function toggleField(name: string) {
    setSelectedFields((prev) => {
      const next = new Set(prev)
      next.has(name) ? next.delete(name) : next.add(name)
      return next
    })
  }

  // Reloading the table with a new field set invalidates pending edits.
  function setTableFieldsAndReset(fields: string[]) {
    setTableFields(fields)
    setEdits({})
    setSaveResults([])
  }

  function onEdit(recordId: string, fieldName: string, value: EditValue) {
    setEdits((prev) => ({
      ...prev,
      [recordId]: { ...(prev[recordId] ?? {}), [fieldName]: value },
    }))
  }

  const editedRecordIds = Object.keys(edits).filter((id) => Object.keys(edits[id]).length > 0)

  // Export reflects saved server state for the currently displayed fields.
  async function handleExport() {
    if (!records.length) return
    setExporting(true)
    setError(null)
    try {
      await exportToExcel(records, tableFields, fieldDefs, { classificationsById, optionItemsByField, selectedLanguageId })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed")
    } finally {
      setExporting(false)
    }
  }

  async function handleSave() {
    if (!client || !languageId || !editedRecordIds.length) return

    setSaving(true)
    setSaveResults([])
    setSaveProgress({ done: 0, total: editedRecordIds.length })

    const results: SaveResult[] = []

    for (let i = 0; i < editedRecordIds.length; i++) {
      const recordId = editedRecordIds[i]
      const recordEdits = edits[recordId]

      type FieldUpdate = { id: string; localizedValues: { languageId: string; values?: string[]; value?: string }[] }
      const fieldUpdates: FieldUpdate[] = Object.entries(recordEdits).flatMap(([fieldName, ev]): FieldUpdate[] => {
        const def = fieldDefs.find((d) => d.name === fieldName)
        if (!def) return []
        if (ev.values !== undefined) {
          return [{ id: def.id, localizedValues: [{ languageId, values: ev.values }] }]
        }
        return [{ id: def.id, localizedValues: [{ languageId, value: ev.value ?? "" }] }]
      })

      if (!fieldUpdates.length) {
        results.push({ recordId, success: true })
        setSaveProgress({ done: i + 1, total: editedRecordIds.length })
        continue
      }

      try {
        const body: Record<string, unknown> = { fields: { addOrUpdate: fieldUpdates } }
        const result = await client.records.update(recordId, body as never)
        if (result.ok) {
          results.push({ recordId, success: true })
        } else {
          results.push({ recordId, success: false, error: result.error?.message ?? `HTTP ${result.status}` })
        }
      } catch (err) {
        results.push({ recordId, success: false, error: err instanceof Error ? err.message : "Unknown error" })
      }

      setSaveProgress({ done: i + 1, total: editedRecordIds.length })
    }

    setSaveResults(results)
    setSaving(false)
    setSaveProgress(null)

    // Refresh successfully saved records and drop their pending edits.
    const savedIds = new Set(results.filter((r) => r.success).map((r) => r.recordId))
    if (savedIds.size) {
      try {
        const refreshed = await fetchRecords(records.map((r) => r.id), tableFields)
        setRecords(refreshed)
      } catch {
        /* keep existing rows if the refresh fails */
      }
      setEdits((prev) => {
        const next = { ...prev }
        for (const id of savedIds) delete next[id]
        return next
      })
    }
  }

  const ctx = { classificationsById, optionItemsByField, selectedLanguageId }

  if (!requestId) {
    return (
      <main className="p-8">
        <p className="text-sm text-muted-foreground">No requestId provided.</p>
      </main>
    )
  }

  return (
    <main className="p-8">
      <FieldDefinitionsPanel
        fieldDefs={fieldDefs}
        selectedFields={selectedFields}
        tableFields={tableFields}
        toggleField={toggleField}
        recordIds={recordIds}
        fetchRecords={fetchRecords}
        setRecords={setRecords}
        setTableFields={setTableFieldsAndReset}
        setError={setError}
      />

      {loading && <p className="text-sm text-muted-foreground">Loading records...</p>}

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {records.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3 gap-4 flex-wrap">
            <p className="text-sm font-medium">
              {records.length} record{records.length !== 1 ? "s" : ""} returned
              {requestedCount !== null && ` (${requestedCount} requested)`}
            </p>
            <div className="flex items-center gap-3">
              <Button
                size="sm"
                variant={showContentType ? "secondary" : "outline"}
                className="h-7 text-xs px-2"
                onClick={() => setShowContentType((v) => !v)}
              >
                Content Type
              </Button>
              <Button
                size="sm"
                variant={showStatus ? "secondary" : "outline"}
                className="h-7 text-xs px-2"
                onClick={() => setShowStatus((v) => !v)}
              >
                Status
              </Button>
              <Label htmlFor="save-language" className="text-xs whitespace-nowrap">Save language</Label>
              <Select value={languageId} onValueChange={setLanguageId}>
                <SelectTrigger id="save-language" className="w-48 h-8 text-xs">
                  <SelectValue placeholder="Select a language…" />
                </SelectTrigger>
                <SelectContent>
                  {languages.map((l) => (
                    <SelectItem key={l.id} value={l.id} className="text-xs">{l.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                onClick={handleSave}
                disabled={saving || !languageId || editedRecordIds.length === 0}
                size="sm"
              >
                {saving
                  ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Saving…</>
                  : `Save changes${editedRecordIds.length ? ` (${editedRecordIds.length})` : ""}`}
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleExport}
                disabled={exporting || !records.length}
              >
                {exporting ? "Exporting…" : "Export to Excel"}
              </Button>
            </div>
          </div>

          {tableFields.length === 0 && (
            <p className="text-sm text-muted-foreground mb-3">
              Use <span className="font-medium">Field Definitions</span> above to add fields to the table, then edit values inline.
            </p>
          )}

          {saving && saveProgress && (
            <p className="text-sm text-muted-foreground mb-2">{saveProgress.done} / {saveProgress.total} records</p>
          )}
          {!saving && saveResults.length > 0 && (
            <p className="text-sm text-muted-foreground mb-2">
              {saveResults.filter((r) => r.success).length} succeeded · {saveResults.filter((r) => !r.success).length} failed
            </p>
          )}

          <RecordsTableEditable
            records={records}
            tableFields={tableFields}
            fieldDefs={fieldDefs}
            ctx={ctx}
            classifications={classifications}
            edits={edits}
            onEdit={onEdit}
            showContentType={showContentType}
            showStatus={showStatus}
          />

          {saveResults.some((r) => !r.success) && (
            <div className="mt-4 border border-border rounded-lg overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/50">
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-8"></th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Record ID</th>
                    <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Error</th>
                  </tr>
                </thead>
                <tbody>
                  {saveResults.filter((r) => !r.success).map((r, i) => (
                    <tr key={r.recordId} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                      <td className="px-4 py-2"><XCircle className="h-4 w-4 text-destructive" /></td>
                      <td className="px-4 py-2 font-mono text-xs">{r.recordId}</td>
                      <td className="px-4 py-2 text-xs text-muted-foreground">{r.error ?? ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {!saving && saveResults.length > 0 && !saveResults.some((r) => !r.success) && (
            <p className="mt-4 flex items-center gap-2 text-sm text-green-600">
              <CheckCircle2 className="h-4 w-4" /> All changes saved.
            </p>
          )}
        </>
      )}
    </main>
  )
}

export default function BasketEditorPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <Suspense>
        <BasketEditorContent />
      </Suspense>
      <Footer />
    </div>
  )
}
