"use client"

import { useState, useEffect } from "react"
import { Expander } from "aprimo-js"
import type { Record as AprimoRecord, File as AprimoFile } from "aprimo-js/model"

interface UseVideoRecordResult {
  videoUrl: string | null
  loading: boolean
  loadingMessage: string
  error: string | null
  masterFileId: string | null
  latestVersionId: string | null
}

export function useVideoRecord(
  recordId: string | null,
  client: any,
  isConnected: boolean
): UseVideoRecordResult {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadingMessage, setLoadingMessage] = useState("Loading…")
  const [error, setError] = useState<string | null>(null)
  const [masterFileId, setMasterFileId] = useState<string | null>(null)
  const [latestVersionId, setLatestVersionId] = useState<string | null>(null)

  useEffect(() => {
    if (!isConnected || !client || !recordId) return

    async function loadRecord() {
      setLoading(true)
      setError(null)
      try {
        setLoadingMessage("Loading record…")
        const expander = Expander.create()
          .for<AprimoRecord>("Record").expand("masterfile")
          .for<AprimoFile>("File").expand("fileversions")

        const result = await client.records.getById(recordId!, expander)
        if (!result.ok) throw new Error(result.error?.message ?? "Failed to load record")

        const record = result.data as any
        if (!record) throw new Error("Record not found")

        const masterFile = record._embedded?.masterfile
        const versions: any[] = masterFile?._embedded?.fileversions?.items ?? []
        const latestVersion = versions.find((v: any) => v.isLatest)
        if (masterFile?.id) setMasterFileId(masterFile.id)
        if (latestVersion?.id) setLatestVersionId(latestVersion.id)

        setLoadingMessage("Creating download order…")
        const orderRes = await client.orders.create({
          type: "download",
          targets: [
            {
              recordId,
              targetTypes: ["Document"],
              assetType: "LatestVersionOfMasterFile",
            } as never,
          ],
        })
        if (!orderRes.ok || !orderRes.data) {
          throw new Error(orderRes.error?.message ?? "Failed to create download order")
        }

        const orderId = orderRes.data.id

        for (let attempt = 0; attempt < 60; attempt++) {
          await new Promise((r) => setTimeout(r, 1000))
          setLoadingMessage(`Preparing video… (${attempt + 1}s)`)

          const pollRes = await client.orders.getById(orderId)
          const order = pollRes.data
          if (!order) continue

          if (order.status === "Failed") throw new Error("Download order failed")

          if (order.status === "Completed" || order.status === "Success") {
            const delivered = (order as unknown as { deliveredFiles?: string[] }).deliveredFiles
            if (Array.isArray(delivered) && delivered.length > 0) {
              setVideoUrl(delivered[0])
              return
            }

            try {
              const dlRes = await client.downloadLinks.getById(orderId)
              const url = (dlRes.data as unknown as { deliveredFiles?: string[] })?.deliveredFiles?.[0]
              if (url) { setVideoUrl(url); return }
            } catch { /* keep polling */ }
          }
        }

        throw new Error("Download order timed out")
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load video")
      } finally {
        setLoading(false)
      }
    }

    loadRecord()
  }, [isConnected, client, recordId])

  return { videoUrl, loading, loadingMessage, error, masterFileId, latestVersionId }
}
