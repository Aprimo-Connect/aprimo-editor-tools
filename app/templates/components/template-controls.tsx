"use client"

import { useState } from "react"
import { useTemplateBuilder } from "../stores/use-template-builder"
import type { Asset, AssetId, Layer, LayerType } from "../types"
import { FocalPointPicker } from "./focal-point-picker"
import { BulkDataPanel } from "./bulk-data-panel"
import "./template-controls.css"

export interface TemplateControlsProps {
  sourceReady: boolean
  sourceType: "image" | "video"
  showBrowseDam: boolean
  showPublish: boolean
  publishing: boolean
  publishProgress: string
  publishedDamUrl: string

  onLoadSource: () => void
  onClearLogo: () => void
  onBrowseDam: () => void
  onExportAll: () => void
  onExportBulk: () => void
  onSwitchAsset: (id: AssetId) => void
  onPublishRenditions: () => void
}

function typeIcon(type: LayerType): string {
  if (type === "headline") return "H"
  if (type === "cta") return "C"
  return "T"
}

function assetLabel(asset: Asset): string {
  if (asset.label) return asset.label
  try {
    const url = new URL(asset.url)
    const parts = url.pathname.split("/")
    return parts[parts.length - 1]?.slice(0, 20) || "Asset"
  } catch {
    return "Asset"
  }
}

export function TemplateControls({
  sourceReady,
  sourceType,
  showBrowseDam,
  showPublish,
  publishing,
  publishProgress,
  publishedDamUrl,
  onLoadSource,
  onClearLogo,
  onBrowseDam,
  onExportAll,
  onExportBulk,
  onSwitchAsset,
  onPublishRenditions,
}: TemplateControlsProps) {
  // Store subscriptions
  const assets = useTemplateBuilder((s) => s.assets)
  const activeAssetId = useTemplateBuilder((s) => s.activeAssetId)
  const layers = useTemplateBuilder((s) => s.layers)
  const logoUrl = useTemplateBuilder((s) => s.logoUrl)
  const statusMsg = useTemplateBuilder((s) => s.statusMsg)
  const statusType = useTemplateBuilder((s) => s.statusType)

  // Derive focal/asset values from a single subscription so refs stay stable
  // across updates that don't touch the active asset.
  const activeAsset = useTemplateBuilder(
    (s) => s.assets.find((a) => a.id === s.activeAssetId) ?? null,
  )
  const sourceUrl = activeAsset?.url ?? ""
  const useSmartCrop = activeAsset?.useSmartCrop ?? false
  const contentAwareFocal = activeAsset?.contentAwareFocal ?? true
  const focalFit = activeAsset?.focalFit ?? "cover"
  const focalX = activeAsset?.focalX ?? 0.5
  const focalY = activeAsset?.focalY ?? 0.5
  const focalW = activeAsset?.focalW ?? 0.3
  const focalH = activeAsset?.focalH ?? 0.3

  // Local UI state
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [newAssetUrl, setNewAssetUrl] = useState("")

  // ── Asset helpers ──────────────────────────────────────────────
  function switchAsset(id: AssetId) {
    useTemplateBuilder.getState().setActiveAsset(id)
    onSwitchAsset(id)
  }

  function reloadAsset(id: AssetId) {
    switchAsset(id)
    onLoadSource()
  }

  function addNewAsset() {
    const url = newAssetUrl.trim()
    if (!url) return
    const id = useTemplateBuilder.getState().addAsset(url)
    setNewAssetUrl("")
    onSwitchAsset(id)
  }

  function removeAsset(id: AssetId) {
    useTemplateBuilder.getState().removeAsset(id)
    const next = useTemplateBuilder.getState().activeAssetId
    if (next) onSwitchAsset(next)
  }

  // ── Layer helpers ──────────────────────────────────────────────
  function moveUp(idx: number) {
    if (idx > 0) useTemplateBuilder.getState().reorderLayers(idx, idx - 1)
  }

  function moveDown(idx: number) {
    if (idx < layers.length - 1) {
      useTemplateBuilder.getState().reorderLayers(idx, idx + 1)
    }
  }

  function addLayer(type: LayerType) {
    useTemplateBuilder.getState().addLayer(type)
    setShowAddMenu(false)
  }

  function onAddMenuBlur() {
    setTimeout(() => setShowAddMenu(false), 150)
  }

  return (
    <div className="ctrl-panel">
      <div className="ctrl-header">Content</div>

      <div className="ctrl-scroll">
        {/* ── Source Assets ─────────────────────────────────────── */}
        <div className="ctrl-body-section">
          {assets.length > 0 && (
            <div className="asset-list">
              {assets.map((asset) => (
                <div
                  key={asset.id}
                  className={`asset-row${
                    asset.id === activeAssetId ? " active" : ""
                  }`}
                  onClick={() => switchAsset(asset.id)}
                >
                  <div
                    className={`asset-row-dot${
                      asset.id === activeAssetId ? " on" : ""
                    }`}
                  />
                  <span className="asset-row-label" title={asset.url}>
                    {assetLabel(asset)}
                  </span>
                  <button
                    className="asset-row-load"
                    onClick={(e) => {
                      e.stopPropagation()
                      reloadAsset(asset.id)
                    }}
                    title="Reload"
                  >
                    <ReloadIcon />
                  </button>
                  {assets.length > 1 && (
                    <button
                      className="asset-row-remove"
                      onClick={(e) => {
                        e.stopPropagation()
                        removeAsset(asset.id)
                      }}
                      title="Remove"
                    >
                      <CloseSmallIcon />
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          <div className="url-add-row">
            <input
              type="url"
              value={newAssetUrl}
              onChange={(e) => setNewAssetUrl(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") addNewAsset()
              }}
              placeholder={
                assets.length
                  ? "Add URL..."
                  : "Paste image or video URL..."
              }
            />
            <button
              className="url-add-btn"
              onClick={addNewAsset}
              disabled={!newAssetUrl.trim()}
            >
              <PlusIcon />
            </button>
          </div>

          {showBrowseDam && (
            <button
              className="url-browse-dam-btn"
              onClick={onBrowseDam}
              title="Pick one or more assets from Aprimo DAM"
            >
              <FolderIcon />
              Browse DAM
            </button>
          )}

          {statusMsg && (
            <div className={`tpl-src-status ${statusType ?? ""}`}>
              {statusMsg}
            </div>
          )}

          {sourceReady && sourceType !== "video" && (
            <>
              <div className="focal-bar">
                <button
                  className={`focal-pill${useSmartCrop ? " on" : ""}`}
                  onClick={() =>
                    useTemplateBuilder
                      .getState()
                      .setActiveAssetUseSmartCrop(!useSmartCrop)
                  }
                  title="Auto focal point"
                >
                  Smart crop
                </button>
                {!useSmartCrop && (
                  <>
                    <button
                      className={`focal-pill${
                        contentAwareFocal ? " on" : ""
                      }`}
                      onClick={() =>
                        useTemplateBuilder
                          .getState()
                          .setActiveAssetContentAwareFocal(!contentAwareFocal)
                      }
                      title="Keep focal area away from text overlays"
                    >
                      Content aware
                    </button>
                    <button
                      className={`focal-pill${
                        focalFit === "safe" ? " on" : ""
                      }`}
                      onClick={() =>
                        useTemplateBuilder
                          .getState()
                          .setActiveAssetFocalFit(
                            focalFit === "safe" ? "cover" : "safe",
                          )
                      }
                      title="Safe: always show full focal area. Cover: image fills canvas."
                    >
                      Safe area
                    </button>
                  </>
                )}
              </div>
              {!useSmartCrop && (
                <div>
                  <FocalPointPicker
                    sourceUrl={sourceUrl}
                    focalX={focalX}
                    focalY={focalY}
                    focalW={focalW}
                    focalH={focalH}
                    onChange={(focal) =>
                      useTemplateBuilder.getState().setActiveAssetFocal({
                        x: focal.focalX,
                        y: focal.focalY,
                        w: focal.focalW,
                        h: focal.focalH,
                      })
                    }
                  />
                  <div className="fp-coords">
                    <span>X: {Math.round(focalX * 100)}%</span>
                    <span>Y: {Math.round(focalY * 100)}%</span>
                    <span className="fp-area-dims">
                      {Math.round(focalW * 100)} × {Math.round(focalH * 100)}%
                    </span>
                    {(focalX !== 0.5 ||
                      focalY !== 0.5 ||
                      focalW !== 0.3 ||
                      focalH !== 0.3) && (
                      <button
                        className="fp-reset"
                        onClick={() =>
                          useTemplateBuilder.getState().setActiveAssetFocal({
                            x: 0.5,
                            y: 0.5,
                            w: 0.3,
                            h: 0.3,
                          })
                        }
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        {/* ── Layers ───────────────────────────────────────────── */}
        <div className="ctrl-sub-label">LAYERS</div>
        <div className="ctrl-body-section">
          {layers.map((layer: Layer, idx) => (
            <div key={layer.id}>
              {idx > 0 && (
                <div className="layer-gap-handle">
                  <div className="layer-gap-line" />
                  <div className="layer-gap-pill">
                    <GapIcon />
                    <input
                      type="number"
                      className="layer-gap-input"
                      min={0}
                      max={80}
                      value={layers[idx - 1].gapAfter ?? 12}
                      onChange={(e) =>
                        useTemplateBuilder
                          .getState()
                          .updateLayerGap(
                            layers[idx - 1].id,
                            parseInt(e.target.value) || 0,
                          )
                      }
                    />
                  </div>
                  <div className="layer-gap-line" />
                </div>
              )}

              <div className="layer-item">
                <div className="layer-header">
                  <span className={`layer-type-badge ${layer.type}`}>
                    {typeIcon(layer.type)}
                  </span>
                  <input
                    className="layer-label-input"
                    type="text"
                    value={layer.label}
                    onChange={(e) =>
                      useTemplateBuilder
                        .getState()
                        .updateLayerLabel(layer.id, e.target.value)
                    }
                    onFocus={(e) => e.target.select()}
                  />
                  <div className="layer-actions">
                    <button
                      className="layer-btn"
                      disabled={idx === 0}
                      onClick={() => moveUp(idx)}
                      title="Move up"
                    >
                      <ArrowUpIcon />
                    </button>
                    <button
                      className="layer-btn"
                      disabled={idx >= layers.length - 1}
                      onClick={() => moveDown(idx)}
                      title="Move down"
                    >
                      <ArrowDownIcon />
                    </button>
                    <button
                      className="layer-btn layer-btn-delete"
                      onClick={() =>
                        useTemplateBuilder.getState().removeLayer(layer.id)
                      }
                      title="Remove layer"
                    >
                      <CloseSmallIcon />
                    </button>
                  </div>
                </div>
                {layer.type === "text" ? (
                  <textarea
                    className="layer-value"
                    value={layer.value}
                    onChange={(e) =>
                      useTemplateBuilder
                        .getState()
                        .updateLayerValue(layer.id, e.target.value)
                    }
                    placeholder="Text content..."
                  />
                ) : (
                  <input
                    className="layer-value"
                    type="text"
                    value={layer.value}
                    onChange={(e) =>
                      useTemplateBuilder
                        .getState()
                        .updateLayerValue(layer.id, e.target.value)
                    }
                    placeholder={
                      layer.type === "headline"
                        ? "Headline text..."
                        : "Button label..."
                    }
                  />
                )}
              </div>
            </div>
          ))}

          <div className="add-layer-wrap">
            <button
              className="btn-add-layer"
              onClick={() => setShowAddMenu((o) => !o)}
              onBlur={onAddMenuBlur}
            >
              <PlusIcon />
              Add Layer
            </button>
            {showAddMenu && (
              <div className="add-layer-menu">
                <button
                  onMouseDown={(e) => {
                    e.preventDefault()
                    addLayer("headline")
                  }}
                >
                  <span
                    className="layer-type-badge headline"
                    style={{ width: 16, height: 16, fontSize: 9 }}
                  >
                    H
                  </span>{" "}
                  Headline
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault()
                    addLayer("text")
                  }}
                >
                  <span
                    className="layer-type-badge text"
                    style={{ width: 16, height: 16, fontSize: 9 }}
                  >
                    T
                  </span>{" "}
                  Text Block
                </button>
                <button
                  onMouseDown={(e) => {
                    e.preventDefault()
                    addLayer("cta")
                  }}
                >
                  <span
                    className="layer-type-badge cta"
                    style={{ width: 16, height: 16, fontSize: 9 }}
                  >
                    C
                  </span>{" "}
                  CTA Button
                </button>
              </div>
            )}
          </div>
        </div>

        {/* ── Bulk Data ────────────────────────────────────────── */}
        <div className="ctrl-sub-label">BULK DATA</div>
        <div className="ctrl-body-section">
          <BulkDataPanel onExportBulk={onExportBulk} />
        </div>

        {/* ── Logo ─────────────────────────────────────────────── */}
        <div className="ctrl-sub-label">LOGO</div>
        <div className="ctrl-body-section">
          <div className="ctrl-field">
            <label>Logo Image URL</label>
            <div className="url-row">
              <input
                type="url"
                value={logoUrl}
                onChange={(e) =>
                  useTemplateBuilder.getState().setLogoUrl(e.target.value)
                }
              />
              <button
                className="btn-load"
                style={{ background: "#64748b" }}
                onClick={onClearLogo}
              >
                Clear
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* ── Export footer ──────────────────────────────────────── */}
      <div className="export-section">
        {showPublish && publishedDamUrl && !publishing && (
          <a
            href={publishedDamUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-publish btn-view-dam"
          >
            <ExternalIcon />
            View in DAM
          </a>
        )}
        {showPublish && !publishedDamUrl && (
          <button
            className="btn-publish"
            disabled={publishing || !sourceReady || sourceType === "video"}
            onClick={onPublishRenditions}
          >
            {publishing ? (
              <>
                <div className="publish-spinner" />
                Publishing {publishProgress}...
              </>
            ) : (
              <>
                <UploadIcon />
                Publish to DAM
              </>
            )}
          </button>
        )}
        <button
          className="btn-export-all"
          disabled={!sourceReady || sourceType === "video"}
          onClick={onExportAll}
        >
          <DownloadIcon />
          Download All (ZIP)
        </button>
        {sourceType === "video" && (
          <div className="video-export-note">
            Video sources: preview only — individual WebM export per banner
          </div>
        )}
      </div>
    </div>
  )
}

// ── Inline icons ─────────────────────────────────────────────────

function ReloadIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 11-2.12-9.36L23 10" />
    </svg>
  )
}

function CloseSmallIcon() {
  return (
    <svg width="9" height="9" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
      <path d="M2.5 2.5 7.5 7.5M7.5 2.5 2.5 7.5" />
    </svg>
  )
}

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 1v10M1 6h10" />
    </svg>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  )
}

function GapIcon() {
  return (
    <svg width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
      <path d="M1 2.5h6M1 5.5h6" />
    </svg>
  )
}

function ArrowUpIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 6.5 5 3.5 8 6.5" />
    </svg>
  )
}

function ArrowDownIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 3.5 5 6.5 8 3.5" />
    </svg>
  )
}

function ExternalIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

function UploadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
    </svg>
  )
}

function DownloadIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
    </svg>
  )
}
