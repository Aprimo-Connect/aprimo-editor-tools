"use client"

import { useRef, useState, useEffect } from "react"
import { useRouter } from "next/navigation"
import { motion } from "framer-motion"
import { Loader2, Upload, X, Plus, FileIcon, CheckCircle2, AlertCircle, Trash2 } from "lucide-react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { ClassificationValuePicker } from "@/components/classification-value-picker"
import { FieldDefinitionSearch } from "@/components/field-definition-search"
import { useAprimo } from "@/context/aprimo-context"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Progress } from "@/components/ui/progress"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Label } from "@/components/ui/label"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import type { FieldDef, ClassificationNode } from "@/models/aprimo"
import {
  type SupportedDataType,
  type Scope,
  type ColDef,
  type CellValue,
  type UploadItem,
  newUid,
  emptyCell,
} from "@/lib/bulk-upload"

const BROWSER_RENDERABLE_IMAGE_TYPES = new Set([
  "image/jpeg", "image/png", "image/gif", "image/webp", "image/svg+xml", "image/avif",
])

export default function BulkUploadPage() {
  const router = useRouter()
  const { client, isConnected } = useAprimo()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const [fieldDefs, setFieldDefs] = useState<FieldDef[]>([])
  const [allClassifications, setAllClassifications] = useState<ClassificationNode[]>([])
  const [languages, setLanguages] = useState<{ id: string; name: string }[]>([])
  const [languageId, setLanguageId] = useState("")

  const [cols, setCols] = useState<ColDef[]>([])
  const [files, setFiles] = useState<UploadItem[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const [isUploading, setIsUploading] = useState(false)
  const [uploadComplete, setUploadComplete] = useState(false)

  const [pickerOpen, setPickerOpen] = useState(false)
  const [pickerType, setPickerType] = useState<SupportedDataType>("SingleLineText")
  const [pickerScope, setPickerScope] = useState<Scope>("shared")
  const [pickerSelected, setPickerSelected] = useState<{ id: string; label: string; dataType: string } | null>(null)

  useEffect(() => {
    if (!isConnected) router.replace("/")
  }, [isConnected, router])

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
      setFieldDefs(
        allDefs
          .filter((d) => ["SingleLineText", "MultiLineText", "ClassificationList", "Numeric"].includes(d.dataType))
          .sort((a, b) => (a.label ?? a.name).localeCompare(b.label ?? b.name))
      )
    }

    async function loadClassifications() {
      const all: ClassificationNode[] = []
      for await (const result of client!.classifications.getPaged(undefined, undefined, "*")) {
        if (!result.ok) break
        all.push(...(result.data?.items ?? []) as unknown as ClassificationNode[])
      }
      setAllClassifications(all)
    }

    loadLanguages()
    loadFieldDefs()
    loadClassifications()
  }, [isConnected, client])

  const perAssetCols = cols.filter((c) => c.scope === "per-asset")
  const sharedCols = cols.filter((c) => c.scope === "shared")

  function addFiles(incoming: FileList | File[]) {
    const newItems: UploadItem[] = Array.from(incoming).map((file) => {
      const values: Record<string, CellValue> = {}
      perAssetCols.forEach((c) => { values[c.uid] = emptyCell() })
      return {
        uid: newUid(),
        file,
        thumbnailUrl: BROWSER_RENDERABLE_IMAGE_TYPES.has(file.type) ? URL.createObjectURL(file) : null,
        values,
        progress: 0,
        status: "pending" as const,
      }
    })
    setFiles((prev) => [...prev, ...newItems])
  }

  function removeFile(uid: string) {
    setFiles((prev) => prev.filter((f) => f.uid !== uid))
  }

  function updateFile(uid: string, patch: Partial<UploadItem>) {
    setFiles((prev) => prev.map((f) => (f.uid === uid ? { ...f, ...patch } : f)))
  }

  function updateCell(fileUid: string, colUid: string, patch: Partial<CellValue>) {
    setFiles((prev) =>
      prev.map((f) => {
        if (f.uid !== fileUid) return f
        const current = f.values[colUid] ?? emptyCell()
        return { ...f, values: { ...f.values, [colUid]: { ...current, ...patch } } }
      })
    )
  }

  function updateCol(uid: string, patch: Partial<ColDef>) {
    setCols((prev) => prev.map((c) => (c.uid === uid ? { ...c, ...patch } : c)))
  }

  function removeCol(colUid: string) {
    const target = cols.find((c) => c.uid === colUid)
    setCols((prev) => prev.filter((c) => c.uid !== colUid))
    if (target?.scope === "per-asset") {
      setFiles((prev) =>
        prev.map((f) => {
          const { [colUid]: _removed, ...rest } = f.values
          return { ...f, values: rest }
        })
      )
    }
  }

  function openPicker(dt: SupportedDataType, scope: Scope) {
    setPickerType(dt)
    setPickerScope(scope)
    setPickerSelected(null)
    setPickerOpen(true)
  }

  async function confirmPicker() {
    if (!pickerSelected) { toast.error("Please select a field"); return }
    if (cols.some((c) => c.fieldId === pickerSelected.id)) { toast.error("Field already added"); return }

    let rootId: string | null = null
    let acceptMultiple = false
    if (pickerType === "ClassificationList" && client) {
      const result = await client.fieldDefinitions.getById(pickerSelected.id)
      const data = result.data as unknown as { rootId?: string; acceptMultipleOptions?: boolean }
      rootId = data?.rootId ?? null
      acceptMultiple = !!data?.acceptMultipleOptions
    }

    const def = fieldDefs.find((d) => d.id === pickerSelected.id)
    const newCol: ColDef = {
      uid: newUid(),
      fieldId: pickerSelected.id,
      fieldName: def?.name ?? pickerSelected.id,
      label: pickerSelected.label,
      dataType: pickerSelected.dataType as SupportedDataType,
      rootId,
      acceptMultiple,
      scope: pickerScope,
      sharedTextValue: "",
      sharedClassifications: [],
    }

    setCols((prev) => [...prev, newCol])
    if (pickerScope === "per-asset") {
      setFiles((prev) =>
        prev.map((f) => ({ ...f, values: { ...f.values, [newCol.uid]: emptyCell() } }))
      )
    }
    setPickerOpen(false)
  }

  function buildFieldPayload(col: ColDef, cell: Pick<ColDef, "sharedTextValue" | "sharedClassifications"> | CellValue) {
    const isCell = "textValue" in cell
    if (col.dataType === "ClassificationList") {
      const classifications = isCell ? (cell as CellValue).classifications : (cell as ColDef).sharedClassifications
      if (!classifications.length) return null
      return { id: col.fieldId, localizedValues: [{ languageId, values: classifications.map((c) => c.id) }] }
    }
    const text = isCell ? (cell as CellValue).textValue : (cell as ColDef).sharedTextValue
    if (!text.trim()) return null
    return { id: col.fieldId, localizedValues: [{ languageId, value: text }] }
  }

  function buildSharedPayload() {
    return sharedCols.flatMap((col) => {
      const entry = buildFieldPayload(col, col)
      return entry ? [entry] : []
    })
  }

  function buildPerAssetPayload(item: UploadItem) {
    return perAssetCols.flatMap((col) => {
      const cell = item.values[col.uid]
      if (!cell) return []
      const entry = buildFieldPayload(col, cell)
      return entry ? [entry] : []
    })
  }

  async function handleUploadAll() {
    if (!client) return
    if (!languageId) { toast.error("Select a language first"); return }
    if (!files.length) { toast.error("Add at least one file"); return }

    setIsUploading(true)
    const sharedPayload = buildSharedPayload()

    for (const item of files) {
      if (item.status === "done") continue
      try {
        updateFile(item.uid, { status: "uploading", progress: 0 })

        const uploadResult = await client.uploader.uploadFile(item.file, {
          parallelLimit: 4,
          onProgress: (uploaded, total) => {
            const pct = total > 0 ? Math.round((uploaded / total) * 100) : 0
            setFiles((prev) => prev.map((f) => (f.uid === item.uid ? { ...f, progress: pct } : f)))
          },
        })

        const uploadData = uploadResult.data as unknown as { token?: string }
        if (!uploadResult.ok || !uploadData?.token) {
          throw new Error(uploadResult.error?.message ?? "Upload failed")
        }
        const token = uploadData.token

        updateFile(item.uid, { status: "creating", progress: 100 })

        const perAsset = buildPerAssetPayload(item)
        const perAssetIds = new Set(perAsset.map((p) => p.id))
        const merged = [...sharedPayload.filter((s) => !perAssetIds.has(s.id)), ...perAsset]

        const createBody: Record<string, unknown> = {
          status: "draft",
          files: {
            master: token,
            addOrUpdate: [{ versions: { addOrUpdate: [{ id: token, fileName: item.file.name }] } }],
          },
        }
        if (merged.length > 0) createBody.fields = { addOrUpdate: merged }

        const createResult = await client.records.create(createBody as never)
        if (!createResult.ok || !createResult.data?.id) {
          throw new Error(createResult.error?.message ?? "Record create failed")
        }

        updateFile(item.uid, { status: "done", recordId: createResult.data.id })
      } catch (err) {
        updateFile(item.uid, { status: "error", error: err instanceof Error ? err.message : "Unknown error" })
      }
    }

    setIsUploading(false)
    setUploadComplete(true)
    toast.success("Upload run complete")
  }

  const completedCount = files.filter((f) => f.status === "done").length
  const errorCount = files.filter((f) => f.status === "error").length

  function renderCellEditor(item: UploadItem, col: ColDef) {
    const cell = item.values[col.uid] ?? emptyCell()
    const disabled = item.status !== "pending"

    if (col.dataType === "ClassificationList") {
      return (
        <div className="min-w-[220px]">
          <ClassificationValuePicker
            rootId={col.rootId}
            acceptMultiple={col.acceptMultiple}
            allClassifications={allClassifications}
            value={cell.classifications}
            onChange={(next) => updateCell(item.uid, col.uid, { classifications: next })}
            disabled={disabled}
            languageId={languageId || undefined}
          />
        </div>
      )
    }
    return (
      <Input
        className="min-w-[180px]"
        placeholder="Value…"
        value={cell.textValue}
        disabled={disabled}
        onChange={(e) => updateCell(item.uid, col.uid, { textValue: e.target.value })}
      />
    )
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 w-full px-6 py-10">
        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
          <p className="text-muted-foreground mb-8">
            Define shared fields applied to every asset, plus per-asset columns for custom values.
            Per-asset values override shared values for the same field.
          </p>

          {/* Language */}
          <div className="flex items-center gap-3 mb-6 rounded-lg border border-border bg-card px-4 py-3">
            <Label htmlFor="language-sel" className="text-sm whitespace-nowrap">Language</Label>
            <Select value={languageId} onValueChange={setLanguageId}>
              <SelectTrigger id="language-sel" className="w-48 h-8 text-xs">
                <SelectValue placeholder="Select a language…" />
              </SelectTrigger>
              <SelectContent>
                {languages.map((l) => (
                  <SelectItem key={l.id} value={l.id} className="text-xs">{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Shared fields */}
          <Card className="mb-6">
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-lg">
                Shared fields <span className="text-muted-foreground text-sm font-normal">(applied to every file)</span>
              </CardTitle>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" onClick={() => openPicker("SingleLineText", "shared")}>
                  <Plus className="w-4 h-4" /> Text
                </Button>
                <Button size="sm" variant="outline" onClick={() => openPicker("ClassificationList", "shared")}>
                  <Plus className="w-4 h-4" /> Classification
                </Button>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {sharedCols.length === 0 && (
                <p className="col-span-full text-sm text-muted-foreground text-center py-6">
                  No shared fields. Add ones whose value will be the same for every asset.
                </p>
              )}
              {sharedCols.map((col) => (
                <div key={col.uid} className="border border-border rounded-md p-3 space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Badge variant="secondary" className="shrink-0">
                        {col.dataType === "ClassificationList" ? "Classification" : "Text"}
                      </Badge>
                      <span className="font-medium truncate">{col.label}</span>
                    </div>
                    <Button size="icon" variant="ghost" className="h-7 w-7 shrink-0" onClick={() => removeCol(col.uid)}>
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  {col.dataType === "ClassificationList" ? (
                    <ClassificationValuePicker
                      rootId={col.rootId}
                      acceptMultiple={col.acceptMultiple}
                      allClassifications={allClassifications}
                      value={col.sharedClassifications}
                      onChange={(next) => updateCol(col.uid, { sharedClassifications: next })}
                      languageId={languageId || undefined}
                    />
                  ) : col.dataType === "MultiLineText" ? (
                    <Textarea
                      placeholder="Value…"
                      rows={2}
                      value={col.sharedTextValue}
                      onChange={(e) => updateCol(col.uid, { sharedTextValue: e.target.value })}
                    />
                  ) : (
                    <Input
                      placeholder="Value…"
                      value={col.sharedTextValue}
                      onChange={(e) => updateCol(col.uid, { sharedTextValue: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </CardContent>
          </Card>

          {/* Drop zone */}
          <Card className="mb-6">
            <CardContent className="pt-6">
              <div
                onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => { e.preventDefault(); setIsDragging(false); if (e.dataTransfer.files?.length) addFiles(e.dataTransfer.files) }}
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  "border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors",
                  isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/30"
                )}
              >
                <Upload className="w-8 h-8 mx-auto mb-2 text-muted-foreground" />
                <p className="text-sm font-medium">Drop files here or click to browse</p>
                <p className="text-xs text-muted-foreground mt-1">Multiple files supported</p>
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(e) => e.target.files && addFiles(e.target.files)}
                />
              </div>
            </CardContent>
          </Card>

          {/* Per-asset column controls */}
          <div className="flex items-center justify-between mb-3">
            <div className="text-sm font-medium">
              Per-asset columns <span className="text-muted-foreground font-normal">(custom value per file)</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" variant="outline" onClick={() => openPicker("SingleLineText", "per-asset")}>
                <Plus className="w-4 h-4" /> Text column
              </Button>
              <Button size="sm" variant="outline" onClick={() => openPicker("ClassificationList", "per-asset")}>
                <Plus className="w-4 h-4" /> Classification column
              </Button>
            </div>
          </div>

          {/* Files table */}
          {files.length > 0 && (
            <Card className="mb-6">
              <CardContent className="p-0 overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="min-w-[260px]">File</TableHead>
                      {perAssetCols.map((col) => (
                        <TableHead key={col.uid} className="min-w-[200px]">
                          <div className="flex items-center gap-2">
                            <Badge variant="secondary" className="text-xs">
                              {col.dataType === "ClassificationList" ? "Class" : "Text"}
                            </Badge>
                            <span className="truncate">{col.label}</span>
                            <Button size="icon" variant="ghost" className="h-6 w-6 ml-auto" onClick={() => removeCol(col.uid)}>
                              <X className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </TableHead>
                      ))}
                      <TableHead className="w-12 text-right" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {files.map((item) => (
                      <TableRow key={item.uid}>
                        <TableCell className="align-top">
                          <div className="flex items-start gap-3">
                            {item.thumbnailUrl ? (
                              <img
                                src={item.thumbnailUrl}
                                alt={item.file.name}
                                className="w-12 h-12 rounded object-cover border border-border shrink-0 bg-muted"
                                loading="lazy"
                              />
                            ) : (
                              <div className="w-12 h-12 rounded border border-border bg-muted flex items-center justify-center shrink-0">
                                <FileIcon className="w-5 h-5 text-muted-foreground" />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium truncate">{item.file.name}</span>
                                {item.status === "done" && <CheckCircle2 className="w-4 h-4 text-primary shrink-0" />}
                                {item.status === "error" && <AlertCircle className="w-4 h-4 text-destructive shrink-0" />}
                                {(item.status === "uploading" || item.status === "creating") && (
                                  <Loader2 className="w-4 h-4 animate-spin text-muted-foreground shrink-0" />
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground">{(item.file.size / 1024).toFixed(1)} KB</p>
                              {(item.status === "uploading" || item.status === "creating") && (
                                <Progress value={item.progress} className="h-1 mt-1" />
                              )}
                              {item.status === "error" && (
                                <p className="text-xs text-destructive mt-0.5 truncate">{item.error}</p>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        {perAssetCols.map((col) => (
                          <TableCell key={col.uid} className="align-top">
                            {renderCellEditor(item, col)}
                          </TableCell>
                        ))}
                        <TableCell className="align-top text-right">
                          {item.status === "pending" && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => removeFile(item.uid)}>
                              <X className="w-4 h-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </CardContent>
            </Card>
          )}

          {/* Footer actions */}
          <div className="flex items-center justify-between pt-4 border-t border-border">
            <div className="text-xs text-muted-foreground">
              {files.length} file{files.length === 1 ? "" : "s"} · {completedCount} done
              {errorCount > 0 && ` · ${errorCount} failed`}
            </div>
            <div className="flex items-center gap-2">
              <Button variant="outline" onClick={() => { setFiles([]); setUploadComplete(false) }} disabled={isUploading || files.length === 0}>
                <Trash2 className="w-4 h-4" /> Clear
              </Button>
              <Button onClick={handleUploadAll} disabled={isUploading || uploadComplete || files.length === 0}>
                {isUploading
                  ? <><Loader2 className="w-4 h-4 animate-spin" /> Uploading…</>
                  : <><Upload className="w-4 h-4" /> Upload all</>}
              </Button>
            </div>
          </div>
        </motion.div>
      </main>
      <Footer />

      {/* Field picker dialog */}
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Select {pickerType === "ClassificationList" ? "classification" : "text"} field{" "}
              <span className="text-muted-foreground font-normal text-sm">({pickerScope})</span>
            </DialogTitle>
            <DialogDescription>
              Search and select a field definition to add as a {pickerScope} column.
            </DialogDescription>
          </DialogHeader>
          <FieldDefinitionSearch
            fieldDefs={fieldDefs}
            value={pickerSelected?.id ?? null}
            onChange={(id, label, dataType) => setPickerSelected({ id, label, dataType })}
            dataTypes={
              pickerType === "ClassificationList"
                ? ["ClassificationList"]
                : ["SingleLineText", "MultiLineText", "Numeric"]
            }
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPickerOpen(false)}>Cancel</Button>
            <Button onClick={confirmPicker}>Add</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
