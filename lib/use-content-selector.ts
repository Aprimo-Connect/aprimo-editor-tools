"use client"

import { useCallback, useEffect, useRef } from "react"
import { useAprimo } from "@/context/aprimo-context"

export interface SelectedRecord {
  id: string
  title?: string
  publicContentUri?: string
  [key: string]: unknown
}

export interface UseContentSelectorOptions {
  onAccept: (selection: SelectedRecord[]) => void
  onCancel?: () => void
  select?: "single" | "multiple" | "singlerendition"
  width?: number
  height?: number
}

export function useContentSelector({
  onAccept,
  onCancel,
  select = "multiple",
  width = 1200,
  height = 800,
}: UseContentSelectorOptions) {
  const { connection, isConnected } = useAprimo()
  const popupRef = useRef<Window | null>(null)
  const callbacksRef = useRef({ onAccept, onCancel })

  useEffect(() => {
    callbacksRef.current = { onAccept, onCancel }
  }, [onAccept, onCancel])

  useEffect(() => {
    if (!connection) return
    const tenantUrl = `https://${connection.environment}.dam.aprimo.com`

    function handleMessage(event: MessageEvent) {
      if (event.origin !== tenantUrl) return
      const data =
        typeof event.data === "string" ? safeParseJson(event.data) : event.data
      if (!data || typeof data !== "object") return

      const result = (data as { result?: string }).result
      if (result === "cancel") {
        closePopup()
        callbacksRef.current.onCancel?.()
        return
      }
      if (result !== "accept") return

      const selection = (data as { selection?: SelectedRecord[] }).selection
      const records = Array.isArray(selection) ? selection : []
      closePopup()
      if (records.length > 0) callbacksRef.current.onAccept(records)
    }

    window.addEventListener("message", handleMessage)
    return () => {
      window.removeEventListener("message", handleMessage)
      closePopup()
    }
  }, [connection])

  const open = useCallback(() => {
    if (!connection) return
    const tenantUrl = `https://${connection.environment}.dam.aprimo.com`
    const options = { targetOrigin: window.location.origin, select }
    const encoded = window.btoa(JSON.stringify(options))
    const url = `${tenantUrl}/dam/selectcontent#options=${encoded}`
    const left = Math.round((screen.width - width) / 2)
    const top = Math.round((screen.height - height) / 2)
    popupRef.current = window.open(
      url,
      "aprimo-content-selector",
      `width=${width},height=${height},left=${left},top=${top},resizable=yes,scrollbars=yes`,
    )
    if (!popupRef.current) {
      console.warn("[content-selector] popup was blocked")
    }
  }, [connection, select, width, height])

  function closePopup() {
    if (popupRef.current && !popupRef.current.closed) popupRef.current.close()
    popupRef.current = null
  }

  return { open, canOpen: isConnected }
}

function safeParseJson(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
