"use client"

import { useState, useEffect, useCallback, useMemo } from "react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Loader2, ChevronRight, ChevronDown, Download, Search, X, RefreshCw } from "lucide-react"
import ExcelJS from "exceljs"

// ── Helpers ───────────────────────────────────────────────────────

// Fetch record count for a list of classification IDs via search.records().
// Probes the first ID with candidate field names, then reuses the working one.
// Runs up to `concurrency` calls at a time to avoid 429s.
// Returns a Map<id, count>. Throws if no candidate field works.
async function fetchClassificationCounts(
  ids: string[],
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  onProgress?: (done: number, total: number) => void,
  concurrency = 5,
): Promise<Map<string, number>> {
  const counts = new Map<string, number>()
  let done = 0
  // Field name candidates, tried in order on the first ID.
  const CANDIDATES = ["Classification", "classificationid"]
  let field: string | null = null

  async function tryField(id: string, f: string): Promise<number | null> {
    try {
      const res = await client.search.records(
        { searchExpression: { expression: `${f} = '${id}'` }, page: 1, pageSize: 1 } as never,
      )
      if (!res.ok) return null
      const data = res.data as unknown as { totalCount?: number }
      return data?.totalCount ?? null
    } catch {
      return null
    }
  }

  async function fetchOne(id: string) {
    if (!field) {
      for (const candidate of CANDIDATES) {
        const n = await tryField(id, candidate)
        if (n !== null) { field = candidate; counts.set(id, n); break }
      }
      if (!field) {
        throw new Error(
          "Record counts are not available: no supported search field found. " +
          `Tried: ${CANDIDATES.join(", ")}`,
        )
      }
    } else {
      counts.set(id, (await tryField(id, field)) ?? 0)
    }
    done++
    onProgress?.(done, ids.length)
  }

  if (ids.length > 0) {
    await fetchOne(ids[0])
    for (let i = 1; i < ids.length; i += concurrency) {
      await Promise.all(ids.slice(i, i + concurrency).map(fetchOne))
    }
  }

  return counts
}

function toGuid(id: string): string {
  if (id.includes("-") || id.length !== 32) return id
  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`
}

function normalizeId(id: string): string {
  return toGuid(id.trim().replace(/^\{|\}$/g, "").toLowerCase())
}

function getDisplayLabel(
  labels: Array<{ languageId: string; value: string }> | undefined,
  fallback: string,
): string {
  if (!labels?.length) return fallback
  for (const lang of ["c2bd4f9b-bb95-4bcb-80c3-1e924c9c26dc", "c2bd4f9bbb954bcb80c31e924c9c26dc"]) {
    const m = labels.find(l => l.languageId.toLowerCase() === lang.toLowerCase())
    if (m?.value) return m.value
  }
  const en = labels.find(l => l.languageId.toLowerCase().startsWith("en"))
  return en?.value ?? labels[0]?.value ?? fallback
}

// ── Types ─────────────────────────────────────────────────────────

interface ClassNode {
  id: string
  name: string
  labelPath: string
  parentId?: string
  labels?: Array<{ languageId: string; value: string }>
}

interface FlatItem {
  id: string
  label: string
  name: string
  labelPath: string
  depth: number
  parentId: string | null
  hasChildren: boolean
}

// ── Page ──────────────────────────────────────────────────────────

export default function ExportClassificationsPage() {
  const { client, isConnected } = useAprimo()

  const [allNodes, setAllNodes] = useState<ClassNode[]>([])
  const [flatItems, setFlatItems] = useState<FlatItem[]>([])
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [search, setSearch] = useState("")
  const [includeRecordCount, setIncludeRecordCount] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportProgress, setExportProgress] = useState("")
  const [countError, setCountError] = useState<string | null>(null)

  // ── children map for cascade and descendant lookup ────────────────

  const childrenMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const node of allNodes) {
      if (node.parentId) {
        const arr = map.get(node.parentId) ?? []
        arr.push(node.id)
        map.set(node.parentId, arr)
      }
    }
    return map
  }, [allNodes])

  // Precompute all descendants for each node (used by cascade + indeterminate check)
  const descendantsMap = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const node of allNodes) {
      const result: string[] = []
      const queue = [...(childrenMap.get(node.id) ?? [])]
      while (queue.length) {
        const cur = queue.shift()!
        result.push(cur)
        queue.push(...(childrenMap.get(cur) ?? []))
      }
      map.set(node.id, result)
    }
    return map
  }, [allNodes, childrenMap])

  // ── Build flat DFS list from raw nodes ───────────────────────────

  const buildFlatItems = useCallback((nodes: ClassNode[]): FlatItem[] => {
    if (!nodes.length) return []

    const childrenByParent = new Map<string | undefined, ClassNode[]>()
    for (const n of nodes) {
      const arr = childrenByParent.get(n.parentId) ?? []
      arr.push(n)
      childrenByParent.set(n.parentId, arr)
    }
    for (const arr of childrenByParent.values()) {
      arr.sort((a, b) => (a.labelPath || a.name).localeCompare(b.labelPath || b.name))
    }

    const nodeIds = new Set(nodes.map(n => n.id))
    const roots = (nodes.filter(n => !n.parentId || !nodeIds.has(n.parentId)))
      .sort((a, b) => (a.labelPath || a.name).localeCompare(b.labelPath || b.name))

    const result: FlatItem[] = []
    function walk(node: ClassNode, depth: number) {
      const children = childrenByParent.get(node.id) ?? []
      result.push({
        id: node.id,
        label: getDisplayLabel(node.labels, node.name),
        name: node.name,
        labelPath: node.labelPath,
        depth,
        parentId: node.parentId ?? null,
        hasChildren: children.length > 0,
      })
      for (const child of children) walk(child, depth + 1)
    }
    for (const root of roots) walk(root, 0)
    return result
  }, [])

  // ── Load ──────────────────────────────────────────────────────────

  const load = useCallback(async () => {
    if (!client || !isConnected) return
    setLoading(true)
    setLoadError(null)
    setChecked(new Set())
    setExpanded(new Set())
    try {
      const allRaw: unknown[] = []
      for await (const result of client.classifications.getPaged(undefined, undefined, "*")) {
        if (!result.ok) break
        allRaw.push(...((result.data as { items?: unknown[] })?.items ?? []))
      }
      const nodes: ClassNode[] = (allRaw as Record<string, unknown>[]).map(c => ({
        id: normalizeId(String(c.id ?? "")),
        name: String(c.name ?? ""),
        labelPath: String(c.labelPath ?? ""),
        parentId: c.parentId ? normalizeId(String(c.parentId)) : undefined,
        labels: c.labels as ClassNode["labels"],
      }))
      setAllNodes(nodes)
      setFlatItems(buildFlatItems(nodes))
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load classifications")
    } finally {
      setLoading(false)
    }
  }, [client, isConnected, buildFlatItems])

  useEffect(() => {
    if (isConnected) load()
  }, [isConnected, load])

  // ── Visible items ─────────────────────────────────────────────────

  const visibleItems = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (q) {
      return flatItems.filter(
        f =>
          f.label.toLowerCase().includes(q) ||
          f.labelPath.toLowerCase().includes(q) ||
          f.name.toLowerCase().includes(q),
      )
    }
    // O(n) pass — flatItems is DFS order, so parent always precedes children
    const visible = new Set<string>()
    return flatItems.filter(f => {
      if (f.depth === 0) { visible.add(f.id); return true }
      if (!f.parentId || !visible.has(f.parentId) || !expanded.has(f.parentId)) return false
      visible.add(f.id)
      return true
    })
  }, [flatItems, search, expanded])

  // ── Interactions ──────────────────────────────────────────────────

  function toggleExpand(id: string) {
    setExpanded(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  function toggleCheck(id: string) {
    setChecked(prev => {
      const next = new Set(prev)
      const descendants = descendantsMap.get(id) ?? []
      if (next.has(id)) {
        next.delete(id)
        descendants.forEach(d => next.delete(d))
      } else {
        next.add(id)
        descendants.forEach(d => next.add(d))
      }
      return next
    })
  }

  function getCheckState(id: string): true | false | "indeterminate" {
    if (checked.has(id)) return true
    const descendants = descendantsMap.get(id) ?? []
    if (descendants.some(d => checked.has(d))) return "indeterminate"
    return false
  }

  function selectAll() { setChecked(new Set(flatItems.map(f => f.id))) }
  function deselectAll() { setChecked(new Set()) }

  // ── Export ────────────────────────────────────────────────────────

  async function doExport() {
    if (!client) return
    setExporting(true)
    setExportProgress("")
    try {
      const nodeById = new Map(allNodes.map(n => [n.id, n]))
      const selectedNodes = allNodes
        .filter(n => checked.has(n.id))
        .sort((a, b) => (a.labelPath || a.name).localeCompare(b.labelPath || b.name))

      // Optionally fetch record counts for selected nodes via search endpoint
      let countById = new Map<string, number>()
      setCountError(null)
      if (includeRecordCount) {
        try {
          const ids = selectedNodes.map(n => n.id)
          countById = await fetchClassificationCounts(
            ids,
            client,
            (done, total) => setExportProgress(`Fetching record counts… ${done}/${total}`),
          )
        } catch (e) {
          setCountError(e instanceof Error ? e.message : String(e))
        }
      }

      setExportProgress("Building spreadsheet…")

      const workbook = new ExcelJS.Workbook()
      const ws = workbook.addWorksheet("Classifications")
      ws.columns = [
        { header: "Name", key: "name", width: 35 },
        { header: "System Name", key: "systemName", width: 35 },
        { header: "ID", key: "id", width: 40 },
        { header: "Parent Name", key: "parentName", width: 35 },
        { header: "Parent System Name", key: "parentSystemName", width: 35 },
        { header: "Parent ID", key: "parentId", width: 40 },
        { header: "Hierarchy Path", key: "path", width: 70 },
        ...(includeRecordCount ? [{ header: "Record Count", key: "count", width: 14 }] : []),
      ]
      ws.getRow(1).font = { bold: true }

      for (const node of selectedNodes) {
        const parent = node.parentId ? nodeById.get(node.parentId) : undefined
        const row: Record<string, unknown> = {
          name: getDisplayLabel(node.labels, node.name),
          systemName: node.name,
          id: node.id,
          parentName: parent ? getDisplayLabel(parent.labels, parent.name) : "",
          parentSystemName: parent?.name ?? "",
          parentId: node.parentId ?? "",
          path: node.labelPath || node.name,
          ...(includeRecordCount ? { count: countById.get(node.id) ?? 0 } : {}),
        }
        ws.addRow(row)
      }

      const buf = await workbook.xlsx.writeBuffer()
      const blob = new Blob([buf], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      })
      const url = URL.createObjectURL(blob)
      const a = document.createElement("a")
      a.href = url
      a.download = "classifications.xlsx"
      a.click()
      URL.revokeObjectURL(url)
    } catch (e) {
      console.error("Export failed:", e)
    } finally {
      setExporting(false)
      setExportProgress("")
    }
  }

  // ── Render ────────────────────────────────────────────────────────

  const checkedCount = checked.size

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 flex flex-col px-6 py-6 gap-4">

        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Export Classifications</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Select classification nodes to include, then download as Excel.
              Each row includes name, ID, parent, and hierarchy path.
              Optionally include asset record counts, fetched via a single analytics API call.
            </p>
          </div>
          {!loading && flatItems.length > 0 && (
            <Button variant="outline" size="sm" onClick={load} className="shrink-0">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Reload
            </Button>
          )}
        </div>

        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-12 justify-center">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading classifications…
          </div>
        )}

        {loadError && (
          <div className="text-sm text-destructive rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3">
            {loadError}
          </div>
        )}

        {!loading && flatItems.length > 0 && (
          <>
            {/* Toolbar */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative flex-1 min-w-48">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                <input
                  type="text"
                  placeholder="Search classifications…"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  className="w-full pl-8 pr-8 py-1.5 text-sm border border-input rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                />
                {search && (
                  <button
                    onClick={() => setSearch("")}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              <Button variant="outline" size="sm" onClick={selectAll}>Select All</Button>
              <Button variant="outline" size="sm" onClick={deselectAll} disabled={checkedCount === 0}>
                Deselect All
              </Button>
              <span className="text-xs text-muted-foreground tabular-nums">
                {checkedCount.toLocaleString()} of {flatItems.length.toLocaleString()} selected
              </span>
            </div>

            {/* Tree */}
            <div className="border border-border rounded-lg overflow-hidden bg-card">
              <div className="overflow-y-auto max-h-[55vh]">
                {visibleItems.length === 0 && (
                  <div className="text-sm text-muted-foreground text-center py-8">
                    No classifications match your search.
                  </div>
                )}
                {visibleItems.map(item => {
                  const checkState = getCheckState(item.id)
                  const isExpanded = expanded.has(item.id)
                  return (
                    <div
                      key={item.id}
                      className="flex items-center gap-1 py-1 pr-3 hover:bg-muted/40 text-sm border-b border-border/40 last:border-0"
                      style={{ paddingLeft: `${item.depth * 20 + 8}px` }}
                    >
                      <button
                        className="shrink-0 w-5 h-5 flex items-center justify-center text-muted-foreground hover:text-foreground"
                        onClick={() => item.hasChildren && toggleExpand(item.id)}
                        style={{ visibility: item.hasChildren ? "visible" : "hidden" }}
                      >
                        {isExpanded
                          ? <ChevronDown className="h-3.5 w-3.5" />
                          : <ChevronRight className="h-3.5 w-3.5" />}
                      </button>
                      <Checkbox
                        checked={checkState}
                        onCheckedChange={() => toggleCheck(item.id)}
                        className="shrink-0"
                      />
                      <span className="truncate ml-1.5">{item.label}</span>
                      {item.depth === 0 && !search && (
                        <span className="ml-auto text-xs text-muted-foreground shrink-0 pl-4">
                          {(descendantsMap.get(item.id)?.length ?? 0) + 1} nodes
                        </span>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Export options + button */}
            <div className="flex items-center gap-4 flex-wrap">
              <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
                <Checkbox
                  checked={includeRecordCount}
                  onCheckedChange={v => { setIncludeRecordCount(v === true); setCountError(null) }}
                />
                Include record count
              </label>
              {countError && (
                <span className="text-xs text-destructive">Count error: {countError}</span>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={doExport} disabled={checkedCount === 0 || exporting}>
                {exporting ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    {exportProgress || "Exporting…"}
                  </>
                ) : (
                  <>
                    <Download className="h-4 w-4 mr-2" />
                    Export {checkedCount.toLocaleString()} node{checkedCount !== 1 ? "s" : ""} to Excel
                  </>
                )}
              </Button>
            </div>
          </>
        )}
      </main>
      <Footer />
    </div>
  )
}
