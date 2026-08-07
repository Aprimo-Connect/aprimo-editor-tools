"use client"

import { useRef, useState, useEffect } from "react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { FileSpreadsheet, Upload, ChevronsUpDown, Check, CheckCircle2, XCircle, Loader2, Eye } from "lucide-react"
import ExcelJS from "exceljs"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useAprimo } from "@/context/aprimo-context"
import type { FieldDef, ClassificationNode, OptionItem } from "@/models/aprimo"
import { DropZone } from "@/components/ui/drop-zone"
import { buildClassificationTree, flattenForPicker } from "@/lib/classifications"
import type { FlatNode } from "@/lib/classifications"

// Split a cell into distinct option values. Multi-select option lists are
// semicolon-delimited; single-select fields treat the whole cell as one value.
function splitOptionCell(raw: string, acceptMultiple: boolean): string[] {
  if (!acceptMultiple) {
    const v = raw.trim()
    return v ? [v] : []
  }
  return raw.split(";").map((s) => s.trim()).filter(Boolean)
}

// Format a date/time value for the target field type. Aprimo expects
// Date as yyyy-MM-dd, DateTime as ISO 8601, and Time as HH:mm:ss. Values
// coming from Excel date cells are already ISO; typed strings are parsed
// best-effort and passed through unchanged if unparseable.
function formatDateForField(raw: string, dataType: string): string {
  const d = new Date(raw.trim())
  if (isNaN(d.getTime())) return raw
  const pad = (n: number) => String(n).padStart(2, "0")
  if (dataType === "Date") {
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
  }
  if (dataType === "Time") {
    return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`
  }
  return d.toISOString()
}

interface ParsedFile {
  headers: string[]
  columnValues: Record<string, string[]>
  rows: Record<string, string>[]
}

async function parseFile(file: File): Promise<ParsedFile> {
  const buffer = await file.arrayBuffer()
  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(buffer)
  const sheet = workbook.worksheets[0]
  if (!sheet) return { headers: [], columnValues: {}, rows: [] }

  const headerRow = sheet.getRow(1)
  const headers: string[] = []
  const colIndexByHeader: Record<string, number> = {}
  headerRow.eachCell({ includeEmpty: false }, (cell, col) => {
    const h = String(cell.value ?? "").trim()
    if (!h) return
    headers.push(h)
    colIndexByHeader[h] = col
  })

  const valueSets: Record<string, Set<string>> = {}
  for (const h of headers) valueSets[h] = new Set()

  const rows: Record<string, string>[] = []
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return
    const record: Record<string, string> = {}
    for (const [h, colIdx] of Object.entries(colIndexByHeader)) {
      const cellVal = row.getCell(colIdx).value
      // ExcelJS returns date cells as JS Date objects; keep them as ISO 8601
      // so they can be reformatted per target field type at save time.
      const val = (cellVal instanceof Date ? cellVal.toISOString() : String(cellVal ?? "")).trim()
      record[h] = val
      if (val) valueSets[h].add(val)
    }
    rows.push(record)
  })

  const columnValues: Record<string, string[]> = {}
  for (const h of headers) columnValues[h] = Array.from(valueSets[h]).sort()

  return { headers, columnValues, rows }
}

function ValueCombobox({
  nodes,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
}: {
  nodes: FlatNode[]
  value: string
  onChange: (id: string) => void
  placeholder?: string
  searchPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = nodes.find((n) => n.id === value)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" role="combobox" className="h-7 w-full max-w-xs justify-between text-xs font-normal">
          <span className="truncate">{selected ? selected.label : placeholder}</span>
          <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-0" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} className="text-xs" />
          <CommandList>
            <CommandEmpty className="text-xs">No match found.</CommandEmpty>
            <CommandGroup>
              {nodes.map((n) => (
                <CommandItem
                  key={n.id}
                  value={n.label}
                  onSelect={() => { onChange(n.id); setOpen(false) }}
                  className="text-xs"
                  style={{ paddingLeft: `${0.5 + n.depth * 1}rem` }}
                >
                  <Check className={`mr-1 h-3 w-3 shrink-0 ${value === n.id ? "opacity-100" : "opacity-0"}`} />
                  {n.label}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

interface SaveResult {
  recordId: string
  success: boolean
  error?: string
}


export default function ExcelImportPage() {
  const inputRef = useRef<HTMLInputElement>(null)
  const { client, isConnected } = useAprimo()

  const [dragging, setDragging] = useState(false)
  const [file, setFile] = useState<File | null>(null)
  const [headers, setHeaders] = useState<string[]>([])
  const [columnValues, setColumnValues] = useState<Record<string, string[]>>({})
  const [rows, setRows] = useState<Record<string, string>[]>([])
  const [loading, setLoading] = useState(false)
  const [selectedHeaders, setSelectedHeaders] = useState<Set<string>>(new Set())
  const [recordIdColumn, setRecordIdColumn] = useState<string>("")
  const [fieldMappings, setFieldMappings] = useState<Record<string, string>>({})
  const [classificationMappings, setClassificationMappings] = useState<Record<string, Record<string, string>>>({})
  const [optionMappings, setOptionMappings] = useState<Record<string, Record<string, string>>>({})

  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])
  const [optionItemsByField, setOptionItemsByField] = useState<Map<string, OptionItem[]>>(new Map())
  const [classifications, setClassifications] = useState<ClassificationNode[]>([])
  const [languages, setLanguages] = useState<{ id: string; name: string }[]>([])
  const [languageId, setLanguageId] = useState<string>("")

  const [saving, setSaving] = useState(false)
  const [saveProgress, setSaveProgress] = useState<{ done: number; total: number } | null>(null)
  const [saveResults, setSaveResults] = useState<SaveResult[]>([])

  useEffect(() => {
    if (!isConnected || !client) return

    async function loadLanguages() {
      const all: { id: string; name: string }[] = []
      for await (const result of client!.languages.getPaged()) {
        if (!result.ok) break
        const items = (result.data?.items ?? []) as unknown as { id: string; name: string; isEnabledForFields: boolean }[]
        all.push(...items.filter((l) => l.isEnabledForFields))
      }
      setLanguages(all.sort((a, b) => a.name.localeCompare(b.name)))
    }

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
      setClassifications(all.sort((a, b) => (a.labelPath || a.name).localeCompare(b.labelPath || b.name)))
    }

    loadLanguages()
    loadFieldDefs()
    loadClassifications()
  }, [isConnected, client])

  function toggleHeader(h: string) {
    setSelectedHeaders((prev) => {
      const next = new Set(prev)
      next.has(h) ? next.delete(h) : next.add(h)
      if (!next.has(h)) {
        if (recordIdColumn === h) setRecordIdColumn("")
        setFieldMappings((m) => { const n = { ...m }; delete n[h]; return n })
        setClassificationMappings((m) => { const n = { ...m }; delete n[h]; return n })
        setOptionMappings((m) => { const n = { ...m }; delete n[h]; return n })
      }
      return next
    })
  }

  function setMapping(column: string, fieldName: string) {
    setFieldMappings((prev) => ({ ...prev, [column]: fieldName }))
  }

  function setClassificationMapping(column: string, excelValue: string, classificationId: string) {
    setClassificationMappings((prev) => ({
      ...prev,
      [column]: { ...(prev[column] ?? {}), [excelValue]: classificationId },
    }))
  }

  function setOptionMapping(column: string, excelValue: string, optionId: string) {
    setOptionMappings((prev) => ({
      ...prev,
      [column]: { ...(prev[column] ?? {}), [excelValue]: optionId },
    }))
  }

  async function handleFile(f: File) {
    if (!f.name.match(/\.(xlsx|xls)$/i)) return
    setFile(f)
    setHeaders([])
    setColumnValues({})
    setRows([])
    setSelectedHeaders(new Set())
    setRecordIdColumn("")
    setFieldMappings({})
    setClassificationMappings({})
    setOptionMappings({})
    setSaveResults([])
    setLoading(true)
    try {
      const parsed = await parseFile(f)
      setHeaders(parsed.headers)
      setColumnValues(parsed.columnValues)
      setRows(parsed.rows)
    } finally {
      setLoading(false)
    }
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault()
    setDragging(false)
    const f = e.dataTransfer.files[0]
    if (f) handleFile(f)
  }

  function onInputChange(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (f) handleFile(f)
  }

  const mappableColumns = Array.from(selectedHeaders).filter((h) => h !== recordIdColumn)

  useEffect(() => {
    if (!fieldDefs.length || !mappableColumns.length) return
    const normalize = (s: string) => s.toLowerCase().replace(/[\s_-]+/g, "")
    setFieldMappings((prev) => {
      const next = { ...prev }
      for (const col of mappableColumns) {
        if (next[col]) continue
        const key = normalize(col)
        const match = fieldDefs.find(
          (d) => normalize(d.name) === key || normalize(d.label ?? "") === key
        )
        if (match) next[col] = match.name
      }
      return next
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fieldDefs, mappableColumns.join(",")])

  useEffect(() => {
    if (!classifications.length) return
    const normalize = (s: string) => s.toLowerCase().trim()
    for (const col of mappableColumns) {
      const fieldName = fieldMappings[col]
      if (!fieldName) continue
      const def = fieldDefs.find((d) => d.name === fieldName)
      if (def?.dataType !== "ClassificationList") continue
      const rawValues = columnValues[col] ?? []
      const values = Array.from(
        new Set(rawValues.flatMap((v) => v.split(";").map((s) => s.trim()).filter(Boolean)))
      )
      if (!values.length) continue
      setClassificationMappings((prev) => {
        const colMap = { ...(prev[col] ?? {}) }
        let changed = false
        for (const val of values) {
          if (colMap[val]) continue
          const match = classifications.find(
            (c) => normalize(c.name) === normalize(val) || normalize(c.labelPath || "") === normalize(val)
          )
          if (match) { colMap[val] = match.id; changed = true }
        }
        return changed ? { ...prev, [col]: colMap } : prev
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [classifications, fieldMappings, mappableColumns.join(",")])

  useEffect(() => {
    if (!optionItemsByField.size) return
    const normalize = (s: string) => s.toLowerCase().trim()
    for (const col of mappableColumns) {
      const fieldName = fieldMappings[col]
      if (!fieldName) continue
      const def = fieldDefs.find((d) => d.name === fieldName)
      if (def?.dataType !== "OptionList") continue
      const items = optionItemsByField.get(fieldName) ?? []
      if (!items.length) continue
      const rawValues = columnValues[col] ?? []
      const values = Array.from(
        new Set(rawValues.flatMap((v) => splitOptionCell(v, !!def.acceptMultipleOptions)))
      )
      if (!values.length) continue
      setOptionMappings((prev) => {
        const colMap = { ...(prev[col] ?? {}) }
        let changed = false
        for (const val of values) {
          if (colMap[val]) continue
          const match = items.find(
            (it) => normalize(it.name) === normalize(val) || normalize(it.label || "") === normalize(val)
          )
          if (match) { colMap[val] = match.id; changed = true }
        }
        return changed ? { ...prev, [col]: colMap } : prev
      })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [optionItemsByField, fieldMappings, mappableColumns.join(",")])

  const classificationColumns = mappableColumns.filter((col) => {
    const fieldName = fieldMappings[col]
    if (!fieldName) return false
    return fieldDefs.find((d) => d.name === fieldName)?.dataType === "ClassificationList"
  })

  const optionColumns = mappableColumns.filter((col) => {
    const fieldName = fieldMappings[col]
    if (!fieldName) return false
    return fieldDefs.find((d) => d.name === fieldName)?.dataType === "OptionList"
  })

  // Whether a classification/option cell holds a value that the auto-matcher
  // can't resolve, meaning it required manual matching. Mirrors the auto-match
  // effects so the result stays consistent.
  function cellNeedsManualMatch(col: string, rawValue: string): boolean {
    if (!rawValue?.trim()) return false
    const fieldName = fieldMappings[col]
    if (!fieldName) return false
    const def = fieldDefs.find((d) => d.name === fieldName)
    if (!def) return false
    const norm = (s: string) => s.toLowerCase().trim()
    if (def.dataType === "ClassificationList") {
      const parts = rawValue.split(";").map((s) => s.trim()).filter(Boolean)
      return parts.some((p) =>
        !classifications.some((c) => norm(c.name) === norm(p) || norm(c.labelPath || "") === norm(p))
      )
    }
    if (def.dataType === "OptionList") {
      const items = optionItemsByField.get(fieldName) ?? []
      const parts = splitOptionCell(rawValue, !!def.acceptMultipleOptions)
      return parts.some((p) =>
        !items.some((it) => norm(it.name) === norm(p) || norm(it.label || "") === norm(p))
      )
    }
    return false
  }

  const NUMERIC_TYPES = ["Numeric"]

  const numericErrors: { col: string; fieldLabel: string; invalidValues: string[] }[] = mappableColumns.flatMap((col) => {
    const fieldName = fieldMappings[col]
    if (!fieldName) return []
    const def = fieldDefs.find((d) => d.name === fieldName)
    if (!def || !NUMERIC_TYPES.includes(def.dataType)) return []
    const invalidValues = (columnValues[col] ?? []).filter((v) => v !== "" && isNaN(Number(v)))
    if (!invalidValues.length) return []
    return [{ col, fieldLabel: def.label ?? def.name, invalidValues }]
  })

  async function handleSave() {
    if (!client || !recordIdColumn || !languageId) return

    const dataRows = rows.filter((row) => row[recordIdColumn]?.trim())
    setSaving(true)
    setSaveResults([])
    setSaveProgress({ done: 0, total: dataRows.length })

    const results: SaveResult[] = []

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i]
      const recordId = row[recordIdColumn].trim()

      type FieldUpdate = { id: string; localizedValues: { languageId: string; values?: string[]; value?: string }[] }
      const fieldUpdates = mappableColumns
        .filter((col) => fieldMappings[col])
        .flatMap((col): FieldUpdate[] => {
          const fieldName = fieldMappings[col]
          const def = fieldDefs.find((d) => d.name === fieldName)
          if (!def) return []
          const rawValue = row[col] ?? ""

          if (def.dataType === "ClassificationList") {
            const colMap = classificationMappings[col] ?? {}
            const ids = rawValue
              .split(";")
              .map((v) => v.trim())
              .filter(Boolean)
              .map((v) => colMap[v])
              .filter(Boolean)
            if (!ids.length) return []
            return [{ id: def.id, localizedValues: [{ languageId, values: ids }] }]
          }

          if (def.dataType === "OptionList") {
            const colMap = optionMappings[col] ?? {}
            const ids = splitOptionCell(rawValue, !!def.acceptMultipleOptions)
              .map((v) => colMap[v])
              .filter(Boolean)
            if (!ids.length) return []
            return [{ id: def.id, localizedValues: [{ languageId, values: ids }] }]
          }

          if (def.dataType.includes("TextList")) {
            const vals = rawValue.split(";").map((v) => v.trim()).filter(Boolean)
            if (!vals.length) return []
            return [{ id: def.id, localizedValues: [{ languageId, values: vals }] }]
          }

          if (["Date", "DateTime", "Time"].includes(def.dataType)) {
            if (!rawValue) return []
            return [{ id: def.id, localizedValues: [{ languageId, value: formatDateForField(rawValue, def.dataType) }] }]
          }

          if (!rawValue) return []
          return [{ id: def.id, localizedValues: [{ languageId, value: rawValue }] }]
        })

      if (!fieldUpdates.length) {
        results.push({ recordId, success: true })
        setSaveProgress({ done: i + 1, total: dataRows.length })
        continue
      }

      try {
        const body: Record<string, unknown> = {
          fields: { addOrUpdate: fieldUpdates },
        }
        const result = await client.records.update(recordId, body as never)
        if (result.ok) {
          results.push({ recordId, success: true })
        } else {
          results.push({ recordId, success: false, error: result.error?.message ?? `HTTP ${result.status}` })
        }
      } catch (err) {
        results.push({ recordId, success: false, error: err instanceof Error ? err.message : "Unknown error" })
      }

      setSaveProgress({ done: i + 1, total: dataRows.length })
    }

    setSaveResults(results)
    setSaving(false)
    setSaveProgress(null)
  }

  const hasReadOnlyMapped = mappableColumns.some((col) => {
    const def = fieldDefs.find((d) => d.name === fieldMappings[col])
    return def?.isReadOnly
  })

  const canSave = !saving && !!recordIdColumn && !!languageId && rows.length > 0 && mappableColumns.some((c) => fieldMappings[c]) && numericErrors.length === 0 && !hasReadOnlyMapped

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 p-8 w-full">
        <DropZone
          isDragging={dragging}
          onDragOver={() => setDragging(true)}
          onDragLeave={() => setDragging(false)}
          onDrop={onDrop}
          onClick={() => inputRef.current?.click()}
          className="p-16 bg-card gap-3"
        >
          {file ? (
            <>
              <FileSpreadsheet className="h-10 w-10 text-primary" />
              <p className="text-sm font-medium">{file.name}</p>
              <p className="text-xs text-muted-foreground">{(file.size / 1024).toFixed(1)} KB · Click to replace</p>
            </>
          ) : (
            <>
              <Upload className="h-10 w-10 text-muted-foreground" />
              <p className="text-sm font-medium">Drop an Excel file here</p>
              <p className="text-xs text-muted-foreground">or click to browse · .xlsx / .xls</p>
            </>
          )}
        </DropZone>

        <input ref={inputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={onInputChange} />

        {loading && <p className="mt-6 text-sm text-muted-foreground">Reading file...</p>}

        {!loading && headers.length > 0 && (
          <div className="mt-6 space-y-6">
            {/* Column selector + settings */}
            <div className="rounded-lg border border-border bg-card p-4 space-y-4">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-muted-foreground">
                  {headers.length} column{headers.length !== 1 ? "s" : ""} found
                  {selectedHeaders.size > 0 && ` · ${selectedHeaders.size} selected`}
                  {` · ${rows.length} row${rows.length !== 1 ? "s" : ""}`}
                </p>
                <Dialog>
                  <DialogTrigger asChild>
                    <Button variant="outline" size="sm" className="h-7 text-xs">
                      <Eye className="mr-1 h-3 w-3" />
                      View contents
                    </Button>
                  </DialogTrigger>
                  <DialogContent className="max-w-[90vw] sm:max-w-[90vw]">
                    <DialogHeader>
                      <DialogTitle className="text-sm">
                        {file?.name} · {rows.length} row{rows.length !== 1 ? "s" : ""}
                      </DialogTitle>
                      <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="inline-block h-3 w-3 rounded-sm bg-yellow-200 dark:bg-yellow-900/50" />
                        Highlighted classification / option values have no automatic match and need manual matching.
                      </p>
                    </DialogHeader>
                    <div className="overflow-auto max-h-[70vh] border border-border rounded-lg bg-card">
                      <table className="w-full text-xs border-collapse">
                        <thead className="sticky top-0 bg-muted">
                          <tr>
                            <th className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b border-border w-10">#</th>
                            {headers.map((h) => (
                              <th key={h} className="px-2 py-1.5 text-left font-medium text-muted-foreground border-b border-border whitespace-nowrap font-mono">
                                {h}
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {rows.map((row, i) => (
                            <tr key={i} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                              <td className="px-2 py-1 text-muted-foreground border-b border-border">{i + 1}</td>
                              {headers.map((h) => {
                                const needsManual = cellNeedsManualMatch(h, row[h])
                                return (
                                  <td
                                    key={h}
                                    className={`px-2 py-1 border-b border-border whitespace-nowrap max-w-xs truncate ${needsManual ? "bg-yellow-200 text-yellow-900 dark:bg-yellow-900/50 dark:text-yellow-100" : ""}`}
                                    title={row[h]}
                                  >
                                    {row[h]}
                                  </td>
                                )
                              })}
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </DialogContent>
                </Dialog>
              </div>
              <div className="flex flex-wrap gap-2">
                {headers.map((h, i) => {
                  const selected = selectedHeaders.has(h)
                  return (
                    <button
                      key={i}
                      onClick={() => toggleHeader(h)}
                      className={`inline-flex items-center rounded-md border px-2.5 py-1 text-xs font-mono transition-colors ${
                        selected
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-muted hover:border-primary/50"
                      }`}
                    >
                      {h}
                    </button>
                  )
                })}
              </div>
              {selectedHeaders.size > 0 && (
                <div className="pt-2 border-t border-border space-y-3">
                  <div className="flex items-center gap-3">
                    <Label htmlFor="record-id-col" className="text-sm whitespace-nowrap w-32">Record ID column</Label>
                    <Select value={recordIdColumn} onValueChange={setRecordIdColumn}>
                      <SelectTrigger id="record-id-col" className="w-56 h-8 text-xs">
                        <SelectValue placeholder="Select a column…" />
                      </SelectTrigger>
                      <SelectContent>
                        {Array.from(selectedHeaders).map((h) => (
                          <SelectItem key={h} value={h} className="text-xs font-mono">{h}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="flex items-center gap-3">
                    <Label htmlFor="language-col" className="text-sm whitespace-nowrap w-32">Language</Label>
                    <Select value={languageId} onValueChange={setLanguageId}>
                      <SelectTrigger id="language-col" className="w-56 h-8 text-xs">
                        <SelectValue placeholder="Select a language…" />
                      </SelectTrigger>
                      <SelectContent>
                        {languages.map((l) => (
                          <SelectItem key={l.id} value={l.id} className="text-xs">{l.name}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}
            </div>

            {/* Field mappings */}
            {mappableColumns.length > 0 && (
              <div>
                <p className="text-sm font-medium mb-3">Field mappings</p>
                <div className="border border-border rounded-lg overflow-hidden bg-card">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/50">
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Excel column</th>
                        <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Aprimo field</th>
                      </tr>
                    </thead>
                    <tbody>
                      {mappableColumns.map((col, i) => (
                        <tr key={col} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                          <td className="px-4 py-2 font-mono text-xs">{col}</td>
                          <td className="px-4 py-2">
                            <Select value={fieldMappings[col] ?? ""} onValueChange={(v) => setMapping(col, v)}>
                              <SelectTrigger className="h-7 text-xs w-full max-w-xs">
                                <SelectValue placeholder="Select a field…" />
                              </SelectTrigger>
                              <SelectContent>
                                {fieldDefs.map((d) => {
                                  const tested = ["SingleLineText", "MultiLineText", "ClassificationList", "Numeric", "TextList", "OptionList", "Html", "Date", "DateTime", "Time"].includes(d.dataType)
                                  return (
                                    <SelectItem key={d.id} value={d.name} className="text-xs" disabled={!!d.isReadOnly}>
                                      <span className="flex items-center gap-2">
                                        {d.label ?? d.name}
                                        {d.isReadOnly && (
                                          <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-muted text-muted-foreground">
                                            read only
                                          </span>
                                        )}
                                        {!tested && !d.isReadOnly && (
                                          <span className="text-[10px] font-medium px-1 py-0.5 rounded bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                                            not tested ({d.dataType})
                                          </span>
                                        )}
                                      </span>
                                    </SelectItem>
                                  )
                                })}
                              </SelectContent>
                            </Select>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Classification value mappings */}
            {classificationColumns.map((col) => {
              const rawValues = columnValues[col] ?? []
              const values = Array.from(
                new Set(rawValues.flatMap((v) => v.split(";").map((s) => s.trim()).filter(Boolean)))
              ).sort()
              const colMap = classificationMappings[col] ?? {}
              const fieldDef = fieldDefs.find((d) => d.name === fieldMappings[col])
              const tree = fieldDef?.rootId
                ? buildClassificationTree(fieldDef.rootId, classifications)
                : null
              const flatNodes: FlatNode[] = tree
                ? flattenForPicker(tree)
                : classifications.map((c) => ({ id: c.id, label: c.labelPath || c.name, depth: 0 }))
              return (
                <div key={col}>
                  <p className="text-sm font-medium mb-1">
                    Classification values — <span className="font-mono">{col}</span>
                    <span className="text-muted-foreground font-normal"> → {fieldDef?.label ?? fieldDef?.name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Match each Excel value to an Aprimo classification.
                  </p>
                  <div className="border border-border rounded-lg overflow-hidden bg-card">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Excel value</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Aprimo classification</th>
                        </tr>
                      </thead>
                      <tbody>
                        {values.map((val, i) => (
                          <tr key={val} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                            <td className="px-4 py-2 font-mono text-xs">{val}</td>
                            <td className="px-4 py-2">
                              <ValueCombobox
                                nodes={flatNodes}
                                value={colMap[val] ?? ""}
                                onChange={(id) => setClassificationMapping(col, val, id)}
                                placeholder="Select classification…"
                                searchPlaceholder="Search classifications…"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}

            {/* Option list value mappings */}
            {optionColumns.map((col) => {
              const colMap = optionMappings[col] ?? {}
              const fieldDef = fieldDefs.find((d) => d.name === fieldMappings[col])
              const rawValues = columnValues[col] ?? []
              const values = Array.from(
                new Set(rawValues.flatMap((v) => splitOptionCell(v, !!fieldDef?.acceptMultipleOptions)))
              ).sort()
              const items = optionItemsByField.get(fieldMappings[col] ?? "") ?? []
              const flatNodes: FlatNode[] = items.map((it) => ({ id: it.id, label: it.label || it.name, depth: 0 }))
              return (
                <div key={col}>
                  <p className="text-sm font-medium mb-1">
                    Option values — <span className="font-mono">{col}</span>
                    <span className="text-muted-foreground font-normal"> → {fieldDef?.label ?? fieldDef?.name}</span>
                  </p>
                  <p className="text-xs text-muted-foreground mb-3">
                    Match each Excel value to an option from this field.
                    {fieldDef?.acceptMultipleOptions
                      ? " This field accepts multiple options — separate values in a cell with semicolons."
                      : " This field accepts a single option per record."}
                  </p>
                  <div className="border border-border rounded-lg overflow-hidden bg-card">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/50">
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Excel value</th>
                          <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Aprimo option</th>
                        </tr>
                      </thead>
                      <tbody>
                        {values.map((val, i) => (
                          <tr key={val} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                            <td className="px-4 py-2 font-mono text-xs">{val}</td>
                            <td className="px-4 py-2">
                              <ValueCombobox
                                nodes={flatNodes}
                                value={colMap[val] ?? ""}
                                onChange={(id) => setOptionMapping(col, val, id)}
                                placeholder="Select option…"
                                searchPlaceholder="Search options…"
                              />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )
            })}

            {/* Read-only field warning */}
            {hasReadOnlyMapped && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4">
                <p className="text-sm font-medium text-destructive">
                  One or more mapped fields are read-only and cannot be imported. Remove them from your field mappings to continue.
                </p>
              </div>
            )}

            {/* Numeric validation errors */}
            {numericErrors.length > 0 && (
              <div className="rounded-md border border-destructive/50 bg-destructive/5 p-4 space-y-2">
                <p className="text-sm font-medium text-destructive">
                  Fix non-numeric values before saving, then re-upload the file:
                </p>
                {numericErrors.map(({ col, fieldLabel, invalidValues }) => (
                  <div key={col} className="text-sm">
                    <span className="font-mono font-medium">{col}</span>
                    <span className="text-muted-foreground"> → {fieldLabel}: </span>
                    <span className="text-destructive">{invalidValues.join(", ")}</span>
                  </div>
                ))}
              </div>
            )}

            {/* Save */}
            {mappableColumns.length > 0 && (
              <div className="flex items-center gap-4 pt-2">
                <Button onClick={handleSave} disabled={!canSave}>
                  {saving ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Uploading…</> : "Upload"}
                </Button>
                {saving && saveProgress && (
                  <p className="text-sm text-muted-foreground">
                    {saveProgress.done} / {saveProgress.total} records
                  </p>
                )}
                {!saving && saveResults.length > 0 && (
                  <p className="text-sm text-muted-foreground">
                    {saveResults.filter((r) => r.success).length} succeeded ·{" "}
                    {saveResults.filter((r) => !r.success).length} failed
                  </p>
                )}
              </div>
            )}

            {/* Save results */}
            {saveResults.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden bg-card">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/50">
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground w-8"></th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Record ID</th>
                      <th className="px-4 py-2 text-left text-xs font-medium text-muted-foreground">Error</th>
                    </tr>
                  </thead>
                  <tbody>
                    {saveResults.map((r, i) => (
                      <tr key={r.recordId} className={i % 2 === 0 ? "bg-muted/20" : ""}>
                        <td className="px-4 py-2">
                          {r.success
                            ? <CheckCircle2 className="h-4 w-4 text-green-500" />
                            : <XCircle className="h-4 w-4 text-destructive" />}
                        </td>
                        <td className="px-4 py-2 font-mono text-xs">{r.recordId}</td>
                        <td className="px-4 py-2 text-xs text-muted-foreground">{r.error ?? ""}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </main>
      <Footer />
    </div>
  )
}
