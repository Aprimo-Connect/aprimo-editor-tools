"use client"

import { useEffect, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { Expander } from "aprimo-js"
import type { Record as AprimoRecord, FileVersion } from "aprimo-js/model"

function MyItemContent() {
  const searchParams = useSearchParams()
  const recordId = searchParams.get("record")
  const { client, isConnected } = useAprimo()

  useEffect(() => {
    if (!recordId || !client || !isConnected) return

    async function fetchAsset() {
      // Fetch all field definitions
      const allFieldDefs: unknown[] = []
      for await (const result of client!.fieldDefinitions.getPaged()) {
        if (!result.ok) break
        allFieldDefs.push(...(result.data?.items ?? []))
      }
      console.log("[my-item] fieldDefinitions:", allFieldDefs)

      // Fetch the record with all expandable data
      const expander = Expander.create()
        .for<AprimoRecord>("Record").expand("fields", "masterfilelatestversion", "classifications")
        .for<FileVersion>("FileVersion").expand("thumbnail", "preview")

      const result = await client!.records.getById(recordId!, expander)

      if (!result.ok) {
        console.error("[my-item] failed to fetch record:", result.error)
        return
      }

      const record = result.data as any
      if (!record) {
        console.warn("[my-item] record not found:", recordId)
        return
      }

      console.log("[my-item] record:", record)
      console.log("[my-item] record.fields.items:", record.fields?.items)
      console.log("[my-item] record.masterFileLatestVersion:", record.masterFileLatestVersion)
      console.log("[my-item] record.classifications.items:", record.classifications?.items)
    }

    fetchAsset()
  }, [recordId, client, isConnected])

  return (
    <main className="p-8">
      {recordId
        ? <p className="text-sm text-muted-foreground font-mono">{recordId}</p>
        : <p className="text-sm text-muted-foreground">No record ID provided.</p>}
    </main>
  )
}

export default function MyItemPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <Suspense>
        <MyItemContent />
      </Suspense>
      <Footer />
    </div>
  )
}
