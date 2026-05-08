"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { LOGO_DEBOUNCE_MS } from "../lib/constants"
import { useTemplateBuilder } from "../stores/use-template-builder"

export interface LogoLoader {
  logoEl: HTMLImageElement | null
  loadLogoImg: (url: string) => void
  scheduleLogoLoad: () => void
  clearLogo: () => void
}

/**
 * Logo loader — single-strategy CORS load.
 *
 * Loads via `<img crossorigin="anonymous">`. If the URL doesn't support
 * CORS, the image fails and `logoEl` becomes null. The user picks a
 * CORS-friendly URL or no logo.
 *
 * The original Vue version had a four-strategy fallback chain (CORS img →
 * fetch+blob → backend proxy → no-CORS display-only). Strategy 3 needed a
 * backend the host doesn't have, and strategy 4 tainted the canvas which
 * broke exports — for our port we just stay clean and skip CORS-blocked
 * logos.
 */
export function useLogoLoader(): LogoLoader {
  const [logoEl, setLogoEl] = useState<HTMLImageElement | null>(null)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const logoUrl = useTemplateBuilder((s) => s.logoUrl)

  const loadLogoImg = useCallback((url: string) => {
    const img = new Image()
    img.crossOrigin = "anonymous"
    img.onload = () => setLogoEl(img)
    img.onerror = () => setLogoEl(null)
    img.src = url
  }, [])

  const scheduleLogoLoad = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      const url = useTemplateBuilder.getState().logoUrl.trim()
      if (!url) {
        setLogoEl(null)
        return
      }
      loadLogoImg(url)
    }, LOGO_DEBOUNCE_MS)
  }, [loadLogoImg])

  const clearLogo = useCallback(() => {
    useTemplateBuilder.getState().setLogoUrl("")
    setLogoEl(null)
  }, [])

  useEffect(() => {
    scheduleLogoLoad()
  }, [logoUrl, scheduleLogoLoad])

  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    }
  }, [])

  return {
    logoEl,
    loadLogoImg,
    scheduleLogoLoad,
    clearLogo,
  }
}
