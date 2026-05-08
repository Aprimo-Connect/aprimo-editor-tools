"use client"

import { useCallback } from "react"
import { Expander } from "aprimo-js"
import { useAprimo } from "@/context/aprimo-context"
import type { AvailableField } from "../types"

// ── Base metadata structure ─────────────────────────────────────────────
//
// `useRecordFields` is the single point through which the Templates module
// reads record metadata from Aprimo. It calls `client.search.records` with
// a `fields` expander, then flattens each field's first localized value
// into a `{ name, value }` pair suitable for layer auto-mapping.
//
// Future use cases (a metadata-editor module, a sidebar showing all fields,
// localization-aware reads) can build on the same hook by extending what's
// returned — the calling code plugs into the existing
// `availableFields` / `applyFieldMappings` flow on the templateBuilder
// store, so adding a new consumer doesn't require new infrastructure.

interface RawLocalizedValue {
  languageId?: string
  value?: string | number | boolean | null
  values?: string[]
}

interface RawField {
  fieldName?: string
  id?: string
  dataType?: string
  localizedValues?: RawLocalizedValue[]
}

interface RawRecord {
  fields?: { items?: RawField[] }
}

function flattenFieldValue(field: RawField): string {
  const v = field.localizedValues?.[0]
  if (!v) return ""
  if (v.value != null && v.value !== "") return String(v.value)
  if (v.values && v.values.length > 0) return v.values.join(", ")
  return ""
}

export function useRecordFields() {
  const { client } = useAprimo()

  /**
   * Fetch a single record by ID and return its fields as a flat
   * `{ name, value }[]` array. Empty array on failure or if the record
   * has no readable fields.
   */
  const fetchRecordFields = useCallback(
    async (recordId: string): Promise<AvailableField[]> => {
      if (!client || !recordId) return []

      const expander = Expander.create()
      ;(expander.for("record") as { expand: (...f: string[]) => unknown }).expand("fields")

      const result = await client.search.records(
        { searchExpression: { expression: `id='${recordId}'` } },
        expander,
      )
      if (!result.ok) return []

      const record = (result.data as { items?: RawRecord[] })?.items?.[0]
      const items = record?.fields?.items ?? []

      return items
        .map((f): AvailableField | null => {
          if (!f.fieldName) return null
          const value = flattenFieldValue(f)
          if (!value) return null
          return { name: f.fieldName, value }
        })
        .filter((f): f is AvailableField => f !== null)
    },
    [client],
  )

  return { fetchRecordFields }
}
