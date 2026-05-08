// CDN URL building utilities — used by the Templates renderer for smart-crop
// URL construction and by exporters that fetch sized renditions.

export function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b)
}

export function stripParams(url: string): string {
  try {
    return url.split("?")[0]
  } catch {
    return url
  }
}

export interface BuildUrlOptions {
  w: number
  h?: number
  q?: number
  fit?: string
  smart?: boolean
  fm?: string
}

export function buildUrl(base: string, opts: BuildUrlOptions): string {
  if (!base) return ""
  const { w, h = 0, q, fit, smart, fm } = opts
  const parts: string[] = []
  const useSmartCrop = smart && fit === "crop" && w > 0 && h > 0

  if (useSmartCrop) {
    if (w > 0) parts.push(`width=${w}`)
    const d = gcd(w, h)
    parts.push(`crop=${w / d}:${h / d},smart`)
  } else {
    if (w && w > 0) parts.push(`width=${w}`)
    if (h && h > 0) parts.push(`height=${h}`)
    if (fit) parts.push(`fit=${fit}`)
  }

  if (q && q !== 80) parts.push(`quality=${q}`)
  if (fm) parts.push(`format=${fm}`)
  const sep = base.includes("?") ? "&" : "?"
  return parts.length ? `${base}${sep}${parts.join("&")}` : base
}

export interface SlotParams {
  w: number
  h?: number
  q?: number
  fit?: string
  smart?: boolean
  fm?: string
}

export function buildSlotUrl(base: string, slotParams: SlotParams): string {
  return buildUrl(base, {
    w: slotParams.w,
    h: slotParams.h ?? 0,
    q: slotParams.q ?? 80,
    fit: slotParams.fit ?? "crop",
    smart: slotParams.smart !== false,
    fm: slotParams.fm ?? "",
  })
}
