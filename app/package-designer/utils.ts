import type { AdditionalFileConfig, ClassificationConfig, PackageConfig, RecordConfig } from "./types"

export type FileRole = "master" | "preview" | "additional" | "record"

export const ROLE_COLOR: Record<string, string> = {
  master: "text-emerald-600 dark:text-emerald-400",
  preview: "text-violet-600 dark:text-violet-400",
  additional: "text-blue-600 dark:text-blue-400",
  record: "text-amber-600 dark:text-amber-400",
}

export const ROLE_LABEL: Record<string, string> = {
  master: "primary",
  preview: "preview",
  additional: "additional",
  record: "linked",
}

const _reCache = new Map<string, RegExp | null>()

export function tryMatch(pattern: string, path: string): boolean {
  if (!pattern.trim()) return false
  if (!_reCache.has(pattern)) {
    try { _reCache.set(pattern, new RegExp(pattern, "i")) } catch { _reCache.set(pattern, null) }
  }
  const re = _reCache.get(pattern)
  if (!re) return false
  const backslash = "\\" + path.replace(/\//g, "\\")
  return re.test(path) || re.test(backslash)
}

export function getFileRolesAndLinks(path: string, config: PackageConfig): { roles: FileRole[]; recordLinkTypes: Array<"pubItem" | "recordLink"> } {
  const roles: FileRole[] = []
  if (tryMatch(config.masterFileRegex, path)) roles.push("master")
  if (tryMatch(config.masterFilePreviewRegex, path)) roles.push("preview")
  if (config.additionalFiles.some(af => tryMatch(af.regex, path))) roles.push("additional")
  const matchingLinkTypes = config.records.filter(r => tryMatch(r.regex, path)).map(r => r.linkType)
  if (matchingLinkTypes.length > 0) roles.push("record")
  return { roles, recordLinkTypes: [...new Set(matchingLinkTypes)] as Array<"pubItem" | "recordLink"> }
}

// ── XML → config parser ────────────────────────────────────────────────────────

let _serializer: XMLSerializer | null = null
const getSerializer = () => (_serializer ??= new XMLSerializer())

export function newId() {
  return Math.random().toString(36).slice(2, 10)
}

export function newDefaultClassification(): ClassificationConfig {
  return { id: newId(), type: "sameAsMaster", value: "", option: "" }
}

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
        : [newDefaultClassification()],
    }
  })

  const rawXml = getSerializer().serializeToString(pkg)

  return {
    id: newId(),
    name, enabled, contentTypeMode, contentTypeValue,
    identificationRules, masterFileRegex, masterFilePreviewRegex,
    additionalFiles, records, rawXml,
  }
}

export function parseXmlToConfigs(xmlString: string): { configs: PackageConfig[] } | { error: string } {
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

// ── XML generator ──────────────────────────────────────────────────────────────

export function ruleMatchesZip(rule: string, zipPaths: string[]): boolean {
  return zipPaths.some(p => tryMatch(rule, p))
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

export function generateAllXml(configs: PackageConfig[]): string {
  if (configs.length === 0) return `<packages>\n\n</packages>`
  const blocks = configs.map(generatePackageBlock).join("\n\n")
  return `<packages>\n\n${blocks}\n\n</packages>`
}

// ── Known package type presets ────────────────────────────────────────────────

export const KNOWN_PACKAGE_TYPES: Array<{ label: string; exts: string[]; regex: string }> = [
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

// ── Visual path segment builder ───────────────────────────────────────────────

export type SegmentMode = "exact" | "extension" | "wildcard"

export type PathSegment = {
  text: string
  isFile: boolean
  ext: string | null
  mode: SegmentMode
}

export function escapeForRegex(str: string): string {
  return str.replace(/[.+*?[\](){}^$|\\]/g, "\\$&")
}

export function buildSegmentsFromPath(path: string, isFolder: boolean): PathSegment[] {
  const parts = path.split("/").filter(Boolean)
  return parts.map((text, i) => {
    const isLast = i === parts.length - 1
    const isFile = !isFolder && isLast
    const extMatch = isFile ? text.match(/\.([^.]+)$/) : null
    return { text, isFile, ext: extMatch ? extMatch[1] : null, mode: "exact" as SegmentMode }
  })
}

export function nextSegmentMode(seg: PathSegment): SegmentMode {
  if (!seg.isFile || !seg.ext) return seg.mode === "exact" ? "wildcard" : "exact"
  const cycle: SegmentMode[] = ["exact", "extension", "wildcard"]
  return cycle[(cycle.indexOf(seg.mode) + 1) % cycle.length]
}

export function buildRegexFromSegments(segs: PathSegment[], isFolder: boolean): string {
  if (segs.length === 0) return ""
  const parts = segs.map(seg => {
    if (seg.mode === "exact") return escapeForRegex(seg.text)
    if (seg.mode === "extension") return `(.*?)\\.${escapeForRegex(seg.ext!)}`
    return `(.*?)`
  })
  const joined = parts.join("[\\\\/]")
  return isFolder ? `${joined}[\\\\/]` : `${joined}$`
}

export function describePattern(segs: PathSegment[], isFolder: boolean): string {
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
