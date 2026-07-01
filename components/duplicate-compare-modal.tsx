"use client"

import { useEffect, useState, type ReactNode } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog"
import { Button } from "@/components/ui/button"
import type { AprimoRecord, FieldDef, FieldValueContext } from "@/models/aprimo"

// Record-link values are rendered/merged as a semicolon-separated list.
const RL_SEP = "; "
const RL_SPLIT = /[;,]/
// RecordLink relationship types that can hold only a single record — no merge.
const SINGLE_LINK_TYPES = new Set(["OneParentOneChild", "ManyParentsOneChild"])
const ROW_H = "h-9"

function getThumbnailUri(record?: AprimoRecord | null): string | undefined {
  return record?._embedded?.masterfilelatestversion?._embedded?.thumbnail?.uri
}

function recordLinkIds(lv: unknown): string[] {
  const rl = lv as {
    value?: string
    values?: string[] | null
    links?: Array<{ recordId: string }>
    parents?: Array<{ recordId: string }>
    children?: Array<{ recordId: string }>
  }
  const ids = [
    ...(rl.values ?? []),
    ...(rl.links ?? []).map((x) => x.recordId),
    ...(rl.parents ?? []).map((x) => x.recordId),
    ...(rl.children ?? []).map((x) => x.recordId),
  ]
  if (typeof rl.value === "string") ids.push(...rl.value.split(RL_SPLIT))
  return ids.map((s) => String(s).trim()).filter(Boolean)
}

function getFieldValue(record: AprimoRecord, fieldName: string, ctx?: FieldValueContext): string {
  const field = record._embedded?.fields?.items?.find((f) => f.fieldName === fieldName)
  if (!field?.localizedValues?.length) return ""
  const langId = ctx?.selectedLanguageId
  const lv =
    (langId && langId !== "__system__"
      ? field.localizedValues.find((v) => v.languageId === langId)
      : undefined) ?? field.localizedValues[0]
  if (field.dataType === "ClassificationList" && Array.isArray(lv.values)) {
    return lv.values
      .map((id) => {
        const node = ctx?.classificationsById?.get(id)
        if (!node) return id
        if (ctx?.selectedLanguageId === "__system__") return node.name || id
        const langLabel = ctx?.selectedLanguageId
          ? node.labels?.find((l) => l.languageId === ctx.selectedLanguageId)?.value
          : undefined
        return langLabel || node.labelPath || node.name || id
      })
      .join(", ")
  }
  if (field.dataType === "OptionList" && Array.isArray(lv.values)) {
    const items = ctx?.optionItemsByField?.get(fieldName)
    return lv.values
      .map((id) => {
        const item = items?.find((item) => item.id === id)
        if (!item) return id
        if (ctx?.selectedLanguageId === "__system__") return item.name || id
        return item.label || id
      })
      .join(", ")
  }
  if (field.dataType === "RecordLink") {
    return Array.from(new Set(recordLinkIds(lv))).join(RL_SEP)
  }
  if (Array.isArray(lv.values)) return lv.values.join(", ")
  return lv.value ?? ""
}

export type MergeSide = "a" | "b" | "merge"
export type MergePick = { name: string; side: MergeSide }

interface Row {
  name: string
  label: string
  dataType: string
  a: string
  b: string
  merged: string
  diff: boolean
  readOnly: boolean
  canMerge: boolean
}

interface DuplicateCompareModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  record: AprimoRecord | null
  duplicate: AprimoRecord | null
  fieldDefs: FieldDef[]
  ctx: FieldValueContext
  loading: boolean
  error: string | null
  onApply?: (picks: MergePick[]) => Promise<void>
  onDelete?: () => Promise<void>
  /** id → referenced asset, used to show record-link values as asset titles. */
  linkedAssets?: Map<string, { title?: string; thumbnailUri?: string }>
}

export function DuplicateCompareModal({
  open,
  onOpenChange,
  record,
  duplicate,
  fieldDefs,
  ctx,
  loading,
  error,
  onApply,
  onDelete,
  linkedAssets,
}: DuplicateCompareModalProps) {
  const [selections, setSelections] = useState<Record<string, MergeSide>>({})
  const [applying, setApplying] = useState(false)
  const [applyMsg, setApplyMsg] = useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Reset choices whenever the pair under comparison changes.
  useEffect(() => {
    setSelections({})
    setApplyMsg(null)
    setConfirmDelete(false)
  }, [record?.id, duplicate?.id])

  if (!record) return null

  const systemRows: Row[] = [
    { name: "", label: "ID", dataType: "", a: record.id, b: duplicate?.id ?? "", merged: "", diff: false, readOnly: true, canMerge: false },
    { name: "", label: "Content Type", dataType: "", a: record.contentType ?? "", b: duplicate?.contentType ?? "", merged: "", diff: false, readOnly: true, canMerge: false },
    { name: "", label: "Status", dataType: "", a: record.status ?? "", b: duplicate?.status ?? "", merged: "", diff: false, readOnly: true, canMerge: false },
  ]

  const fieldRows: Row[] = fieldDefs
    .map((def) => {
      const a = getFieldValue(record, def.name, ctx)
      const b = duplicate ? getFieldValue(duplicate, def.name, ctx) : ""
      const canMerge = def.dataType === "RecordLink" && !SINGLE_LINK_TYPES.has(def.linkType ?? "")
      const merged = canMerge
        ? Array.from(new Set([...a.split(RL_SPLIT), ...b.split(RL_SPLIT)].map((s) => s.trim()).filter(Boolean))).join(RL_SEP)
        : ""
      return {
        name: def.name,
        label: def.label || def.name,
        dataType: def.dataType,
        a,
        b,
        merged,
        diff: !!duplicate && a !== b,
        readOnly: !!def.isReadOnly,
        canMerge,
      }
    })
    .filter((r) => r.a || r.b)
    .sort((x, y) => x.label.localeCompare(y.label))

  const rows = [...systemRows, ...fieldRows]
  const diffRows = fieldRows.filter((r) => r.diff && !r.readOnly)
  const sideFor = (name: string): MergeSide => selections[name] ?? "a"

  const thumbA = getThumbnailUri(record)
  const thumbB = getThumbnailUri(duplicate)

  async function handleApply() {
    if (!onApply) return
    setApplying(true)
    setApplyMsg(null)
    try {
      await onApply(diffRows.map((r) => ({ name: r.name, side: sideFor(r.name) })))
      setApplyMsg("Applied selected values to this asset.")
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : "Failed to apply changes.")
    } finally {
      setApplying(false)
    }
  }

  async function handleDelete() {
    if (!onDelete) return
    if (!confirmDelete) {
      setConfirmDelete(true)
      return
    }
    setDeleting(true)
    setApplyMsg(null)
    try {
      await onDelete()
    } catch (e) {
      setApplyMsg(e instanceof Error ? e.message : "Failed to delete duplicate.")
      setConfirmDelete(false)
    } finally {
      setDeleting(false)
    }
  }

  // Record-link rows hold record ids; render the referenced assets as
  // thumbnail + title chips. Other fields render their text value.
  const cellContent = (row: Row, raw: string): ReactNode => {
    if (row.dataType !== "RecordLink") return raw || "-"
    const ids = raw.split(RL_SPLIT).map((s) => s.trim()).filter(Boolean)
    if (ids.length === 0) return "-"
    return (
      <span className="inline-flex items-center gap-2">
        {ids.map((id) => {
          const a = linkedAssets?.get(id)
          return (
            <span key={id} className="inline-flex items-center gap-1">
              {a?.thumbnailUri
                ? <img src={a.thumbnailUri} alt="" className="w-12 h-12 object-cover rounded shrink-0" />
                : <span className="w-12 h-12 rounded bg-muted inline-block shrink-0" />}
              <span>{a?.title || id}</span>
            </span>
          )
        })}
      </span>
    )
  }

  const chip = (row: Row, side: MergeSide, content: ReactNode, label?: string) => {
    const selected = sideFor(row.name) === side
    return (
      <button
        type="button"
        onClick={() => setSelections((s) => ({ ...s, [row.name]: side }))}
        className={`rounded px-2 py-0.5 whitespace-nowrap transition-colors ${
          selected ? "bg-primary/10 ring-1 ring-primary font-medium" : "opacity-60 hover:opacity-100 hover:bg-muted"
        }`}
        title={selected ? "Selected" : "Click to use this value"}
      >
        {label && <span className="text-[10px] uppercase tracking-wide opacity-70 mr-1">{label}</span>}
        {content}
      </button>
    )
  }

  // A single value cell's content for one of the two columns.
  const valueContent = (row: Row, column: "a" | "b") => {
    if (column === "b" && loading) return null
    const selectable = row.diff && !row.readOnly && !!duplicate
    if (!selectable) {
      return <span className="whitespace-nowrap">{cellContent(row, column === "a" ? row.a : row.b)}</span>
    }
    if (column === "a") return chip(row, "a", cellContent(row, row.a), row.canMerge ? "This" : undefined)
    return (
      <div className="flex items-center gap-3 whitespace-nowrap">
        {chip(row, "b", cellContent(row, row.b), row.canMerge ? "Dup" : undefined)}
        {row.canMerge && chip(row, "merge", cellContent(row, row.merged), "Merge")}
      </div>
    )
  }

  const rowBg = (row: Row) => (row.diff ? "bg-amber-50 dark:bg-amber-950/30" : "")
  // RecordLink rows render thumbnails, so they need a taller row to stay aligned.
  const rowH = (row: Row) => (row.dataType === "RecordLink" ? "h-14" : ROW_H)

  // One vertically-stacked, horizontally-scrolling value column.
  const ValueColumn = ({ column }: { column: "a" | "b" }) => (
    <div className="flex-1 min-w-0 overflow-x-auto">
      <div className="w-max min-w-full">
        {rows.map((row, i) => (
          <div key={`${column}-${row.label}-${i}`} className={`${rowH(row)} flex items-center px-2 border-b last:border-0 ${rowBg(row)}`}>
            {valueContent(row, column)}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[90vw] sm:max-w-[90vw] w-[90vw] max-h-[85vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Duplicate comparison</DialogTitle>
          <DialogDescription>Compare this asset's metadata with its duplicate and choose which values to keep.</DialogDescription>
        </DialogHeader>

        {/* Column headers */}
        <div className="flex border-b text-sm font-medium">
          <div className="w-44 shrink-0 pb-2 pr-4">Field</div>
          <div className="flex-1 min-w-0 pb-2 pr-4">
            <div className="flex items-center gap-2">
              {thumbA ? <img src={thumbA} alt="" className="w-12 h-12 object-cover rounded" /> : <div className="w-12 h-12 bg-muted rounded" />}
              <span>This asset</span>
            </div>
          </div>
          <div className="flex-1 min-w-0 pb-2 pr-4">
            <div className="flex items-center gap-2">
              {loading ? (
                <div className="w-12 h-12 bg-muted rounded animate-pulse" />
              ) : thumbB ? (
                <img src={thumbB} alt="" className="w-12 h-12 object-cover rounded" />
              ) : (
                <div className="w-12 h-12 bg-muted rounded" />
              )}
              <span>{loading ? "Finding duplicate…" : duplicate ? "Duplicate" : "No duplicate found"}</span>
            </div>
          </div>
        </div>

        {error && <p className="py-2 text-destructive text-xs">{error}</p>}

        {/* Body: one shared vertical scroll (outer); each value column scrolls
            horizontally on its own. The inner flex grows to content height so the
            columns don't each become their own vertical scroller. */}
        <div className="overflow-y-auto flex-1">
          <div className="flex text-sm">
            <div className="w-44 shrink-0">
              {rows.map((row, i) => (
                <div key={`label-${row.label}-${i}`} className={`${rowH(row)} flex items-center px-2 border-b last:border-0 font-medium text-muted-foreground ${rowBg(row)}`}>
                  <span className="truncate" title={row.label}>{row.label}</span>
                </div>
              ))}
            </div>
            <ValueColumn column="a" />
            <ValueColumn column="b" />
          </div>
        </div>

        {duplicate && (
          <DialogFooter className="border-t pt-3 sm:items-center sm:justify-between">
            <div className="flex items-center gap-3 flex-wrap">
              {onApply && diffRows.length > 0 && (
                <Button size="sm" onClick={handleApply} disabled={applying}>
                  {applying ? "Applying…" : "Apply selected to this asset"}
                </Button>
              )}
              {diffRows.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  {diffRows.length} mismatched field{diffRows.length !== 1 ? "s" : ""}. Click a value to choose which to keep;
                  multi-value record links can be merged &amp; deduped.
                </span>
              )}
              {applyMsg && <span className="text-xs text-foreground">{applyMsg}</span>}
            </div>
            <div className="flex items-center gap-3">
              {confirmDelete && !deleting && (
                <button className="text-xs text-muted-foreground underline" onClick={() => setConfirmDelete(false)}>
                  Cancel
                </button>
              )}
              {onDelete && (
                <Button size="sm" variant="destructive" onClick={handleDelete} disabled={deleting}>
                  {deleting ? "Deleting…" : confirmDelete ? "Confirm delete" : "Delete duplicate"}
                </Button>
              )}
            </div>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  )
}
