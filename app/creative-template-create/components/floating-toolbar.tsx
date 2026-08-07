"use client"

import { Fragment, type CSSProperties } from "react"
import { Lock, LockOpen, Trash2 } from "lucide-react"
import { toHex } from "@/lib/utils"
import { type Fit, type Layer, type TextSpan } from "@/lib/creative-template-render"
import { M, alpha, absolutePos, splitIntoRuns, type AnyContent } from "../utils"

type Props = {
  selected: Layer
  layers: Layer[]
  layoutWidth: number
  editingId: string | null
  onPatchContent: (id: string, patch: Partial<AnyContent>) => void
  onPatchLayer: (id: string, patch: Partial<Layer>) => void
  onRemoveLayer: (id: string) => void
  onSetEditingId: (id: string | null) => void
}

export function FloatingToolbar({ selected, layers, layoutWidth, editingId, onPatchContent, onPatchLayer, onRemoveLayer, onSetEditingId }: Props) {
  const abs = absolutePos(layers, selected.id) ?? { x: selected.x, y: selected.y }
  const TOOLBAR_H = 44
  const showAbove = abs.y >= TOOLBAR_H + 12
  const ty = showAbove ? abs.y - TOOLBAR_H - 8 : abs.y + selected.height + 8
  const tx = Math.max(0, Math.min(abs.x, layoutWidth - 8))

  const typeBadge: Record<Layer["type"], string> = { text: "T", image: "IMG", shape: "□", button: "BTN" }
  const typeBadgeBg: Record<Layer["type"], string> = { text: M.primaryColor, image: "#3b82f6", shape: "#8b5cf6", button: M.secondaryColor }

  const inputCss: CSSProperties = {
    height: 28, fontSize: 12, borderRadius: 6,
    border: `1px solid ${alpha("foreground", 15)}`, padding: "0 8px",
    fontFamily: M.sans, flexShrink: 0, outline: "none", color: M.foreground, background: "#fff",
  }
  const iconBtn = (active?: boolean): CSSProperties => ({
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: 28, height: 28, borderRadius: 6,
    border: `1px solid ${alpha("foreground", 15)}`,
    background: active ? alpha("foreground", 8) : "transparent",
    cursor: "pointer", flexShrink: 0, color: M.foreground, padding: 0,
  })
  const Sep = () => <span style={{ display: "inline-block", width: 1, height: 20, background: alpha("foreground", 10), margin: "0 4px", flexShrink: 0 }} />

  return (
    <div
      style={{
        position: "absolute", left: tx, top: ty, zIndex: 20,
        display: "inline-flex", alignItems: "center", gap: 3,
        background: "#fff", border: `1px solid ${alpha("foreground", 12)}`,
        borderRadius: 12, padding: "0 8px", height: TOOLBAR_H,
        boxShadow: "0 4px 20px rgba(0,0,0,0.13), 0 1px 4px rgba(0,0,0,0.06)",
        whiteSpace: "nowrap", pointerEvents: "auto",
      }}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <span style={{ background: typeBadgeBg[selected.type], color: "#fff", borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em", flexShrink: 0 }}>
        {typeBadge[selected.type]}
      </span>
      <span style={{ fontSize: 12, fontWeight: 500, color: alpha("foreground", 60), maxWidth: 96, overflow: "hidden", textOverflow: "ellipsis", padding: "0 4px", flexShrink: 1 }}>
        {selected.name}
      </span>

      <Sep />

      {selected.locked ? (
        <span style={{ fontSize: 11, color: alpha("foreground", 45), padding: "0 4px" }}>Locked</span>
      ) : (
        <>
          {selected.type === "text" && (
            <>
              {selected.content.spans ? (
                <>
                  {selected.content.spans.map((span, i) => {
                    const spans = selected.content.spans!
                    const updateSpan = (patch: Partial<TextSpan>) => {
                      const next = spans.map((s, j) => j === i ? { ...s, ...patch } : s)
                      onPatchContent(selected.id, { spans: next, text: next.map((s) => s.text).join("") })
                    }
                    return (
                      <Fragment key={i}>
                        <input
                          type="color"
                          value={toHex(span.color ?? selected.content.color)}
                          onChange={(e) => updateSpan({ color: e.target.value })}
                          style={{ width: 24, height: 24, padding: 1, borderRadius: 4, border: `1px solid ${alpha("foreground", 15)}`, cursor: "pointer", flexShrink: 0 }}
                          title={`Run ${i + 1} color`}
                        />
                        <input
                          type="text"
                          value={span.text}
                          onChange={(e) => updateSpan({ text: e.target.value })}
                          style={{ ...inputCss, width: 80, fontSize: 11 }}
                          placeholder={`Run ${i + 1}…`}
                        />
                        {spans.length > 1 && (
                          <button
                            onClick={() => {
                              const next = spans.filter((_, j) => j !== i)
                              onPatchContent(selected.id, { spans: next.length ? next : undefined, text: next.map((s) => s.text).join("") })
                            }}
                            style={{ ...iconBtn(), width: 18, height: 18, borderRadius: 4, fontSize: 12, color: alpha("foreground", 45) }}
                            title={`Remove run ${i + 1}`}
                          >×</button>
                        )}
                      </Fragment>
                    )
                  })}
                  <button
                    onClick={() => onPatchContent(selected.id, { spans: [...selected.content.spans!, { text: "", color: selected.content.color }] })}
                    style={{ ...iconBtn(), width: 22, height: 22, borderRadius: 4, fontSize: 14, color: alpha("foreground", 50) }}
                    title="Add run"
                  >+</button>
                  <button
                    onClick={() => onPatchContent(selected.id, { spans: undefined })}
                    style={{ ...iconBtn(), width: "auto", padding: "0 8px", fontSize: 10, color: alpha("foreground", 50) }}
                    title="Remove all color runs"
                  >Clear runs</button>
                  <Sep />
                  <input type="number" value={selected.content.fontSize} onChange={(e) => onPatchContent(selected.id, { fontSize: Number(e.target.value) || 1 })}
                    style={{ ...inputCss, width: 52 }} title="Font size" />
                  <button style={iconBtn(selected.content.fontWeight >= 700)} title="Bold"
                    onClick={() => onPatchContent(selected.id, { fontWeight: selected.content.fontWeight >= 700 ? 400 : 700 })}>
                    <strong style={{ fontSize: 13, fontFamily: "Georgia, serif" }}>B</strong>
                  </button>
                  <button style={iconBtn()} title="Alignment"
                    onClick={() => onPatchContent(selected.id, { align: selected.content.align === "left" ? "center" : selected.content.align === "center" ? "right" : "left" })}>
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{selected.content.align === "left" ? "≡L" : selected.content.align === "center" ? "≡C" : "≡R"}</span>
                  </button>
                </>
              ) : (
                <>
                  <input
                    list="font-family-suggestions"
                    value={selected.content.fontFamily}
                    onChange={(e) => onPatchContent(selected.id, { fontFamily: e.target.value })}
                    style={{ ...inputCss, width: 140 }}
                    title="Font family"
                  />
                  <input type="color" value={toHex(selected.content.color)} onChange={(e) => onPatchContent(selected.id, { color: e.target.value })}
                    style={{ width: 28, height: 28, padding: 2, borderRadius: 6, border: `1px solid ${alpha("foreground", 15)}`, cursor: "pointer", flexShrink: 0 }} title="Color" />
                  <input type="number" value={selected.content.fontSize} onChange={(e) => onPatchContent(selected.id, { fontSize: Number(e.target.value) || 1 })}
                    style={{ ...inputCss, width: 52 }} title="Font size" />
                  <button style={iconBtn(selected.content.fontWeight >= 700)} title="Bold"
                    onClick={() => onPatchContent(selected.id, { fontWeight: selected.content.fontWeight >= 700 ? 400 : 700 })}>
                    <strong style={{ fontSize: 13, fontFamily: "Georgia, serif" }}>B</strong>
                  </button>
                  <button style={iconBtn()} title="Alignment"
                    onClick={() => onPatchContent(selected.id, { align: selected.content.align === "left" ? "center" : selected.content.align === "center" ? "right" : "left" })}>
                    <span style={{ fontSize: 10, fontWeight: 600 }}>{selected.content.align === "left" ? "≡L" : selected.content.align === "center" ? "≡C" : "≡R"}</span>
                  </button>
                  {editingId !== selected.id && (
                    <button onClick={() => onSetEditingId(selected.id)}
                      style={{ ...iconBtn(), width: "auto", padding: "0 10px", fontSize: 11, fontWeight: 600, color: M.primaryColor, borderColor: alpha("primaryColor", 30), background: alpha("primaryColor", 6) }}>
                      Edit text
                    </button>
                  )}
                  <button
                    onClick={() => onPatchContent(selected.id, { spans: splitIntoRuns(selected.content.text, selected.content.color) })}
                    style={{ ...iconBtn(), width: "auto", padding: "0 8px", fontSize: 10, color: alpha("foreground", 55) }}
                    title="Split into color runs"
                  >+ Runs</button>
                </>
              )}
            </>
          )}

          {selected.type === "image" && (
            <>
              <input type="text" value={selected.content.src} onChange={(e) => onPatchContent(selected.id, { src: e.target.value, source: "free" })}
                placeholder="Image URL…"
                style={{ ...inputCss, width: 180, fontFamily: M.mono, fontSize: 11 }} />
              <select value={selected.content.fit} onChange={(e) => onPatchContent(selected.id, { fit: e.target.value as Fit })}
                style={{ ...inputCss, padding: "0 6px" }}>
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
                <option value="fill">Fill</option>
              </select>
            </>
          )}

          {selected.type === "shape" && (
            <>
              {selected.content.fillType === "color" && (
                <input type="color" value={toHex(selected.content.fill)} onChange={(e) => onPatchContent(selected.id, { fill: e.target.value })}
                  style={{ width: 28, height: 28, padding: 2, borderRadius: 6, border: `1px solid ${alpha("foreground", 15)}`, cursor: "pointer", flexShrink: 0 }} title="Fill" />
              )}
              <span style={{ fontSize: 11, color: alpha("foreground", 50) }}>Fill</span>
            </>
          )}

          {selected.type === "button" && (
            <>
              <input type="text" value={selected.content.label} onChange={(e) => onPatchContent(selected.id, { label: e.target.value })}
                placeholder="Label…" style={{ ...inputCss, width: 100 }} />
              <input type="color" value={toHex(selected.content.background)} onChange={(e) => onPatchContent(selected.id, { background: e.target.value })}
                style={{ width: 28, height: 28, padding: 2, borderRadius: 6, border: `1px solid ${alpha("foreground", 15)}`, cursor: "pointer", flexShrink: 0 }} title="Background" />
              <input type="color" value={toHex(selected.content.color)} onChange={(e) => onPatchContent(selected.id, { color: e.target.value })}
                style={{ width: 28, height: 28, padding: 2, borderRadius: 6, border: `1px solid ${alpha("foreground", 15)}`, cursor: "pointer", flexShrink: 0 }} title="Text color" />
            </>
          )}

          <Sep />
        </>
      )}

      <input
        type="number"
        min={0}
        max={100}
        value={Math.round(selected.opacity * 100)}
        onChange={(e) => onPatchLayer(selected.id, { opacity: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
        style={{ ...inputCss, width: 52 }}
        title="Opacity %"
      />
      <span style={{ fontSize: 11, color: alpha("foreground", 45), marginLeft: -4 }}>%</span>

      <Sep />

      <button style={iconBtn(selected.locked)} title={selected.locked ? "Unlock" : "Lock"}
        onClick={() => onPatchLayer(selected.id, { locked: !selected.locked })}>
        {selected.locked ? <Lock style={{ width: 13, height: 13 }} /> : <LockOpen style={{ width: 13, height: 13 }} />}
      </button>

      <button style={{ ...iconBtn(), color: "#ef4444" }} title="Delete" onClick={() => onRemoveLayer(selected.id)}>
        <Trash2 style={{ width: 13, height: 13 }} />
      </button>
    </div>
  )
}
