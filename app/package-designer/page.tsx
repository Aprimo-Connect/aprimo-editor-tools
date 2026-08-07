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
  ChevronRight, ChevronDown, FileIcon, FolderIcon, FolderOpen,
  Plus, Trash2, Copy, Check, Package2, Upload, X, FlaskConical, Loader2,
  ArrowUp, ArrowDown,
} from "lucide-react"

// ── Types ──────────────────────────────────────────────────────────────────────

type AdditionalFileConfig = {
  id: string
  regex: string
  purpose: string
  usages: string
}

type ClassificationConfig = {
  id: string
  type: "identifier" | "namePath" | "sameAsMaster"
  value: string
  option: "" | "newOnly" | "duplicateOnly"
}

type RecordConfig = {
  id: string
  regex: string
  linkType: "pubItem" | "recordLink"
  linkField: string
  checkDuplicate: string
  contentTypeMode: "detect" | "fixed"
  contentTypeValue: string
  classifications: ClassificationConfig[]
}

type PackageConfig = {
  id: string
  name: string
  enabled: boolean
  contentTypeMode: "detect" | "fixed" | "keep"
  contentTypeValue: string
  identificationRules: string[]
  masterFileRegex: string
  masterFilePreviewRegex: string
  additionalFiles: AdditionalFileConfig[]
  records: RecordConfig[]
  rawXml?: string
}

type FocusedInput =
  | { kind: "identification"; index: number }
  | { kind: "masterFile" }
  | { kind: "masterPreview" }
  | { kind: "additional"; id: string }
  | { kind: "record"; id: string }
  | null

type TreeNode = {
  name: string
  path: string
  isFolder: boolean
  children: TreeNode[]
}

type AssignRole = "master" | "preview" | "additional" | "record" | "identification" | ""

// ── Pure helpers ───────────────────────────────────────────────────────────────

function newId() {
  return Math.random().toString(36).slice(2, 10)
}

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

function tryMatch(pattern: string, path: string): boolean {
  if (!pattern.trim()) return false
  try {
    const re = new RegExp(pattern, "i")
    const backslash = "\\" + path.replace(/\//g, "\\")
    return re.test(path) || re.test(backslash)
  } catch {
    return false
  }
}

type FileRole = "master" | "preview" | "additional" | "record"

function getFileRoles(path: string, config: PackageConfig): FileRole[] {
  const roles: FileRole[] = []
  if (tryMatch(config.masterFileRegex, path)) roles.push("master")
  if (tryMatch(config.masterFilePreviewRegex, path)) roles.push("preview")
  if (config.additionalFiles.some(af => tryMatch(af.regex, path))) roles.push("additional")
  if (config.records.some(r => tryMatch(r.regex, path))) roles.push("record")
  return roles
}

function getRecordLinkTypes(path: string, config: PackageConfig): Array<"pubItem" | "recordLink"> {
  const types = config.records.filter(r => tryMatch(r.regex, path)).map(r => r.linkType)
  return [...new Set(types)]
}

function escapeForRegex(str: string): string {
  return str.replace(/[.+*?[\](){}^$|\\]/g, "\\$&")
}

// ── Visual path segment builder ───────────────────────────────────────────────

type SegmentMode = "exact" | "extension" | "wildcard"

type PathSegment = {
  text: string
  isFile: boolean
  ext: string | null
  mode: SegmentMode
}

function buildSegmentsFromPath(path: string, isFolder: boolean): PathSegment[] {
  const parts = path.split("/").filter(Boolean)
  return parts.map((text, i) => {
    const isLast = i === parts.length - 1
    const isFile = !isFolder && isLast
    const extMatch = isFile ? text.match(/\.([^.]+)$/) : null
    return { text, isFile, ext: extMatch ? extMatch[1] : null, mode: "exact" as SegmentMode }
  })
}

function nextSegmentMode(seg: PathSegment): SegmentMode {
  if (!seg.isFile || !seg.ext) return seg.mode === "exact" ? "wildcard" : "exact"
  const cycle: SegmentMode[] = ["exact", "extension", "wildcard"]
  return cycle[(cycle.indexOf(seg.mode) + 1) % cycle.length]
}

function buildRegexFromSegments(segs: PathSegment[], isFolder: boolean): string {
  if (segs.length === 0) return ""
  const parts = segs.map(seg => {
    if (seg.mode === "exact") return escapeForRegex(seg.text)
    if (seg.mode === "extension") return `(.*?)\\.${escapeForRegex(seg.ext!)}`
    return `(.*?)`
  })
  const joined = parts.join("[\\\\/]")
  return isFolder ? `${joined}[\\\\/]` : `${joined}$`
}

function describePattern(segs: PathSegment[], isFolder: boolean): string {
  if (segs.length === 0) return ""
  if (isFolder) {
    const folderPath = segs.map(s => s.mode === "exact" ? `"${s.text}"` : "*").join("/")
    return `All files inside ${folderPath}`
  }
  const last = segs[segs.length - 1]
  const folders = segs.slice(0, -1)
  const fileDesc =
    last.mode === "exact" ? `"${last.text}"` :
    last.mode === "extension" ? `any .${last.ext} file` :
    "any file"
  if (folders.length === 0) return `${fileDesc} anywhere in the zip`
  const folderPath = folders.map(s => s.mode === "exact" ? s.text : "*").join("/")
  return `${fileDesc} in "${folderPath}"`
}

// ── Known package type presets ────────────────────────────────────────────────

const KNOWN_PACKAGE_TYPES: Array<{ label: string; exts: string[]; regex: string }> = [
  { label: "InDesign",         exts: ["indd", "indt"],       regex: "(.*?)\\.(indd|indt)$" },
  { label: "InDesign Markup",  exts: ["idml"],               regex: "(.*?)\\.idml$" },
  { label: "Illustrator",      exts: ["ai"],                 regex: "(.*?)\\.ai$" },
  { label: "Photoshop",        exts: ["psd"],                regex: "(.*?)\\.psd$" },
  { label: "3D Studio Max",    exts: ["max"],                regex: "(.*?)\\.max$" },
  { label: "Cinema 4D",        exts: ["c4d"],                regex: "(.*?)\\.c4d$" },
  { label: "Blender",          exts: ["blend"],              regex: "(.*?)\\.blend$" },
  { label: "3D (GLB/glTF)",    exts: ["glb", "gltf"],        regex: "(.*?)\\.(glb|gltf)$" },
  { label: "3D (FBX)",         exts: ["fbx"],                regex: "(.*?)\\.fbx$" },
  { label: "3D (OBJ)",         exts: ["obj"],                regex: "(.*?)\\.obj$" },
]

// ── XML → config parser ────────────────────────────────────────────────────────

function parsePackageEl(pkg: Element): PackageConfig {
  const name = pkg.getAttribute("name") ?? "MyPackage"
  const enabled = pkg.getAttribute("enabled") !== "false"

  const ruleEls = Array.from(pkg.querySelectorAll("identification rule"))
  const identificationRules = ruleEls.length > 0
    ? ruleEls.map(r => r.getAttribute("regex") ?? "")
    : [""]

  const ctEl = Array.from(pkg.children).find(c => c.tagName.toLowerCase() === "contenttype")
  const contentTypeMode = (ctEl?.getAttribute("mode") ?? "detect") as PackageConfig["contentTypeMode"]
  const contentTypeValue = contentTypeMode === "fixed" ? (ctEl?.textContent?.trim() ?? "") : ""

  const masterEl = pkg.querySelector("masterFile, masterfile")
  const masterFileRegex = masterEl?.getAttribute("regex") ?? ""
  const masterFilePreviewRegex = masterEl?.getAttribute("previewRegex") ?? masterEl?.getAttribute("previewregex") ?? ""

  const additionalFiles: AdditionalFileConfig[] = Array.from(
    pkg.querySelectorAll("additionalFiles add, additionalfiles add")
  ).map(el => ({
    id: newId(),
    regex: el.getAttribute("regex") ?? "",
    purpose: el.getAttribute("purpose") ?? "",
    usages: el.getAttribute("usages") ?? "",
  }))

  const records: RecordConfig[] = Array.from(
    pkg.querySelectorAll("records add")
  ).map(el => {
    const recCtEl = Array.from(el.children).find(c => c.tagName.toLowerCase() === "contenttype")
    const classifications: ClassificationConfig[] = Array.from(
      el.querySelectorAll("classification")
    ).map(cls => ({
      id: newId(),
      type: (cls.getAttribute("type") ?? "sameAsMaster") as ClassificationConfig["type"],
      value: cls.getAttribute("value") ?? "",
      option: (cls.getAttribute("option") ?? "") as ClassificationConfig["option"],
    }))
    return {
      id: newId(),
      regex: el.getAttribute("regex") ?? "",
      linkType: (el.getAttribute("linkType") ?? "pubItem") as RecordConfig["linkType"],
      linkField: el.getAttribute("linkField") ?? "",
      checkDuplicate: el.getAttribute("checkDuplicate") ?? "FileNameAndContent",
      contentTypeMode: (recCtEl?.getAttribute("mode") ?? "detect") as RecordConfig["contentTypeMode"],
      contentTypeValue: recCtEl?.textContent?.trim() ?? "",
      classifications: classifications.length > 0
        ? classifications
        : [{ id: newId(), type: "sameAsMaster", value: "", option: "" }],
    }
  })

  const rawXml = new XMLSerializer().serializeToString(pkg)

  return {
    id: newId(),
    name, enabled, contentTypeMode, contentTypeValue,
    identificationRules, masterFileRegex, masterFilePreviewRegex,
    additionalFiles, records, rawXml,
  }
}

function parseXmlToConfigs(xmlString: string): { configs: PackageConfig[] } | { error: string } {
  let doc: Document
  try {
    doc = new DOMParser().parseFromString(xmlString.trim(), "text/xml")
  } catch {
    return { error: "Could not parse XML" }
  }
  const parseError = doc.querySelector("parsererror")
  if (parseError) {
    const msg = parseError.textContent?.split("\n")[0] ?? "XML syntax error"
    return { error: msg }
  }
  const pkgEls = Array.from(doc.querySelectorAll("packages > package, package"))
  if (pkgEls.length === 0) return { error: "No <package> element found" }
  return { configs: pkgEls.map(parsePackageEl) }
}

function ruleMatchesZip(rule: string, zipPaths: string[]): boolean {
  if (!rule.trim()) return false
  try {
    const re = new RegExp(rule, "i")
    return zipPaths.some(p => {
      const backslash = "\\" + p.replace(/\//g, "\\")
      return re.test(p) || re.test(backslash)
    })
  } catch {
    return false
  }
}

function esc(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function generatePackageBlock(config: PackageConfig): string {
  const ind = (n: number) => "  ".repeat(n)
  const lines: string[] = []

  const enabledAttr = config.enabled ? ` enabled="true"` : ""
  lines.push(`${ind(1)}<package name="${esc(config.name)}"${enabledAttr}>`, ``)

  const rules = config.identificationRules.filter(r => r.trim())
  if (rules.length > 0) {
    lines.push(`${ind(2)}<identification>`)
    for (const rule of rules) lines.push(`${ind(3)}<rule regex="${esc(rule)}"/>`)
    lines.push(`${ind(2)}</identification>`, ``)
  }

  if (config.contentTypeMode === "keep") {
    lines.push(`${ind(2)}<contentType mode="keep" />`, ``)
  } else if (config.contentTypeMode === "fixed" && config.contentTypeValue.trim()) {
    lines.push(`${ind(2)}<contentType mode="fixed">${esc(config.contentTypeValue)}</contentType>`, ``)
  }

  const hasMaster = config.masterFileRegex.trim() || config.masterFilePreviewRegex.trim()
  const additionals = config.additionalFiles.filter(af => af.regex.trim())
  const recs = config.records.filter(r => r.regex.trim())

  if (hasMaster || additionals.length > 0 || recs.length > 0) {
    lines.push(`${ind(2)}<structure>`, ``)

    if (hasMaster) {
      const rAttr = config.masterFileRegex.trim() ? ` regex="${esc(config.masterFileRegex)}"` : ""
      const pAttr = config.masterFilePreviewRegex.trim() ? ` previewRegex="${esc(config.masterFilePreviewRegex)}"` : ""
      lines.push(`${ind(3)}<masterFile${rAttr}${pAttr} />`, ``)
    }

    if (additionals.length > 0) {
      lines.push(`${ind(3)}<additionalFiles>`)
      for (const af of additionals) {
        const pAttr = af.purpose ? ` purpose="${esc(af.purpose)}"` : ""
        const uAttr = af.usages ? ` usages="${esc(af.usages)}"` : ""
        lines.push(`${ind(4)}<add regex="${esc(af.regex)}"${pAttr}${uAttr} />`)
      }
      lines.push(`${ind(3)}</additionalFiles>`, ``)
    }

    if (recs.length > 0) {
      lines.push(`${ind(3)}<records>`)
      for (const rec of recs) {
        const lfAttr = rec.linkType === "recordLink" && rec.linkField.trim() ? ` linkField="${esc(rec.linkField)}"` : ""
        const cdAttr = rec.checkDuplicate ? ` checkDuplicate="${esc(rec.checkDuplicate)}"` : ""
        lines.push(`${ind(4)}<add regex="${esc(rec.regex)}" linkType="${rec.linkType}"${lfAttr}${cdAttr}>`)
        if (rec.contentTypeMode === "fixed" && rec.contentTypeValue.trim()) {
          lines.push(`${ind(5)}<contentType mode="fixed">${esc(rec.contentTypeValue)}</contentType>`)
        }
        for (const cls of rec.classifications) {
          const optAttr = cls.option ? ` option="${cls.option}"` : ""
          if (cls.type === "sameAsMaster") {
            lines.push(`${ind(5)}<classification type="sameAsMaster"${optAttr} />`)
          } else if (cls.value.trim()) {
            lines.push(`${ind(5)}<classification type="${cls.type}" value="${esc(cls.value)}"${optAttr} />`)
          }
        }
        lines.push(`${ind(4)}</add>`)
      }
      lines.push(`${ind(3)}</records>`, ``)
    }

    lines.push(`${ind(2)}</structure>`)
  }

  lines.push(``, `${ind(1)}</package>`)
  return lines.join("\n")
}

function generateAllXml(configs: PackageConfig[]): string {
  if (configs.length === 0) return `<packages>\n\n</packages>`
  const blocks = configs.map(generatePackageBlock).join("\n\n")
  return `<packages>\n\n${blocks}\n\n</packages>`
}

// ── FileTreeNode ───────────────────────────────────────────────────────────────

const ROLE_COLOR: Record<string, string> = {
  master: "text-emerald-600 dark:text-emerald-400",
  preview: "text-violet-600 dark:text-violet-400",
  additional: "text-blue-600 dark:text-blue-400",
  record: "text-amber-600 dark:text-amber-400",
}
const ROLE_LABEL: Record<string, string> = {
  master: "primary",
  preview: "preview",
  additional: "additional",
  record: "linked",
}

function FileTreeNode({
  node, depth, config, expandedPaths, focusedMatches, selectedPath, onToggle, onSelect,
}: {
  node: TreeNode
  depth: number
  config: PackageConfig
  expandedPaths: Set<string>
  focusedMatches: Set<string>
  selectedPath: string | null
  onToggle: (path: string) => void
  onSelect: (path: string, isFolder: boolean) => void
}) {
  const isExpanded = expandedPaths.has(node.path)
  const roles = !node.isFolder ? getFileRoles(node.path, config) : []
  const recordLinkTypes = !node.isFolder ? getRecordLinkTypes(node.path, config) : []
  const hasConflict = roles.length > 1
  const isFocusedMatch = focusedMatches.has(node.path)
  const isSelected = selectedPath === node.path

  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1.5 py-0.5 rounded text-sm select-none cursor-pointer transition-colors",
          "hover:bg-muted/40",
          !hasConflict && roles[0] && ROLE_COLOR[roles[0]],
          hasConflict && "text-orange-600 dark:text-orange-400",
          isFocusedMatch && "bg-yellow-100/60 dark:bg-yellow-900/30 ring-1 ring-inset ring-yellow-400/40",
          isSelected && "bg-primary/10 ring-1 ring-inset ring-primary/30 !text-foreground",
        )}
        style={{ paddingLeft: `${depth * 16 + 8}px`, paddingRight: 8 }}
        onClick={() => onSelect(node.path, node.isFolder)}
      >
        {node.isFolder ? (
          <span
            className="flex items-center gap-1 shrink-0"
            onClick={e => { e.stopPropagation(); onToggle(node.path) }}
          >
            {isExpanded
              ? <ChevronDown className="h-3.5 w-3.5 opacity-50" />
              : <ChevronRight className="h-3.5 w-3.5 opacity-50" />}
            {isExpanded
              ? <FolderOpen className="h-3.5 w-3.5" />
              : <FolderIcon className="h-3.5 w-3.5" />}
          </span>
        ) : (
          <>
            <span className="w-3.5 shrink-0" />
            <FileIcon className="h-3.5 w-3.5 shrink-0 opacity-60" />
          </>
        )}
        <span className="truncate flex-1 min-w-0">{node.name}</span>
        {!isSelected && roles.length > 0 && (
          <span className="flex items-center gap-0.5 ml-1 shrink-0">
            {roles.flatMap(r => {
              if (r === "record") {
                const types = recordLinkTypes.length > 0 ? recordLinkTypes : ["pubItem" as const]
                return types.map((lt, i) => (
                  <Badge
                    key={`record-${i}`}
                    variant="outline"
                    className={cn("text-[10px] px-1 py-0 h-4 border-current", ROLE_COLOR[r])}
                  >
                    {lt === "pubItem" ? "linked-pubItem" : "linked-recordLink"}
                  </Badge>
                ))
              }
              return [
                <Badge
                  key={r}
                  variant="outline"
                  className={cn("text-[10px] px-1 py-0 h-4 border-current", ROLE_COLOR[r])}
                >
                  {ROLE_LABEL[r]}
                </Badge>
              ]
            })}
          </span>
        )}
      </div>

      {node.isFolder && isExpanded && node.children.map(child => (
        <FileTreeNode
          key={child.path}
          node={child}
          depth={depth + 1}
          config={config}
          expandedPaths={expandedPaths}
          focusedMatches={focusedMatches}
          selectedPath={selectedPath}
          onToggle={onToggle}
          onSelect={onSelect}
        />
      ))}
    </div>
  )
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
  const [fileTree, setFileTree] = useState<TreeNode[]>([])
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

  // ── XML import dialog state (add new) ──

  // ── Per-card XML dialog (view / edit / replace) ──
  const [pasteTargetId, setPasteTargetId] = useState<string | null>(null)
  const [pasteXml, setPasteXml] = useState("")
  const [pasteXmlError, setPasteXmlError] = useState<string | null>(null)
  const [pasteXmlValid, setPasteXmlValid] = useState<boolean | null>(null)

  // ── Identification test state ──
  const [identTestResults, setIdentTestResults] = useState<Array<{ rule: string; matches: string[] }> | null>(null)
  const [expandedTestRule, setExpandedTestRule] = useState<number | null>(null)

  // ── Misc ──
  const [copied, setCopied] = useState(false)

  // ── Derived ───────────────────────────────────────────────────────────────────

  const selectedConfig = packages.find(p => p.id === selectedPackageId) ?? null

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

  const patternMatchCount = focusedMatches.size

  const conflictCount = useMemo(
    () => selectedConfig ? zipPaths.filter(p => getFileRoles(p, selectedConfig).length > 1).length : 0,
    [zipPaths, selectedConfig]
  )

  const zipSuggestions = useMemo(() => {
    const extsInZip = new Set(zipPaths.map(p => p.split(".").pop()?.toLowerCase()).filter(Boolean))
    return KNOWN_PACKAGE_TYPES.filter(pt => pt.exts.some(e => extsInZip.has(e)))
  }, [zipPaths])

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
    const pkg: PackageConfig = {
      id: newId(),
      name: "New Package",
      enabled: true,
      contentTypeMode: "detect",
      contentTypeValue: "",
      identificationRules: [""],
      masterFileRegex: "",
      masterFilePreviewRegex: "",
      additionalFiles: [],
      records: [],
    }
    setPackages(prev => [pkg, ...prev])
    setSelectedPackageId(pkg.id)
    setIdentTestResults(null)
    setSelectedPath(null)
  }

  const movePackageUp = (id: string) =>
    setPackages(prev => {
      const i = prev.findIndex(p => p.id === id)
      if (i <= 0) return prev
      const next = [...prev]
      ;[next[i - 1], next[i]] = [next[i], next[i - 1]]
      return next
    })

  const movePackageDown = (id: string) =>
    setPackages(prev => {
      const i = prev.findIndex(p => p.id === id)
      if (i < 0 || i >= prev.length - 1) return prev
      const next = [...prev]
      ;[next[i], next[i + 1]] = [next[i + 1], next[i]]
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

  const set = <K extends keyof PackageConfig>(key: K, value: PackageConfig[K]) =>
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
    updateSelected(prev => ({
      ...prev,
      records: [...prev.records, {
        id: newId(), regex: "", linkType: "pubItem", linkField: "",
        checkDuplicate: "FileNameAndContent", contentTypeMode: "detect", contentTypeValue: "",
        classifications: [{ id: newId(), type: "sameAsMaster", value: "", option: "" }],
      }],
    }))

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
        ? { ...r, classifications: [...r.classifications, { id: newId(), type: "sameAsMaster", value: "", option: "" }] }
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
    setExpandedTestRule(null)
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
      const tree = buildTree(paths)
      setFileTree(tree)
      setExpandedPaths(new Set(tree.map(n => n.path)))
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
    setPasteTargetId(id)
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
    if (!pasteTargetId) return
    const parsed = parseXmlToConfigs(pasteXml)
    if ("error" in parsed) {
      setPasteXmlError(parsed.error)
      setPasteXmlValid(false)
      return
    }
    const pkg = parsed.configs[0]
    setPackages(prev => prev.map(p => p.id === pasteTargetId ? { ...pkg, id: pasteTargetId } : p))
    if (selectedPackageId === pasteTargetId) setIdentTestResults(null)
    setPasteTargetId(null)
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
      set("masterFileRegex", regex)
    } else if (assignRole === "preview") {
      set("masterFilePreviewRegex", regex)
    } else if (assignRole === "additional") {
      updateSelected(prev => ({
        ...prev,
        additionalFiles: [...prev.additionalFiles, { id: newId(), regex, purpose: assignPurpose, usages: assignUsages }],
      }))
    } else if (assignRole === "record") {
      updateSelected(prev => ({
        ...prev,
        records: [...prev.records, {
          id: newId(), regex, linkType: "pubItem", linkField: "",
          checkDuplicate: "FileNameAndContent", contentTypeMode: "detect", contentTypeValue: "",
          classifications: [{ id: newId(), type: "sameAsMaster", value: "", option: "" }],
        }],
      }))
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
              <div
                className={cn(
                  "flex-1 flex flex-col items-center justify-center m-4 rounded-lg border-2 border-dashed transition-colors cursor-pointer",
                  isDragging ? "border-primary bg-primary/5" : "border-border hover:border-primary/50 hover:bg-muted/20"
                )}
                onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-8 w-8 text-muted-foreground mb-2" />
                <p className="text-sm font-medium">Drop a .zip file here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse</p>
              </div>
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
              <div className="border-t border-border bg-muted/20 p-3 space-y-3 shrink-0">

                <div className="flex items-center gap-2">
                  {selectedIsFolder
                    ? <FolderIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                    : <FileIcon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  <span className="text-xs font-mono truncate flex-1 min-w-0 text-foreground">{selectedPath}</span>
                  <Button variant="ghost" size="icon" className="h-5 w-5 shrink-0" onClick={() => setSelectedPath(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>

                {!selectedConfig && (
                  <p className="text-xs text-muted-foreground">
                    Select a package in the Current Config tab to assign this file.
                  </p>
                )}

                {selectedConfig && (
                  <>
                    {/* Visual segment builder */}
                    {!isRawMode ? (
                      <div className="space-y-2">
                        <div className="flex items-center gap-1 flex-wrap">
                          {segments.map((seg, i) => {
                            const display =
                              seg.mode === "exact" ? seg.text :
                              seg.mode === "extension" ? `*.${seg.ext}` : "*"
                            const tooltip =
                              seg.mode === "exact"
                                ? (seg.isFile && seg.ext ? `click → *.${seg.ext}` : "click → *")
                                : seg.mode === "extension" ? "click → *"
                                : "click → exact"
                            return (
                              <span key={i} className="flex items-center gap-1">
                                {i > 0 && <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />}
                                <button
                                  title={tooltip}
                                  onClick={() => setSegments(prev => prev.map((s, j) =>
                                    j === i ? { ...s, mode: nextSegmentMode(s) } : s
                                  ))}
                                  className={cn(
                                    "text-xs px-2 py-0.5 rounded border font-mono transition-all",
                                    seg.mode === "exact" && "border-border bg-background text-foreground hover:border-primary/50",
                                    seg.mode === "extension" && "border-blue-400/60 bg-blue-50/60 dark:bg-blue-900/20 text-blue-700 dark:text-blue-300 border-dashed",
                                    seg.mode === "wildcard" && "border-amber-400/60 bg-amber-50/60 dark:bg-amber-900/20 text-amber-700 dark:text-amber-300 border-dashed",
                                  )}
                                >
                                  {display}
                                </button>
                              </span>
                            )
                          })}
                          {selectedIsFolder && (
                            <span className="flex items-center gap-1">
                              <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                              <span className="text-xs text-muted-foreground font-mono">…</span>
                            </span>
                          )}
                        </div>

                        <p className="text-xs text-muted-foreground leading-snug">
                          {describePattern(segments, selectedIsFolder)}
                        </p>

                        <div className="flex gap-3 text-xs text-muted-foreground">
                          <span className="flex items-center gap-1">
                            <span className="inline-block w-2.5 h-2.5 border border-border rounded bg-background" />
                            exact
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block w-2.5 h-2.5 border border-dashed border-blue-400/60 rounded bg-blue-50/60 dark:bg-blue-900/20" />
                            extension
                          </span>
                          <span className="flex items-center gap-1">
                            <span className="inline-block w-2.5 h-2.5 border border-dashed border-amber-400/60 rounded bg-amber-50/60 dark:bg-amber-900/20" />
                            wildcard
                          </span>
                        </div>
                      </div>
                    ) : (
                      <Input
                        value={rawRegex}
                        onChange={e => setRawRegex(e.target.value)}
                        className="font-mono text-xs h-8"
                        placeholder="regex pattern"
                        autoFocus
                      />
                    )}

                    <div className="flex items-center gap-2">
                      <code className="flex-1 min-w-0 text-xs font-mono bg-background border border-border px-2 py-1 rounded truncate text-muted-foreground">
                        {activeRegex || "—"}
                      </code>
                      <span className={cn(
                        "text-xs tabular-nums shrink-0",
                        patternMatchCount > 0 ? "text-primary font-medium" : "text-muted-foreground"
                      )}>
                        {patternMatchCount}✓
                      </span>
                      <button
                        onClick={() => {
                          if (!isRawMode) { setRawRegex(derivedRegex); setIsRawMode(true) }
                          else setIsRawMode(false)
                        }}
                        className="text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0"
                        title={isRawMode ? "Back to visual" : "Edit regex directly"}
                      >
                        {isRawMode ? "visual" : "edit"}
                      </button>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-xs">Assign as</Label>
                      <Select value={assignRole} onValueChange={v => setAssignRole(v as AssignRole)}>
                        <SelectTrigger className="h-8 text-sm">
                          <SelectValue placeholder="Choose role…" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="identification">Identification Rule</SelectItem>
                          <SelectItem value="master">Primary File</SelectItem>
                          <SelectItem value="preview">Preview</SelectItem>
                          <SelectItem value="additional">Additional File</SelectItem>
                          <SelectItem value="record">Linked Record</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    {assignRole === "additional" && (
                      <div className="grid grid-cols-2 gap-2">
                        <div className="space-y-1">
                          <Label className="text-xs">Purpose</Label>
                          <Select value={assignPurpose || "_none"} onValueChange={v => setAssignPurpose(v === "_none" ? "" : v)}>
                            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="None" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="_none">None</SelectItem>
                              <SelectItem value="review">review</SelectItem>
                              <SelectItem value="spinset">spinset</SelectItem>
                              <SelectItem value="3dpreview">3dpreview</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="space-y-1">
                          <Label className="text-xs">Usages</Label>
                          <Input value={assignUsages} onChange={e => setAssignUsages(e.target.value)} className="h-8 text-xs" placeholder="e.g. print" />
                        </div>
                      </div>
                    )}

                    <Button
                      size="sm"
                      className="w-full h-8"
                      disabled={!assignRole || !activeRegex.trim()}
                      onClick={applyAssignment}
                    >
                      Apply
                    </Button>
                  </>
                )}
              </div>
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
                        ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
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
                    {(() => {
                      const firstMatchIdx = zipPaths.length > 0
                        ? packages.findIndex(p => {
                            const rules = p.identificationRules.filter(r => r.trim())
                            return rules.length > 0 && rules.every(r => ruleMatchesZip(r, zipPaths))
                          })
                        : -1
                      return packages.map((pkg, i) => {
                      const rules = pkg.identificationRules.filter(r => r.trim())
                      const hasZip = zipPaths.length > 0
                      const ruleResults = hasZip
                        ? rules.map(r => ({ rule: r, hit: ruleMatchesZip(r, zipPaths) }))
                        : []
                      const isMatch = hasZip && rules.length > 0 && ruleResults.every(r => r.hit)
                      const isPartial = hasZip && !isMatch && ruleResults.some(r => r.hit)
                      const isShadowed = isMatch && firstMatchIdx >= 0 && i > firstMatchIdx
                      const isSelected = selectedPackageId === pkg.id

                      return (
                        <div
                          key={pkg.id}
                          className={cn(
                            "rounded-lg border p-3 space-y-2 transition-colors cursor-pointer",
                            isSelected
                              ? "border-primary/60 bg-primary/5 ring-1 ring-primary/20"
                              : isMatch
                              ? "border-emerald-500/40 bg-emerald-50/20 dark:bg-emerald-950/10 hover:bg-emerald-50/30 dark:hover:bg-emerald-950/20"
                              : isPartial
                              ? "border-amber-400/40 hover:bg-muted/30"
                              : "border-border bg-card hover:bg-muted/30"
                          )}
                          onClick={() => handleSelectPackage(pkg.id)}
                        >
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2 min-w-0">
                              {hasZip && rules.length > 0 && (
                                isMatch
                                  ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                  : isPartial
                                  ? <span className="text-amber-500 text-xs font-bold shrink-0">½</span>
                                  : <X className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" />
                              )}
                              <span className="font-medium text-sm truncate">{pkg.name}</span>
                              {!pkg.enabled && (
                                <Badge variant="secondary" className="text-xs shrink-0">disabled</Badge>
                              )}
                              {isMatch && (
                                <Badge className="text-xs shrink-0 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400 border-emerald-500/30 border">
                                  matches zip
                                </Badge>
                              )}
                              {isShadowed && (
                                <Badge className="text-xs shrink-0 bg-orange-500/15 text-orange-700 dark:text-orange-400 border-orange-500/30 border">
                                  hidden by "{packages[firstMatchIdx].name}"
                                </Badge>
                              )}
                            </div>
                            <div
                              className="flex items-center gap-0.5 shrink-0"
                              onClick={e => e.stopPropagation()}
                            >
                              <Button
                                size="sm" variant="ghost" className="h-7 w-7 p-0"
                                disabled={i === 0}
                                onClick={() => movePackageUp(pkg.id)}
                                title="Move up"
                              >
                                <ArrowUp className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm" variant="ghost" className="h-7 w-7 p-0"
                                disabled={i === packages.length - 1}
                                onClick={() => movePackageDown(pkg.id)}
                                title="Move down"
                              >
                                <ArrowDown className="h-3 w-3" />
                              </Button>
                              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => openPasteDialog(pkg.id)}>
                                XML
                              </Button>
                              <Button
                                size="sm" variant="ghost"
                                className="h-7 w-7 p-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                                onClick={() => deletePackage(pkg.id)}
                                title="Delete"
                              >
                                <Trash2 className="h-3 w-3" />
                              </Button>
                              <Button
                                size="sm"
                                variant={isSelected ? "default" : "outline"}
                                className="h-7 px-3 text-xs"
                                onClick={() => handleEditPackage(pkg.id)}
                              >
                                Edit
                              </Button>
                            </div>
                          </div>

                          {rules.length > 0 ? (
                            <div className="space-y-0.5 pl-1">
                              {rules.slice(0, 2).map((rule, j) => (
                                <div key={j} className="flex items-center gap-2">
                                  {hasZip && (
                                    ruleResults[j].hit
                                      ? <Check className="h-3 w-3 text-emerald-500 shrink-0" />
                                      : <X className="h-3 w-3 text-destructive/40 shrink-0" />
                                  )}
                                  <code className="text-xs font-mono text-muted-foreground truncate">{rule}</code>
                                </div>
                              ))}
                              {rules.length > 2 && (
                                <p className="text-xs text-muted-foreground ml-5">+{rules.length - 2} more rule{rules.length - 2 !== 1 ? "s" : ""}</p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-muted-foreground pl-1">No identification rules</p>
                          )}
                        </div>
                      )
                    })
                    })()}
                  </div>
                </ScrollArea>
              )}
            </TabsContent>

            {/* ── Configure tab ── */}
            <TabsContent value="configure" className="flex-1 overflow-hidden m-0">
              {!selectedConfig ? (
                <div className="flex flex-col items-center justify-center gap-3 p-8 text-center h-full">
                  <Package2 className="h-8 w-8 text-muted-foreground" />
                  <div className="space-y-1">
                    <p className="text-sm font-medium">No package selected</p>
                    <p className="text-sm text-muted-foreground">
                      Select a package from the Current Config tab, or create a new one.
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" onClick={() => setActiveTab("import")}>
                      View Packages
                    </Button>
                    <Button size="sm" onClick={addBlankPackage}>
                      <Plus className="h-3.5 w-3.5 mr-1.5" /> New Package
                    </Button>
                  </div>
                </div>
              ) : (
                <ScrollArea className="h-full">
                  <div className="p-6 space-y-8 max-w-2xl">

                    {/* Package */}
                    <section className="space-y-4">
                      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Package</h2>
                      <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-1.5">
                          <Label>Name</Label>
                          <Input value={selectedConfig.name} onChange={e => set("name", e.target.value)} placeholder="e.g. InDesign" />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Package Content Type</Label>
                          <div className="flex gap-2">
                            <Select value={selectedConfig.contentTypeMode} onValueChange={v => set("contentTypeMode", v as PackageConfig["contentTypeMode"])}>
                              <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                <SelectItem value="detect">Detect</SelectItem>
                                <SelectItem value="fixed">Fixed</SelectItem>
                                <SelectItem value="keep">Keep</SelectItem>
                              </SelectContent>
                            </Select>
                            {selectedConfig.contentTypeMode === "fixed" && (
                              <Input value={selectedConfig.contentTypeValue} onChange={e => set("contentTypeValue", e.target.value)} placeholder="Content type name" />
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        <Switch id="enabled" checked={selectedConfig.enabled} onCheckedChange={v => set("enabled", v)} />
                        <Label htmlFor="enabled">Enabled</Label>
                      </div>
                    </section>

                    <Separator />

                    {/* Identification */}
                    <section className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Identification Rules</h2>
                        <div className="flex gap-2">
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={!zipPaths.length || !selectedConfig.identificationRules.some(r => r.trim())}
                            onClick={runIdentificationTest}
                            title={!zipPaths.length ? "Load a zip first" : ""}
                          >
                            <FlaskConical className="h-3.5 w-3.5 mr-1" /> Test Match
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => set("identificationRules", [...selectedConfig.identificationRules, ""])}>
                            <Plus className="h-3.5 w-3.5 mr-1" /> Add Rule
                          </Button>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Aprimo uses these regexes to detect the package type when a zip is uploaded. Multiple rules use AND logic — all must match.
                      </p>

                      <div className="space-y-1.5">
                        <p className="text-xs text-muted-foreground">
                          {zipSuggestions.length > 0
                            ? "Detected in this zip — click to use:"
                            : "Common package types — click to use:"}
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          {(zipSuggestions.length > 0 ? zipSuggestions : KNOWN_PACKAGE_TYPES).map(pt => {
                            const alreadyAdded = selectedConfig.identificationRules.includes(pt.regex)
                            return (
                              <button
                                key={pt.regex}
                                disabled={alreadyAdded}
                                onClick={() => addIdentificationRule(pt.regex)}
                                className={cn(
                                  "text-xs px-2 py-0.5 rounded border transition-colors font-mono",
                                  alreadyAdded
                                    ? "border-primary/40 bg-primary/10 text-primary cursor-default"
                                    : "border-border hover:border-primary/50 text-muted-foreground hover:text-foreground"
                                )}
                                title={pt.regex}
                              >
                                {pt.label}
                              </button>
                            )
                          })}
                        </div>
                      </div>

                      <div className="space-y-2">
                        {selectedConfig.identificationRules.map((rule, i) => (
                          <div key={i} className="flex gap-2">
                            <Input
                              value={rule}
                              onChange={e => {
                                const next = [...selectedConfig.identificationRules]
                                next[i] = e.target.value
                                set("identificationRules", next)
                                setIdentTestResults(null)
                              }}
                              onFocus={() => setFocusedInput({ kind: "identification", index: i })}
                              onBlur={() => setFocusedInput(null)}
                              placeholder="e.g. (.*?)\.(indd|indt)$"
                              className="font-mono text-sm"
                            />
                            {selectedConfig.identificationRules.length > 1 && (
                              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0"
                                onClick={() => set("identificationRules", selectedConfig.identificationRules.filter((_, j) => j !== i))}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        ))}
                      </div>

                      {/* Test results */}
                      {identTestResults && (() => {
                        const allPassed = identTestResults.every(r => r.matches.length > 0)
                        return (
                          <div className="rounded-lg border border-border p-3 space-y-2.5 bg-muted/20">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium">Test Results</span>
                              <button onClick={() => setIdentTestResults(null)} className="text-muted-foreground hover:text-foreground transition-colors">
                                <X className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <div className="space-y-2">
                              {identTestResults.map((r, i) => (
                                <div key={i} className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    {r.matches.length > 0
                                      ? <Check className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                                      : <X className="h-3.5 w-3.5 text-destructive shrink-0" />}
                                    <code className="text-xs font-mono text-muted-foreground truncate flex-1 min-w-0">{r.rule}</code>
                                    {r.matches.length > 0 && (
                                      <button
                                        onClick={() => setExpandedTestRule(expandedTestRule === i ? null : i)}
                                        className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 shrink-0 hover:underline"
                                      >
                                        {r.matches.length} file{r.matches.length !== 1 ? "s" : ""}
                                        <ChevronDown className={cn("h-3 w-3 transition-transform", expandedTestRule === i && "rotate-180")} />
                                      </button>
                                    )}
                                    {r.matches.length === 0 && (
                                      <span className="text-xs text-destructive shrink-0">no match</span>
                                    )}
                                  </div>
                                  {expandedTestRule === i && (
                                    <div className="ml-5 space-y-0.5 max-h-32 overflow-y-auto">
                                      {r.matches.map(m => (
                                        <div key={m} className="text-xs font-mono text-muted-foreground truncate">{m}</div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>

                            <div className={cn(
                              "flex items-center gap-2 pt-2 border-t border-border text-xs font-semibold",
                              allPassed ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                            )}>
                              {allPassed
                                ? <Check className="h-3.5 w-3.5 shrink-0" />
                                : <X className="h-3.5 w-3.5 shrink-0" />}
                              {allPassed
                                ? `This zip would be identified as "${selectedConfig.name}"`
                                : `Would NOT be identified — ${identTestResults.filter(r => r.matches.length > 0).length} of ${identTestResults.length} rules matched`}
                            </div>
                          </div>
                        )
                      })()}
                    </section>

                    <Separator />

                    {/* Primary file */}
                    <section className="space-y-4">
                      <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Primary File</h2>
                      <div className="space-y-3">
                        <div className="space-y-1.5">
                          <Label>File Regex <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                          <Input
                            value={selectedConfig.masterFileRegex}
                            onChange={e => set("masterFileRegex", e.target.value)}
                            onFocus={() => setFocusedInput({ kind: "masterFile" })}
                            onBlur={() => setFocusedInput(null)}
                            placeholder="e.g. (.*?)\.(indd|indt)$"
                            className="font-mono text-sm"
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label>Preview Regex <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                          <Input
                            value={selectedConfig.masterFilePreviewRegex}
                            onChange={e => set("masterFilePreviewRegex", e.target.value)}
                            onFocus={() => setFocusedInput({ kind: "masterPreview" })}
                            onBlur={() => setFocusedInput(null)}
                            placeholder="e.g. \\previews\\.*\.(jpeg|jpg|png)$"
                            className="font-mono text-sm"
                          />
                        </div>
                      </div>
                    </section>

                    <Separator />

                    {/* Additional files */}
                    <section className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Additional Files</h2>
                        <Button variant="outline" size="sm" onClick={addAdditionalFile}>
                          <Plus className="h-3.5 w-3.5 mr-1" /> Add
                        </Button>
                      </div>
                      {selectedConfig.additionalFiles.length === 0 && (
                        <p className="text-xs text-muted-foreground">No additional files configured.</p>
                      )}
                      <div className="space-y-3">
                        {selectedConfig.additionalFiles.map(af => (
                          <div key={af.id} className="border border-border rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-muted-foreground">Additional File</span>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeAF(af.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Regex</Label>
                              <Input
                                value={af.regex}
                                onChange={e => setAF(af.id, "regex", e.target.value)}
                                onFocus={() => setFocusedInput({ kind: "additional", id: af.id })}
                                onBlur={() => setFocusedInput(null)}
                                placeholder="e.g. document fonts\\(.*?)\.*$"
                                className="font-mono text-sm"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Purpose <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                                <Select value={af.purpose || "_none"} onValueChange={v => setAF(af.id, "purpose", v === "_none" ? "" : v)}>
                                  <SelectTrigger><SelectValue placeholder="None" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="_none">None</SelectItem>
                                    <SelectItem value="review">review</SelectItem>
                                    <SelectItem value="spinset">spinset</SelectItem>
                                    <SelectItem value="3dpreview">3dpreview</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1.5">
                                <Label>Usages <span className="text-muted-foreground font-normal text-xs">(optional)</span></Label>
                                <Input value={af.usages} onChange={e => setAF(af.id, "usages", e.target.value)} placeholder="e.g. print" />
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <Separator />

                    {/* Records */}
                    <section className="space-y-4">
                      <div className="flex items-center justify-between">
                        <h2 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">Linked Records</h2>
                        <Button variant="outline" size="sm" onClick={addRecord}>
                          <Plus className="h-3.5 w-3.5 mr-1" /> Add
                        </Button>
                      </div>
                      {selectedConfig.records.length === 0 && (
                        <p className="text-xs text-muted-foreground">No linked records configured.</p>
                      )}
                      <div className="space-y-3">
                        {selectedConfig.records.map(rec => (
                          <div key={rec.id} className="border border-border rounded-lg p-4 space-y-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-medium text-muted-foreground">Linked Record</span>
                              <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => removeRec(rec.id)}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                            <div className="space-y-1.5">
                              <Label>Regex</Label>
                              <Input
                                value={rec.regex}
                                onChange={e => setRec(rec.id, "regex", e.target.value)}
                                onFocus={() => setFocusedInput({ kind: "record", id: rec.id })}
                                onBlur={() => setFocusedInput(null)}
                                placeholder="e.g. links\\(.*?)\.*$"
                                className="font-mono text-sm"
                              />
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                              <div className="space-y-1.5">
                                <Label>Link Type</Label>
                                <Select value={rec.linkType} onValueChange={v => setRec(rec.id, "linkType", v as RecordConfig["linkType"])}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="pubItem">pubItem</SelectItem>
                                    <SelectItem value="recordLink">recordLink</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                              <div className="space-y-1.5">
                                <Label>Check Duplicate</Label>
                                <Select value={rec.checkDuplicate || "FileNameAndContent"} onValueChange={v => setRec(rec.id, "checkDuplicate", v)}>
                                  <SelectTrigger><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="FileNameAndContent">FileNameAndContent</SelectItem>
                                    <SelectItem value="FileName">FileName</SelectItem>
                                    <SelectItem value="FileContent">FileContent</SelectItem>
                                    <SelectItem value="false">false (always create)</SelectItem>
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                            {rec.linkType === "recordLink" && (
                              <div className="space-y-1.5">
                                <Label>Link Field</Label>
                                <Input value={rec.linkField} onChange={e => setRec(rec.id, "linkField", e.target.value)} placeholder="Field name" />
                              </div>
                            )}
                            <div className="space-y-1.5">
                              <Label>Record Content Type</Label>
                              <div className="flex gap-2">
                                <Select value={rec.contentTypeMode} onValueChange={v => setRec(rec.id, "contentTypeMode", v as RecordConfig["contentTypeMode"])}>
                                  <SelectTrigger className="w-28 shrink-0"><SelectValue /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="detect">Detect</SelectItem>
                                    <SelectItem value="fixed">Fixed</SelectItem>
                                  </SelectContent>
                                </Select>
                                {rec.contentTypeMode === "fixed" && (
                                  <Input value={rec.contentTypeValue} onChange={e => setRec(rec.id, "contentTypeValue", e.target.value)} placeholder="Content type name" />
                                )}
                              </div>
                            </div>
                            <div className="space-y-2">
                              <div className="flex items-center justify-between">
                                <Label className="text-xs">Classifications</Label>
                                <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => addCls(rec.id)}>
                                  <Plus className="h-3 w-3 mr-1" /> Add
                                </Button>
                              </div>
                              {rec.classifications.map(cls => (
                                <div key={cls.id} className="flex gap-2 items-center">
                                  <Select value={cls.type} onValueChange={v => setCls(rec.id, cls.id, "type", v as ClassificationConfig["type"])}>
                                    <SelectTrigger className="w-36 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="sameAsMaster">sameAsMaster</SelectItem>
                                      <SelectItem value="identifier">identifier</SelectItem>
                                      <SelectItem value="namePath">namePath</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {cls.type !== "sameAsMaster" && (
                                    <Input
                                      value={cls.value}
                                      onChange={e => setCls(rec.id, cls.id, "value", e.target.value)}
                                      placeholder={cls.type === "namePath" ? "/path/to/class" : "identifier"}
                                      className="flex-1 text-sm min-w-0"
                                    />
                                  )}
                                  <Select value={cls.option || "_all"} onValueChange={v => setCls(rec.id, cls.id, "option", v === "_all" ? "" : v as ClassificationConfig["option"])}>
                                    <SelectTrigger className="w-32 shrink-0 text-xs"><SelectValue /></SelectTrigger>
                                    <SelectContent>
                                      <SelectItem value="_all">Always</SelectItem>
                                      <SelectItem value="newOnly">newOnly</SelectItem>
                                      <SelectItem value="duplicateOnly">duplicateOnly</SelectItem>
                                    </SelectContent>
                                  </Select>
                                  {rec.classifications.length > 1 && (
                                    <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => removeCls(rec.id, cls.id)}>
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </Button>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    </section>

                    <div className="pb-4" />
                  </div>
                </ScrollArea>
              )}
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
      <Dialog open={!!pasteTargetId} onOpenChange={open => {
        if (!open) { setPasteTargetId(null); setPasteXmlError(null); setPasteXmlValid(null); setPasteXml("") }
      }}>
        <DialogContent className="max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{packages.find(p => p.id === pasteTargetId)?.name ?? ""} — XML</DialogTitle>
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
