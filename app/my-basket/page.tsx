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
import { LayoutGrid, List } from "lucide-react"
import { FieldDefinitionsPanel } from "@/components/field-definitions-panel"
import { RecordsTable } from "@/components/records-table"
import { RecordsGrid } from "@/components/records-grid"
import { exportToExcel } from "@/lib/export"
import type { AprimoRecord, FieldDef, ClassificationNode, OptionItem } from "@/models/aprimo"

function BasketExampleContent() {
  const searchParams = useSearchParams()
  const requestId = searchParams.get("requestId")
  const { client, isConnected, selectedLanguageId } = useAprimo()

  const [records, setRecords] = useState<AprimoRecord[]>([])
  const [recordIds, setRecordIds] = useState<string[]>([])
  const [requestedCount, setRequestedCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])
  const [classificationsById, setClassificationsById] = useState<Map<string, ClassificationNode>>(new Map())
  const [optionItemsByField, setOptionItemsByField] = useState<Map<string, OptionItem[]>>(new Map())
  const [selectedFields, setSelectedFields] = useState<Set<string>>(new Set())
  const [tableFields, setTableFields] = useState<string[]>([])
  const [viewMode, setViewMode] = useState<"table" | "grid">("table")
  const [gridShowPreview, setGridShowPreview] = useState(false)
  const [gridShowContentType, setGridShowContentType] = useState(true)
  const [gridShowStatus, setGridShowStatus] = useState(true)

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
      setClassificationsById(new Map(all.map((c) => [c.id, c])))
    }

    loadFieldDefs()
    loadClassifications()
  }, [isConnected, client])

  const fetchRecords = useCallback(async (ids: string[], fields: string[]) => {
    if (!client) return []

    const expander = Expander.create()
      .for<AprimoSDKRecord>("Record").expand("fields", "masterfilelatestversion")
      .for<FileVersion>("FileVersion").expand("thumbnail", "preview")
    if (fields.length > 0) expander.selectRecordFields(...fields)

    const BATCH_SIZE = 50
    const batches: string[][] = []
    for (let i = 0; i < ids.length; i += BATCH_SIZE) {
      batches.push(ids.slice(i, i + BATCH_SIZE))
    }

    const batchResults = await Promise.all(
      batches.map((batch) => {
        const expression = batch.map((id) => `id='${id}'`).join(" OR ")
        return client.search.records({ searchExpression: { expression } }, expander)
      })
    )

    const failed = batchResults.filter((r) => !r.ok)
    if (failed.length) throw new Error(failed.map((r) => r.error?.message ?? "Search failed").join(", "))

    return batchResults.flatMap((r) => r.data?.items ?? []) as unknown as AprimoRecord[]
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

  async function handleFetchAndExport() {
    if (!recordIds.length) return
    setExporting(true)
    setError(null)
    try {
      const fields = Array.from(selectedFields)
      const fetched = await fetchRecords(recordIds, fields)
      setRecords(fetched)
      await exportToExcel(fetched, fields, fieldDefs, { classificationsById, optionItemsByField, selectedLanguageId })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed")
    } finally {
      setExporting(false)
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
        setTableFields={setTableFields}
        setError={setError}
        exporting={exporting}
        onExport={handleFetchAndExport}
      />

      {loading && <p className="text-sm text-muted-foreground">Loading records...</p>}

      {error && <p className="text-sm text-destructive mb-4">{error}</p>}

      {records.length > 0 && (
        <>
          <div className="flex items-center justify-between mb-3 print:hidden">
            <p className="text-sm font-medium">
              {records.length} record{records.length !== 1 ? "s" : ""} returned
              {requestedCount !== null && ` (${requestedCount} requested)`}
            </p>
            <div className="flex items-center gap-2">
              {viewMode === "grid" && (
                <>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-7 text-xs px-2"
                    onClick={() => setGridShowPreview((v) => !v)}
                  >
                    {gridShowPreview ? "Thumbnail" : "Preview"}
                  </Button>
                  <Button
                    size="sm"
                    variant={gridShowContentType ? "secondary" : "outline"}
                    className="h-7 text-xs px-2"
                    onClick={() => setGridShowContentType((v) => !v)}
                  >
                    Content Type
                  </Button>
                  <Button
                    size="sm"
                    variant={gridShowStatus ? "secondary" : "outline"}
                    className="h-7 text-xs px-2"
                    onClick={() => setGridShowStatus((v) => !v)}
                  >
                    Status
                  </Button>
                </>
              )}
              <div className="flex items-center gap-1 border rounded-md p-0.5">
                <Button
                  size="sm"
                  variant={viewMode === "table" ? "secondary" : "ghost"}
                  className="h-7 w-7 p-0"
                  onClick={() => setViewMode("table")}
                >
                  <List className="h-4 w-4" />
                </Button>
                <Button
                  size="sm"
                  variant={viewMode === "grid" ? "secondary" : "ghost"}
                  className="h-7 w-7 p-0"
                  onClick={() => setViewMode("grid")}
                >
                  <LayoutGrid className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </div>

          {viewMode === "table"
            ? <RecordsTable records={records} tableFields={tableFields} fieldDefs={fieldDefs} ctx={ctx} />
            : <RecordsGrid records={records} tableFields={tableFields} fieldDefs={fieldDefs} ctx={ctx} showPreview={gridShowPreview} showContentType={gridShowContentType} showStatus={gridShowStatus} />
          }
        </>
      )}
    </main>
  )
}

export default function BasketExamplePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <Suspense>
        <BasketExampleContent />
      </Suspense>
      <Footer />
    </div>
  )
}
