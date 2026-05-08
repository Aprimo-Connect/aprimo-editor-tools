// Google Fonts loader for canvas rendering. Loads families on demand and
// resolves once `document.fonts.check()` confirms the font file is ready
// to use — necessary because canvas drawing happens off-DOM and won't
// trigger the usual font-fallback round-trip.

export const FONT_WEIGHTS: Record<string, number[]> = {
  Inter: [300, 400, 500, 600, 700, 900],
  Roboto: [300, 400, 500, 600, 700, 900],
  "Open Sans": [300, 400, 500, 600, 700],
  Lato: [300, 400, 700, 900],
  Montserrat: [300, 400, 500, 600, 700, 900],
  Poppins: [300, 400, 500, 600, 700, 900],
  Raleway: [300, 400, 500, 600, 700, 900],
  Oswald: [300, 400, 500, 600, 700],
  "Playfair Display": [400, 500, 600, 700, 900],
  Merriweather: [300, 400, 500, 600, 700, 900],
  "Source Sans 3": [300, 400, 500, 600, 700, 900],
  Nunito: [300, 400, 500, 600, 700, 900],
  Rubik: [300, 400, 500, 600, 700, 900],
  "Work Sans": [300, 400, 500, 600, 700, 900],
  "DM Sans": [300, 400, 500, 600, 700, 900],
  Outfit: [300, 400, 500, 600, 700, 900],
  Manrope: [300, 400, 500, 600, 700],
  "Space Grotesk": [300, 400, 500, 600, 700],
  "Plus Jakarta Sans": [300, 400, 500, 600, 700],
  Sora: [300, 400, 500, 600, 700],
  Barlow: [300, 400, 500, 600, 700, 900],
  "Bebas Neue": [400],
  Archivo: [300, 400, 500, 600, 700, 900],
  "Libre Franklin": [300, 400, 500, 600, 700, 900],
  "Fira Sans": [300, 400, 500, 600, 700, 900],
  "Crimson Text": [400, 600, 700],
  "PT Sans": [400, 700],
  "IBM Plex Sans": [300, 400, 500, 600, 700],
  Bitter: [300, 400, 500, 600, 700, 900],
  "Josefin Sans": [300, 400, 500, 600, 700],
  "Noto Sans": [300, 400, 500, 600, 700, 900],
  Kanit: [300, 400, 500, 600, 700, 900],
  Quicksand: [300, 400, 500, 600, 700],
  Mulish: [300, 400, 500, 600, 700, 900],
  Lexend: [300, 400, 500, 600, 700, 900],
}

export const FONT_LIST: string[] = Object.keys(FONT_WEIGHTS)

export function nearestWeight(family: string, targetWeight: string | number): string {
  const weights = FONT_WEIGHTS[family]
  if (!weights) return String(targetWeight)
  const tw = typeof targetWeight === "number" ? targetWeight : parseInt(targetWeight)
  if (weights.includes(tw)) return String(tw)
  let best = weights[0]
  let bestDist = Math.abs(tw - best)
  for (const w of weights) {
    const d = Math.abs(tw - w)
    if (d < bestDist || (d === bestDist && w > best)) {
      best = w
      bestDist = d
    }
  }
  return String(best)
}

export function hasWeight(family: string, weight: string | number): boolean {
  const weights = FONT_WEIGHTS[family]
  if (!weights) return true
  const w = typeof weight === "number" ? weight : parseInt(weight)
  return weights.includes(w)
}

const readyFamilies = new Set<string>()
const pendingLoads = new Map<string, Promise<void>>()

/**
 * Load a Google Font family (all common weights at once). Resolves when the
 * font is ready for canvas use. The `_weight` argument is accepted for API
 * compat but ignored — all weights are loaded together.
 */
export function loadFont(family: string, _weight: string | number = "400"): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve()
  if (family === "Inter") return Promise.resolve()
  if (readyFamilies.has(family)) return Promise.resolve()
  const inflight = pendingLoads.get(family)
  if (inflight) return inflight

  const promise = new Promise<void>((resolve) => {
    const weights = FONT_WEIGHTS[family] ?? [400]
    const wgts = weights.join(";")
    const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family)}:wght@${wgts}&display=swap`

    let link = document.querySelector<HTMLLinkElement>(`link[href="${url}"]`)
    const needsInject = !link

    if (needsInject) {
      link = document.createElement("link")
      link.rel = "stylesheet"
      link.href = url
    }

    function onStylesheetReady() {
      const check = `400 16px "${family}"`
      const tryResolve = (attempts = 0) => {
        if (document.fonts.check(check)) {
          readyFamilies.add(family)
          pendingLoads.delete(family)
          resolve()
        } else if (attempts > 80) {
          // Safety timeout (~5s) — resolve anyway so UI isn't stuck.
          readyFamilies.add(family)
          pendingLoads.delete(family)
          resolve()
        } else {
          setTimeout(() => tryResolve(attempts + 1), 60)
        }
      }
      document.fonts
        .load(check)
        .then(() => {
          if (document.fonts.check(check)) {
            readyFamilies.add(family)
            pendingLoads.delete(family)
            resolve()
          } else {
            tryResolve()
          }
        })
        .catch(() => {
          tryResolve()
        })
    }

    if (needsInject && link) {
      link.onload = onStylesheetReady
      link.onerror = () => {
        readyFamilies.add(family)
        pendingLoads.delete(family)
        resolve()
      }
      document.head.appendChild(link)
    } else {
      onStylesheetReady()
    }
  })

  pendingLoads.set(family, promise)
  return promise
}

/**
 * Ensure a specific weight's font file is downloaded and ready. The
 * stylesheet must already be injected (via loadFont). Uses
 * `document.fonts.load()` to trigger the browser to fetch that weight.
 */
export async function ensureWeight(family: string, weight: string | number = "400"): Promise<void> {
  if (typeof window === "undefined") return
  if (family === "Inter") return
  await loadFont(family)
  const check = `${weight} 16px "${family}"`
  if (document.fonts.check(check)) return
  try {
    await document.fonts.load(check)
  } catch {
    /* weight may not exist; browser uses nearest */
  }
  await document.fonts.ready
}

/**
 * Ensure the three template fonts (headline / text / cta) plus their active
 * weights are loaded. Resolves only when all are ready.
 */
export async function loadTemplateFonts(
  headlineFont?: string,
  textFont?: string,
  ctaFont?: string,
  hw?: string | number,
  tw?: string | number,
  cw?: string | number,
): Promise<void> {
  const loads: Promise<void>[] = []
  if (headlineFont) loads.push(loadFont(headlineFont))
  if (textFont) loads.push(loadFont(textFont))
  if (ctaFont) loads.push(loadFont(ctaFont))
  await Promise.all(loads)
  const weightLoads: Promise<void>[] = []
  if (headlineFont && hw != null) weightLoads.push(ensureWeight(headlineFont, hw))
  if (textFont && tw != null) weightLoads.push(ensureWeight(textFont, tw))
  if (ctaFont && cw != null) weightLoads.push(ensureWeight(ctaFont, cw))
  await Promise.all(weightLoads)
}

export function isFontReady(family: string, _weight: string | number = "400"): boolean {
  if (family === "Inter") return true
  return readyFamilies.has(family)
}
