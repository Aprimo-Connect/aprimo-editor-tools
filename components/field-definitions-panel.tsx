"use client"

import { useState, useMemo, useEffect } from "react"
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { ChevronDown, ChevronUp, Search, X } from "lucide-react"
import type { AprimoRecord, FieldDef } from "@/models/aprimo"

interface FieldDefinitionsPanelProps {
  fieldDefs: FieldDef[]
  selectedFields: Set<string>
  tableFields: string[]
  toggleField: (name: string) => void
  recordIds: string[]
  fetchRecords: (ids: string[], fields: string[]) => Promise<AprimoRecord[]>
  setRecords: (records: AprimoRecord[]) => void
  setTableFields: (fields: string[]) => void
  setError: (error: string | null) => void
}

export function FieldDefinitionsPanel({
  fieldDefs,
  selectedFields,
  tableFields,
  toggleField,
  recordIds,
  fetchRecords,
  setRecords,
  setTableFields,
  setError,
}: FieldDefinitionsPanelProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState("")
  const [showReadOnly, setShowReadOnly] = useState(false)
  const [activeTab, setActiveTab] = useState("__all__")

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return fieldDefs.filter((d) => {
      if (!showReadOnly && d.isReadOnly) return false
      return !q || (d.label || d.name).toLowerCase().includes(q)
    })
  }, [fieldDefs, search, showReadOnly])

  const grouped = useMemo(() =>
    Object.entries(
      filtered.reduce<Record<string, FieldDef[]>>((groups, def) => {
        const key = def.dataType ?? "Other"
        ;(groups[key] ??= []).push(def)
        return groups
      }, {})
    ).sort(([a], [b]) => a.localeCompare(b)),
    [filtered]
  )

  // If filtering removes the active type's tab, fall back to "All".
  useEffect(() => {
    if (activeTab !== "__all__" && !grouped.some(([dt]) => dt === activeTab)) {
      setActiveTab("__all__")
    }
  }, [grouped, activeTab])

  const selectedDefs = fieldDefs.filter((d) => selectedFields.has(d.name))

  const renderFieldGrid = (defs: FieldDef[]) => (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
      {defs.map((def) => (
        <div key={def.id} className="flex items-center gap-2">
          <Checkbox
            id={def.id}
            checked={selectedFields.has(def.name)}
            onCheckedChange={() => toggleField(def.name)}
          />
          <Label htmlFor={def.id} className="text-xs cursor-pointer truncate leading-tight" title={def.label || def.name}>
            {def.label || def.name}
          </Label>
        </div>
      ))}
    </div>
  )

  const selectionChanged = useMemo(() => {
    const applied = new Set(tableFields)
    if (applied.size !== selectedFields.size) return true
    for (const f of selectedFields) if (!applied.has(f)) return true
    return false
  }, [selectedFields, tableFields])

  if (fieldDefs.length === 0) return null

  async function handleAddToTable() {
    const fields = Array.from(selectedFields)
    setTableFields(fields)
    setOpen(false)
    setError(null)
    try {
      const fetched = await fetchRecords(recordIds, fields)
      setRecords(fetched)
    } catch (err) {
      setError(err instanceof Error ? err.message : "Reload failed")
    }
  }

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="relative mb-6 print:hidden">
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/10"
          onClick={() => setOpen(false)}
        />
      )}
      <CollapsibleTrigger className="relative z-50 flex w-full items-center justify-between rounded-lg border bg-background px-4 py-3 text-sm font-medium">
        <span className="flex items-center gap-2">
          Field Definitions
          <Badge variant="secondary" className="text-xs font-normal">{fieldDefs.length}</Badge>
          {selectedFields.size > 0 && (
            <Badge className="text-xs font-normal">{selectedFields.size} selected</Badge>
          )}
        </span>
        {open ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
      </CollapsibleTrigger>

      <CollapsibleContent className="absolute left-0 right-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-background shadow-lg">
        <div className="px-4 pt-3 pb-2 space-y-3">

          {/* Search + read-only toggle */}
          <div className="flex items-center gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search fields…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-8 pl-8 pr-8 text-sm"
              />
              {search && (
                <button
                  onClick={() => setSearch("")}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            <label className="flex items-center gap-2 cursor-pointer shrink-0">
              <Switch checked={showReadOnly} onCheckedChange={setShowReadOnly} className="scale-75" />
              <span className="text-xs text-muted-foreground">Read-only</span>
            </label>
          </div>

          {/* Selected chips */}
          {selectedDefs.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {selectedDefs.map((def) => (
                <Badge
                  key={def.name}
                  variant="secondary"
                  className="text-xs gap-1 pr-1 cursor-pointer"
                  onClick={() => toggleField(def.name)}
                >
                  {def.label || def.name}
                  <X className="h-3 w-3 opacity-60" />
                </Badge>
              ))}
              <button
                onClick={() => selectedDefs.forEach((d) => toggleField(d.name))}
                className="text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 ml-1"
              >
                Clear all
              </button>
            </div>
          )}
        </div>

        {/* Field list — one tab per data type */}
        {grouped.length === 0 ? (
          <div className="border-t px-4 py-3">
            <p className="text-sm text-muted-foreground text-center py-6">No fields match "{search}"</p>
          </div>
        ) : (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="border-t gap-0">
            <div className="px-4 pt-3">
              <TabsList className="flex h-auto w-full flex-wrap justify-start gap-1">
                <TabsTrigger value="__all__" className="text-xs">All</TabsTrigger>
                {grouped.map(([dataType, defs]) => (
                  <TabsTrigger key={dataType} value={dataType} className="text-xs">
                    {dataType} ({defs.length})
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>
            <ScrollArea className="h-96 px-4 py-3">
              <TabsContent value="__all__" className="mt-0">
                {grouped.map(([dataType, defs]) => (
                  <div key={dataType} className="mb-4">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      {dataType}
                    </p>
                    {renderFieldGrid(defs)}
                  </div>
                ))}
              </TabsContent>
              {grouped.map(([dataType, defs]) => (
                <TabsContent key={dataType} value={dataType} className="mt-0">
                  {renderFieldGrid(defs)}
                </TabsContent>
              ))}
            </ScrollArea>
          </Tabs>
        )}

        <div className="border-t px-4 py-3 flex items-center justify-end gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddToTable}
            disabled={!recordIds.length || !selectionChanged}
          >
            Update Table
          </Button>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
