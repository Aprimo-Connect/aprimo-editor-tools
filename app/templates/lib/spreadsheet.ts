"use client"

import type { CellValue } from "exceljs"

export interface ParsedSpreadsheet {
  rows: Record<string, unknown>[]
  columns: string[]
}

function isCsv(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase() ?? ""
  return ext === "csv" || file.type === "text/csv"
}

/**
 * Parse CSV text. Handles RFC 4180-ish quoted fields with embedded commas,
 * embedded quotes (escaped as ""), and CRLF/LF line endings.
 */
function parseCsv(text: string): ParsedSpreadsheet {
  const lines: string[][] = []
  let row: string[] = []
  let cell = ""
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]

    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      cell += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ",") {
      row.push(cell)
      cell = ""
      i++
      continue
    }
    if (ch === "\r") {
      i++
      continue
    }
    if (ch === "\n") {
      row.push(cell)
      lines.push(row)
      row = []
      cell = ""
      i++
      continue
    }
    cell += ch
    i++
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell)
    lines.push(row)
  }

  if (lines.length === 0) return { rows: [], columns: [] }

  const columns = lines[0].map((c) => c.trim())
  const rows: Record<string, unknown>[] = []
  for (let r = 1; r < lines.length; r++) {
    const line = lines[r]
    if (line.length === 1 && line[0] === "") continue
    const obj: Record<string, unknown> = {}
    for (let c = 0; c < columns.length; c++) {
      obj[columns[c]] = line[c] ?? ""
    }
    rows.push(obj)
  }

  return { rows, columns }
}

/**
 * Convert an ExcelJS cell value (rich text, hyperlinks, formulas, dates, etc.)
 * into a plain primitive for the bulk-data store.
 */
function extractCellValue(value: CellValue): string | number | boolean {
  if (value == null) return ""
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value
  }
  if (value instanceof Date) return value.toISOString()
  if (typeof value === "object") {
    if ("text" in value) {
      const inner = (value as { text: unknown }).text
      if (typeof inner === "string") return inner
      return String(inner ?? "")
    }
    if ("richText" in value) {
      const rich = (value as { richText: Array<{ text?: string }> }).richText
      return rich.map((r) => r.text ?? "").join("")
    }
    if ("result" in value) {
      return extractCellValue((value as { result: CellValue }).result)
    }
    if ("error" in value) return ""
  }
  return String(value)
}

async function parseXlsx(file: File): Promise<ParsedSpreadsheet> {
  const ExcelJSMod = await import("exceljs")
  const ExcelJS = (ExcelJSMod.default ?? ExcelJSMod) as typeof import("exceljs")
  const arrayBuffer = await file.arrayBuffer()

  const workbook = new ExcelJS.Workbook()
  await workbook.xlsx.load(arrayBuffer)

  const sheet = workbook.worksheets[0]
  if (!sheet) throw new Error("No sheets found in the file.")

  // Header row → columns. ExcelJS uses 1-based indexing; column ordinals may
  // be sparse if cells were merged or skipped.
  const headerRow = sheet.getRow(1)
  const columns: string[] = []
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    columns[colNumber - 1] = String(cell.value ?? "").trim()
  })
  for (let i = 0; i < columns.length; i++) {
    if (columns[i] == null) columns[i] = ""
  }
  while (columns.length > 0 && !columns[columns.length - 1]) columns.pop()

  if (columns.length === 0) throw new Error("Spreadsheet has no header row.")

  const rows: Record<string, unknown>[] = []
  for (let r = 2; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r)
    if (!row.hasValues) continue
    const obj: Record<string, unknown> = {}
    let nonEmpty = false
    for (let c = 0; c < columns.length; c++) {
      const colName = columns[c]
      if (!colName) continue
      const cell = row.getCell(c + 1)
      const val = extractCellValue(cell.value)
      obj[colName] = val
      if (val !== "" && val != null) nonEmpty = true
    }
    if (nonEmpty) rows.push(obj)
  }

  return { rows, columns }
}

/**
 * Parse an uploaded spreadsheet (xlsx or csv) into rows + column headers.
 *
 * @throws if the file has no sheets, no header row, or no data rows.
 */
export async function parseSpreadsheet(file: File): Promise<ParsedSpreadsheet> {
  const result = isCsv(file) ? parseCsv(await file.text()) : await parseXlsx(file)
  if (!result.rows.length) throw new Error("The spreadsheet is empty.")
  return result
}
