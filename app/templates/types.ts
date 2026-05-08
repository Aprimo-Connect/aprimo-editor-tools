export type LayerType = "headline" | "text" | "cta"
export type LayerId = string
export type FormatId = string
export type AssetId = string

export type Anchor =
  | "tl" | "tc" | "tr"
  | "cl" | "cc" | "cr"
  | "bl" | "bc" | "br"
  | ""

export interface Layer {
  id: LayerId
  type: LayerType
  label: string
  value: string
  mappedField: string | null
  gapAfter: number
}

export interface Format {
  id: FormatId
  label: string
  w: number
  h: number
  anchor: Anchor
  layerAnchors: Record<LayerId, Anchor>
  logoAnchor: Anchor
  visibleLayers: LayerId[]
  logoSize: number
  contentScale: number
  contentWidth: number
  ctaScale?: number
  padding?: number
  assetAnchors?: Record<AssetId, Anchor>
}

export interface Styles {
  headlineFont: string
  headlineFontSize: number
  headlineFontWeight: string
  headlineColor: string
  textFont: string
  textFontSize: number
  textFontWeight: string
  textColor: string
  ctaFont: string
  ctaFontSize: number
  ctaFontWeight: string
  ctaTextColor: string
  accentColor: string
  ctaPadH: number
  ctaPadV: number
  ctaRadius: number
  contentGap: number
  overlayColor: string
  overlayOpacity: number
  bgMode: "none" | "color" | "linear" | "radial"
  bgColor1: string
  bgColor2: string
  bgAngle: number
  bgDistance: number
}

export type FocalFit = "cover" | "contain" | "safe"

export interface Asset {
  id: AssetId
  url: string
  label: string
  focalX: number
  focalY: number
  focalW: number
  focalH: number
  focalFit: FocalFit
  contentAwareFocal: boolean
  useSmartCrop: boolean
}

export interface CanvasPosition {
  x: number
  y: number
}

export interface Snapshot {
  layers: Layer[]
  formats: Format[]
  styles: Styles
  assets: Asset[]
  activeAssetId: AssetId | ""
  logoUrl: string
  canvasPositions: Record<FormatId, CanvasPosition>
}

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  snapshot: Snapshot | null
}

export interface AvailableField {
  name: string
  value: string
}

export interface DrawState {
  el: HTMLImageElement | HTMLVideoElement | null
  logo: HTMLImageElement | null
  headline: string
  cta: string
  layers: Layer[]
  headlineFont: string
  headlineFontSize: number
  headlineFontWeight: string
  headlineColor: string
  textFont: string
  textFontSize: number
  textFontWeight: string
  textColor: string
  ctaFont: string
  ctaFontSize: number
  ctaFontWeight: string
  ctaTextColor: string
  accentColor: string
  ctaPadH: number
  ctaPadV: number
  ctaRadius: number
  contentGap: number
  overlayColor: string
  overlayOpacity: number
  bgMode: Styles["bgMode"]
  bgColor1: string
  bgColor2: string
  bgAngle: number
  bgDistance: number
  focalX: number
  focalY: number
  focalW: number
  focalH: number
  contentAwareFocal: boolean
  focalFit: FocalFit
  _sourceUrlOverride?: string
  _logoUrlOverride?: string
}
