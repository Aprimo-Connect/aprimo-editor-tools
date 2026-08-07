export type AdditionalFileConfig = {
  id: string
  regex: string
  purpose: string
  usages: string
}

export type ClassificationConfig = {
  id: string
  type: "identifier" | "namePath" | "sameAsMaster"
  value: string
  option: "" | "newOnly" | "duplicateOnly"
}

export type RecordConfig = {
  id: string
  regex: string
  linkType: "pubItem" | "recordLink"
  linkField: string
  checkDuplicate: string
  contentTypeMode: "detect" | "fixed"
  contentTypeValue: string
  classifications: ClassificationConfig[]
}

export type PackageConfig = {
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

export type FocusedInput =
  | { kind: "identification"; index: number }
  | { kind: "masterFile" }
  | { kind: "masterPreview" }
  | { kind: "additional"; id: string }
  | { kind: "record"; id: string }
  | null

export type TreeNode = {
  name: string
  path: string
  isFolder: boolean
  children: TreeNode[]
}

export type AssignRole = "master" | "preview" | "additional" | "record" | "identification" | ""
