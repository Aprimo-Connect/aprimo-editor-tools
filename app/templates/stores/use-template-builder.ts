"use client"

import { create } from "zustand"
import { useProjectManager } from "./use-project-manager"
import type {
  Anchor,
  Asset,
  AssetId,
  AvailableField,
  CanvasPosition,
  DrawState,
  FocalFit,
  Format,
  FormatId,
  Layer,
  LayerId,
  Snapshot,
  Styles,
} from "../types"

const DEFAULT_GAP = 12
// No default logo URL — users opt in by entering one. The HubSpot-hosted
// Aprimo logo from the original demo is CORS-blocked, so auto-loading it
// produced noisy console errors and (via the old fallback path) a tainted
// canvas that broke exports.
const DEFAULT_LOGO = ""

const DEFAULT_LAYERS: Layer[] = [
  { id: "headline", type: "headline", label: "Headline", value: "Aprimo DAM", mappedField: null, gapAfter: DEFAULT_GAP },
  { id: "text", type: "text", label: "Text", value: "Make the most out of your assets with single-purpose applications.", mappedField: null, gapAfter: DEFAULT_GAP },
  { id: "cta", type: "cta", label: "CTA", value: "Learn more", mappedField: null, gapAfter: DEFAULT_GAP },
]

const DEFAULT_FORMATS: Format[] = [
  {
    id: "default-3x2", label: "Default 3:2", w: 900, h: 600,
    anchor: "bl", layerAnchors: {}, logoAnchor: "",
    visibleLayers: ["headline", "text", "cta"],
    logoSize: 0.06, contentScale: 1, contentWidth: 50,
  },
]

const DEFAULT_STYLES: Styles = {
  headlineFont: "Playfair Display", headlineFontSize: 32, headlineFontWeight: "700", headlineColor: "#ffffff",
  textFont: "Poppins", textFontSize: 16, textFontWeight: "400", textColor: "#ffffff",
  ctaFont: "Outfit", ctaFontSize: 16, ctaFontWeight: "400", ctaTextColor: "#ffffff",
  accentColor: "#6366f1", ctaPadH: 20, ctaPadV: 10, ctaRadius: 50,
  contentGap: 12,
  overlayColor: "#000000", overlayOpacity: 0.65,
  bgMode: "none", bgColor1: "#0f172a", bgColor2: "#1e293b", bgAngle: 180, bgDistance: 100,
}

function generateAssetId(): string {
  return "asset_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5)
}

type StatusType = "" | "ok" | "err" | "load"

interface TemplateBuilderState {
  layers: Layer[]
  formats: Format[]
  styles: Styles
  assets: Asset[]
  activeAssetId: AssetId | ""
  logoUrl: string
  canvasPositions: Record<FormatId, CanvasPosition>

  activeSettingsId: FormatId | null
  statusMsg: string
  statusType: StatusType
  availableFields: AvailableField[]

  // Asset actions
  addAsset: (url?: string, label?: string) => AssetId
  removeAsset: (id: AssetId) => void
  setActiveAsset: (id: AssetId) => void
  updateAsset: <K extends keyof Asset>(id: AssetId, field: K, value: Asset[K]) => void
  setActiveAssetUrl: (url: string) => void
  setActiveAssetUseSmartCrop: (b: boolean) => void
  setActiveAssetFocal: (focal: { x?: number; y?: number; w?: number; h?: number }) => void
  setActiveAssetContentAwareFocal: (b: boolean) => void
  setActiveAssetFocalFit: (fit: FocalFit) => void

  // Layer actions
  addLayer: (type?: "headline" | "text" | "cta", label?: string) => LayerId
  removeLayer: (id: LayerId) => void
  reorderLayers: (fromIdx: number, toIdx: number) => void
  updateLayerValue: (id: LayerId, value: string) => void
  updateLayerLabel: (id: LayerId, label: string) => void
  updateLayerGap: (id: LayerId, gap: number) => void
  setFieldMapping: (layerId: LayerId, fieldName: string | null) => void

  // Format actions
  addFormat: (label: string, w: number, h: number, x?: number, y?: number) => FormatId
  removeFormat: (id: FormatId) => void
  updateFormat: <K extends keyof Format>(id: FormatId, field: K, value: Format[K]) => void
  setCanvasPosition: (id: FormatId, pos: CanvasPosition) => void
  setLayerAnchor: (formatId: FormatId, layerId: LayerId, anchor: Anchor) => void
  toggleLayerVisibility: (formatId: FormatId, layerId: LayerId) => void
  resolveAnchor: (fmt: Format) => Anchor
  setAssetAnchor: (formatId: FormatId, anchor: Anchor) => void
  hasAssetAnchorOverride: (formatId: FormatId) => boolean

  // Style actions
  updateStyle: <K extends keyof Styles>(key: K, value: Styles[K]) => void

  // Logo
  setLogoUrl: (url: string) => void

  // UI
  setActiveSettingsId: (id: FormatId | null) => void
  setAvailableFields: (fields: AvailableField[]) => void
  setStatus: (msg: string, type?: StatusType) => void
  applyFieldMappings: () => number

  // Persistence
  scheduleSave: () => void
  toSnapshot: () => Snapshot
  hydrateFromSnapshot: (snap: Snapshot | null) => string
  loadSavedState: () => string
}

let saveTimer: ReturnType<typeof setTimeout> | null = null

export const useTemplateBuilder = create<TemplateBuilderState>((set, get) => ({
  layers: JSON.parse(JSON.stringify(DEFAULT_LAYERS)),
  formats: JSON.parse(JSON.stringify(DEFAULT_FORMATS)),
  styles: { ...DEFAULT_STYLES },
  assets: [],
  activeAssetId: "",
  logoUrl: DEFAULT_LOGO,
  canvasPositions: {},

  activeSettingsId: null,
  statusMsg: "",
  statusType: "",
  availableFields: [],

  addAsset: (url = "", label = "") => {
    const id = generateAssetId()
    const asset: Asset = {
      id, url, label,
      focalX: 0.5, focalY: 0.5,
      focalW: 0.30, focalH: 0.30,
      focalFit: "cover",
      contentAwareFocal: false,
      useSmartCrop: false,
    }
    set((s) => ({
      assets: [...s.assets, asset],
      activeAssetId: id,
    }))
    get().scheduleSave()
    return id
  },

  removeAsset: (id) => {
    set((s) => {
      const idx = s.assets.findIndex((a) => a.id === id)
      if (idx === -1) return s
      const nextAssets = s.assets.filter((a) => a.id !== id)
      const nextActive =
        s.activeAssetId === id ? (nextAssets[0]?.id ?? "") : s.activeAssetId
      return { assets: nextAssets, activeAssetId: nextActive }
    })
    get().scheduleSave()
  },

  setActiveAsset: (id) => {
    if (!get().assets.find((a) => a.id === id)) return
    set({ activeAssetId: id })
    // Persist so reload restores the same active asset. Without this, the
    // user could switch asset and reload before any other change fires
    // scheduleSave, losing the selection.
    get().scheduleSave()
  },

  updateAsset: (id, field, value) => {
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, [field]: value } : a)),
    }))
    get().scheduleSave()
  },

  setActiveAssetUrl: (url) => {
    const { activeAssetId, assets, addAsset } = get()
    if (!activeAssetId || !assets.find((a) => a.id === activeAssetId)) {
      if (url) addAsset(url)
      return
    }
    set((s) => ({
      assets: s.assets.map((a) => (a.id === activeAssetId ? { ...a, url } : a)),
    }))
    get().scheduleSave()
  },

  setActiveAssetUseSmartCrop: (b) => {
    const id = get().activeAssetId
    if (!id) return
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, useSmartCrop: b } : a)),
    }))
    get().scheduleSave()
  },

  setActiveAssetFocal: (focal) => {
    const id = get().activeAssetId
    if (!id) return
    set((s) => ({
      assets: s.assets.map((a) => {
        if (a.id !== id) return a
        return {
          ...a,
          focalX: focal.x ?? a.focalX,
          focalY: focal.y ?? a.focalY,
          focalW: focal.w ?? a.focalW,
          focalH: focal.h ?? a.focalH,
        }
      }),
    }))
    get().scheduleSave()
  },

  setActiveAssetContentAwareFocal: (b) => {
    const id = get().activeAssetId
    if (!id) return
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, contentAwareFocal: b } : a)),
    }))
    get().scheduleSave()
  },

  setActiveAssetFocalFit: (fit) => {
    const id = get().activeAssetId
    if (!id) return
    set((s) => ({
      assets: s.assets.map((a) => (a.id === id ? { ...a, focalFit: fit } : a)),
    }))
    get().scheduleSave()
  },

  addLayer: (type = "text", label = "") => {
    const id = `layer_${Date.now().toString(36)}`
    const defaults: Record<string, { label: string; value: string }> = {
      headline: { label: "Headline", value: "" },
      cta: { label: "CTA", value: "" },
      text: { label: label || "Text", value: "" },
    }
    const def = defaults[type] || defaults.text
    const layer: Layer = {
      id, type, label: def.label, value: def.value,
      mappedField: null, gapAfter: DEFAULT_GAP,
    }
    set((s) => ({
      layers: [...s.layers, layer],
      formats: s.formats.map((f) => ({
        ...f,
        visibleLayers: [...(f.visibleLayers ?? []), id],
      })),
    }))
    get().scheduleSave()
    return id
  },

  removeLayer: (id) => {
    set((s) => ({
      layers: s.layers.filter((l) => l.id !== id),
      formats: s.formats.map((f) => ({
        ...f,
        visibleLayers: (f.visibleLayers ?? []).filter((lid) => lid !== id),
      })),
    }))
    get().scheduleSave()
  },

  reorderLayers: (fromIdx, toIdx) => {
    set((s) => {
      const next = [...s.layers]
      const [item] = next.splice(fromIdx, 1)
      next.splice(toIdx, 0, item)
      return { layers: next }
    })
    get().scheduleSave()
  },

  updateLayerValue: (id, value) => {
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, value } : l)),
    }))
    get().scheduleSave()
  },

  updateLayerLabel: (id, label) => {
    set((s) => ({
      layers: s.layers.map((l) => (l.id === id ? { ...l, label } : l)),
    }))
    get().scheduleSave()
  },

  updateLayerGap: (id, gap) => {
    set((s) => ({
      layers: s.layers.map((l) =>
        l.id === id ? { ...l, gapAfter: Math.max(0, gap) } : l,
      ),
    }))
    get().scheduleSave()
  },

  setFieldMapping: (layerId, fieldName) => {
    const matched = fieldName
      ? get().availableFields.find((f) => f.name === fieldName)
      : null
    set((s) => ({
      layers: s.layers.map((l) => {
        if (l.id !== layerId) return l
        const next: Layer = { ...l, mappedField: fieldName ?? null }
        if (matched && matched.value) next.value = matched.value
        return next
      }),
    }))
    get().scheduleSave()
  },

  addFormat: (label, w, h, x, y) => {
    const base = label
      .toLowerCase()
      .replace(/[^a-z0-9]/g, "-")
      .replace(/-+/g, "-")
      .slice(0, 20)
    const id = base + "-" + Date.now().toString(36)
    const visibleLayers = get().layers.map((l) => l.id)
    const fmt: Format = {
      id, label, w, h,
      anchor: "bl",
      layerAnchors: {}, logoAnchor: "",
      visibleLayers,
      logoSize: 0.08, contentScale: 1, contentWidth: 60,
    }
    set((s) => {
      const nextPositions = { ...s.canvasPositions }
      if (x != null && y != null) nextPositions[id] = { x, y }
      return {
        formats: [...s.formats, fmt],
        canvasPositions: nextPositions,
      }
    })
    get().scheduleSave()
    return id
  },

  removeFormat: (id) => {
    set((s) => {
      if (s.formats.length <= 1) return s
      const nextPositions = { ...s.canvasPositions }
      delete nextPositions[id]
      return {
        formats: s.formats.filter((f) => f.id !== id),
        canvasPositions: nextPositions,
        activeSettingsId: s.activeSettingsId === id ? null : s.activeSettingsId,
      }
    })
    get().scheduleSave()
  },

  updateFormat: (id, field, value) => {
    set((s) => ({
      formats: s.formats.map((f) => (f.id === id ? { ...f, [field]: value } : f)),
    }))
    get().scheduleSave()
  },

  setCanvasPosition: (id, pos) => {
    set((s) => ({
      canvasPositions: { ...s.canvasPositions, [id]: pos },
    }))
    get().scheduleSave()
  },

  setLayerAnchor: (formatId, layerId, anchor) => {
    set((s) => ({
      formats: s.formats.map((f) => {
        if (f.id !== formatId) return f
        const layerAnchors = { ...(f.layerAnchors ?? {}) }
        if (!anchor || anchor === f.anchor) {
          delete layerAnchors[layerId]
        } else {
          layerAnchors[layerId] = anchor
        }
        return { ...f, layerAnchors }
      }),
    }))
    get().scheduleSave()
  },

  toggleLayerVisibility: (formatId, layerId) => {
    set((s) => ({
      formats: s.formats.map((f) => {
        if (f.id !== formatId) return f
        const visible = [...(f.visibleLayers ?? [])]
        const idx = visible.indexOf(layerId)
        if (idx !== -1) visible.splice(idx, 1)
        else visible.push(layerId)
        return { ...f, visibleLayers: visible }
      }),
    }))
    get().scheduleSave()
  },

  resolveAnchor: (fmt) => {
    const aid = get().activeAssetId
    if (aid && fmt.assetAnchors?.[aid]) return fmt.assetAnchors[aid]
    return fmt.anchor || "bl"
  },

  setAssetAnchor: (formatId, anchor) => {
    const aid = get().activeAssetId
    if (!aid) return
    set((s) => ({
      formats: s.formats.map((f) => {
        if (f.id !== formatId) return f
        const assetAnchors = { ...(f.assetAnchors ?? {}) }
        if (!anchor || anchor === f.anchor) {
          delete assetAnchors[aid]
        } else {
          assetAnchors[aid] = anchor
        }
        const next: Format = { ...f }
        if (Object.keys(assetAnchors).length > 0) next.assetAnchors = assetAnchors
        else delete next.assetAnchors
        return next
      }),
    }))
    get().scheduleSave()
  },

  hasAssetAnchorOverride: (formatId) => {
    const { formats, activeAssetId } = get()
    const fmt = formats.find((f) => f.id === formatId)
    return !!(fmt?.assetAnchors && activeAssetId && fmt.assetAnchors[activeAssetId])
  },

  updateStyle: (key, value) => {
    set((s) => ({ styles: { ...s.styles, [key]: value } }))
    get().scheduleSave()
  },

  setLogoUrl: (url) => {
    set({ logoUrl: url })
    get().scheduleSave()
  },

  setActiveSettingsId: (id) => set({ activeSettingsId: id }),
  setAvailableFields: (fields) => set({ availableFields: fields }),
  setStatus: (msg, type = "") => set({ statusMsg: msg, statusType: type }),

  applyFieldMappings: () => {
    const { availableFields } = get()
    if (availableFields.length === 0) return 0
    const fieldMap = new Map(availableFields.map((f) => [f.name, f.value]))
    let count = 0
    set((s) => ({
      layers: s.layers.map((l) => {
        if (!l.mappedField) return l
        const val = fieldMap.get(l.mappedField)
        if (val != null && val !== "") {
          count++
          return { ...l, value: val }
        }
        return l
      }),
    }))
    get().scheduleSave()
    return count
  },

  scheduleSave: () => {
    if (saveTimer) clearTimeout(saveTimer)
    saveTimer = setTimeout(() => {
      try {
        useProjectManager.getState().saveProjectSnapshot(get().toSnapshot())
      } catch {
        /* ignore */
      }
    }, 200)
  },

  toSnapshot: () => {
    const s = get()
    return {
      layers: JSON.parse(JSON.stringify(s.layers)),
      formats: JSON.parse(JSON.stringify(s.formats)),
      styles: { ...s.styles },
      assets: JSON.parse(JSON.stringify(s.assets)),
      activeAssetId: s.activeAssetId,
      logoUrl: s.logoUrl,
      canvasPositions: { ...s.canvasPositions },
    }
  },

  hydrateFromSnapshot: (snap) => {
    if (!snap) {
      set({
        layers: JSON.parse(JSON.stringify(DEFAULT_LAYERS)),
        formats: JSON.parse(JSON.stringify(DEFAULT_FORMATS)),
        styles: { ...DEFAULT_STYLES },
        assets: [],
        activeAssetId: "",
        logoUrl: DEFAULT_LOGO,
        canvasPositions: {},
        activeSettingsId: null,
      })
      return ""
    }
    const assets = snap.assets ?? []
    const activeAssetId = snap.activeAssetId || assets[0]?.id || ""
    set({
      layers: snap.layers?.length ? snap.layers : JSON.parse(JSON.stringify(DEFAULT_LAYERS)),
      formats: snap.formats?.length ? snap.formats : JSON.parse(JSON.stringify(DEFAULT_FORMATS)),
      styles: { ...DEFAULT_STYLES, ...(snap.styles ?? {}) },
      assets,
      activeAssetId,
      logoUrl: snap.logoUrl ?? DEFAULT_LOGO,
      canvasPositions: { ...(snap.canvasPositions ?? {}) },
      activeSettingsId: null,
    })
    return assets.find((a) => a.id === activeAssetId)?.url ?? ""
  },

  loadSavedState: () => {
    const pm = useProjectManager.getState()
    if (!pm.activeProjectId) pm.init()
    const activeId = useProjectManager.getState().activeProjectId
    const snap = pm.getProjectSnapshot(activeId)
    return get().hydrateFromSnapshot(snap)
  },
}))

// ── Selectors ────────────────────────────────────────────────────────────

export const selectActiveAsset = (s: TemplateBuilderState): Asset | null =>
  s.assets.find((a) => a.id === s.activeAssetId) ?? null

export const selectSourceUrl = (s: TemplateBuilderState): string =>
  selectActiveAsset(s)?.url ?? ""

export const selectUseSmartCrop = (s: TemplateBuilderState): boolean =>
  selectActiveAsset(s)?.useSmartCrop ?? false

export const selectFocalPoint = (s: TemplateBuilderState) => {
  const a = selectActiveAsset(s)
  return {
    x: a?.focalX ?? 0.5,
    y: a?.focalY ?? 0.5,
    w: a?.focalW ?? 0.30,
    h: a?.focalH ?? 0.30,
  }
}

export const selectContentAwareFocal = (s: TemplateBuilderState): boolean =>
  selectActiveAsset(s)?.contentAwareFocal ?? true

export const selectFocalFit = (s: TemplateBuilderState): FocalFit =>
  selectActiveAsset(s)?.focalFit ?? "cover"

export const selectActiveFormat = (s: TemplateBuilderState): Format | null =>
  s.activeSettingsId
    ? s.formats.find((f) => f.id === s.activeSettingsId) ?? null
    : null

export const selectDrawState = (s: TemplateBuilderState): DrawState => {
  const layerMap: Record<string, Layer> = {}
  for (const l of s.layers) layerMap[l.id] = l
  const focal = selectFocalPoint(s)
  return {
    el: null,
    logo: null,
    headline: layerMap.headline?.value ?? "",
    cta: layerMap.cta?.value ?? "",
    layers: s.layers,
    headlineFont: s.styles.headlineFont,
    headlineFontSize: s.styles.headlineFontSize,
    headlineFontWeight: s.styles.headlineFontWeight,
    headlineColor: s.styles.headlineColor,
    textFont: s.styles.textFont,
    textFontSize: s.styles.textFontSize,
    textFontWeight: s.styles.textFontWeight,
    textColor: s.styles.textColor,
    ctaFont: s.styles.ctaFont,
    ctaFontSize: s.styles.ctaFontSize,
    ctaFontWeight: s.styles.ctaFontWeight,
    ctaTextColor: s.styles.ctaTextColor,
    accentColor: s.styles.accentColor,
    ctaPadH: s.styles.ctaPadH,
    ctaPadV: s.styles.ctaPadV,
    ctaRadius: s.styles.ctaRadius,
    contentGap: s.styles.contentGap,
    overlayColor: s.styles.overlayColor,
    overlayOpacity: s.styles.overlayOpacity,
    bgMode: s.styles.bgMode,
    bgColor1: s.styles.bgColor1,
    bgColor2: s.styles.bgColor2,
    bgAngle: s.styles.bgAngle,
    bgDistance: s.styles.bgDistance,
    focalX: focal.x,
    focalY: focal.y,
    focalW: focal.w,
    focalH: focal.h,
    contentAwareFocal: selectContentAwareFocal(s),
    focalFit: selectFocalFit(s),
  }
}
