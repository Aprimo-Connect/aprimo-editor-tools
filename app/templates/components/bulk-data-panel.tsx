"use client"

import { useRef, useState } from "react"
import { useBulkData } from "../stores/use-bulk-data"
import { useTemplateBuilder } from "../stores/use-template-builder"
import { parseSpreadsheet } from "../lib/spreadsheet"
import "./bulk-data-panel.css"

export interface BulkDataPanelProps {
  onExportBulk: () => void
}

export function BulkDataPanel({ onExportBulk }: BulkDataPanelProps) {
  const layers = useTemplateBuilder((s) => s.layers)
  const formatsLength = useTemplateBuilder((s) => s.formats.length)

  const isActive = useBulkData((s) => s.isActive)
  const fileName = useBulkData((s) => s.fileName)
  const rows = useBulkData((s) => s.rows)
  const columns = useBulkData((s) => s.columns)
  const columnMapping = useBulkData((s) => s.columnMapping)
  const sourceImageColumn = useBulkData((s) => s.sourceImageColumn)
  const logoColumn = useBulkData((s) => s.logoColumn)
  const activeRowIndex = useBulkData((s) => s.activeRowIndex)
  const isExporting = useBulkData((s) => s.isExporting)
  const exportProgress = useBulkData((s) => s.exportProgress)

  const [dragOver, setDragOver] = useState(false)
  const [parseError, setParseError] = useState("")
  const fileInputRef = useRef<HTMLInputElement>(null)

  async function handleFile(file: File | undefined | null) {
    if (!file) return
    setParseError("")
    try {
      const { rows: parsedRows, columns: parsedColumns } = await parseSpreadsheet(file)
      useBulkData.getState().importData(parsedRows, parsedColumns, file.name, layers)
    } catch (e) {
      setParseError(e instanceof Error ? e.message : String(e))
    }
  }

  function onFileInput(e: React.ChangeEvent<HTMLInputElement>) {
    handleFile(e.target.files?.[0])
    e.target.value = "" // allow re-picking the same file
  }

  function onDrop(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(false)
    handleFile(e.dataTransfer?.files?.[0])
  }

  function onDragOver(e: React.DragEvent<HTMLDivElement>) {
    e.preventDefault()
    setDragOver(true)
  }

  function onDragLeave() {
    setDragOver(false)
  }

  function onRowInput(e: React.ChangeEvent<HTMLInputElement>) {
    const val = parseInt(e.target.value)
    if (!isNaN(val)) useBulkData.getState().setActiveRow(val - 1)
  }

  const activeRow = rows[activeRowIndex] ?? null

  if (!isActive) {
    return (
      <div className="bulk-panel">
        <div
          className={`bulk-dropzone${dragOver ? " hover" : ""}`}
          onDrop={onDrop}
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <FileIcon />
          <span>Drop CSV / XLSX or click to browse</span>
          <input
            ref={fileInputRef}
            type="file"
            accept=".csv,.xlsx,.xls,.tsv"
            onChange={onFileInput}
            style={{ display: "none" }}
          />
        </div>
        {parseError && <div className="bulk-error">{parseError}</div>}
      </div>
    )
  }

  return (
    <div className="bulk-panel">
      {/* File info bar */}
      <div className="bulk-file-bar">
        <FileSmallIcon />
        <span className="bulk-file-name">{fileName}</span>
        <span className="bulk-row-count">{rows.length} rows</span>
        <button
          className="bulk-clear-btn"
          onClick={() => useBulkData.getState().reset()}
          title="Remove spreadsheet"
        >
          <CloseIcon />
        </button>
      </div>

      {/* Column mapping */}
      <div className="bulk-mapping">
        <div className="bulk-mapping-title">Column mapping</div>
        {layers.map((layer) => (
          <div key={layer.id} className="bulk-map-row">
            <span className="bulk-map-label">{layer.label || layer.id}</span>
            <select
              className="bulk-map-select"
              value={columnMapping[layer.id] ?? ""}
              onChange={(e) =>
                useBulkData.getState().setMapping(layer.id, e.target.value || null)
              }
            >
              <option value="">-- unmapped --</option>
              {columns.map((col) => (
                <option key={col} value={col}>
                  {col}
                </option>
              ))}
            </select>
          </div>
        ))}

        <div className="bulk-map-row">
          <span className="bulk-map-label muted">Source image</span>
          <select
            className="bulk-map-select"
            value={sourceImageColumn}
            onChange={(e) =>
              useBulkData.setState({ sourceImageColumn: e.target.value })
            }
          >
            <option value="">-- unmapped --</option>
            {columns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
        </div>

        <div className="bulk-map-row">
          <span className="bulk-map-label muted">Logo</span>
          <select
            className="bulk-map-select"
            value={logoColumn}
            onChange={(e) => useBulkData.setState({ logoColumn: e.target.value })}
          >
            <option value="">-- unmapped --</option>
            {columns.map((col) => (
              <option key={col} value={col}>
                {col}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Row stepper */}
      <div className="bulk-stepper">
        <button
          className="bulk-step-btn"
          disabled={activeRowIndex <= 0}
          onClick={() => useBulkData.getState().prevRow()}
        >
          <ChevronLeftIcon />
        </button>
        <span className="bulk-step-info">
          Row{" "}
          <input
            type="number"
            className="bulk-step-input"
            value={activeRowIndex + 1}
            min={1}
            max={rows.length}
            onChange={onRowInput}
          />{" "}
          of {rows.length}
        </span>
        <button
          className="bulk-step-btn"
          disabled={activeRowIndex >= rows.length - 1}
          onClick={() => useBulkData.getState().nextRow()}
        >
          <ChevronRightIcon />
        </button>
      </div>

      {/* Row preview */}
      {activeRow && (
        <div className="bulk-preview">
          {columns.map((col) => (
            <div key={col} className="bulk-preview-row">
              <span className="bulk-preview-col">{col}</span>
              <span className="bulk-preview-val">{String(activeRow[col] ?? "")}</span>
            </div>
          ))}
        </div>
      )}

      {/* Bulk export */}
      <div className="bulk-export">
        <button
          className="bulk-export-btn"
          disabled={isExporting}
          onClick={onExportBulk}
        >
          {!isExporting && <DownloadIcon />}
          {isExporting
            ? `Exporting... ${Math.round(exportProgress * 100)}%`
            : `Export All (${rows.length} × ${formatsLength} = ${rows.length * formatsLength} images)`}
        </button>
        {isExporting && (
          <div className="bulk-progress">
            <div
              className="bulk-progress-bar"
              style={{ width: exportProgress * 100 + "%" }}
            />
          </div>
        )}
      </div>
    </div>
  )
}

// ── Icons ─────────────────────────────────────────────────────

function FileIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
      <line x1="12" y1="18" x2="12" y2="12" />
      <polyline points="9 15 12 12 15 15" />
    </svg>
  )
}

function FileSmallIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  )
}

function CloseIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2.5 2.5 7.5 7.5M7.5 2.5 2.5 7.5" />
    </svg>
  )
}

function ChevronLeftIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 1.5 3.5 5 7 8.5" />
    </svg>
  )
}

function ChevronRightIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 1.5 6.5 5 3 8.5" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}
