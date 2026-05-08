"use client"

import { create } from "zustand"
import type { DrawState, Layer } from "../types"

type BulkRow = Record<string, unknown>

interface BulkDataState {
  rows: BulkRow[]
  columns: string[]
  columnMapping: Record<string, string>
  sourceImageColumn: string
  logoColumn: string
  activeRowIndex: number
  isActive: boolean
  fileName: string

  exportProgress: number
  isExporting: boolean

  importData: (rows: BulkRow[], cols: string[], name: string, layers: Layer[]) => void
  setMapping: (layerId: string, columnName: string | null) => void
  setActiveRow: (i: number) => void
  nextRow: () => void
  prevRow: () => void
  setExportProgress: (p: number) => void
  setIsExporting: (b: boolean) => void
  buildRowDrawState: (rowIndex: number, base: DrawState) => DrawState
  reset: () => void
}

function findBestColumnMatch(layer: Layer, cols: string[]): string | null {
  const nameLC = (layer.label || layer.id || "").toLowerCase().trim()
  const typeLC = (layer.type || "").toLowerCase()

  const exact = cols.find((c) => c.toLowerCase().trim() === nameLC)
  if (exact) return exact

  const typeMatch = cols.find((c) => c.toLowerCase().trim() === typeLC)
  if (typeMatch) return typeMatch

  const partial = cols.find((c) => {
    const cLC = c.toLowerCase().trim()
    return cLC.includes(nameLC) || nameLC.includes(cLC)
  })
  if (partial) return partial

  return null
}

export const useBulkData = create<BulkDataState>((set, get) => ({
  rows: [],
  columns: [],
  columnMapping: {},
  sourceImageColumn: "",
  logoColumn: "",
  activeRowIndex: 0,
  isActive: false,
  fileName: "",
  exportProgress: 0,
  isExporting: false,

  importData: (rows, columns, fileName, layers) => {
    const mapping: Record<string, string> = {}
    for (const layer of layers) {
      const match = findBestColumnMatch(layer, columns)
      if (match) mapping[layer.id] = match
    }
    const sourceImageColumn =
      columns.find((c) =>
        /^(image|source|photo|asset|url|image.?url|source.?url)$/i.test(c.trim()),
      ) ?? ""
    const logoColumn =
      columns.find((c) => /^(logo|logo.?url|brand.?logo)$/i.test(c.trim())) ?? ""

    set({
      rows,
      columns,
      fileName,
      activeRowIndex: 0,
      isActive: true,
      columnMapping: mapping,
      sourceImageColumn,
      logoColumn,
    })
  },

  setMapping: (layerId, columnName) => {
    const next = { ...get().columnMapping }
    if (columnName) next[layerId] = columnName
    else delete next[layerId]
    set({ columnMapping: next })
  },

  setActiveRow: (i) => {
    const len = get().rows.length
    set({ activeRowIndex: Math.max(0, Math.min(i, Math.max(0, len - 1))) })
  },

  nextRow: () => get().setActiveRow(get().activeRowIndex + 1),
  prevRow: () => get().setActiveRow(get().activeRowIndex - 1),

  setExportProgress: (p) => set({ exportProgress: p }),
  setIsExporting: (b) => set({ isExporting: b }),

  buildRowDrawState: (rowIndex, base) => {
    const { rows, columnMapping, sourceImageColumn, logoColumn } = get()
    const row = rows[rowIndex]
    if (!row) return base

    const overriddenLayers = base.layers.map((layer) => {
      const col = columnMapping[layer.id]
      if (col && row[col] != null && String(row[col]).trim() !== "") {
        return { ...layer, value: String(row[col]) }
      }
      return layer
    })

    const headlineLayer = overriddenLayers.find((l) => l.type === "headline")
    const ctaLayer = overriddenLayers.find((l) => l.type === "cta")

    return {
      ...base,
      layers: overriddenLayers,
      headline: headlineLayer?.value ?? base.headline,
      cta: ctaLayer?.value ?? base.cta,
      _sourceUrlOverride: sourceImageColumn ? String(row[sourceImageColumn] ?? "") : "",
      _logoUrlOverride: logoColumn ? String(row[logoColumn] ?? "") : "",
    }
  },

  reset: () =>
    set({
      rows: [],
      columns: [],
      columnMapping: {},
      sourceImageColumn: "",
      logoColumn: "",
      activeRowIndex: 0,
      isActive: false,
      fileName: "",
      exportProgress: 0,
      isExporting: false,
    }),
}))

export const selectRowCount = (s: BulkDataState) => s.rows.length
export const selectActiveRow = (s: BulkDataState) => s.rows[s.activeRowIndex] ?? null
