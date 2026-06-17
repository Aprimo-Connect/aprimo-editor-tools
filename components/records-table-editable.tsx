"use client"

import { useState, useEffect } from "react"
import { ChevronsUpDown, Check, X, Copy, ClipboardPaste } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Badge } from "@/components/ui/badge"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import type { AprimoRecord, FieldDef, FieldValueContext, ClassificationNode } from "@/models/aprimo"
import { buildClassificationTree, flattenForPicker } from "@/lib/classifications"
import type { FlatNode } from "@/lib/classifications"

export interface EditValue {
  value?: string
  values?: string[]
}

function getThumbnailUri(record: AprimoRecord): string | undefined {
  return record._embedded?.masterfilelatestversion?._embedded?.thumbnail?.uri
}

/** Derive the editable raw value (ids or text) for a field, in the active language. */
export function getRawValue(record: AprimoRecord, fieldName: string, langId?: string | null): EditValue {
  const field = record._embedded?.fields?.items?.find((f) => f.fieldName === fieldName)
  if (!field?.localizedValues?.length) return {}
  const lv =
    (langId && langId !== "__system__"
      ? field.localizedValues.find((v) => v.languageId === langId)
      : undefined) ?? field.localizedValues[0]
  if (Array.isArray(lv.values)) return { values: [...lv.values] }
  return { value: lv.value ?? "" }
}

/** Pretty labels for an array-valued field (TextList / OptionList / ClassificationList). */
function displayLabels(def: FieldDef, v: EditValue, ctx: FieldValueContext): string[] | null {
  if (!v.values) return null
  if (def.dataType === "ClassificationList") {
    return v.values.map((id) => {
      const node = ctx.classificationsById?.get(id)
      if (!node) return id
      const langId = ctx.selectedLanguageId
      if (langId && langId !== "__system__") {
        const localized = node.labels?.find((l) => l.languageId === langId)?.value
        if (localized) return localized
      }
      return node.name || node.labelPath || id
    })
  }
  if (def.dataType === "OptionList") {
    const items = ctx.optionItemsByField?.get(def.name)
    return v.values.map((id) => items?.find((it) => it.id === id)?.label || id)
  }
  return v.values
}

/** Render a cell's value: array-valued fields as pills, scalars as text. */
function CellDisplay({ def, value, ctx }: { def: FieldDef; value: EditValue; ctx: FieldValueContext }) {
  const labels = displayLabels(def, value, ctx)
  if (labels) {
    if (!labels.length) return <span className="text-muted-foreground">—</span>
    return (
      <div className="flex flex-wrap gap-1">
        {labels.map((label, i) => (
          <Badge key={i} variant="secondary" className="text-xs font-normal">{label}</Badge>
        ))}
      </div>
    )
  }
  return value.value ? <>{value.value}</> : <span className="text-muted-foreground">—</span>
}

/** Generic single/multi value picker driven by a flat list of {id,label,depth} options. */
function MultiSelectCell({
  options,
  valueIds,
  acceptMultiple,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  autoOpen = false,
  onClose,
}: {
  options: FlatNode[]
  valueIds: string[]
  acceptMultiple: boolean
  onChange: (ids: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
  autoOpen?: boolean
  onClose?: () => void
}) {
  const [open, setOpen] = useState(autoOpen)
  const selected = new Set(valueIds)
  const labelFor = (id: string) => options.find((o) => o.id === id)?.label ?? id

  function setOpenState(o: boolean) {
    setOpen(o)
    if (!o) onClose?.()
  }

  function toggle(id: string) {
    if (acceptMultiple) {
      onChange(selected.has(id) ? valueIds.filter((v) => v !== id) : [...valueIds, id])
    } else {
      onChange(selected.has(id) ? [] : [id])
      setOpenState(false)
    }
  }

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpenState}>
        <PopoverTrigger asChild>
          <Button variant="outline" role="combobox" className="h-7 w-full min-w-44 justify-between text-xs font-normal">
            <span className="truncate">
              {valueIds.length === 0 ? placeholder : valueIds.length === 1 ? labelFor(valueIds[0]) : `${valueIds.length} selected`}
            </span>
            <ChevronsUpDown className="ml-1 h-3 w-3 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-72 p-0" align="start">
          <Command>
            <CommandInput placeholder={searchPlaceholder} className="text-xs" />
            <CommandList>
              <CommandEmpty className="text-xs">No match.</CommandEmpty>
              <CommandGroup>
                {options.map((o) => (
                  <CommandItem
                    key={o.id}
                    value={o.label}
                    onSelect={() => toggle(o.id)}
                    className="text-xs"
                    style={{ paddingLeft: `${0.5 + o.depth}rem` }}
                  >
                    <Check className={`mr-1 h-3 w-3 shrink-0 ${selected.has(o.id) ? "opacity-100" : "opacity-0"}`} />
                    {o.label}
                  </CommandItem>
                ))}
              </CommandGroup>
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {valueIds.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {valueIds.map((id) => (
            <Badge key={id} variant="secondary" className="text-xs gap-1 pr-1">
              {labelFor(id)}
              <button
                onClick={() => onChange(valueIds.filter((v) => v !== id))}
                className="ml-0.5 rounded-full hover:bg-muted-foreground/20"
              >
                <X className="h-2.5 w-2.5" />
              </button>
            </Badge>
          ))}
        </div>
      )}
    </div>
  )
}

function EditableCell({
  record,
  def,
  ctx,
  classifications,
  edit,
  onChange,
  onExit,
}: {
  record: AprimoRecord
  def: FieldDef
  ctx: FieldValueContext
  classifications: ClassificationNode[]
  edit: EditValue | undefined
  onChange: (value: EditValue) => void
  onExit: () => void
}) {
  const langId = ctx.selectedLanguageId
  const current = edit ?? getRawValue(record, def.name, langId)
  const pickerLang = langId && langId !== "__system__" ? langId : undefined

  const onInputKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLInputElement).blur()
  }

  if (def.dataType === "ClassificationList") {
    const tree = def.rootId ? buildClassificationTree(def.rootId, classifications) : null
    const options: FlatNode[] = tree
      ? flattenForPicker(tree, 0, pickerLang)
      : classifications.map((c) => ({ id: c.id, label: c.labelPath || c.name, depth: 0 }))
    return (
      <MultiSelectCell
        options={options}
        valueIds={current.values ?? []}
        acceptMultiple={def.acceptMultipleOptions ?? true}
        onChange={(ids) => onChange({ values: ids })}
        placeholder="Select classification…"
        searchPlaceholder="Search classifications…"
        autoOpen
        onClose={onExit}
      />
    )
  }

  if (def.dataType === "OptionList") {
    const items = ctx.optionItemsByField?.get(def.name) ?? []
    const options: FlatNode[] = items.map((it) => ({ id: it.id, label: it.label || it.name, depth: 0 }))
    return (
      <MultiSelectCell
        options={options}
        valueIds={current.values ?? []}
        acceptMultiple={!!def.acceptMultipleOptions}
        onChange={(ids) => onChange({ values: ids })}
        placeholder="Select option…"
        searchPlaceholder="Search options…"
        autoOpen
        onClose={onExit}
      />
    )
  }

  if (def.dataType.includes("TextList")) {
    return (
      <Input
        autoFocus
        onBlur={onExit}
        onKeyDown={onInputKeyDown}
        className="h-7 text-xs min-w-44"
        value={(current.values ?? []).join("; ")}
        placeholder="value; value"
        onChange={(e) => onChange({ values: e.target.value.split(";").map((s) => s.trim()).filter(Boolean) })}
      />
    )
  }

  if (def.dataType === "MultiLineText") {
    return (
      <Textarea
        autoFocus
        onBlur={onExit}
        onKeyDown={(e) => { if (e.key === "Escape") (e.target as HTMLTextAreaElement).blur() }}
        rows={4}
        className="min-w-56 text-xs"
        value={current.value ?? ""}
        onChange={(e) => onChange({ value: e.target.value })}
      />
    )
  }

  const inputType =
    def.dataType === "Numeric" ? "number" : def.dataType === "Date" ? "date" : "text"
  return (
    <Input
      autoFocus
      onBlur={onExit}
      onKeyDown={onInputKeyDown}
      type={inputType}
      className="h-7 text-xs min-w-44"
      value={current.value ?? ""}
      onChange={(e) => onChange({ value: e.target.value })}
    />
  )
}

interface RecordsTableEditableProps {
  records: AprimoRecord[]
  tableFields: string[]
  fieldDefs: FieldDef[]
  ctx: FieldValueContext
  classifications: ClassificationNode[]
  edits: Record<string, Record<string, EditValue>>
  onEdit: (recordId: string, fieldName: string, value: EditValue) => void
  showContentType?: boolean
  showStatus?: boolean
}

interface Clipboard {
  recordId: string
  fieldName: string
  dataType: string
  value: EditValue
}

interface DragFill {
  fieldName: string
  startIndex: number
  currentIndex: number
}

export function RecordsTableEditable({
  records,
  tableFields,
  fieldDefs,
  ctx,
  classifications,
  edits,
  onEdit,
  showContentType = true,
  showStatus = true,
}: RecordsTableEditableProps) {
  const [clipboard, setClipboard] = useState<Clipboard | null>(null)
  const [drag, setDrag] = useState<DragFill | null>(null)
  const [editing, setEditing] = useState<{ recordId: string; fieldName: string } | null>(null)

  const cellValue = (record: AprimoRecord, def: FieldDef): EditValue =>
    edits[record.id]?.[def.name] ?? getRawValue(record, def.name, ctx.selectedLanguageId)

  // Paste needs matching type; classification/option ids are field-scoped, so
  // those additionally require the same field.
  const canPaste = (def: FieldDef): boolean => {
    if (!clipboard || clipboard.dataType !== def.dataType) return false
    if ((def.dataType === "ClassificationList" || def.dataType === "OptionList") && clipboard.fieldName !== def.name) return false
    return true
  }

  // Commit an Excel-style drag-fill: copy the source cell's value to every
  // cell in the dragged range (excluding the source itself).
  useEffect(() => {
    if (!drag) return
    const onUp = () => {
      const def = fieldDefs.find((d) => d.name === drag.fieldName)
      if (def) {
        const value = cellValue(records[drag.startIndex], def)
        const lo = Math.min(drag.startIndex, drag.currentIndex)
        const hi = Math.max(drag.startIndex, drag.currentIndex)
        for (let i = lo; i <= hi; i++) {
          if (i !== drag.startIndex) onEdit(records[i].id, def.name, value)
        }
      }
      setDrag(null)
    }
    window.addEventListener("mouseup", onUp)
    return () => window.removeEventListener("mouseup", onUp)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag])

  const inFillRange = (fieldName: string, index: number): boolean =>
    !!drag && drag.fieldName === fieldName &&
    index >= Math.min(drag.startIndex, drag.currentIndex) &&
    index <= Math.max(drag.startIndex, drag.currentIndex)

  return (
    <table className={`mt-4 w-full text-sm border-collapse ${drag ? "select-none" : ""}`}>
      <thead>
        <tr className="border-b text-left">
          <th className="pb-2 pr-4 font-medium w-20"></th>
          <th className="pb-2 pr-4 font-medium">ID</th>
          {showContentType && <th className="pb-2 pr-4 font-medium">Content Type</th>}
          {showStatus && <th className="pb-2 pr-4 font-medium">Status</th>}
          {tableFields.map((f) => (
            <th key={f} className="pb-2 pr-4 font-medium">
              {fieldDefs.find((d) => d.name === f)?.label ?? f}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((record, rowIndex) => (
          <tr key={record.id} className="border-b last:border-0 align-top">
            <td className="py-2 pr-4">
              {getThumbnailUri(record)
                ? <img src={getThumbnailUri(record)} alt="" className="w-16 h-16 object-cover rounded" />
                : <div className="w-16 h-16 bg-muted rounded" />}
            </td>
            <td className="py-2 pr-4 font-mono text-xs">{record.id}</td>
            {showContentType && <td className="py-2 pr-4">{record.contentType ?? "-"}</td>}
            {showStatus && <td className="py-2 pr-4">{record.status ?? "-"}</td>}
            {tableFields.map((f) => {
              const def = fieldDefs.find((d) => d.name === f)
              const edited = edits[record.id]?.[f] !== undefined
              const editable = def && !def.isReadOnly
              const isEditing = editing?.recordId === record.id && editing?.fieldName === f
              const isClipboardSource = clipboard?.recordId === record.id && clipboard?.fieldName === f
              const filling = inFillRange(f, rowIndex)
              return (
                <td
                  key={f}
                  onMouseEnter={() => { if (drag && drag.fieldName === f) setDrag({ ...drag, currentIndex: rowIndex }) }}
                  className={`group relative py-2 pr-4 ${edited ? "bg-yellow-100/60 dark:bg-yellow-900/30" : ""} ${isClipboardSource ? "ring-1 ring-inset ring-primary" : ""} ${filling ? "ring-1 ring-inset ring-primary/70 bg-primary/5" : ""}`}
                >
                  {!def
                    ? "-"
                    : isEditing
                      ? <EditableCell
                          record={record}
                          def={def}
                          ctx={ctx}
                          classifications={classifications}
                          edit={edits[record.id]?.[f]}
                          onChange={(value) => onEdit(record.id, f, value)}
                          onExit={() => setEditing((cur) => (cur?.recordId === record.id && cur?.fieldName === f ? null : cur))}
                        />
                      : <div
                          onClick={() => editable && setEditing({ recordId: record.id, fieldName: f })}
                          className={`min-h-7 whitespace-pre-wrap rounded px-1.5 py-1 text-xs ${editable ? "cursor-text hover:bg-muted/50" : "text-muted-foreground"}`}
                        >
                          <CellDisplay def={def} value={cellValue(record, def)} ctx={ctx} />
                        </div>}
                  {editable && !isEditing && (
                    <div className="absolute bottom-1 left-1 z-10 hidden items-center gap-0.5 rounded border bg-background/95 p-0.5 shadow-sm group-hover:flex">
                      <button
                        title="Copy cell"
                        onClick={() => setClipboard({ recordId: record.id, fieldName: def!.name, dataType: def!.dataType, value: cellValue(record, def!) })}
                        className="rounded p-0.5 hover:bg-muted"
                      >
                        <Copy className="h-3 w-3" />
                      </button>
                      <button
                        title={canPaste(def!) ? "Paste into cell" : "Copy a compatible cell first"}
                        disabled={!canPaste(def!)}
                        onClick={() => clipboard && onEdit(record.id, def!.name, clipboard.value)}
                        className="rounded p-0.5 hover:bg-muted disabled:opacity-30 disabled:hover:bg-transparent"
                      >
                        <ClipboardPaste className="h-3 w-3" />
                      </button>
                    </div>
                  )}
                  {editable && !isEditing && (
                    <div
                      title="Drag to fill down"
                      onMouseDown={(e) => { e.preventDefault(); setDrag({ fieldName: f, startIndex: rowIndex, currentIndex: rowIndex }) }}
                      className="absolute bottom-0.5 right-0.5 z-10 h-2 w-2 cursor-ns-resize rounded-[1px] bg-primary opacity-0 group-hover:opacity-100"
                    />
                  )}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
