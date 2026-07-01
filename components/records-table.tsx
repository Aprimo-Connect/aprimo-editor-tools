"use client"

import type { AprimoRecord, FieldDef, FieldValueContext } from "@/models/aprimo"

function getThumbnailUri(record: AprimoRecord): string | undefined {
  return record._embedded?.masterfilelatestversion?._embedded?.thumbnail?.uri
}

function getFileInfo(record: AprimoRecord): { fileName?: string; checksum?: number } {
  const fv = record._embedded?.masterfilelatestversion as { fileName?: string; crc32?: number } | undefined
  return { fileName: fv?.fileName, checksum: fv?.crc32 }
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

interface RecordsTableProps {
  records: AprimoRecord[]
  tableFields: string[]
  fieldDefs: FieldDef[]
  ctx: FieldValueContext
  /** Show the master file's filename + checksum columns. */
  showFileInfo?: boolean
  /** When provided, rows become clickable. */
  onRecordClick?: (record: AprimoRecord) => void
}

export function RecordsTable({ records, tableFields, fieldDefs, ctx, showFileInfo, onRecordClick }: RecordsTableProps) {
  return (
    <table className="mt-4 w-full text-sm border-collapse">
      <thead>
        <tr className="border-b text-left">
          <th className="pb-2 pr-4 font-medium w-20"></th>
          <th className="pb-2 pr-4 font-medium">ID</th>
          {showFileInfo && <th className="pb-2 pr-4 font-medium">Filename</th>}
          {showFileInfo && <th className="pb-2 pr-4 font-medium">Checksum</th>}
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
          <tr
            key={record.id}
            className={`border-b last:border-0 ${onRecordClick ? "cursor-pointer hover:bg-muted/50" : ""}`}
            onClick={onRecordClick ? () => onRecordClick(record) : undefined}
          >
            <td className="py-2 pr-4">
              {getThumbnailUri(record)
                ? <img src={getThumbnailUri(record)} alt="" className="w-16 h-16 object-cover rounded" />
                : <div className="w-16 h-16 bg-muted rounded" />}
            </td>
            <td className="py-2 pr-4 font-mono text-xs">{record.id}</td>
            {showFileInfo && <td className="py-2 pr-4">{getFileInfo(record).fileName ?? "-"}</td>}
            {showFileInfo && <td className="py-2 pr-4 font-mono text-xs">{getFileInfo(record).checksum ?? "-"}</td>}
            <td className="py-2 pr-4">{record.contentType ?? "-"}</td>
            <td className="py-2 pr-4">{record.status ?? "-"}</td>
            {tableFields.map((f) => (
              <td key={f} className="py-2 pr-4">{getFieldValue(record, f, ctx) || "-"}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  )
}
