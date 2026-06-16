"use client"

import { useState } from "react"
import { ChevronsUpDown, Check, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
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

function displayValue(def: FieldDef, v: EditValue, ctx: FieldValueContext): string {
  if (v.values) {
    if (def.dataType === "ClassificationList") {
      return v.values.map((id) => ctx.classificationsById?.get(id)?.labelPath || id).join(", ")
    }
    if (def.dataType === "OptionList") {
      const items = ctx.optionItemsByField?.get(def.name)
      return v.values.map((id) => items?.find((it) => it.id === id)?.label || id).join(", ")
    }
    return v.values.join(", ")
  }
  return v.value ?? ""
}

/** Generic single/multi value picker driven by a flat list of {id,label,depth} options. */
function MultiSelectCell({
  options,
  valueIds,
  acceptMultiple,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
}: {
  options: FlatNode[]
  valueIds: string[]
  acceptMultiple: boolean
  onChange: (ids: string[]) => void
  placeholder?: string
  searchPlaceholder?: string
}) {
  const [open, setOpen] = useState(false)
  const selected = new Set(valueIds)
  const labelFor = (id: string) => options.find((o) => o.id === id)?.label ?? id

  function toggle(id: string) {
    if (acceptMultiple) {
      onChange(selected.has(id) ? valueIds.filter((v) => v !== id) : [...valueIds, id])
    } else {
      onChange(selected.has(id) ? [] : [id])
      setOpen(false)
    }
  }

  return (
    <div className="space-y-1">
      <Popover open={open} onOpenChange={setOpen}>
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
}: {
  record: AprimoRecord
  def: FieldDef
  ctx: FieldValueContext
  classifications: ClassificationNode[]
  edit: EditValue | undefined
  onChange: (value: EditValue) => void
}) {
  const langId = ctx.selectedLanguageId
  const current = edit ?? getRawValue(record, def.name, langId)
  const pickerLang = langId && langId !== "__system__" ? langId : undefined

  if (def.isReadOnly) {
    return <span className="text-muted-foreground text-xs">{displayValue(def, current, ctx) || "-"}</span>
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
      />
    )
  }

  if (def.dataType.includes("TextList")) {
    return (
      <Input
        className="h-7 text-xs min-w-44"
        value={(current.values ?? []).join("; ")}
        placeholder="value; value"
        onChange={(e) => onChange({ values: e.target.value.split(";").map((s) => s.trim()).filter(Boolean) })}
      />
    )
  }

  const inputType =
    def.dataType === "Numeric" ? "number" : def.dataType === "Date" ? "date" : "text"
  return (
    <Input
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
}

export function RecordsTableEditable({
  records,
  tableFields,
  fieldDefs,
  ctx,
  classifications,
  edits,
  onEdit,
}: RecordsTableEditableProps) {
  return (
    <table className="mt-4 w-full text-sm border-collapse">
      <thead>
        <tr className="border-b text-left">
          <th className="pb-2 pr-4 font-medium w-20"></th>
          <th className="pb-2 pr-4 font-medium">ID</th>
          <th className="pb-2 pr-4 font-medium">Content Type</th>
          <th className="pb-2 pr-4 font-medium">Status</th>
          {tableFields.map((f) => (
            <th key={f} className="pb-2 pr-4 font-medium">
              {fieldDefs.find((d) => d.name === f)?.label ?? f}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {records.map((record) => (
          <tr key={record.id} className="border-b last:border-0 align-top">
            <td className="py-2 pr-4">
              {getThumbnailUri(record)
                ? <img src={getThumbnailUri(record)} alt="" className="w-16 h-16 object-cover rounded" />
                : <div className="w-16 h-16 bg-muted rounded" />}
            </td>
            <td className="py-2 pr-4 font-mono text-xs">{record.id}</td>
            <td className="py-2 pr-4">{record.contentType ?? "-"}</td>
            <td className="py-2 pr-4">{record.status ?? "-"}</td>
            {tableFields.map((f) => {
              const def = fieldDefs.find((d) => d.name === f)
              const edited = edits[record.id]?.[f] !== undefined
              return (
                <td key={f} className={`py-2 pr-4 ${edited ? "bg-yellow-100/60 dark:bg-yellow-900/30" : ""}`}>
                  {def
                    ? <EditableCell
                        record={record}
                        def={def}
                        ctx={ctx}
                        classifications={classifications}
                        edit={edits[record.id]?.[f]}
                        onChange={(value) => onEdit(record.id, f, value)}
                      />
                    : "-"}
                </td>
              )
            })}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
