"use client"

import { FormatPropertiesPanel } from "./format-properties-panel"
import { GlobalStylesPanel } from "./global-styles-panel"
import type { Format, FormatId } from "../types"
import "./right-panel.css"

export interface RightPanelProps {
  format: Format | null
  canDelete?: boolean
  sourceType?: "image" | "video"
  onClose: () => void
  onDelete: (id: FormatId) => void
  onExport: () => void
}

export function RightPanel({
  format,
  canDelete = true,
  sourceType = "image",
  onClose,
  onDelete,
  onExport,
}: RightPanelProps) {
  if (format) {
    return (
      <div className="right-panel">
        <FormatPropertiesPanel
          format={format}
          canDelete={canDelete}
          sourceType={sourceType}
          onClose={onClose}
          onDelete={onDelete}
          onExport={onExport}
        />
      </div>
    )
  }

  return (
    <div className="right-panel">
      <div className="rp-header">
        <span className="rp-header-title">Design</span>
      </div>
      <div className="rp-styles-section">
        <GlobalStylesPanel />
      </div>
    </div>
  )
}
