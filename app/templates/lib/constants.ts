// Infinite canvas zoom limits and defaults.
export const MIN_ZOOM = 0.02
export const MAX_ZOOM = 4.0
export const DEFAULT_ZOOM = 1.0
export const ZOOM_STEP = 1.08
export const CARD_GAP = 80

// Video loading timeout (ms).
export const VIDEO_LOAD_TIMEOUT = 12_000

// Blob URL revocation delay (ms).
export const BLOB_REVOKE_DELAY = 30_000

// Logo URL debounce delay (ms).
export const LOGO_DEBOUNCE_MS = 500

// Default per-format properties — used by reset-to-default and duplicate.
export const DEFAULT_FORMAT_PROPS = {
  anchor: "bl",
  layerAnchors: {},
  logoAnchor: "",
  logoSize: 0.08,
  contentScale: 1,
  contentWidth: 60,
  ctaScale: 1,
  padding: 0,
} as const
