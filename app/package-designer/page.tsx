"use client"

import { useState, useCallback, useMemo, useRef } from "react"
import JSZip from "jszip"
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import { ScrollArea } from "@/components/ui/scroll-area"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import { toast } from "sonner"
import { useAprimo } from "@/context/aprimo-context"
import {
  ChevronRight, FileIcon, FolderIcon,
  Plus, Trash2, Copy, Check, Package2, Upload, X, FlaskConical,
} from "lucide-react"
import { Spinner } from "@/components/ui/spinner"

import type { AdditionalFileConfig, ClassificationConfig, RecordConfig, PackageConfig, FocusedInput, TreeNode, AssignRole } from "./types"
import { tryMatch, getFileRolesAndLinks, ROLE_COLOR, ROLE_LABEL, newId, newDefaultClassification, parseXmlToConfigs, generateAllXml, ruleMatchesZip, buildSegmentsFromPath, buildRegexFromSegments, KNOWN_PACKAGE_TYPES, type PathSegment } from "./utils"
import { DropZone } from "@/components/ui/drop-zone"
import { AssignmentPanel } from "./components/assignment-panel"
import { ConfigureForm } from "./components/configure-form"
import { FileTreeNode } from "./components/file-tree-node"
import { IdentificationTestResults } from "./components/identification-test-results"
import { PackageListCard } from "./components/package-list-card"
import { RecordCard } from "./components/record-card"

// ── Pure helpers ───────────────────────────────────────────────────────────────

function normalizePath(p: string) {
  return p.replace(/\\/g, "/").replace(/\/$/, "")
}

function detectRootFolder(paths: string[]): string | null {
  if (paths.length === 0) return null
  const first = paths[0].split("/")[0]
  if (!first) return null
  return paths.every(p => p.startsWith(first + "/")) ? first : null
}

function buildTree(paths: string[]): TreeNode[] {
  const root: TreeNode[] = []
  const map: Record<string, TreeNode> = {}

  for (const rawPath of [...paths].sort()) {
    const path = normalizePath(rawPath)
    const parts = path.split("/").filter(Boolean)
    let current = root
    let currentPath = ""

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i]
      const isLast = i === parts.length - 1
      currentPath = currentPath ? `${currentPath}/${part}` : part

      if (!map[currentPath]) {
        const node: TreeNode = { name: part, path: currentPath, isFolder: !isLast, children: [] }
        map[currentPath] = node
        current.push(node)
      }
      current = map[currentPath].children
    }
  }

  return root
}


function newDefaultRecord(regex = ""): RecordConfig {
  return {
    id: newId(), regex, linkType: "pubItem", linkField: "",
    checkDuplicate: "FileNameAndContent", contentTypeMode: "detect", contentTypeValue: "",
    classifications: [newDefaultClassification()],
  }
}


// ── Default / empty config ─────────────────────────────────────────────────────

const EMPTY_CONFIG: PackageConfig = {
  id: "",
  name: "",
  enabled: true,
  contentTypeMode: "detect",
  contentTypeValue: "",
  identificationRules: [],
  masterFileRegex: "",
  masterFilePreviewRegex: "",
  additionalFiles: [],
  records: [],
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function PackageDesignerPage() {
  const { client, isConnected } = useAprimo()
  const fileInputRef = useRef<HTMLInputElement>(null)

  // ── Zip state ──
  const [zipPaths, setZipPaths] = useState<string[]>([])
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set())
  const [isDragging, setIsDragging] = useState(false)
  const [fileName, setFileName] = useState<string | null>(null)
  const [zipRootFolder, setZipRootFolder] = useState<string | null>(null)

  // ── Package list state ──
  const [packages, setPackages] = useState<PackageConfig[]>([])
  const [selectedPackageId, setSelectedPackageId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<"import" | "configure" | "xml">("import")

  // ── Assignment panel state ──
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [selectedIsFolder, setSelectedIsFolder] = useState(false)
  const [assignRole, setAssignRole] = useState<AssignRole>("")
  const [assignPurpose, setAssignPurpose] = useState("")
  const [assignUsages, setAssignUsages] = useState("")
  const [segments, setSegments] = useState<PathSegment[]>([])
  const [isRawMode, setIsRawMode] = useState(false)
  const [rawRegex, setRawRegex] = useState("")
  const [focusedInput, setFocusedInput] = useState<FocusedInput>(null)

  // ── Aprimo load state ──
  const [rawAprimoXml, setRawAprimoXml] = useState<string | null>(null)
  const [xmlModalOpen, setXmlModalOpen] = useState(false)

  const [isLoadingFromAprimo, setIsLoadingFromAprimo] = useState(false)
  const [aprimoLoadError, setAprimoLoadError] = useState<string | null>(null)

  // ── Per-card XML dialog (view / edit / replace) ──
  const [pasteTarget, setPasteTarget] = useState<{ id: string; name: string } | null>(null)
  const [pasteXml, setPasteXml] = useState("")
  const [pasteXmlError, setPasteXmlError] = useState<string | null>(null)
  const [pasteXmlValid, setPasteXmlValid] = useState<boolean | null>(null)

  // ── Identification test state ──
  const [identTestResults, setIdentTestResults] = useState<Array<{ rule: string; matches: string[] }> | null>(null)

  // ── Misc ──
  const [copied, setCopied] = useState(false)

  // ── Derived ───────────────────────────────────────────────────────────────────

  const selectedConfig = useMemo(
    () => packages.find(p => p.id === selectedPackageId) ?? null,
    [packages, selectedPackageId]
  )

  const fileTree = useMemo(() => buildTree(zipPaths), [zipPaths])

  const focusedRegex = useMemo<string | null>(() => {
    if (!focusedInput || !selectedConfig) return null
    switch (focusedInput.kind) {
      case "identification": return selectedConfig.identificationRules[focusedInput.index] ?? null
      case "masterFile": return selectedConfig.masterFileRegex
      case "masterPreview": return selectedConfig.masterFilePreviewRegex
      case "additional": return selectedConfig.additionalFiles.find(af => af.id === focusedInput.id)?.regex ?? null
      case "record": return selectedConfig.records.find(r => r.id === focusedInput.id)?.regex ?? null
    }
  }, [focusedInput, selectedConfig])

  const derivedRegex = useMemo(
    () => buildRegexFromSegments(segments, selectedIsFolder),
    [segments, selectedIsFolder]
  )

  const activeRegex = isRawMode ? rawRegex : derivedRegex

  const focusedMatches = useMemo<Set<string>>(() => {
    const pattern = selectedPath ? activeRegex : focusedRegex
    if (!pattern?.trim()) return new Set()
    try {
      const re = new RegExp(pattern, "i")
      return new Set(zipPaths.filter(p => re.test(p)))
    } catch {
      return new Set()
    }
  }, [selectedPath, activeRegex, focusedRegex, zipPaths])

  const conflictCount = useMemo(
    () => selectedConfig ? zipPaths.filter(p => getFileRolesAndLinks(p, selectedConfig).roles.length > 1).length : 0,
    [zipPaths, selectedConfig]
  )

  const zipSuggestions = useMemo(() => {
    const extsInZip = new Set<string>()
    for (const p of zipPaths) {
      const dot = p.lastIndexOf(".")
      if (dot !== -1) extsInZip.add(p.slice(dot + 1).toLowerCase())
    }
    return KNOWN_PACKAGE_TYPES.filter(pt => pt.exts.some(e => extsInZip.has(e)))
  }, [zipPaths])

  const packageMatchData = useMemo(() => {
    const hasZip = zipPaths.length > 0
    const data = packages.map(pkg => {
      const rules = pkg.identificationRules.filter(r => r.trim())
      const ruleResults = hasZip ? rules.map(r => ({ rule: r, hit: ruleMatchesZip(r, zipPaths) })) : []
      const isMatch = hasZip && rules.length > 0 && ruleResults.every(r => r.hit)
      const isPartial = hasZip && !isMatch && ruleResults.some(r => r.hit)
      return { pkg, rules, ruleResults, isMatch, isPartial }
    })
    const firstMatchIdx = hasZip ? data.findIndex(d => d.isMatch) : -1
    const firstMatchName = firstMatchIdx >= 0 ? data[firstMatchIdx].pkg.name : ""
    return data.map((d, i) => ({ ...d, isShadowed: d.isMatch && firstMatchIdx >= 0 && i > firstMatchIdx, firstMatchName }))
  }, [packages, zipPaths])

  const xml = useMemo(() => generateAllXml(packages), [packages])

  // ── Package list management ───────────────────────────────────────────────────

  const handleSelectPackage = (id: string) => {
    setSelectedPackageId(id)
    setIdentTestResults(null)
    setSelectedPath(null)
    setAssignRole("")
  }

  const handleEditPackage = (id: string) => {
    handleSelectPackage(id)
    setActiveTab("configure")
  }

  const addBlankPackage = () => {
    const pkg: PackageConfig = { ...EMPTY_CONFIG, id: newId(), name: "New Package", identificationRules: [""] }
    setPackages(prev => [pkg, ...prev])
    setSelectedPackageId(pkg.id)
    setIdentTestResults(null)
    setSelectedPath(null)
  }

  const movePackage = (id: string, dir: -1 | 1) =>
    setPackages(prev => {
      const i = prev.findIndex(p => p.id === id)
      if (i < 0 || i + dir < 0 || i + dir >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[i + dir]] = [next[i + dir], next[i]]
      return next
    })

  const deletePackage = (id: string) => {
    setPackages(prev => prev.filter(p => p.id !== id))
    if (selectedPackageId === id) {
      setSelectedPackageId(null)
      setIdentTestResults(null)
    }
  }

  // ── Config helpers — operate on the selected package in the list ──────────────

  const updateSelected = (updater: (prev: PackageConfig) => PackageConfig) =>
    setPackages(prev => prev.map(p => p.id === selectedPackageId ? updater(p) : p))

  const setProp = <K extends keyof PackageConfig>(key: K, value: PackageConfig[K]) =>
    updateSelected(prev => ({ ...prev, [key]: value }))

  const addIdentificationRule = (regex: string) => {
    updateSelected(prev => {
      const rules = [...prev.identificationRules]
      const emptyIdx = rules.findIndex(r => !r.trim())
      if (emptyIdx >= 0) rules[emptyIdx] = regex
      else rules.push(regex)
      return { ...prev, identificationRules: rules }
    })
  }

  const addAdditionalFile = () =>
    updateSelected(prev => ({
      ...prev,
      additionalFiles: [...prev.additionalFiles, { id: newId(), regex: "", purpose: "", usages: "" }],
    }))

  const setAF = (id: string, key: keyof AdditionalFileConfig, value: string) =>
    updateSelected(prev => ({
      ...prev,
      additionalFiles: prev.additionalFiles.map(af => af.id === id ? { ...af, [key]: value } : af),
    }))

  const removeAF = (id: string) =>
    updateSelected(prev => ({ ...prev, additionalFiles: prev.additionalFiles.filter(af => af.id !== id) }))

  const addRecord = () =>
    updateSelected(prev => ({ ...prev, records: [...prev.records, newDefaultRecord()] }))

  const setRec = (id: string, key: keyof Omit<RecordConfig, "id" | "classifications">, value: string) =>
    updateSelected(prev => ({
      ...prev,
      records: prev.records.map(r => r.id === id ? { ...r, [key]: value } : r),
    }))

  const removeRec = (id: string) =>
    updateSelected(prev => ({ ...prev, records: prev.records.filter(r => r.id !== id) }))

  const addCls = (recId: string) =>
    updateSelected(prev => ({
      ...prev,
      records: prev.records.map(r => r.id === recId
        ? { ...r, classifications: [...r.classifications, newDefaultClassification()] }
        : r),
    }))

  const setCls = (recId: string, clsId: string, key: keyof ClassificationConfig, value: string) =>
    updateSelected(prev => ({
      ...prev,
      records: prev.records.map(r => r.id === recId
        ? { ...r, classifications: r.classifications.map(c => c.id === clsId ? { ...c, [key]: value } : c) }
        : r),
    }))

  const removeCls = (recId: string, clsId: string) =>
    updateSelected(prev => ({
      ...prev,
      records: prev.records.map(r => r.id === recId
        ? { ...r, classifications: r.classifications.filter(c => c.id !== clsId) }
        : r),
    }))

  // ── Identification test ───────────────────────────────────────────────────────

  const runIdentificationTest = () => {
    if (!selectedConfig) return
    const rules = selectedConfig.identificationRules.filter(r => r.trim())
    if (!rules.length || !zipPaths.length) return
    setIdentTestResults(rules.map(rule => {
      try {
        const re = new RegExp(rule, "i")
        return { rule, matches: zipPaths.filter(p => re.test(p)) }
      } catch {
        return { rule, matches: [] }
      }
    }))
  }

  // ── Zip loading ──────────────────────────────────────────────────────────────

  const loadZip = useCallback(async (file: File) => {
    try {
      const zip = await JSZip.loadAsync(file)
      const rawPaths: string[] = []
      zip.forEach(relativePath => {
        if (!relativePath.endsWith("/")) rawPaths.push(normalizePath(relativePath))
      })
      const root = detectRootFolder(rawPaths)
      const paths = root ? rawPaths.map(p => p.slice(root.length + 1)) : rawPaths
      setZipRootFolder(root)
      setZipPaths(paths)
      setExpandedPaths(new Set(buildTree(paths).map(n => n.path)))
      setFileName(file.name)
      setSelectedPath(null)
      toast.success(`Loaded ${paths.length} files from ${file.name}`)
    } catch {
      toast.error("Failed to read zip file")
    }
  }, [])

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file?.name.endsWith(".zip")) loadZip(file)
    else toast.error("Please drop a .zip file")
  }, [loadZip])

  const toggleExpanded = useCallback((path: string) => {
    setExpandedPaths(prev => {
      const next = new Set(prev)
      next.has(path) ? next.delete(path) : next.add(path)
      return next
    })
  }, [])

  const handleSelect = useCallback((path: string, isFolder: boolean) => {
    const isDeselect = selectedPath === path
    setSelectedPath(isDeselect ? null : path)
    setSelectedIsFolder(isFolder)
    setAssignRole("")
    setAssignPurpose("")
    setAssignUsages("")
    setIsRawMode(false)
    if (!isDeselect) {
      setSegments(buildSegmentsFromPath(path, isFolder))
    }
  }, [selectedPath])

  // ── Aprimo load ───────────────────────────────────────────────────────────────

  const loadFromAprimo = async () => {
    if (!client) return
    setIsLoadingFromAprimo(true)
    setAprimoLoadError(null)
    try {
      const result = await client.settings.getByName(".packageIngestionConfiguration", "system")
      if (!result.ok || !result.data) {
        toast.error("Setting not found or access denied")
        return
      }
      const value = (result.data as { value?: string }).value ?? ""
      if (!value.trim()) {
        toast.error("PackageIngestionConfiguration setting is empty")
        return
      }
      setRawAprimoXml(value)
      const parsed = parseXmlToConfigs(value)
      if ("error" in parsed) {
        setAprimoLoadError(parsed.error)
        toast.error("Loaded but XML has errors")
      } else {
        setAprimoLoadError(null)
        setPackages(parsed.configs)
        setSelectedPackageId(null)
        setIdentTestResults(null)
        toast.success(`Loaded ${parsed.configs.length} package${parsed.configs.length !== 1 ? "s" : ""} from Aprimo`)
      }
    } catch (err) {
      toast.error(`Failed to load: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setIsLoadingFromAprimo(false)
    }
  }

  // ── XML import dialog ─────────────────────────────────────────────────────────

  // ── Per-card paste XML ────────────────────────────────────────────────────────

  const openPasteDialog = (id: string) => {
    const pkg = packages.find(p => p.id === id)
    setPasteTarget(pkg ? { id, name: pkg.name } : { id, name: "" })
    setPasteXml(pkg ? generateAllXml([pkg]) : "")
    setPasteXmlError(null)
    setPasteXmlValid(null)
  }

  const validatePasteXml = () => {
    const parsed = parseXmlToConfigs(pasteXml)
    if ("error" in parsed) {
      setPasteXmlError(parsed.error)
      setPasteXmlValid(false)
    } else {
      setPasteXmlError(null)
      setPasteXmlValid(true)
    }
  }

  const applyPasteXml = () => {
    if (!pasteTarget) return
    const parsed = parseXmlToConfigs(pasteXml)
    if ("error" in parsed) {
      setPasteXmlError(parsed.error)
      setPasteXmlValid(false)
      return
    }
    const pkg = parsed.configs[0]
    setPackages(prev => prev.map(p => p.id === pasteTarget.id ? { ...pkg, id: pasteTarget.id } : p))
    if (selectedPackageId === pasteTarget.id) setIdentTestResults(null)
    setPasteTarget(null)
    toast.success(`Updated "${pkg.name}"`)
  }

  // ── Assignment ────────────────────────────────────────────────────────────────

  const applyAssignment = () => {
    if (!selectedPath || !assignRole || !activeRegex.trim()) return
    const regex = activeRegex.trim()
    const roleLabels: Record<AssignRole, string> = {
      master: "Primary File", preview: "Preview", additional: "Additional File",
      record: "Linked Record", identification: "Identification Rule", "": "",
    }

    if (assignRole === "master") {
      setProp("masterFileRegex", regex)
    } else if (assignRole === "preview") {
      setProp("masterFilePreviewRegex", regex)
    } else if (assignRole === "additional") {
      updateSelected(prev => ({
        ...prev,
        additionalFiles: [...prev.additionalFiles, { id: newId(), regex, purpose: assignPurpose, usages: assignUsages }],
      }))
    } else if (assignRole === "record") {
      updateSelected(prev => ({ ...prev, records: [...prev.records, newDefaultRecord(regex)] }))
    } else if (assignRole === "identification") {
      addIdentificationRule(regex)
      setIdentTestResults(null)
    }

    toast.success(`Assigned as ${roleLabels[assignRole]}`)
    setSelectedPath(null)
    setAssignRole("")
  }

  const copyXml = () => {
    navigator.clipboard.writeText(xml)
    setCopied(true)
    toast.success("XML copied to clipboard")
    setTimeout(() => setCopied(false), 2000)
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Navbar />

      <div className="border-b border-border px-6 py-3 flex items-center gap-3 shrink-0">
        <Package2 className="h-5 w-5 text-primary shrink-0" />
        <div>
          <h1 className="text-base font-semibold leading-tight">Package Designer</h1>
          <p className="text-xs text-muted-foreground">
            Drop a zip to inspect its structure, then configure your Aprimo package definition.
          </p>
        </div>
      </div>

      <PanelGroup direction="horizontal" className="flex-1 overflow-hidden">
        {/* ── Left panel: file tree ── */}
        <Panel defaultSize={35} minSize={18}>
          <div className="flex flex-col h-full border-r border-border">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-border shrink-0">
              <span className="text-sm font-medium truncate">
                {fileName
                  ? <span className="flex items-center gap-2">
                      <span className="truncate max-w-48">{fileName}</span>
                      <Badge variant="secondary" className="text-xs">{zipPaths.length}</Badge>
                    </span>
                  : "Zip Contents"}
              </span>
              {fileName && (
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={() => fileInputRef.current?.click()}>
                  <Upload className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>

            {/* Root folder strip notice */}
            {zipRootFolder && (
              <div className="px-4 py-1.5 border-b border-border shrink-0 flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">root stripped:</span>
                <code className="text-xs font-mono text-muted-foreground">{zipRootFolder}/</code>
              </div>
            )}

            {/* Color legend */}
            {zipPaths.length > 0 && (
              <div className="px-4 py-1.5 border-b border-border flex flex-wrap gap-x-3 gap-y-1 shrink-0">
                {(["master", "preview", "additional", "record"] as const).map(role => (
                  <span key={role} className={cn("text-xs", ROLE_COLOR[role])}>● {ROLE_LABEL[role]}</span>
                ))}
                {focusedMatches.size > 0 && (
                  <span className="text-xs text-yellow-600 dark:text-yellow-400">
                    ● {focusedMatches.size} match{focusedMatches.size !== 1 ? "es" : ""}
                  </span>
                )}
                {conflictCount > 0 && (
                  <span className="text-xs text-orange-600 dark:text-orange-400">
                    ⚠ {conflictCount} overlap{conflictCount !== 1 ? "s" : ""}
                  </span>
                )}
                {selectedConfig && (
                  <span className="text-xs text-muted-foreground ml-auto truncate max-w-32" title={selectedConfig.name}>
                    {selectedConfig.name}
                  </span>
                )}
              </div>
            )}

            {/* Tree or drop zone */}
            {zipPaths.length === 0 ? (
              <DropZone
                isDragging={isDragging}
                onDragOver={() => setIsDragging(true)}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                label="Drop a .zip file here"
                className="flex-1 m-4"
              />
            ) : (
              <div
                className="flex-1 overflow-hidden"
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
              >
                <ScrollArea className="h-full">
                  <div className="py-1.5">
                    {fileTree.map(node => (
                      <FileTreeNode
                        key={node.path}
                        node={node}
                        depth={0}
                        config={selectedConfig ?? EMPTY_CONFIG}
                        expandedPaths={expandedPaths}
                        focusedMatches={focusedMatches}
                        selectedPath={selectedPath}
                        onToggle={toggleExpanded}
                        onSelect={handleSelect}
                      />
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Assignment panel */}
            {selectedPath && (
              <AssignmentPanel
                selectedPath={selectedPath}
                selectedIsFolder={selectedIsFolder}
                selectedConfig={selectedConfig}
                segments={segments}
                isRawMode={isRawMode}
                rawRegex={rawRegex}
                derivedRegex={derivedRegex}
                activeRegex={activeRegex}
                focusedMatchCount={focusedMatches.size}
                assignRole={assignRole}
                assignPurpose={assignPurpose}
                assignUsages={assignUsages}
                onDeselect={() => setSelectedPath(null)}
                onSetSegments={setSegments}
                onSetRawRegex={setRawRegex}
                onToggleRawMode={() => setIsRawMode(v => !v)}
                onSetAssignRole={setAssignRole}
                onSetAssignPurpose={setAssignPurpose}
                onSetAssignUsages={setAssignUsages}
                onApply={applyAssignment}
              />
            )}
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-border hover:bg-primary/40 transition-colors data-[resize-handle-active]:bg-primary/60" />

        {/* ── Right panel ── */}
        <Panel defaultSize={65} minSize={40}>
          <Tabs value={activeTab} onValueChange={v => setActiveTab(v as typeof activeTab)} className="flex flex-col h-full">
            <div className="border-b border-border px-4 shrink-0">
              <TabsList className="h-10 bg-transparent rounded-none gap-0 p-0">
                {(["import", "configure", "xml"] as const).map(tab => (
                  <TabsTrigger
                    key={tab}
                    value={tab}
                    className="rounded-none border-b-2 border-transparent data-[state=active]:border-primary data-[state=active]:bg-transparent capitalize px-4"
                  >
                    {tab === "xml" ? "XML Output" : tab === "import" ? "Current Config" : "Configure"}
                    {tab === "import" && packages.length > 0 && (
                      <Badge variant="secondary" className="ml-1.5 text-xs h-4 px-1">{packages.length}</Badge>
                    )}
                    {tab === "configure" && selectedConfig && (
                      <span className="ml-1.5 text-xs text-muted-foreground hidden sm:inline truncate max-w-24">
                        — {selectedConfig.name}
                      </span>
                    )}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* ── Current Config tab ── */}
            <TabsContent value="import" className="flex-1 overflow-hidden m-0 flex flex-col">
              <div className="px-4 py-2 border-b border-border shrink-0 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  {isConnected && (
                    <Button variant="outline" size="sm" disabled={isLoadingFromAprimo} onClick={loadFromAprimo}>
                      {isLoadingFromAprimo
                        ? <Spinner className="h-3.5 w-3.5 mr-1.5" />
                        : <Package2 className="h-3.5 w-3.5 mr-1.5" />}
                      Load package definitions from Aprimo
                    </Button>
                  )}
                  {rawAprimoXml && (
                    <Button variant="ghost" size="sm" onClick={() => setXmlModalOpen(true)}>
                      <Copy className="h-3.5 w-3.5 mr-1.5" /> View Raw
                    </Button>
                  )}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <Button size="sm" onClick={addBlankPackage}>
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> New Package
                  </Button>
                </div>
              </div>

              {packages.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center gap-3 p-8 text-center">
                  {aprimoLoadError ? (
                    <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2 text-left max-w-sm">
                      <X className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                      <p className="text-xs text-destructive font-mono break-all">{aprimoLoadError}</p>
                    </div>
                  ) : (
                    <>
                      <Package2 className="h-8 w-8 text-muted-foreground" />
                      <div className="space-y-1">
                        <p className="text-sm font-medium">No packages yet</p>
                        <p className="text-sm text-muted-foreground">
                          {isConnected
                            ? "Load from Aprimo, import XML, or create a new package."
                            : "Import XML or create a new package to get started."}
                        </p>
                      </div>
                    </>
                  )}
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <div className="p-4 space-y-2">
                    <p className="text-xs text-muted-foreground mb-3">
                      {packages.length} package{packages.length !== 1 ? "s" : ""}
                      {zipPaths.length > 0 ? " — identification tested against zip" : ""}
                      {" · "}order matches Aprimo evaluation priority
                    </p>
                    {packageMatchData.map(({ pkg, rules, ruleResults, isMatch, isPartial, isShadowed, firstMatchName }, i) => (
                      <PackageListCard
                        key={pkg.id}
                        pkg={pkg}
                        isFirst={i === 0}
                        isLast={i === packages.length - 1}
                        hasZip={zipPaths.length > 0}
                        isSelected={selectedPackageId === pkg.id}
                        isMatch={isMatch}
                        isPartial={isPartial}
                        isShadowed={isShadowed}
                        firstMatchName={firstMatchName}
                        rules={rules}
                        ruleResults={ruleResults}
                        onSelect={() => handleSelectPackage(pkg.id)}
                        onMoveUp={() => movePackage(pkg.id, -1)}
                        onMoveDown={() => movePackage(pkg.id, 1)}
                        onEdit={() => handleEditPackage(pkg.id)}
                        onDelete={() => deletePackage(pkg.id)}
                        onPasteXml={() => openPasteDialog(pkg.id)}
                      />
                    ))}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            {/* ── Configure tab ── */}
            <TabsContent value="configure" className="flex-1 overflow-hidden m-0">
              <ConfigureForm
                config={selectedConfig!}
                zipPaths={zipPaths}
                zipSuggestions={zipSuggestions}
                identTestResults={identTestResults}
                setProp={setProp}
                setFocusedInput={setFocusedInput}
                setIdentTestResults={setIdentTestResults}
                runIdentificationTest={runIdentificationTest}
                addIdentificationRule={addIdentificationRule}
                addAdditionalFile={addAdditionalFile}
                setAF={setAF}
                removeAF={removeAF}
                addRecord={addRecord}
                setRec={setRec}
                removeRec={removeRec}
                addCls={addCls}
                setCls={setCls}
                removeCls={removeCls}
                onViewPackages={() => setActiveTab("import")}
                onAddPackage={addBlankPackage}
              />
            </TabsContent>

            {/* ── XML Output tab ── */}
            <TabsContent value="xml" className="flex-1 overflow-hidden m-0 flex flex-col">
              <div className="flex items-center justify-between px-4 py-2 border-b border-border shrink-0">
                <span className="text-xs text-muted-foreground font-mono">
                  .packageIngestionConfiguration
                  {packages.length > 0 && ` (${packages.length} package${packages.length !== 1 ? "s" : ""})`}
                </span>
                <Button variant="outline" size="sm" onClick={copyXml} disabled={packages.length === 0}>
                  {copied
                    ? <><Check className="h-3.5 w-3.5 mr-1.5 text-green-500" />Copied!</>
                    : <><Copy className="h-3.5 w-3.5 mr-1.5" />Copy XML</>}
                </Button>
              </div>
              {packages.length === 0 ? (
                <div className="flex-1 flex items-center justify-center">
                  <p className="text-sm text-muted-foreground">No packages configured yet.</p>
                </div>
              ) : (
                <div className="flex-1 overflow-auto">
                  <pre className="p-6 text-sm font-mono text-foreground whitespace-pre leading-relaxed">
                    {xml}
                  </pre>
                </div>
              )}
            </TabsContent>
          </Tabs>
        </Panel>
      </PanelGroup>

      <input
        ref={fileInputRef}
        type="file"
        accept=".zip"
        className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          if (file) loadZip(file)
          e.target.value = ""
        }}
      />

      {/* Raw Aprimo XML modal */}
      <Dialog open={xmlModalOpen} onOpenChange={setXmlModalOpen}>
        <DialogContent className="w-[90vw] sm:max-w-none" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>.packageIngestionConfiguration (raw)</DialogTitle>
          </DialogHeader>
          <div className="flex justify-start">
            <Button variant="outline" size="sm" onClick={() => {
              if (rawAprimoXml) { navigator.clipboard.writeText(rawAprimoXml); toast.success("Copied") }
            }}>
              <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
            </Button>
          </div>
          <ScrollArea className="h-[65vh] rounded-md border bg-muted/30">
            <pre className="p-4 text-xs font-mono whitespace-pre leading-relaxed">{rawAprimoXml}</pre>
          </ScrollArea>
        </DialogContent>
      </Dialog>


      {/* Per-card XML dialog — editable XML for this package */}
      <Dialog open={!!pasteTarget} onOpenChange={open => {
        if (!open) { setPasteTarget(null); setPasteXmlError(null); setPasteXmlValid(null); setPasteXml("") }
      }}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{pasteTarget?.name ?? ""} — XML</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <Textarea
              value={pasteXml}
              onChange={e => { setPasteXml(e.target.value); setPasteXmlError(null); setPasteXmlValid(null) }}
              className="font-mono text-xs h-80 resize-none"
              spellCheck={false}
            />
            {pasteXmlError && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 px-3 py-2">
                <X className="h-3.5 w-3.5 text-destructive shrink-0 mt-0.5" />
                <p className="text-xs text-destructive font-mono break-all">{pasteXmlError}</p>
              </div>
            )}
            {pasteXmlValid === true && (
              <div className="flex items-center gap-2 text-xs text-emerald-600 dark:text-emerald-400">
                <Check className="h-3.5 w-3.5 shrink-0" /> Valid XML
              </div>
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={validatePasteXml} disabled={!pasteXml.trim()}>
                Validate
              </Button>
              <Button size="sm" onClick={applyPasteXml} disabled={!pasteXml.trim()}>
                Apply
              </Button>
              <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { navigator.clipboard.writeText(pasteXml); toast.success("Copied") }}>
                <Copy className="h-3.5 w-3.5 mr-1.5" /> Copy
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Footer />
    </div>
  )
}
