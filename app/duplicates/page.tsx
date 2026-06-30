"use client"

import { useCallback, useEffect, useState } from "react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { Expander } from "aprimo-js"
import type { Record as AprimoSDKRecord, FileVersion } from "aprimo-js/model"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LayoutGrid, List, RefreshCw } from "lucide-react"
import { RecordsTable } from "@/components/records-table"
import { RecordsGrid } from "@/components/records-grid"
import { DuplicateCompareModal, type MergePick } from "@/components/duplicate-compare-modal"
import { exportToExcel } from "@/lib/export"
import type { AprimoRecord, FieldDef, ClassificationNode, OptionItem } from "@/models/aprimo"

const PAGE_SIZE = 100
const MAX_RESULTS = 2000
// Aprimo's search grammar references a custom option-list field with the function
// form: FieldName("IsDuplicate").Option.Name = "1"  (a bare token throws
// "field does not exist"). Option Name "1" marks an asset as a duplicate.
const DUPLICATE_EXPRESSION = `FieldName("IsDuplicate").Option.Name = "1"`
const DUP_FIELD_LABEL = "IsDuplicate"

function getFileName(record: AprimoRecord): string | undefined {
  return (record._embedded?.masterfilelatestversion as { fileName?: string } | undefined)?.fileName
}

type MatchMode = "both" | "filename" | "checksum"

// A record is a duplicate when it shares the master file's filename and/or checksum,
// per the chosen mode. Builds e.g.
// file.version.filename = '<name>' AND file.version.checksum = '<crc32>' AND NOT id = '<id>'
function duplicateMatchExpression(record: AprimoRecord, excludeId: string, mode: MatchMode): string | null {
  const fileName = getFileName(record)
  const { crc32 } = getChecksums(record)
  const clauses: string[] = []
  if (mode !== "checksum" && fileName) clauses.push(`file.version.filename = '${fileName.replace(/'/g, "''")}'`)
  if (mode !== "filename" && crc32 != null && crc32 !== 0) clauses.push(`file.version.checksum = '${crc32}'`)
  if (clauses.length === 0) return null
  clauses.push(`NOT id = '${excludeId}'`)
  return clauses.join(" AND ")
}

function getChecksums(record: AprimoRecord): { crc32?: number; sha256?: string } {
  const fv = record._embedded?.masterfilelatestversion as { crc32?: number; sha256?: string } | undefined
  return { crc32: fv?.crc32, sha256: fv?.sha256 }
}

// Union + dedupe two record-link fields' localized values, per language, across
// links / parents / children (by recordId) and any flat values array. Empty
// categories are omitted — the API rejects updates that touch a non-modifiable
// property (e.g. "Parents"), and an empty array reads as an attempt to modify it.
function mergeRecordLinkLocalizedValues(
  aField?: { localizedValues?: unknown[] },
  bField?: { localizedValues?: unknown[] },
): unknown[] {
  type Item = { recordId: string }
  type RLValue = { languageId?: string; value?: string; values?: string[] | null; links?: Item[]; parents?: Item[]; children?: Item[] }
  const aLV = (aField?.localizedValues ?? []) as RLValue[]
  const bLV = (bField?.localizedValues ?? []) as RLValue[]
  const langs = Array.from(new Set([...aLV, ...bLV].map((v) => v.languageId)))

  return langs
    .map((languageId) => {
      const a = aLV.find((v) => v.languageId === languageId)
      const b = bLV.find((v) => v.languageId === languageId)
      const mergeItems = (key: "links" | "parents" | "children"): Item[] => {
        const seen = new Set<string>()
        const out: Item[] = []
        for (const it of [...(a?.[key] ?? []), ...(b?.[key] ?? [])]) {
          if (it?.recordId && !seen.has(it.recordId)) { seen.add(it.recordId); out.push(it) }
        }
        return out
      }
      const out: Record<string, unknown> = { languageId }
      const links = mergeItems("links")
      const parents = mergeItems("parents")
      const children = mergeItems("children")
      const values = Array.from(new Set([...(a?.values ?? []), ...(b?.values ?? [])].filter(Boolean)))
      if (links.length) out.links = links
      if (parents.length) out.parents = parents
      if (children.length) out.children = children
      if (values.length) out.values = values
      return out
    })
    .filter((lv) => Object.keys(lv).length > 1) // drop languages with nothing to set
}

export default function DuplicatesPage() {
  const { client, isConnected, selectedLanguageId } = useAprimo()

  const [expression, setExpression] = useState(DUPLICATE_EXPRESSION)
  const [records, setRecords] = useState<AprimoRecord[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [viewMode, setViewMode] = useState<"table" | "grid">("grid")
  const [matchMode, setMatchMode] = useState<MatchMode>("checksum")
  const [gridShowPreview, setGridShowPreview] = useState(false)
  const [gridShowContentType, setGridShowContentType] = useState(true)
  const [gridShowStatus, setGridShowStatus] = useState(true)

  // Field metadata used to render labels/values in the compare modal.
  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])
  const [classificationsById, setClassificationsById] = useState<Map<string, ClassificationNode>>(new Map())
  const [optionItemsByField, setOptionItemsByField] = useState<Map<string, OptionItem[]>>(new Map())

  // Compare-modal state.
  const [modalOpen, setModalOpen] = useState(false)
  const [selectedRecord, setSelectedRecord] = useState<AprimoRecord | null>(null)
  const [duplicate, setDuplicate] = useState<AprimoRecord | null>(null)
  const [dupLoading, setDupLoading] = useState(false)
  const [dupError, setDupError] = useState<string | null>(null)

  useEffect(() => {
    if (!isConnected || !client) return

    async function loadFieldDefs() {
      const allDefs: FieldDef[] = []
      for await (const result of client!.fieldDefinitions.getPaged()) {
        if (!result.ok) break
        allDefs.push(...(result.data?.items ?? []) as unknown as FieldDef[])
      }
      const filtered = allDefs
        .filter((d) => !["Json", "HyperlinkList", "Duration"].includes(d.dataType))
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

  // Paginate through every record matching the search expression.
  const runExpression = useCallback(async (expr: string) => {
    if (!client) return { items: [] as AprimoRecord[], total: 0 }
    const expander = Expander.create()
      .for<AprimoSDKRecord>("Record").expand("fields", "masterfilelatestversion")
      .for<FileVersion>("FileVersion").expand("thumbnail", "preview")

    const collected: AprimoRecord[] = []
    let total = 0
    let page = 1
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const result = await client.search.records(
        { searchExpression: { expression: expr }, page, pageSize: PAGE_SIZE },
        expander
      )
      if (!result.ok) throw new Error(result.error?.message ?? "Search failed")
      const data = result.data as unknown as { items?: AprimoRecord[]; totalCount?: number }
      const items = data?.items ?? []
      total = data?.totalCount ?? collected.length + items.length
      collected.push(...items)
      if (items.length < PAGE_SIZE || collected.length >= MAX_RESULTS) break
      page += 1
    }
    return { items: collected, total }
  }, [client])

  const search = useCallback(async (expr: string) => {
    const trimmed = expr.trim()
    if (!trimmed) return
    setLoading(true)
    setError(null)
    setHasSearched(true)
    try {
      const { items, total } = await runExpression(trimmed)
      setRecords(items)
      setTotalCount(total)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Search failed")
      setRecords([])
      setTotalCount(null)
    } finally {
      setLoading(false)
    }
  }, [runExpression])

  // Load duplicates automatically once connected.
  useEffect(() => {
    if (isConnected && client) search(DUPLICATE_EXPRESSION)
  }, [isConnected, client, search])

  // Resolve the asset's duplicate counterpart: another record sharing the master
  // file's filename and checksum (file.version.filename + file.version.checksum).
  const resolveDuplicate = useCallback(async (rec: AprimoRecord) => {
    if (!client) return
    setDupLoading(true)
    setDupError(null)
    setDuplicate(null)
    try {
      const expander = Expander.create()
        .for<AprimoSDKRecord>("Record").expand("fields", "masterfilelatestversion")
        .for<FileVersion>("FileVersion").expand("thumbnail", "preview")

      // Ensure we have the master file's filename + checksum — refetch if missing.
      let source = rec
      if (!getFileName(rec) || getChecksums(rec).crc32 == null) {
        const res = await client.records.getById(rec.id, expander)
        if (res.ok) source = res.data as unknown as AprimoRecord
      }

      const expr = duplicateMatchExpression(source, rec.id, matchMode)
      if (!expr) {
        setDupError("This asset has no filename/checksum to match a duplicate on.")
        return
      }

      const r = await client.search.records({ searchExpression: { expression: expr } }, expander)
      if (!r.ok) throw new Error(r.error?.message ?? "Duplicate search failed")
      const items = (r.data as unknown as { items?: AprimoRecord[] })?.items ?? []
      const dupRec = items.find((it) => it.id !== rec.id) ?? null

      if (!dupRec) setDupError("No matching duplicate record found.")
      else setDuplicate(dupRec)
    } catch (err) {
      setDupError(err instanceof Error ? err.message : "Failed to load duplicate")
    } finally {
      setDupLoading(false)
    }
  }, [client, matchMode])

  // Apply the user's per-field picks to the clicked asset. "a" picks already hold
  // this asset's value (no write); "b" takes the duplicate's value; "merge" unions
  // and dedupes the record-link values from both sides.
  const handleApplyMerge = useCallback(async (picks: MergePick[]) => {
    if (!client || !selectedRecord || !duplicate) return

    const addOrUpdate = picks
      .map((p) => {
        if (p.side === "a") return null
        const def = fieldDefs.find((d) => d.name === p.name)
        if (!def || def.isReadOnly) return null
        const thisField = selectedRecord._embedded?.fields?.items?.find((f) => f.fieldName === p.name)
        const dupField = duplicate._embedded?.fields?.items?.find((f) => f.fieldName === p.name)

        if (p.side === "merge") {
          const localizedValues = mergeRecordLinkLocalizedValues(thisField, dupField)
          return { id: def.id, localizedValues }
        }
        // side "b": take the duplicate's value. Record links are sanitized so we
        // don't try to write non-modifiable (empty) categories like Parents.
        if (!dupField) return null
        const localizedValues = def.dataType === "RecordLink"
          ? mergeRecordLinkLocalizedValues(undefined, dupField)
          : dupField.localizedValues ?? []
        return { id: def.id, localizedValues }
      })
      .filter(Boolean) as Array<{ id: string; localizedValues: unknown }>

    if (addOrUpdate.length === 0) return

    const res = await client.records.update(
      selectedRecord.id,
      { fields: { addOrUpdate } } as unknown as Parameters<typeof client.records.update>[1]
    )
    if (!res.ok) throw new Error(res.error?.message ?? "Update failed")

    // Reflect the update locally by refetching the asset.
    const expander = Expander.create()
      .for<AprimoSDKRecord>("Record").expand("fields", "masterfilelatestversion")
      .for<FileVersion>("FileVersion").expand("thumbnail", "preview")
    const refreshed = await client.records.getById(selectedRecord.id, expander)
    if (refreshed.ok) {
      const updated = refreshed.data as unknown as AprimoRecord
      setSelectedRecord(updated)
      setRecords((prev) => prev.map((r) => (r.id === updated.id ? updated : r)))
    }
  }, [client, selectedRecord, duplicate, fieldDefs])

  // Delete the matched duplicate record, then recompute the surviving asset's
  // IsDuplicate flag the way the Aprimo rule does: still "1" (duplicate) if any
  // other record shares the checksum, otherwise "0" (not a duplicate).
  const handleDeleteDuplicate = useCallback(async () => {
    if (!client || !duplicate) return
    const del = await client.records.delete(duplicate.id)
    if (!del.ok) throw new Error(del.error?.message ?? "Delete failed")

    let survivorStillDuplicate = false
    if (selectedRecord) {
      const dupDef = fieldDefs.find(
        (d) =>
          d.name.toLowerCase() === DUP_FIELD_LABEL.toLowerCase() ||
          (d.label ?? "").toLowerCase() === DUP_FIELD_LABEL.toLowerCase()
      )
      if (dupDef) {
        // Make sure the survivor has filename + checksum (refetch if the grid lacks them).
        let survivor = selectedRecord
        if (!getFileName(survivor) || getChecksums(survivor).crc32 == null) {
          const exp = Expander.create().for<AprimoSDKRecord>("Record").expand("masterfilelatestversion")
          const res = await client.records.getById(survivor.id, exp)
          if (res.ok) survivor = res.data as unknown as AprimoRecord
        }
        // Any other record matching (per the chosen mode) means it's still a duplicate.
        const expr = duplicateMatchExpression(survivor, selectedRecord.id, matchMode)
        if (expr) {
          const r = await client.search.records({ searchExpression: { expression: expr }, page: 1, pageSize: 1 })
          if (r.ok) {
            const data = r.data as unknown as { totalCount?: number; items?: unknown[] }
            survivorStillDuplicate = (data.totalCount ?? data.items?.length ?? 0) > 0
          }
        }

        // Set the flag to the option whose Name is "1" (duplicate) or "0" (not),
        // using the resolved option item id — never a raw value.
        const targetName = survivorStillDuplicate ? "1" : "0"
        const targetId = (dupDef.items ?? []).find((i) => i.name === targetName)?.id
        if (targetId) {
          const existing = selectedRecord._embedded?.fields?.items?.find((f) => f.fieldName === dupDef.name)
          const localizedValues = existing?.localizedValues?.length
            ? existing.localizedValues.map((lv) => ({ languageId: lv.languageId, values: [targetId] }))
            : [{ values: [targetId] }]
          const upd = await client.records.update(
            selectedRecord.id,
            { fields: { addOrUpdate: [{ id: dupDef.id, localizedValues }] } } as unknown as Parameters<typeof client.records.update>[1]
          )
          if (!upd.ok) throw new Error(upd.error?.message ?? "Failed to update IsDuplicate")
        }
      }
    }

    // Drop the deleted duplicate; drop the survivor too only if it's no longer flagged.
    const removeIds = new Set<string>([duplicate.id])
    if (selectedRecord && !survivorStillDuplicate) removeIds.add(selectedRecord.id)
    setRecords((prev) => prev.filter((r) => !removeIds.has(r.id)))
    setTotalCount((prev) => (prev !== null ? Math.max(0, prev - removeIds.size) : prev))
    setModalOpen(false)
    setDuplicate(null)
    setSelectedRecord(null)
  }, [client, duplicate, selectedRecord, fieldDefs, matchMode])

  const handleRecordClick = useCallback((rec: AprimoRecord) => {
    console.log("[duplicates] clicked record:", rec)
    console.log("[duplicates] record._embedded:", rec._embedded)
    console.log("[duplicates] masterfilelatestversion:", rec._embedded?.masterfilelatestversion)
    console.log("[duplicates] duplicateInfo:", (rec._embedded?.masterfilelatestversion as { duplicateInfo?: unknown } | undefined)?.duplicateInfo)
    setSelectedRecord(rec)
    setDuplicate(null)
    setDupError(null)
    setModalOpen(true)
    resolveDuplicate(rec)
  }, [resolveDuplicate])

  async function handleExport() {
    if (!records.length) return
    setExporting(true)
    setError(null)
    try {
      await exportToExcel(records, [], [], { selectedLanguageId })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Export failed")
    } finally {
      setExporting(false)
    }
  }

  const ctx = { classificationsById, optionItemsByField, selectedLanguageId }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 p-8">
        {!isConnected ? (
          <p className="text-sm text-muted-foreground">Connect to your Aprimo environment to view duplicate assets.</p>
        ) : (
          <>
            {/* Advanced override — editable search expression. */}
            <details className="mb-6 max-w-2xl text-sm">
              <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground">
                Advanced: edit search expression
              </summary>
              <div className="mt-2 flex items-center gap-2">
                <Input
                  value={expression}
                  onChange={(e) => setExpression(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") search(expression) }}
                  placeholder={DUPLICATE_EXPRESSION}
                  className="h-9 text-sm font-mono"
                />
                <Button size="sm" variant="outline" className="h-9" onClick={() => search(expression)} disabled={loading || !expression.trim()}>
                  Run
                </Button>
              </div>
            </details>

            {loading && <p className="text-sm text-muted-foreground">Finding duplicate assets…</p>}

            {error && <p className="text-sm text-destructive mb-4">{error}</p>}

            {!loading && hasSearched && records.length === 0 && !error && (
              <p className="text-sm text-muted-foreground">No duplicate assets found.</p>
            )}

            {records.length > 0 && (
              <>
                <div className="flex items-center justify-between mb-3 print:hidden">
                  <p className="text-sm font-medium">
                    {records.length} duplicate asset{records.length !== 1 ? "s" : ""}
                    {totalCount !== null && totalCount > records.length && ` (showing first ${records.length} of ${totalCount})`}
                  </p>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">Match on</span>
                    <Select value={matchMode} onValueChange={(v) => setMatchMode(v as MatchMode)}>
                      <SelectTrigger className="h-7 text-xs w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="both">Filename + checksum</SelectItem>
                        <SelectItem value="filename">Filename</SelectItem>
                        <SelectItem value="checksum">Checksum</SelectItem>
                      </SelectContent>
                    </Select>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2"
                      onClick={() => search(expression)}
                      disabled={loading}
                    >
                      <RefreshCw className="h-3.5 w-3.5 mr-1" />
                      Refresh
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs px-2"
                      onClick={handleExport}
                      disabled={exporting}
                    >
                      {exporting ? "Exporting…" : "Export to Excel"}
                    </Button>
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

                <p className="text-xs text-muted-foreground mb-2 print:hidden">Click an asset to compare its metadata with its duplicate.</p>

                {viewMode === "table"
                  ? <RecordsTable records={records} tableFields={[]} fieldDefs={[]} ctx={ctx} onRecordClick={handleRecordClick} />
                  : <RecordsGrid records={records} tableFields={[]} fieldDefs={[]} ctx={ctx} showPreview={gridShowPreview} showContentType={gridShowContentType} showStatus={gridShowStatus} compact showFileInfo onRecordClick={handleRecordClick} />
                }
              </>
            )}
          </>
        )}
      </main>
      <Footer />

      <DuplicateCompareModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        record={selectedRecord}
        duplicate={duplicate}
        fieldDefs={fieldDefs}
        ctx={ctx}
        loading={dupLoading}
        error={dupError}
        onApply={handleApplyMerge}
        onDelete={handleDeleteDuplicate}
      />
    </div>
  )
}
