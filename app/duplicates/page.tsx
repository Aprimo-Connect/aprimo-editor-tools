"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
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
// Faceting needs a base population to aggregate over; this matches all records.
const FACET_BASE_EXPRESSION = `NOT id = ''`

type MatchMode = "both" | "filename" | "checksum"

// Match a field definition by name/label against candidate tokens.
function matchesField(d: FieldDef, candidates: string[]): boolean {
  const n = (d.name ?? "").toLowerCase()
  const l = (d.label ?? "").toLowerCase()
  return candidates.some((c) => n === c || l === c || n.includes(c) || l.includes(c))
}

// First localized value of a record field, as a string.
function getRecordFieldValue(record: AprimoRecord, fieldName: string): string {
  const f = record._embedded?.fields?.items?.find((x) => x.fieldName === fieldName)
  const lv = f?.localizedValues?.[0]
  if (!lv) return ""
  if (Array.isArray(lv.values)) return lv.values.join(", ")
  return lv.value ?? ""
}

// Collect every record id referenced by the record's RecordLink fields.
function collectRecordLinkIds(record: AprimoRecord): string[] {
  const ids: string[] = []
  for (const f of record._embedded?.fields?.items ?? []) {
    if (f.dataType !== "RecordLink") continue
    for (const lv of f.localizedValues ?? []) {
      const rl = lv as {
        value?: string
        values?: string[] | null
        links?: Array<{ recordId: string }>
        parents?: Array<{ recordId: string }>
        children?: Array<{ recordId: string }>
      }
      ids.push(...(rl.values ?? []))
      ids.push(...(rl.links ?? []).map((x) => x.recordId))
      ids.push(...(rl.parents ?? []).map((x) => x.recordId))
      ids.push(...(rl.children ?? []).map((x) => x.recordId))
      if (typeof rl.value === "string") ids.push(...rl.value.split(/[;,]/))
    }
  }
  return Array.from(new Set(ids.map((s) => String(s).trim()).filter(Boolean)))
}

// A record is a duplicate when it shares the _Checksum and/or _Filename field
// values, per the chosen mode. Builds e.g.
// FieldName("_Filename") = "x" AND FieldName("_Checksum") = "y" AND NOT id = 'id'
function duplicateMatchExpression(
  record: AprimoRecord,
  excludeId: string,
  mode: MatchMode,
  names: { checksum?: string; filename?: string },
): string | null {
  const q = (s: string) => s.replace(/"/g, '""')
  const clauses: string[] = []
  if (mode !== "checksum" && names.filename) {
    const v = getRecordFieldValue(record, names.filename)
    if (v) clauses.push(`FieldName("${q(names.filename)}") = "${q(v)}"`)
  }
  if (mode !== "filename" && names.checksum) {
    const v = getRecordFieldValue(record, names.checksum)
    if (v) clauses.push(`FieldName("${q(names.checksum)}") = "${q(v)}"`)
  }
  if (clauses.length === 0) return null
  clauses.push(`NOT id = '${excludeId.replace(/'/g, "''")}'`)
  return clauses.join(" AND ")
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

  const [expression, setExpression] = useState("")
  const [records, setRecords] = useState<AprimoRecord[]>([])
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [loading, setLoading] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [hasSearched, setHasSearched] = useState(false)
  const [listNote, setListNote] = useState<string | null>(null)
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
  const [linkedAssets, setLinkedAssets] = useState<Map<string, { title?: string; thumbnailUri?: string }>>(new Map())

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

  // Resolve the _Checksum / _Filename fields (text, indexed) from the loaded defs.
  const checksumField = useMemo(() => fieldDefs.find((d) => matchesField(d, ["_checksum", "checksum", "crc32"])), [fieldDefs])
  const filenameField = useMemo(() => fieldDefs.find((d) => matchesField(d, ["_filename", "filename"])), [fieldDefs])
  const matchNames = useMemo(
    () => ({ checksum: checksumField?.name, filename: filenameField?.name }),
    [checksumField, filenameField]
  )

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

  // Build the list by faceting on the field the match mode selects (checksum for
  // "checksum"/"both", filename for "filename"): aggregate distinct values, keep
  // those occurring more than once, then fetch the records that share them. For
  // "both", additionally keep only records that share the same checksum+filename
  // pair with another record.
  const loadDuplicates = useCallback(async () => {
    if (!client) return
    const facetField = matchMode === "filename" ? filenameField : checksumField
    const facetLabel = matchMode === "filename" ? "_Filename" : "_Checksum"
    setLoading(true)
    setError(null)
    setListNote(null)
    setHasSearched(true)
    try {
      if (!facetField) {
        setError(`No "${facetLabel}" field found in this environment.`)
        setRecords([])
        setTotalCount(null)
        return
      }
      const q = (s: string) => s.replace(/"/g, '""')
      const facetRes = await client.search.records({
        searchExpression: { expression: FACET_BASE_EXPRESSION },
        // A textField facet aggregates a text field's distinct values with counts;
        // it takes the field's fieldId. (SDK types omit these, so cast.)
        facets: [{ name: "facet", type: "textField", fieldId: facetField.id, maximumFacetValues: 5000 }],
        page: 1,
        pageSize: 1,
      } as unknown as Parameters<typeof client.search.records>[0])
      if (!facetRes.ok) throw new Error(facetRes.error?.message ?? "Facet search failed")

      const data = facetRes.data as unknown as { facets?: Array<{ name?: string; values?: unknown[] }> }
      console.log("[duplicates] facet response:", data.facets)
      const facet = (data.facets ?? [])[0]

      // Parse defensively — a facet value may be a string or an object with a count.
      const dupValues: string[] = []
      for (const v of facet?.values ?? []) {
        if (v && typeof v === "object") {
          const o = v as { value?: unknown; key?: unknown; count?: number }
          const key = o.value ?? o.key
          if (key != null && (o.count ?? 0) > 1) dupValues.push(String(key))
        }
      }

      if (dupValues.length === 0) {
        setRecords([])
        setTotalCount(0)
        setListNote(`No duplicated ${matchMode === "filename" ? "filenames" : "checksums"} found.`)
        return
      }

      const expander = Expander.create()
        .for<AprimoSDKRecord>("Record").expand("fields", "masterfilelatestversion")
        .for<FileVersion>("FileVersion").expand("thumbnail", "preview")
      const BATCH = 25
      const all: AprimoRecord[] = []
      for (let i = 0; i < dupValues.length && all.length < MAX_RESULTS; i += BATCH) {
        const expr = dupValues
          .slice(i, i + BATCH)
          .map((c) => `FieldName("${q(facetField.name)}") = "${q(c)}"`)
          .join(" OR ")
        const r = await client.search.records({ searchExpression: { expression: expr }, page: 1, pageSize: PAGE_SIZE }, expander)
        if (r.ok) all.push(...((r.data as unknown as { items?: AprimoRecord[] })?.items ?? []))
      }

      // "both": narrow to records that share the same checksum+filename pair.
      let result = all
      if (matchMode === "both" && checksumField && filenameField) {
        const keyOf = (rec: AprimoRecord) =>
          `${getRecordFieldValue(rec, checksumField.name)}|${getRecordFieldValue(rec, filenameField.name)}`
        const counts = new Map<string, number>()
        for (const rec of all) counts.set(keyOf(rec), (counts.get(keyOf(rec)) ?? 0) + 1)
        result = all.filter((rec) => (counts.get(keyOf(rec)) ?? 0) > 1)
      }

      setRecords(result)
      setTotalCount(result.length)
      const via = matchMode === "both" ? "checksum + filename" : matchMode === "filename" ? "filename" : "checksum"
      setListNote(`${result.length} duplicate asset${result.length !== 1 ? "s" : ""} via ${via}.`)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load duplicates")
      setRecords([])
      setTotalCount(null)
    } finally {
      setLoading(false)
    }
  }, [client, matchMode, checksumField, filenameField])

  // Load (and reload) duplicates once fields are resolved and whenever the match
  // mode changes — loadDuplicates's identity changes with matchMode.
  useEffect(() => {
    if (isConnected && client && fieldDefs.length) loadDuplicates()
  }, [isConnected, client, fieldDefs.length, loadDuplicates])

  // Fetch titles/thumbnails for records referenced by RecordLink fields, so the
  // modal can show asset names instead of raw ids. Merges into linkedAssets.
  const resolveLinkedAssets = useCallback(async (recs: AprimoRecord[]) => {
    if (!client) return
    const ids = Array.from(new Set(recs.flatMap(collectRecordLinkIds)))
    if (ids.length === 0) return
    const expander = Expander.create()
      .for<AprimoSDKRecord>("Record").expand("masterfilelatestversion")
      .for<FileVersion>("FileVersion").expand("thumbnail")
    const BATCH = 50
    const fetched = new Map<string, { title?: string; thumbnailUri?: string }>()
    for (let i = 0; i < ids.length; i += BATCH) {
      const expr = ids.slice(i, i + BATCH).map((id) => `id = '${id.replace(/'/g, "''")}'`).join(" OR ")
      const r = await client.search.records({ searchExpression: { expression: expr }, page: 1, pageSize: BATCH }, expander)
      if (!r.ok) continue
      for (const it of (r.data as unknown as { items?: AprimoRecord[] })?.items ?? []) {
        fetched.set(it.id, {
          title: it.title ?? undefined,
          thumbnailUri: it._embedded?.masterfilelatestversion?._embedded?.thumbnail?.uri,
        })
      }
    }
    if (fetched.size) setLinkedAssets((prev) => new Map([...prev, ...fetched]))
  }, [client])

  // Resolve the asset's duplicate counterpart: another record sharing the
  // _Checksum and/or _Filename field values (per the chosen match mode).
  const resolveDuplicate = useCallback(async (rec: AprimoRecord) => {
    if (!client) return
    setDupLoading(true)
    setDupError(null)
    setDuplicate(null)
    try {
      const expr = duplicateMatchExpression(rec, rec.id, matchMode, matchNames)
      if (!expr) {
        setDupError("This asset has no _Checksum/_Filename value to match a duplicate on.")
        return
      }

      const expander = Expander.create()
        .for<AprimoSDKRecord>("Record").expand("fields", "masterfilelatestversion")
        .for<FileVersion>("FileVersion").expand("thumbnail", "preview")
      const r = await client.search.records({ searchExpression: { expression: expr } }, expander)
      if (!r.ok) throw new Error(r.error?.message ?? "Duplicate search failed")
      const items = (r.data as unknown as { items?: AprimoRecord[] })?.items ?? []
      const dupRec = items.find((it) => it.id !== rec.id) ?? null

      if (!dupRec) {
        setDupError("No matching duplicate record found.")
      } else {
        setDuplicate(dupRec)
        resolveLinkedAssets([dupRec])
      }
    } catch (err) {
      setDupError(err instanceof Error ? err.message : "Failed to load duplicate")
    } finally {
      setDupLoading(false)
    }
  }, [client, matchMode, matchNames, resolveLinkedAssets])

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

  // Delete the matched duplicate record. If the survivor no longer matches any
  // other record (per the chosen mode), it's no longer a duplicate — drop it
  // from the grid too.
  const handleDeleteDuplicate = useCallback(async () => {
    if (!client || !duplicate) return
    const del = await client.records.delete(duplicate.id)
    if (!del.ok) throw new Error(del.error?.message ?? "Delete failed")

    let survivorStillDuplicate = false
    if (selectedRecord) {
      const expr = duplicateMatchExpression(selectedRecord, selectedRecord.id, matchMode, matchNames)
      if (expr) {
        const r = await client.search.records({ searchExpression: { expression: expr }, page: 1, pageSize: 1 })
        if (r.ok) {
          const data = r.data as unknown as { totalCount?: number; items?: unknown[] }
          survivorStillDuplicate = (data.totalCount ?? data.items?.length ?? 0) > 0
        }
      }
    }

    const removeIds = new Set<string>([duplicate.id])
    if (selectedRecord && !survivorStillDuplicate) removeIds.add(selectedRecord.id)
    setRecords((prev) => prev.filter((r) => !removeIds.has(r.id)))
    setTotalCount((prev) => (prev !== null ? Math.max(0, prev - removeIds.size) : prev))
    setModalOpen(false)
    setDuplicate(null)
    setSelectedRecord(null)
  }, [client, duplicate, selectedRecord, matchMode, matchNames])

  const handleRecordClick = useCallback((rec: AprimoRecord) => {
    setSelectedRecord(rec)
    setDuplicate(null)
    setDupError(null)
    setLinkedAssets(new Map())
    setModalOpen(true)
    resolveDuplicate(rec)
    resolveLinkedAssets([rec])
  }, [resolveDuplicate, resolveLinkedAssets])

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
                  placeholder={`FieldName("_Checksum") = "..."`}
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
                      onClick={loadDuplicates}
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

                {listNote && <p className="text-xs text-muted-foreground mb-1 print:hidden">{listNote}</p>}
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
        linkedAssets={linkedAssets}
      />
    </div>
  )
}
