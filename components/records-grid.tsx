"use client"

import type { AprimoRecord, FieldDef, FieldValueContext } from "@/models/aprimo"

function getThumbnailUri(record: AprimoRecord): string | undefined {
  return record._embedded?.masterfilelatestversion?._embedded?.thumbnail?.uri
}

function getPreviewUri(record: AprimoRecord): string | undefined {
  return record._embedded?.masterfilelatestversion?._embedded?.preview?.uri
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
  if (Array.isArray(lv.values)) return lv.values.join(", ")
  return lv.value ?? ""
}

interface RecordsGridProps {
  records: AprimoRecord[]
  tableFields: string[]
  fieldDefs: FieldDef[]
  ctx: FieldValueContext
  showPreview: boolean
  showContentType: boolean
  showStatus: boolean
}

export function RecordsGrid({ records, tableFields, fieldDefs, ctx, showPreview, showContentType, showStatus }: RecordsGridProps) {
  return (
    <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6">
      {records.map((record) => {
        const thumb = showPreview ? getPreviewUri(record) ?? getThumbnailUri(record) : getThumbnailUri(record)
        return (
          <div key={record.id} className="border rounded-lg overflow-hidden">
            {thumb
              ? <img src={thumb} alt="" className="w-full aspect-video object-cover" />
              : <div className="w-full aspect-video bg-muted" />}
            <div className="p-2 space-y-0.5">
              {showContentType && record.contentType && <p className="text-xs text-muted-foreground">{record.contentType}</p>}
              {showStatus && record.status && <p className="text-xs text-muted-foreground">{record.status}</p>}
              {tableFields.map((f) => {
                const value = getFieldValue(record, f, ctx)
                if (!value) return null
                return (
                  <p key={f} className="text-xs text-muted-foreground">
                    <span className="font-medium">{fieldDefs.find((d) => d.name === f)?.label ?? f}:</span> {value}
                  </p>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
