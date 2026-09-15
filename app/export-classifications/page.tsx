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

      // Compute depth for each node
      const depthCache = new Map<string, number>()
      function getDepth(id: string): number {
        if (depthCache.has(id)) return depthCache.get(id)!
        const node = nodeById.get(id)
        if (!node?.parentId || !nodeById.has(node.parentId)) { depthCache.set(id, 0); return 0 }
        const d = getDepth(node.parentId) + 1
        depthCache.set(id, d)
        return d
      }

      // Optional: fetch record counts in batches of 5
      let counts: Map<string, number> | null = null
      if (includeRecordCount) {
        counts = new Map()
        const total = selectedNodes.length
        for (let i = 0; i < total; i += 5) {
          const batch = selectedNodes.slice(i, i + 5)
          setExportProgress(`Counting records… ${Math.min(i + 5, total).toLocaleString()} / ${total.toLocaleString()}`)
          await Promise.all(
            batch.map(async node => {
              try {
                const res = await client.search.records(
                  { searchExpression: { expression: `classificationid = '${node.id}'` }, page: 1, pageSize: 1 } as never,
                )
                counts!.set(node.id, (res as Record<string, unknown>)._total as number ?? 0)
              } catch {
                counts!.set(node.id, 0)
              }
            }),
          )
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
        { header: "Depth", key: "depth", width: 8 },
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
          depth: getDepth(node.id),
        }
        if (includeRecordCount) row.count = counts?.get(node.id) ?? 0
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
              Select classification nodes to include, then download the full hierarchy as Excel.
              Includes name, ID, parent ID, hierarchy path, and depth for every selected node.
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

            {/* Record count option */}
            <label className="flex items-center gap-2 text-sm cursor-pointer select-none w-fit">
              <Checkbox
                checked={includeRecordCount}
                onCheckedChange={v => setIncludeRecordCount(v === true)}
              />
              Include record count
              <span className="text-xs text-muted-foreground">
                (requires one API call per selected node — may be slow for large selections)
              </span>
            </label>

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

            {/* Export */}
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
