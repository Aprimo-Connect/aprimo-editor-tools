"use client"

import { useEffect, useMemo, useState } from "react"
import { DEFAULT_FORMAT_PROPS } from "../lib/constants"
import { useTemplateBuilder } from "../stores/use-template-builder"
import type { Anchor, Format, FormatId, Layer } from "../types"
import "./format-properties-panel.css"

const ANCHOR_DEFS: Array<{ k: Anchor; icon: string }> = [
  { k: "tl", icon: "↖" }, { k: "tc", icon: "↑" }, { k: "tr", icon: "↗" },
  { k: "cl", icon: "←" }, { k: "cc", icon: "●" }, { k: "cr", icon: "→" },
  { k: "bl", icon: "↙" }, { k: "bc", icon: "↓" }, { k: "br", icon: "↘" },
]

const SIZING_FIELDS = ["contentWidth", "padding", "contentScale", "ctaScale", "logoSize"] as const
type SizingField = (typeof SIZING_FIELDS)[number]

export interface FormatPropertiesPanelProps {
  format: Format
  canDelete?: boolean
  sourceType?: "image" | "video"
  onClose: () => void
  onDelete: (id: FormatId) => void
  onExport: () => void
}

export function FormatPropertiesPanel({
  format,
  canDelete = true,
  sourceType = "image",
  onClose,
  onDelete,
  onExport,
}: FormatPropertiesPanelProps) {
  const layers = useTemplateBuilder((s) => s.layers)
  const assetCount = useTemplateBuilder((s) => s.assets.length)
  const canvasPositions = useTemplateBuilder((s) => s.canvasPositions)
  const resolveAnchor = useTemplateBuilder((s) => s.resolveAnchor)
  const hasAssetAnchorOverride = useTemplateBuilder((s) => s.hasAssetAnchorOverride)

  const [localName, setLocalName] = useState(format.label)
  // null = group anchor, layer id, or "_logo"
  const [selectedElement, setSelectedElement] = useState<string | null>(null)

  // Reset local name when switching to a different format
  useEffect(() => {
    setLocalName(format.label)
  }, [format.id, format.label])

  function onNameChange(e: React.ChangeEvent<HTMLInputElement>) {
    setLocalName(e.target.value)
    useTemplateBuilder.getState().updateFormat(format.id, "label", e.target.value)
  }

  const hasMultipleAssets = assetCount > 1
  const hasActiveAssetAnchor = useMemo(
    () => hasAssetAnchorOverride(format.id),
    [hasAssetAnchorOverride, format.id, format.assetAnchors],
  )

  const logoVisible = (format.logoSize ?? 0.08) > 0

  const isLayerVisible = (layerId: string) =>
    format.visibleLayers?.includes(layerId) ?? false

  function toggleLayerVis(layerId: string) {
    useTemplateBuilder.getState().toggleLayerVisibility(format.id, layerId)
  }

  function toggleLogo() {
    const current = format.logoSize ?? 0.08
    useTemplateBuilder.getState().updateFormat(format.id, "logoSize", current > 0 ? 0 : 0.08)
  }

  function selectElement(id: string | null) {
    setSelectedElement((cur) => (cur === id ? null : id))
  }

  // ── Anchor label / value / has-custom logic ─────────────────
  const anchorLabel = useMemo(() => {
    if (!selectedElement) {
      if (hasMultipleAssets && hasActiveAssetAnchor) return "Group (this asset)"
      return "Group"
    }
    if (selectedElement === "_logo") return "Logo"
    const layer = layers.find((l) => l.id === selectedElement)
    return layer?.label ?? selectedElement
  }, [selectedElement, hasMultipleAssets, hasActiveAssetAnchor, layers])

  const activeAnchor = useMemo<Anchor>(() => {
    if (!selectedElement) return resolveAnchor(format)
    if (selectedElement === "_logo") {
      if (format.logoAnchor) return format.logoAnchor
      const a = resolveAnchor(format)
      const mirrorV = a[0] === "b" ? "t" : "b"
      const mirrorH = a[1] === "l" ? "r" : a[1] === "r" ? "l" : a[1]
      return (mirrorV + mirrorH) as Anchor
    }
    return (format.layerAnchors?.[selectedElement] || resolveAnchor(format)) as Anchor
  }, [selectedElement, format, resolveAnchor])

  const hasCustomAnchor = useMemo(() => {
    if (!selectedElement) {
      const la = format.layerAnchors
      const hasLayerOverrides = la && Object.keys(la).length > 0
      return hasLayerOverrides || !!format.logoAnchor || hasActiveAssetAnchor
    }
    if (selectedElement === "_logo") return !!format.logoAnchor
    return !!format.layerAnchors?.[selectedElement]
  }, [selectedElement, format, hasActiveAssetAnchor])

  function setActiveAnchor(k: Anchor) {
    const store = useTemplateBuilder.getState()
    if (!selectedElement) {
      if (hasMultipleAssets) {
        store.setAssetAnchor(format.id, k)
      } else {
        store.updateFormat(format.id, "anchor", k)
      }
    } else if (selectedElement === "_logo") {
      store.updateFormat(format.id, "logoAnchor", k)
    } else {
      store.setLayerAnchor(format.id, selectedElement, k)
    }
  }

  function resetActiveAnchor() {
    const store = useTemplateBuilder.getState()
    if (!selectedElement) {
      store.updateFormat(format.id, "layerAnchors", {})
      store.updateFormat(format.id, "logoAnchor", "")
      if (hasActiveAssetAnchor) store.setAssetAnchor(format.id, "")
      return
    }
    if (selectedElement === "_logo") {
      store.updateFormat(format.id, "logoAnchor", "")
    } else {
      store.setLayerAnchor(format.id, selectedElement, "")
    }
  }

  function getLayerAnchor(layerId: string): Anchor | null {
    return (format.layerAnchors?.[layerId] as Anchor | undefined) ?? null
  }

  // ── Sizing reset-all ──────────────────────────────────────────
  const anySizingModified = useMemo(() => {
    return SIZING_FIELDS.some((f) => {
      const cur = (format as unknown as Record<string, unknown>)[f]
      const def = (DEFAULT_FORMAT_PROPS as unknown as Record<string, unknown>)[f]
      return cur !== undefined && cur !== def
    })
  }, [format])

  function resetAllSizing() {
    const store = useTemplateBuilder.getState()
    for (const f of SIZING_FIELDS) {
      const def = (DEFAULT_FORMAT_PROPS as unknown as Record<string, unknown>)[f]
      if (def !== undefined) {
        store.updateFormat(format.id, f as keyof Format, def as never)
      }
    }
  }

  function isDefault(field: SizingField): boolean {
    const cur = (format as unknown as Record<string, unknown>)[field]
    const def = (DEFAULT_FORMAT_PROPS as unknown as Record<string, unknown>)[field]
    return cur === def
  }

  function resetProp(field: SizingField) {
    const def = (DEFAULT_FORMAT_PROPS as unknown as Record<string, unknown>)[field]
    if (def !== undefined) {
      useTemplateBuilder.getState().updateFormat(format.id, field as keyof Format, def as never)
    }
  }

  // ── Numeric setters ───────────────────────────────────────────
  function updateDimension(field: "w" | "h", val: string) {
    const n = parseInt(val)
    if (!isNaN(n) && n > 0) {
      useTemplateBuilder.getState().updateFormat(format.id, field, n)
    }
  }

  function updatePosition(axis: "x" | "y", val: string) {
    const n = parseInt(val)
    if (isNaN(n)) return
    const current = useTemplateBuilder.getState().canvasPositions[format.id] ?? { x: 0, y: 0 }
    useTemplateBuilder.getState().setCanvasPosition(format.id, { ...current, [axis]: n })
  }

  function updateSlider(field: keyof Format, val: string, divisor = 1) {
    const n = parseFloat(val)
    if (isNaN(n)) return
    useTemplateBuilder
      .getState()
      .updateFormat(format.id, field, (divisor === 1 ? n : n / divisor) as never)
  }

  const pos = canvasPositions[format.id] ?? { x: 0, y: 0 }

  return (
    <div className="props-panel">
      <div className="props-header">
        <input
          type="text"
          className="props-name-input"
          value={localName}
          onChange={onNameChange}
          placeholder="Format name"
        />
        <button className="props-close" onClick={onClose} title="Close">
          <CloseIcon />
        </button>
      </div>

      <div className="props-body">
        {/* Size */}
        <section className="props-section">
          <div className="props-card">
            <div className="props-card-title">Size</div>
            <div className="props-grid-2">
              <NumField label="W" value={format.w} onChange={(v) => updateDimension("w", v)} />
              <NumField label="H" value={format.h} onChange={(v) => updateDimension("h", v)} />
            </div>
          </div>
        </section>

        {/* Location */}
        <section className="props-section">
          <div className="props-card">
            <div className="props-card-title">Location</div>
            <div className="props-grid-2">
              <NumField label="X" value={pos.x} onChange={(v) => updatePosition("x", v)} />
              <NumField label="Y" value={pos.y} onChange={(v) => updatePosition("y", v)} />
            </div>
          </div>
        </section>

        {/* Anchor & Elements */}
        <section className="props-section">
          <div className="props-card">
            <div className="anchor-header">
              <div className="anchor-header-label">{anchorLabel} Anchor</div>
              {hasCustomAnchor && (
                <button
                  className="anchor-header-reset"
                  title={
                    !selectedElement
                      ? "Clear all element overrides"
                      : selectedElement === "_logo"
                        ? "Reset to auto"
                        : "Reset to group anchor"
                  }
                  onClick={resetActiveAnchor}
                >
                  <ResetIcon />
                </button>
              )}
            </div>
            <div className="anchor-grid-wrap">
              <div className="anchor-grid">
                {ANCHOR_DEFS.map((a) => (
                  <button
                    key={a.k}
                    className={`anchor-btn${activeAnchor === a.k ? " active" : ""}`}
                    title={(a.k as string).toUpperCase()}
                    onClick={() => setActiveAnchor(a.k)}
                  >
                    {a.icon}
                  </button>
                ))}
              </div>
            </div>

            {/* Element selector chips */}
            <div className="elem-selector">
              <button
                className={`elem-chip${!selectedElement ? " selected" : ""}`}
                onClick={() => selectElement(null)}
                title="Group anchor"
              >
                All
              </button>
              {layers.map((layer: Layer) =>
                isLayerVisible(layer.id) ? (
                  <button
                    key={layer.id}
                    className={`elem-chip${selectedElement === layer.id ? " selected" : ""}${
                      getLayerAnchor(layer.id) ? " custom" : ""
                    }`}
                    onClick={() => selectElement(layer.id)}
                  >
                    {layer.label}
                  </button>
                ) : null,
              )}
              {logoVisible && (
                <button
                  className={`elem-chip${selectedElement === "_logo" ? " selected" : ""}${
                    format.logoAnchor ? " custom" : ""
                  }`}
                  onClick={() => selectElement("_logo")}
                >
                  Logo
                </button>
              )}
            </div>
          </div>
        </section>

        {/* Visibility */}
        <section className="props-section">
          <div className="props-card">
            <div className="props-card-title">Visibility</div>
            <div className="vis-toggles">
              {layers.map((layer) => (
                <button
                  key={layer.id}
                  className={`elem-toggle${isLayerVisible(layer.id) ? " on" : ""}`}
                  onClick={() => toggleLayerVis(layer.id)}
                >
                  {layer.label}
                </button>
              ))}
              <button
                className={`elem-toggle${logoVisible ? " on" : ""}`}
                onClick={toggleLogo}
              >
                Logo
              </button>
            </div>
          </div>
        </section>

        {/* Sizing */}
        <section className="props-section">
          <div className="props-card">
            <div className="sizing-header">
              <div className="props-card-title" style={{ marginBottom: 0 }}>
                Sizing
              </div>
              {anySizingModified && (
                <button
                  className="anchor-header-reset"
                  title="Reset all sizing to defaults"
                  onClick={resetAllSizing}
                >
                  <ResetIcon />
                </button>
              )}
            </div>
            <div className="props-slider-group">
              <SliderItem
                label="Content Width"
                value={format.contentWidth ?? 60}
                min={20}
                max={100}
                onChange={(v) => updateSlider("contentWidth", v)}
                modified={!isDefault("contentWidth")}
                onReset={() => resetProp("contentWidth")}
                unit="%"
              />
              <SliderItem
                label="Padding"
                value={format.padding ?? 0}
                min={0}
                max={20}
                onChange={(v) => updateSlider("padding", v)}
                modified={!isDefault("padding")}
                onReset={() => resetProp("padding")}
                unit="%"
              />
              <SliderItem
                label="Text Scale"
                value={Math.round((format.contentScale || 1) * 100)}
                min={50}
                max={300}
                onChange={(v) => updateSlider("contentScale", v, 100)}
                modified={!isDefault("contentScale")}
                onReset={() => resetProp("contentScale")}
                unit="%"
              />
              <SliderItem
                label="CTA Scale"
                value={Math.round((format.ctaScale || 1) * 100)}
                min={50}
                max={300}
                onChange={(v) => updateSlider("ctaScale", v, 100)}
                modified={!isDefault("ctaScale")}
                onReset={() => resetProp("ctaScale")}
                unit="%"
              />
              <SliderItem
                label="Logo Size"
                value={Math.round((format.logoSize || 0.08) * 100)}
                min={2}
                max={20}
                onChange={(v) => updateSlider("logoSize", v, 100)}
                modified={!isDefault("logoSize")}
                onReset={() => resetProp("logoSize")}
                unit="%"
              />
            </div>
          </div>
        </section>

        {/* Actions */}
        <section className="props-section props-actions">
          <button className="props-export-btn" onClick={onExport}>
            <DownloadIcon />
            Download {sourceType === "video" ? "WebM" : "PNG"}
          </button>
          <button
            className="props-delete-btn"
            disabled={!canDelete}
            onClick={() => onDelete(format.id)}
          >
            <TrashIcon />
            Delete Format
          </button>
        </section>
      </div>
    </div>
  )
}

// ── Small subcomponents ─────────────────────────────────────────

function NumField({
  label,
  value,
  onChange,
}: {
  label: string
  value: number
  onChange: (v: string) => void
}) {
  return (
    <div className="props-num-field">
      <label>{label}</label>
      <input
        type="number"
        min={10}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <span className="props-field-unit">px</span>
    </div>
  )
}

interface SliderItemProps {
  label: string
  value: number
  min: number
  max: number
  unit: string
  modified: boolean
  onChange: (v: string) => void
  onReset: () => void
}

function SliderItem({
  label,
  value,
  min,
  max,
  unit,
  modified,
  onChange,
  onReset,
}: SliderItemProps) {
  return (
    <div className="props-slider-item">
      <span className="props-slider-label">{label}</span>
      <div className="props-slider-row">
        <input
          type="range"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <input
          type="number"
          className="props-num-inline"
          min={min}
          max={max}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
        <span className="props-unit">{unit}</span>
        <button
          className={`props-reset-inline${modified ? " modified" : ""}`}
          disabled={!modified}
          onClick={onReset}
          title="Reset to default"
        >
          <ResetIcon />
        </button>
      </div>
    </div>
  )
}

// ── Inline icon components ──────────────────────────────────────

function CloseIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M3 3l8 8M11 3l-8 8" />
    </svg>
  )
}

function ResetIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 12a9 9 0 109-9 9.75 9.75 0 00-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  )
}
