"use client"

import { useState, useEffect, useCallback, useMemo, memo, useRef } from "react"
import { Navbar } from "@/components/navbar"
import { useAprimo } from "@/context/aprimo-context"
import { Button } from "@/components/ui/button"
import { Loader2, RefreshCw, X, Search } from "lucide-react"
import { Expander } from "aprimo-js"
import {
  ReactFlow,
  Background,
  Controls,
  Node,
  Edge,
  NodeProps,
  useNodesState,
  useEdgesState,
  MarkerType,
  BackgroundVariant,
  Handle,
  Position,
} from "@xyflow/react"
import "@xyflow/react/dist/style.css"

// ── Domain types ───────────────────────────────────────────────────────────────

interface ALabel { languageId: string; value: string }

interface AFieldDef {
  id: string
  name: string
  dataType?: string
  labels?: ALabel[]
  defaultValue?: string
  validation?: string
  resetToDefaultFields?: string[]
  scope?: string
}

function isGlobal(fd: AFieldDef) { return fd.scope?.toLowerCase().includes("global") ?? false }

interface AFieldGroup {
  id: string
  name: string
  memberIds: string[]
}

interface AContainer {
  kind: "contentType" | "classification"
  id: string
  name: string
  labels?: ALabel[]
  registeredFieldGroupIds: string[]
  registeredFieldIds: string[]
}

// ── Node data shape (single interface, optional fields) ────────────────────────

interface GNodeData {
  label: string
  sublabel?: string
  dataType?: string
  fieldCount?: number
  fgCount?: number
  fdCount?: number
  isHighlight?: boolean
  refKind?: "default" | "validation" | "rule-condition" | "rule-action"
  raw?: AContainer | AFieldGroup | AFieldDef
  [key: string]: unknown
}

type GNode = Node<GNodeData>
type GEdge = Edge

// ── Helpers ────────────────────────────────────────────────────────────────────

function getLabel(labels: ALabel[] | undefined, name: string): string {
  if (!labels?.length) return name
  const en = labels.find(l =>
    l.languageId.toLowerCase().includes("c2bd4f9b") ||
    l.languageId.toLowerCase().startsWith("en"),
  )
  return en?.value ?? labels[0]?.value ?? name
}

const DT_COLOR: Record<string, string> = {
  SingleLineText: "#3b82f6", MultiLineText: "#3b82f6", Html: "#3b82f6",
  RichContent: "#3b82f6", TextList: "#3b82f6",
  Integer: "#16a34a", Decimal: "#16a34a", Duration: "#16a34a", NumericList: "#16a34a",
  DateTime: "#ca8a04",
  Boolean: "#9333ea",
  Option: "#ea580c",
  Link: "#db2777", RecordLink: "#db2777", RecordList: "#db2777",
  ClassificationList: "#0891b2", LanguageList: "#0891b2",
  Json: "#6b7280",
}

function dtColor(dt?: string) { return DT_COLOR[dt ?? ""] ?? "#6b7280" }

// ── Custom Node Components ─────────────────────────────────────────────────────

const ContainerNode = memo(function ContainerNode({ data, selected }: NodeProps) {
  const d = data as GNodeData
  const isClassification = d.sublabel === "Classification"
  const bg = isClassification ? "#16a34a" : "#2563eb"
  const border = isClassification
    ? (selected ? "#86efac" : "#15803d")
    : (selected ? "#93c5fd" : "#1d4ed8")
  return (
    <div style={{
      background: bg, border: `2px solid ${border}`,
      boxShadow: selected ? `0 0 0 3px ${border}55` : "0 1px 3px rgba(0,0,0,0.2)",
      borderRadius: 8, padding: "8px 14px", minWidth: 200, cursor: "pointer", color: "#fff",
    }}>
      {isClassification
        ? <Handle id="bottom" type="target" position={Position.Bottom} style={{ background: "#fff5", width: 8, height: 8 }} />
        : <Handle type="target" position={Position.Left} style={{ background: "#fff5", width: 8, height: 8 }} />
      }
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.75, textTransform: "uppercase", marginBottom: 2 }}>
        {d.sublabel}
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{d.label}</div>
    </div>
  )
})

const FieldGroupNode = memo(function FieldGroupNode({ data, selected }: NodeProps) {
  const d = data as GNodeData
  return (
    <div style={{
      background: "#ea580c", border: `2px solid ${selected ? "#fdba74" : "#c2410c"}`,
      boxShadow: selected ? "0 0 0 3px rgba(253,186,116,0.4)" : "0 1px 3px rgba(0,0,0,0.2)",
      borderRadius: 8, padding: "7px 12px", minWidth: 180, cursor: "pointer", color: "#fff",
    }}>
      <Handle id="bottom" type="target" position={Position.Bottom} style={{ background: "#fdba74", width: 8, height: 8 }} />
      <Handle id="top"    type="source" position={Position.Top}    style={{ background: "#fdba74", width: 8, height: 8 }} />
      <Handle type="source" position={Position.Right} style={{ background: "#fdba74", width: 8, height: 8 }} />
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.75, textTransform: "uppercase", marginBottom: 2 }}>
        Field Group
      </div>
      <div style={{ fontSize: 12, fontWeight: 600, lineHeight: 1.3 }}>{d.label}</div>
      {d.fieldCount !== undefined && (
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>
          {d.fieldCount} field{d.fieldCount !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  )
})

const FieldDefNode = memo(function FieldDefNode({ data, selected }: NodeProps) {
  const d = data as GNodeData
  const color = dtColor(d.dataType)
  return (
    <div style={{
      background: d.isHighlight ? "#4c1d95" : "#fff",
      border: `2px solid ${selected ? "#a78bfa" : "#8b5cf6"}`,
      boxShadow: selected ? "0 0 0 3px rgba(167,139,250,0.4)" : d.isHighlight ? "0 2px 8px rgba(139,92,246,0.4)" : "0 1px 3px rgba(0,0,0,0.15)",
      borderRadius: 8, padding: "8px 12px", minWidth: 180, cursor: "pointer",
    }}>
      <Handle type="target"  position={Position.Left}   style={{ background: "#8b5cf6", width: 8, height: 8 }} />
      <Handle type="source"  position={Position.Right}  style={{ background: "#8b5cf6", width: 8, height: 8 }} />
      <Handle id="top"    type="source" position={Position.Top}    style={{ background: "#8b5cf6", width: 8, height: 8 }} />
      <Handle id="bottom" type="target" position={Position.Bottom} style={{ background: "#8b5cf6", width: 8, height: 8 }} />
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.75, textTransform: "uppercase", marginBottom: 2, color: d.isHighlight ? "#e9d5ff" : "#7c3aed" }}>
        Field Definition
      </div>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: d.isHighlight ? "#fff" : "#4c1d95" }}>{d.label}</div>
      {d.dataType && (
        <div style={{ marginTop: 4 }}>
          <span style={{
            fontSize: 10, fontWeight: 600, color: d.isHighlight ? "#fff" : color,
            background: d.isHighlight ? `${color}55` : `${color}1a`,
            borderRadius: 4, padding: "1px 6px",
          }}>
            {d.dataType}
          </span>
        </div>
      )}
    </div>
  )
})

const CrossRefNode = memo(function CrossRefNode({ data, selected }: NodeProps) {
  const d = data as GNodeData
  const isRule = d.refKind === "rule-condition" || d.refKind === "rule-action"

  if (isRule) {
    // Rules: solid colored card like ContainerNode/FieldGroupNode
    const bg     = "#0369a1"
    const border = selected ? "#7dd3fc" : "#075985"
    const tag    = d.refKind === "rule-condition" ? "condition" : "action"
    return (
      <div style={{
        background: bg, border: `2px solid ${border}`,
        boxShadow: selected ? `0 0 0 3px ${border}55` : "0 1px 3px rgba(0,0,0,0.2)",
        borderRadius: 8, padding: "8px 14px", minWidth: 180, cursor: "pointer", color: "#fff",
      }}>
        <Handle type="source" position={Position.Top} style={{ background: "#fff5", width: 8, height: 8 }} />
        <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", opacity: 0.75, textTransform: "uppercase", marginBottom: 2 }}>Rule</div>
        <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3 }}>{d.label}</div>
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 2 }}>{tag}</div>
      </div>
    )
  }

  // Field definition refs: light/transparent card so they feel secondary
  const isDefault = d.refKind === "default"
  const accent = isDefault ? "#7c3aed" : "#b45309"
  const bg     = isDefault ? "#f5f3ff" : "#fffbeb"
  const border = selected ? accent : (isDefault ? "#c4b5fd" : "#fcd34d")
  const tag    = isDefault ? "default value" : "validation"
  return (
    <div style={{
      background: bg, border: `2px solid ${border}`,
      boxShadow: selected ? `0 0 0 3px ${accent}33` : "0 1px 3px rgba(0,0,0,0.1)",
      borderRadius: 8, padding: "8px 14px", minWidth: 180, cursor: "pointer",
    }}>
      <Handle type="source" position={Position.Right} style={{ background: accent, width: 8, height: 8 }} />
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: accent, opacity: 0.8, textTransform: "uppercase", marginBottom: 2 }}>Field Definition</div>
      <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.3, color: isDefault ? "#4c1d95" : "#78350f" }}>{d.label}</div>
      <div style={{ fontSize: 11, color: accent, opacity: 0.75, marginTop: 2 }}>{tag}</div>
    </div>
  )
})

const nodeTypes = { container: ContainerNode, fieldGroup: FieldGroupNode, fieldDefinition: FieldDefNode, crossRef: CrossRefNode }

// ── Cross-field reference detection ───────────────────────────────────────────

interface CrossRef {
  field: AFieldDef
  via: "default" | "validation"
}

// Aprimo expression syntax:
//   fieldName="<internal name>"  — references field by name
//   fieldId="<guid>"             — references field by ID (most reliable)
const FIELD_NAME_RE = /fieldName\s*=\s*["']([^"']+)["']/gi
const FIELD_ID_RE   = /fieldId\s*=\s*["']([^"']+)["']/gi

function normalizeId(id: string) { return id.replace(/-/g, "").toLowerCase() }

function expressionReferences(expr: string, target: AFieldDef): boolean {
  if (!expr) return false
  // Check fieldId references (exact, most reliable)
  const idMatches = [...expr.matchAll(FIELD_ID_RE)].map(m => m[1])
  if (idMatches.some(id => normalizeId(id) === normalizeId(target.id))) return true
  // Check fieldName references (case-insensitive)
  const nameMatches = [...expr.matchAll(FIELD_NAME_RE)].map(m => m[1])
  return nameMatches.some(n => n.toLowerCase() === target.name.toLowerCase())
}

function findCrossFieldRefs(target: AFieldDef, allFDs: AFieldDef[]): CrossRef[] {
  const refs: CrossRef[] = []
  for (const other of allFDs) {
    if (other.id === target.id) continue
    const inDefault    = expressionReferences(other.defaultValue ?? "", target)
    const inValidation = expressionReferences(other.validation   ?? "", target)
    if (inDefault)               refs.push({ field: other, via: "default" })
    if (inValidation && !inDefault) refs.push({ field: other, via: "validation" })
  }
  return refs
}

// ── Rule types ────────────────────────────────────────────────────────────────

interface ARuleCondition {
  conditionType: string
  fieldDefinitionId?: string
  expression?: string
  reference?: string
}

interface ARuleAction {
  actionType: string
  fieldDefinitionId?: string
  reference?: string
  expression?: string
}

interface ARule {
  id: string
  name: string
  conditions: ARuleCondition[]
  actions: ARuleAction[]
}

interface RuleRef {
  rule: ARule
  via: "condition" | "action"
  detail: string
}

function findRuleRefs(target: AFieldDef, rules: ARule[]): RuleRef[] {
  const refs: RuleRef[] = []
  for (const rule of rules) {
    for (const cond of rule.conditions) {
      const byId = cond.fieldDefinitionId && normalizeId(cond.fieldDefinitionId) === normalizeId(target.id)
      const byExpr = (cond.expression && expressionReferences(cond.expression, target)) ||
                     (cond.reference && expressionReferences(cond.reference, target))
      if (byId || byExpr) {
        refs.push({ rule, via: "condition", detail: cond.conditionType })
        break
      }
    }
    for (const action of rule.actions) {
      const byId = action.fieldDefinitionId && normalizeId(action.fieldDefinitionId) === normalizeId(target.id)
      const byExpr = (action.reference && expressionReferences(action.reference, target)) ||
                     (action.expression && expressionReferences(action.expression, target))
      if (byId || byExpr) {
        refs.push({ rule, via: "action", detail: action.actionType })
        break
      }
    }
  }
  return refs
}

// ── Build focused usage graph for one field definition ─────────────────────────

function buildUsageGraph(
  fd: AFieldDef,
  containers: AContainer[],
  fieldGroupMap: Map<string, AFieldGroup>,
  allFDs: AFieldDef[],
  rules: ARule[],
): { nodes: GNode[]; edges: GEdge[] } {
  const nodes: GNode[] = []
  const edges: GEdge[] = []

  // Which field groups contain this FD?
  const usedFGs = new Map<string, AFieldGroup>()
  for (const [id, fg] of fieldGroupMap) {
    if (fg.memberIds.includes(fd.id)) usedFGs.set(id, fg)
  }

  // Which containers reference those FGs or have this FD directly?
  const relevantContainers: AContainer[] = []
  for (const c of containers) {
    const hasGroup = c.registeredFieldGroupIds.some(gId => usedFGs.has(gId))
    const hasDirect = c.registeredFieldIds.includes(fd.id)
    if (hasGroup || hasDirect) relevantContainers.push(c)
  }

  const fdLabel = getLabel(fd.labels, fd.name)

  // Compute refs up front — needed for layout sizing
  const crossRefs = findCrossFieldRefs(fd, allFDs)
  const ruleRefs  = findRuleRefs(fd, rules)

  // Approximate node dimensions (px) — used only for spacing math
  const FD_W = 210, FD_H = 85
  const FG_W = 200, FG_H = 72
  const CT_W = 210, CT_H = 62
  const REF_W = 200, REF_H = 75
  const RULE_W = 200, RULE_H = 75
  const COL_GAP = 160 // gap between nodes in the same row
  const ROW_GAP = 160 // vertical gap between rows

  const fgList = [...usedFGs.values()]

  // Widths for horizontal rows
  const fgTotalW   = fgList.length   * FG_W   + Math.max(0, fgList.length   - 1) * COL_GAP
  const ruleTotalW = ruleRefs.length * RULE_W  + Math.max(0, ruleRefs.length - 1) * COL_GAP

  // Split containers by kind
  const classificationCTs = relevantContainers.filter(c => c.kind === "classification")
  const contentTypeCTs    = relevantContainers.filter(c => c.kind === "contentType")

  // Classifications spread horizontally ABOVE the FG row
  const clsTotalW = classificationCTs.length * CT_W + Math.max(0, classificationCTs.length - 1) * COL_GAP
  // Content types stacked vertically to the RIGHT of the FG row
  const ctTotalH  = contentTypeCTs.length * CT_H + Math.max(0, contentTypeCTs.length - 1) * COL_GAP

  // Ref fields stacked vertically to the LEFT of FD
  const refTotalH = crossRefs.length * REF_H + Math.max(0, crossRefs.length - 1) * COL_GAP
  const hasRefs   = crossRefs.length > 0

  // Structural width = max of FG row, classification row (above FGs), FD, rules
  const hasCTs  = contentTypeCTs.length > 0
  const structW = Math.max(fgTotalW, clsTotalW, FD_W)
  const totalW  = structW + (hasCTs ? COL_GAP + CT_W : 0)

  // Overall centre-X: leave room for ref fields on the far left
  const ORIGIN_X = hasRefs ? REF_W + ROW_GAP : 0
  const CENTER_X = ORIGIN_X + Math.max(totalW, ruleTotalW, FD_W) / 2

  // Row Y positions (top → bottom): classifications → FGs → FD → rules
  const hasFGs  = fgList.length > 0
  const hasCls  = classificationCTs.length > 0
  const CLS_Y   = 0
  const FG_Y    = hasCls ? CT_H + ROW_GAP : 0
  const FD_Y    = FG_Y + (hasFGs ? FG_H + ROW_GAP : 0)
  const RULE_Y  = FD_Y + FD_H + ROW_GAP

  const FD_X  = CENTER_X - FD_W / 2
  const FD_CY = FD_Y + FD_H / 2
  const FG_CY = FG_Y + FG_H / 2

  // ── FD ───────────────────────────────────────────────────────────────────────
  nodes.push({
    id: "fd-selected",
    type: "fieldDefinition",
    position: { x: FD_X, y: FD_Y },
    data: { label: fdLabel, dataType: fd.dataType, isHighlight: true, raw: fd } as GNodeData,
  })

  // ── TOP: field groups spread horizontally above FD ───────────────────────────
  const fgStartX = CENTER_X - fgTotalW / 2
  fgList.forEach((fg, i) => {
    const x = fgStartX + i * (FG_W + COL_GAP)
    nodes.push({
      id: `fg-${fg.id}`,
      type: "fieldGroup",
      position: { x, y: FG_Y },
      data: { label: fg.name, fieldCount: fg.memberIds.length, raw: fg } as GNodeData,
    })
    edges.push({
      id: `e-fd-fg${fg.id}`,
      source: "fd-selected", sourceHandle: "top",
      target: `fg-${fg.id}`, targetHandle: "bottom",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color: "#ea580c" },
      style: { stroke: "#f97316", strokeWidth: 2 },
    })
  })

  // ── ABOVE FGs: classifications ───────────────────────────────────────────────
  const clsStartX = CENTER_X - clsTotalW / 2
  classificationCTs.forEach((c, i) => {
    const color = "#22c55e"
    nodes.push({
      id: `c-${c.id}`,
      type: "container",
      position: { x: clsStartX + i * (CT_W + COL_GAP), y: CLS_Y },
      data: { label: getLabel(c.labels, c.name), sublabel: "Classification", raw: c } as GNodeData,
    })
    for (const fg of fgList) {
      if (c.registeredFieldGroupIds.includes(fg.id)) {
        edges.push({
          id: `e-fg${fg.id}-c${c.id}`,
          source: `fg-${fg.id}`, sourceHandle: "top",
          target: `c-${c.id}`, targetHandle: "bottom",
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
          style: { stroke: color, strokeWidth: 2 },
        })
      }
    }
    if (c.registeredFieldIds.includes(fd.id)) {
      edges.push({
        id: `e-fd-direct-c${c.id}`,
        source: "fd-selected", sourceHandle: "top",
        target: `c-${c.id}`, targetHandle: "bottom",
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color },
        style: { stroke: color, strokeWidth: 2, strokeDasharray: undefined },
      })
    }
  })

  // ── RIGHT of FG row: content types ───────────────────────────────────────────
  const ctX      = CENTER_X + structW / 2 + COL_GAP
  const ctStartY = FG_CY - ctTotalH / 2
  contentTypeCTs.forEach((c, i) => {
    const color = "#3b82f6"
    nodes.push({
      id: `c-${c.id}`,
      type: "container",
      position: { x: ctX, y: ctStartY + i * (CT_H + COL_GAP) },
      data: { label: getLabel(c.labels, c.name), sublabel: "Content Type", raw: c } as GNodeData,
    })
    for (const fg of fgList) {
      if (c.registeredFieldGroupIds.includes(fg.id)) {
        edges.push({
          id: `e-fg${fg.id}-c${c.id}`,
          source: `fg-${fg.id}`, target: `c-${c.id}`,
          markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
          style: { stroke: color, strokeWidth: 2 },
        })
      }
    }
    if (c.registeredFieldIds.includes(fd.id)) {
      edges.push({
        id: `e-fd-direct-c${c.id}`,
        source: "fd-selected", target: `c-${c.id}`,
        markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color },
        style: { stroke: color, strokeWidth: 2, strokeDasharray: undefined },
      })
    }
  })

  // ── BOTTOM: rules ────────────────────────────────────────────────────────────
  const ruleStartX = CENTER_X - ruleTotalW / 2
  ruleRefs.forEach((ref, i) => {
    const color = "#0369a1"
    nodes.push({
      id: `ruleref-${ref.rule.id}`,
      type: "crossRef",
      position: { x: ruleStartX + i * (RULE_W + COL_GAP), y: RULE_Y },
      data: {
        label: ref.rule.name,
        refKind: ref.via === "condition" ? "rule-condition" : "rule-action",
        raw: ref.rule as unknown as AFieldDef,
      } as GNodeData,
    })
    edges.push({
      id: `e-ruleref-${ref.rule.id}`,
      source: `ruleref-${ref.rule.id}`,
      target: "fd-selected", targetHandle: "bottom",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: undefined },
    })
  })

  // ── LEFT: referenced field definitions ─────────────────────────────────────
  const refX      = ORIGIN_X - ROW_GAP - REF_W
  const refStartY = FD_CY - refTotalH / 2
  crossRefs.forEach((ref, i) => {
    const refLabel = getLabel(ref.field.labels, ref.field.name)
    const color    = ref.via === "default" ? "#7c3aed" : "#b45309"
    nodes.push({
      id: `ref-${ref.field.id}`,
      type: "crossRef",
      position: { x: refX, y: refStartY + i * (REF_H + COL_GAP) },
      data: { label: refLabel, refKind: ref.via, raw: ref.field } as GNodeData,
    })
    edges.push({
      id: `e-ref-${ref.field.id}`,
      source: `ref-${ref.field.id}`, target: "fd-selected",
      markerEnd: { type: MarkerType.ArrowClosed, width: 14, height: 14, color },
      style: { stroke: color, strokeWidth: 1.5, strokeDasharray: undefined },
    })
  })

  return { nodes, edges }
}

// ── Main Page ──────────────────────────────────────────────────────────────────

export default function DataModelPage() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { client, isConnected } = useAprimo() as any

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allFDs, setAllFDs] = useState<AFieldDef[]>([])
  const [fieldGroupMap, setFieldGroupMap] = useState<Map<string, AFieldGroup>>(new Map())
  const [containers, setContainers] = useState<AContainer[]>([])
  const [selectedFD, setSelectedFD] = useState<AFieldDef | null>(null)
  const [fdSearch, setFdSearch] = useState("")

  const [nodes, setNodes, onNodesChange] = useNodesState<GNode>([])
  const [edges, setEdges, onEdgesChange] = useEdgesState<GEdge>([])
  const [clickedNode, setClickedNode] = useState<GNode | null>(null)

  // Rules cache — loaded once on first field selection, then reused
  const rulesCache = useRef<ARule[] | null>(null)
  const [rulesLoading, setRulesLoading] = useState(false)
  const [rulesError, setRulesError] = useState<string | null>(null)
  const [rules, setRules] = useState<ARule[]>([])

  const load = useCallback(async () => {
    if (!client || !isConnected) return
    setLoading(true)
    setError(null)
    setSelectedFD(null)
    rulesCache.current = null
    setRules([])
    setRulesError(null)
    try {
      // 1. Field definitions
      const fdMap = new Map<string, AFieldDef>()
      for await (const page of client.fieldDefinitions.getPaged({ pageSize: 500 })) {
        if (!page.ok) break
        const items = (page.data as { items?: unknown[] })?.items ?? []
        for (const raw of items) {
          const fd = raw as { id: string; name: string; dataType?: string; labels?: ALabel[]; defaultValue?: string; validation?: string; resetToDefaultFields?: string[]; scope?: string }
          fdMap.set(fd.id, {
            id: fd.id, name: fd.name, dataType: fd.dataType, labels: fd.labels,
            defaultValue: fd.defaultValue, validation: fd.validation,
            resetToDefaultFields: fd.resetToDefaultFields ?? [],
            scope: fd.scope,
          })
        }
      }
      setAllFDs([...fdMap.values()].sort((a, b) => a.name.localeCompare(b.name)))

      // 2. Field groups with embedded members via select header
      const fgMap = new Map<string, AFieldGroup>()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const fgExpander = (Expander as any).create().for("FieldGroup").expand("members")
      for await (const page of client.fieldGroups.getPaged({ pageSize: 200 }, fgExpander)) {
        if (!page.ok) break
        const items = (page.data as { items?: unknown[] })?.items ?? []
        for (const raw of items) {
          const fg = raw as { id: string; name: string; _embedded?: { members?: { items?: { id: string }[] } } }
          const memberIds = fg._embedded?.members?.items?.map(m => m.id) ?? []
          fgMap.set(fg.id, { id: fg.id, name: fg.name, memberIds })
        }
      }
      setFieldGroupMap(fgMap)

      // 3. Content types
      const ctList: AContainer[] = []
      for await (const page of client.contentTypes.getPaged({ pageSize: 200 })) {
        if (!page.ok) break
        const items = (page.data as { items?: unknown[] })?.items ?? []
        for (const raw of items) {
          const ct = raw as { id: string; name: string; labels?: ALabel[]; registeredFieldGroups?: { fieldGroupId: string }[]; registeredFields?: { fieldId: string }[] }
          ctList.push({
            kind: "contentType",
            id: ct.id,
            name: ct.name,
            labels: ct.labels,
            registeredFieldGroupIds: ct.registeredFieldGroups?.map(g => g.fieldGroupId) ?? [],
            registeredFieldIds: ct.registeredFields?.map(f => f.fieldId) ?? [],
          })
        }
      }

      // 4. Classifications with field assignments (any that have registeredFieldGroups or registeredFields)
      const classList: AContainer[] = []
      for await (const page of client.classifications.getPaged(undefined, undefined, "*")) {
        if (!page.ok) break
        const items = (page.data as { items?: unknown[] })?.items ?? []
        for (const raw of items) {
          const cl = raw as { id: string; name: string; labels?: ALabel[]; registeredFieldGroups?: { fieldGroupId: string }[]; registeredFields?: { fieldId: string }[] }
          const fgIds = cl.registeredFieldGroups?.map(g => g.fieldGroupId) ?? []
          const fdIds = cl.registeredFields?.map(f => f.fieldId) ?? []
          if (fgIds.length > 0 || fdIds.length > 0) {
            classList.push({
              kind: "classification",
              id: cl.id,
              name: cl.name,
              labels: cl.labels,
              registeredFieldGroupIds: fgIds,
              registeredFieldIds: fdIds,
            })
          }
        }
      }

      setContainers([...ctList, ...classList])
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load data model")
    } finally {
      setLoading(false)
    }
  }, [client, isConnected])

  useEffect(() => { if (isConnected) load() }, [isConnected, load])

  const loadRules = useCallback(async () => {
    if (!client || rulesCache.current !== null) return
    setRulesLoading(true)
    setRulesError(null)
    try {
      const loaded: ARule[] = []
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const expander = (Expander as any).create().for("Rule").expand("conditions", "actions")
      for await (const page of client.rules.getPaged({ pageSize: 200 }, expander)) {
        if (!page.ok) {
          setRulesError(`Rules API returned ${(page as { status?: number }).status ?? "error"}`)
          break
        }
        const items = (page.data as { items?: unknown[] })?.items ?? []
        for (const raw of items) {
          const r = raw as {
            id: string; name: string
            _embedded?: {
              conditions?: { items?: unknown[] }
              actions?: { items?: unknown[] }
            }
          }
          const conditions: ARuleCondition[] = r._embedded?.conditions?.items?.map(c => c as ARuleCondition) ?? []
          const actions: ARuleAction[]       = r._embedded?.actions?.items?.map(a => a as ARuleAction) ?? []
          loaded.push({ id: r.id, name: r.name, conditions, actions })
        }
      }
      rulesCache.current = loaded
      setRules(loaded)
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load rules"
      setRulesError(msg)
      rulesCache.current = []
    } finally {
      setRulesLoading(false)
    }
  }, [client])

  // Rebuild graph when selected FD changes
  useEffect(() => {
    if (!selectedFD) { setNodes([]); setEdges([]); return }
    const { nodes: n, edges: e } = buildUsageGraph(selectedFD, containers, fieldGroupMap, allFDs, rules)
    setNodes(n)
    setEdges(e)
  }, [selectedFD, containers, fieldGroupMap, allFDs, rules, setNodes, setEdges])

  // Usage summary for selected FD
  const usageSummary = useMemo(() => {
    if (!selectedFD) return null
    const fgs = [...fieldGroupMap.values()].filter(fg => fg.memberIds.includes(selectedFD.id))
    const fgIds = new Set(fgs.map(fg => fg.id))
    const byGroup = containers.filter(c => c.registeredFieldGroupIds.some(id => fgIds.has(id)))
    const direct = containers.filter(c => c.registeredFieldIds.includes(selectedFD.id))
    const allContainers = new Set([...byGroup.map(c => c.id), ...direct.map(c => c.id)])
    const ctCount = [...allContainers].filter(id => containers.find(c => c.id === id)?.kind === "contentType").length
    const clCount = [...allContainers].filter(id => containers.find(c => c.id === id)?.kind === "classification").length
    const refs = findCrossFieldRefs(selectedFD, allFDs)
    const ruleRefs = findRuleRefs(selectedFD, rules)
    return { fgCount: fgs.length, ctCount, clCount, directCount: direct.length, refs, ruleRefs }
  }, [selectedFD, containers, fieldGroupMap, allFDs, rules])

  const handleSelectFD = useCallback((fd: AFieldDef) => {
    setSelectedFD(prev => prev?.id === fd.id ? null : fd)
    loadRules()
  }, [loadRules])

  const onNodeClick = useCallback((_: React.MouseEvent, node: GNode) => {
    setClickedNode(prev => prev?.id === node.id ? null : node)
  }, [])

  const filteredFDs = useMemo(() => {
    const q = fdSearch.trim().toLowerCase()
    if (!q) return allFDs
    return allFDs.filter(fd => fd.name.toLowerCase().includes(q) || (fd.dataType ?? "").toLowerCase().includes(q))
  }, [allFDs, fdSearch])

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <main className="flex-1 flex flex-col px-6 py-4 gap-3" style={{ minHeight: 0 }}>

        {/* Header */}
        <div className="flex items-start justify-between gap-4 shrink-0">
          <div>
            <h1 className="text-2xl font-bold">Data Model Explorer</h1>
            <p className="text-sm text-muted-foreground mt-1">
              Select a field definition to see where it is used across content types, classifications, and field groups.
            </p>
          </div>
          {!loading && allFDs.length > 0 && (
            <Button variant="outline" size="sm" onClick={load} className="shrink-0">
              <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
              Reload
            </Button>
          )}
        </div>

        {/* Loading */}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-20 justify-center flex-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading field definitions, groups, content types, and classifications…
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div className="text-sm text-destructive rounded-md border border-destructive/20 bg-destructive/5 px-4 py-3 shrink-0">
            {error}
          </div>
        )}

        {/* Two-panel layout */}
        {!loading && allFDs.length > 0 && (
          <div
            className="flex gap-3 border border-border rounded-lg overflow-hidden"
            style={{ height: "calc(100vh - 220px)", minHeight: 400 }}
          >
            {/* Left: field definition picker */}
            <div className="w-72 flex flex-col border-r border-border shrink-0">
              <div className="p-3 border-b border-border">
                <div className="relative">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
                  <input
                    type="text"
                    placeholder="Search field definitions…"
                    value={fdSearch}
                    onChange={e => setFdSearch(e.target.value)}
                    className="w-full pl-8 pr-7 py-1.5 text-sm border border-input rounded-md bg-background outline-none focus:ring-1 focus:ring-ring"
                  />
                  {fdSearch && (
                    <button
                      onClick={() => setFdSearch("")}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="text-xs text-muted-foreground mt-1.5">
                  {filteredFDs.length.toLocaleString()} of {allFDs.length.toLocaleString()} fields
                </div>
              </div>
              <div className="flex-1 overflow-y-auto">
                {filteredFDs.map(fd => {
                  const color = dtColor(fd.dataType)
                  const isSelected = selectedFD?.id === fd.id
                  return (
                    <button
                      key={fd.id}
                      onClick={() => handleSelectFD(fd)}
                      className={`w-full text-left px-3 py-2 border-b border-border/40 last:border-0 hover:bg-muted/50 transition-colors flex items-start gap-2 ${
                        isSelected ? "bg-primary/10 border-l-2 border-l-primary" : ""
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className={`text-sm font-medium truncate ${isSelected ? "text-primary" : ""}`}>{fd.name}</span>
                          {isGlobal(fd) && (
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", color: "#16a34a", background: "#dcfce7", borderRadius: 3, padding: "1px 4px", flexShrink: 0 }}>
                              GLOBAL
                            </span>
                          )}
                        </div>
                        {fd.dataType && (
                          <span
                            style={{ color, background: `${color}1a`, fontSize: 10, fontWeight: 600, padding: "1px 5px", borderRadius: 4 }}
                          >
                            {fd.dataType}
                          </span>
                        )}
                      </div>
                    </button>
                  )
                })}
              </div>
            </div>

            {/* Right: usage graph */}
            <div className="flex-1 flex flex-col min-w-0">
              {!selectedFD ? (
                <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
                  <div className="text-center space-y-2">
                    <div className="text-4xl opacity-20">◈</div>
                    <div>Select a field definition to see its usage</div>
                  </div>
                </div>
              ) : (
                <>
                  {/* Usage summary bar */}
                  {usageSummary && (
                    <div className="px-4 py-2.5 border-b border-border bg-muted/30 flex items-center gap-4 text-sm shrink-0 flex-wrap">
                      <span className="font-semibold text-base">{getLabel(selectedFD.labels, selectedFD.name)}</span>
                      {selectedFD.dataType && (
                        <span style={{ color: dtColor(selectedFD.dataType), background: `${dtColor(selectedFD.dataType)}1a`, fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 5 }}>
                          {selectedFD.dataType}
                        </span>
                      )}
                      <span className="text-muted-foreground text-xs ml-auto flex gap-3 flex-wrap justify-end">
                        {usageSummary.fgCount > 0 && <span><b>{usageSummary.fgCount}</b> field group{usageSummary.fgCount !== 1 ? "s" : ""}</span>}
                        {usageSummary.ctCount > 0 && <span><b>{usageSummary.ctCount}</b> content type{usageSummary.ctCount !== 1 ? "s" : ""}</span>}
                        {usageSummary.clCount > 0 && <span><b>{usageSummary.clCount}</b> classification{usageSummary.clCount !== 1 ? "s" : ""}</span>}
                        {usageSummary.directCount > 0 && <span><b>{usageSummary.directCount}</b> direct assignment{usageSummary.directCount !== 1 ? "s" : ""}</span>}
                        {usageSummary.refs.length > 0 && (
                          <span className="text-purple-600 font-medium">
                            referenced in <b>{usageSummary.refs.length}</b> field expression{usageSummary.refs.length !== 1 ? "s" : ""}
                          </span>
                        )}
                        {rulesLoading ? (
                          <span className="flex items-center gap-1 text-muted-foreground">
                            <Loader2 className="h-3 w-3 animate-spin" />
                            loading rules…
                          </span>
                        ) : rulesError ? (
                          <span className="text-destructive text-xs" title={rulesError}>rules unavailable</span>
                        ) : rules.length > 0 && usageSummary.ruleRefs.length === 0 ? (
                          <span className="text-muted-foreground text-xs">not used in any rule</span>
                        ) : usageSummary.ruleRefs.length > 0 ? (
                          <span style={{ color: "#0369a1", fontWeight: 500 }}>
                            used in <b>{usageSummary.ruleRefs.length}</b> rule{usageSummary.ruleRefs.length !== 1 ? "s" : ""}
                          </span>
                        ) : null}
                        {usageSummary.fgCount === 0 && usageSummary.ctCount === 0 && usageSummary.clCount === 0 && (
                          <span className="italic">Not assigned anywhere</span>
                        )}
                      </span>
                    </div>
                  )}

                  {/* Graph + detail panel */}
                  <div className="flex-1 flex min-h-0">
                    <div className="flex-1">
                      {nodes.length === 0 ? (
                        <div className="h-full flex items-center justify-center text-sm text-muted-foreground italic">
                          This field definition is not assigned to any content type or classification.
                        </div>
                      ) : (
                        <ReactFlow
                          nodes={nodes}
                          edges={edges}
                          onNodesChange={onNodesChange}
                          onEdgesChange={onEdgesChange}
                          onNodeClick={onNodeClick}
                          onPaneClick={() => setClickedNode(null)}
                          nodeTypes={nodeTypes}
                          fitView
                          fitViewOptions={{ padding: 0.15 }}
                          minZoom={0.1}
                          maxZoom={2}
                          proOptions={{ hideAttribution: true }}
                        >
                          <Background variant={BackgroundVariant.Dots} gap={24} size={1} color="hsl(var(--border))" />
                          <Controls showInteractive={false} />
                        </ReactFlow>
                      )}
                    </div>

                    {/* Detail panel */}
                    {clickedNode && (
                      <div className="w-72 border-l border-border bg-card flex flex-col shrink-0 overflow-y-auto">
                        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b border-border">
                          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                            {clickedNode.type === "container"
                              ? (clickedNode.data as GNodeData).sublabel
                              : clickedNode.type === "fieldGroup"
                              ? "Field Group"
                              : "Field Definition"}
                          </span>
                          <button onClick={() => setClickedNode(null)} className="text-muted-foreground hover:text-foreground">
                            <X className="h-4 w-4" />
                          </button>
                        </div>
                        <div className="p-4">
                          <NodeDetailPanel
                            node={clickedNode}
                            fieldGroupMap={fieldGroupMap}
                            fieldDefMap={new Map(allFDs.map(f => [f.id, f]))}
                            containers={containers}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}

        {!loading && !error && allFDs.length === 0 && isConnected && (
          <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
            No field definitions found.
          </div>
        )}
      </main>
    </div>
  )
}

// ── Node detail panel ──────────────────────────────────────────────────────────

function NodeDetailPanel({
  node,
  fieldGroupMap,
  fieldDefMap,
  containers,
}: {
  node: GNode
  fieldGroupMap: Map<string, AFieldGroup>
  fieldDefMap: Map<string, AFieldDef>
  containers: AContainer[]
}) {
  const d = node.data as GNodeData

  function Row({ label, value }: { label: string; value: string }) {
    return (
      <div className="space-y-0.5">
        <div className="text-xs font-semibold text-muted-foreground">{label}</div>
        <div className="text-sm break-all">{value}</div>
      </div>
    )
  }

  function IdBox({ id }: { id: string }) {
    return (
      <div className="font-mono text-xs bg-muted rounded px-2 py-1.5 break-all select-all">{id}</div>
    )
  }

  if (node.type === "container") {
    const raw = d.raw as AContainer
    return (
      <div className="space-y-4 text-sm">
        <Row label="Name" value={d.label} />
        {d.label !== raw.name && <Row label="System name" value={raw.name} />}
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-muted-foreground">ID</div>
          <IdBox id={raw.id} />
        </div>
        {raw.registeredFieldGroupIds.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground">Field Groups ({raw.registeredFieldGroupIds.length})</div>
            {raw.registeredFieldGroupIds.map(id => {
              const fg = fieldGroupMap.get(id)
              return (
                <div key={id} className="text-xs flex justify-between gap-2">
                  <span>{fg?.name ?? id}</span>
                  <span className="text-muted-foreground shrink-0">{fg?.memberIds.length ?? "?"} fields</span>
                </div>
              )
            })}
          </div>
        )}
        {raw.registeredFieldIds.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground">Direct Fields ({raw.registeredFieldIds.length})</div>
            {raw.registeredFieldIds.map(id => {
              const fd = fieldDefMap.get(id)
              return (
                <div key={id} className="text-xs flex justify-between gap-2">
                  <span>{fd?.name ?? id}</span>
                  {fd?.dataType && <span className="text-muted-foreground shrink-0">{fd.dataType}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  if (node.type === "fieldGroup") {
    const raw = d.raw as AFieldGroup
    return (
      <div className="space-y-4 text-sm">
        <Row label="Name" value={d.label} />
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-muted-foreground">ID</div>
          <IdBox id={raw.id} />
        </div>
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-muted-foreground">Used in</div>
          <div className="space-y-1">
            {containers.filter(c => c.registeredFieldGroupIds.includes(raw.id)).map(c => (
              <div key={c.id} className="text-xs flex items-center gap-1.5">
                <div style={{ width: 8, height: 8, borderRadius: 2, background: c.kind === "contentType" ? "#2563eb" : "#16a34a", flexShrink: 0 }} />
                <span>{getLabel(c.labels, c.name)}</span>
              </div>
            ))}
          </div>
        </div>
        {raw.memberIds.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-semibold text-muted-foreground">Fields ({raw.memberIds.length})</div>
            {raw.memberIds.map(id => {
              const fd = fieldDefMap.get(id)
              return (
                <div key={id} className="text-xs flex justify-between gap-2">
                  <span>{fd?.name ?? id}</span>
                  {fd?.dataType && <span className="text-muted-foreground shrink-0">{fd.dataType}</span>}
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  // fieldDefinition node (selected or reference)
  const raw = d.raw as AFieldDef
  const color = dtColor(raw.dataType)
  return (
    <div className="space-y-4 text-sm">
      <Row label="Name" value={d.label} />
      {d.label !== raw.name && <Row label="System name" value={raw.name} />}
      <div className="space-y-0.5">
        <div className="text-xs font-semibold text-muted-foreground">ID</div>
        <IdBox id={raw.id} />
      </div>
      {raw.dataType && (
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-muted-foreground">Data Type</div>
          <div className="flex items-center gap-2">
            <span style={{ color, background: `${color}1a`, fontSize: 11, fontWeight: 600, padding: "2px 7px", borderRadius: 5 }}>
              {raw.dataType}
            </span>
            {isGlobal(raw) && (
              <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", color: "#16a34a", background: "#dcfce7", borderRadius: 3, padding: "2px 5px" }}>
                GLOBAL
              </span>
            )}
          </div>
        </div>
      )}
      {raw.scope && (
        <Row label="Scope" value={raw.scope} />
      )}
      {raw.defaultValue && (
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-muted-foreground">Default Value Expression</div>
          <pre className="text-xs bg-muted rounded px-2 py-1.5 whitespace-pre-wrap break-all font-mono">{raw.defaultValue}</pre>
        </div>
      )}
      {raw.validation && (
        <div className="space-y-0.5">
          <div className="text-xs font-semibold text-muted-foreground">Validation Expression</div>
          <pre className="text-xs bg-muted rounded px-2 py-1.5 whitespace-pre-wrap break-all font-mono">{raw.validation}</pre>
        </div>
      )}
    </div>
  )
}

