"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { buildSmartCropUrl } from "../lib/renderer"
import { VIDEO_LOAD_TIMEOUT } from "../lib/constants"
import {
  useTemplateBuilder,
  selectSourceUrl,
  selectUseSmartCrop,
} from "../stores/use-template-builder"
import type { FormatId } from "../types"

export type SourceType = "image" | "video"

export interface SourceLoaderCallbacks {
  onImageLoaded?: (img: HTMLImageElement, url: string) => void
  onVideoReady?: () => void
}

export interface SourceLoader {
  sourceType: SourceType
  sourceEl: HTMLImageElement | HTMLVideoElement | null
  sourceReady: boolean
  sourceLoading: boolean
  croppedEls: Record<FormatId, HTMLImageElement>
  hiddenVideoRef: React.RefObject<HTMLVideoElement | null>

  isVideoUrl: (url: string) => boolean
  loadSource: (callbacks?: SourceLoaderCallbacks) => void
  loadSmartCrops: (baseUrl: string) => void
  loadSmartCropForFormat: (
    baseUrl: string,
    formatId: FormatId,
    w: number,
    h: number,
    onLoaded?: () => void,
  ) => void
  reloadSmartCrop: (
    formatId: FormatId,
    w: number,
    h: number,
    onLoaded?: () => void,
  ) => void
  startVideoLoop: (renderFn: () => void) => void
  stopVideoLoop: () => void
  clearCroppedEls: () => void
  reset: () => void
}

export function useSourceLoader(): SourceLoader {
  const [sourceType, setSourceType] = useState<SourceType>("image")
  const [sourceEl, setSourceEl] = useState<HTMLImageElement | HTMLVideoElement | null>(null)
  const [sourceReady, setSourceReady] = useState(false)
  const [sourceLoading, setSourceLoading] = useState(false)
  const [croppedEls, setCroppedEls] = useState<Record<FormatId, HTMLImageElement>>({})

  const hiddenVideoRef = useRef<HTMLVideoElement | null>(null)
  const animFrameRef = useRef<number | null>(null)

  // Refs that mirror state for reads inside callbacks (avoids stale-closure
  // bugs without re-creating callbacks on every render).
  const sourceReadyRef = useRef(sourceReady)
  sourceReadyRef.current = sourceReady
  const sourceLoadingRef = useRef(sourceLoading)
  sourceLoadingRef.current = sourceLoading
  const sourceTypeRef = useRef(sourceType)
  sourceTypeRef.current = sourceType

  const isVideoUrl = useCallback((url: string): boolean => {
    return /\.(mp4|webm|mov|m4v|ogv)(\?|$)/i.test(url) || url.includes("/video/")
  }, [])

  const clearCroppedEls = useCallback(() => {
    setCroppedEls({})
  }, [])

  const stopVideoLoop = useCallback(() => {
    if (animFrameRef.current != null) {
      cancelAnimationFrame(animFrameRef.current)
      animFrameRef.current = null
    }
  }, [])

  const loadSmartCropForFormat = useCallback(
    (
      baseUrl: string,
      formatId: FormatId,
      w: number,
      h: number,
      onLoaded?: () => void,
    ) => {
      const cropUrl = buildSmartCropUrl(baseUrl, w, h)
      if (!cropUrl) return
      const img = new Image()
      img.crossOrigin = "anonymous"
      img.onload = () => {
        setCroppedEls((prev) => ({ ...prev, [formatId]: img }))
        onLoaded?.()
      }
      img.src = cropUrl
    },
    [],
  )

  const loadSmartCrops = useCallback(
    (baseUrl: string) => {
      clearCroppedEls()
      const state = useTemplateBuilder.getState()
      if (!selectUseSmartCrop(state)) return
      for (const fmt of state.formats) {
        loadSmartCropForFormat(baseUrl, fmt.id, fmt.w, fmt.h)
      }
    },
    [clearCroppedEls, loadSmartCropForFormat],
  )

  const reloadSmartCrop = useCallback(
    (
      formatId: FormatId,
      w: number,
      h: number,
      onLoaded?: () => void,
    ) => {
      const state = useTemplateBuilder.getState()
      if (
        !sourceReadyRef.current ||
        !selectUseSmartCrop(state) ||
        sourceTypeRef.current !== "image"
      ) {
        return
      }
      const baseUrl = selectSourceUrl(state).trim()
      if (!baseUrl) return
      loadSmartCropForFormat(baseUrl, formatId, w, h, onLoaded)
    },
    [loadSmartCropForFormat],
  )

  const loadSource = useCallback(
    (callbacks: SourceLoaderCallbacks = {}) => {
      const state = useTemplateBuilder.getState()
      const url = selectSourceUrl(state).trim()
      if (!url) return

      stopVideoLoop()
      setSourceReady(false)
      setSourceLoading(true)

      const type: SourceType = isVideoUrl(url) ? "video" : "image"
      setSourceType(type)
      clearCroppedEls()
      state.setStatus("Loading...", "load")

      if (type === "image") {
        const img = new Image()
        img.crossOrigin = "anonymous"
        img.onload = () => {
          setSourceEl(img)
          setSourceReady(true)
          setSourceLoading(false)
          useTemplateBuilder
            .getState()
            .setStatus(
              `✓ Image loaded (${img.naturalWidth}×${img.naturalHeight})`,
              "ok",
            )
          callbacks.onImageLoaded?.(img, url)
        }
        img.onerror = () => {
          setSourceLoading(false)
          useTemplateBuilder
            .getState()
            .setStatus("Could not load image — check URL", "err")
        }
        img.src = url
      } else {
        const video = hiddenVideoRef.current
        if (!video) return
        video.src = url
        video.crossOrigin = "anonymous"
        video.load()

        const onReady = () => {
          video.oncanplay = null
          setSourceEl(video)
          setSourceReady(true)
          setSourceLoading(false)
          useTemplateBuilder.getState().setStatus("▶ Video playing", "ok")
          video.play().catch(() => {})
          callbacks.onVideoReady?.()
        }
        video.oncanplay = onReady
        video.onerror = () => {
          setSourceLoading(false)
          useTemplateBuilder
            .getState()
            .setStatus("Could not load video — check URL", "err")
        }

        setTimeout(() => {
          if (!sourceReadyRef.current && sourceLoadingRef.current) {
            setSourceLoading(false)
            useTemplateBuilder
              .getState()
              .setStatus("Timeout loading video", "err")
          }
        }, VIDEO_LOAD_TIMEOUT)
      }
    },
    [isVideoUrl, clearCroppedEls, stopVideoLoop],
  )

  const startVideoLoop = useCallback(
    (renderFn: () => void) => {
      stopVideoLoop()
      const loop = () => {
        renderFn()
        animFrameRef.current = requestAnimationFrame(loop)
      }
      animFrameRef.current = requestAnimationFrame(loop)
    },
    [stopVideoLoop],
  )

  const reset = useCallback(() => {
    stopVideoLoop()
    setSourceEl(null)
    setSourceReady(false)
    setSourceLoading(false)
    setSourceType("image")
    clearCroppedEls()
  }, [stopVideoLoop, clearCroppedEls])

  // Cleanup any pending RAF on unmount.
  useEffect(() => {
    return () => {
      if (animFrameRef.current != null) cancelAnimationFrame(animFrameRef.current)
    }
  }, [])

  return {
    sourceType,
    sourceEl,
    sourceReady,
    sourceLoading,
    croppedEls,
    hiddenVideoRef,
    isVideoUrl,
    loadSource,
    loadSmartCrops,
    loadSmartCropForFormat,
    reloadSmartCrop,
    startVideoLoop,
    stopVideoLoop,
    clearCroppedEls,
    reset,
  }
}
