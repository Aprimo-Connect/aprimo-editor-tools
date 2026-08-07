"use client"

import { Lock, LockOpen, X } from "lucide-react"
import { cn, toHex } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { type Align, type Fit, type Layer, type TextSpan, type ShapeContent } from "@/lib/creative-template-render"
import { splitIntoRuns, type AnyContent, type FieldDef } from "../utils"

type SourceCtMeta = { directFieldIds: Set<string>; groupIds: Set<string> }

type Props = {
  selected: Layer | null
  onPatchContent: (id: string, patch: Partial<AnyContent>) => void
  onPatchLayer: (id: string, patch: Partial<Layer>) => void
  fieldDefs: FieldDef[] | null
  loadingFieldDefs: boolean
  onLoadFieldDefs: () => void
  sourceCtMeta: SourceCtMeta | null
}

export function PropertiesPanel({ selected, onPatchContent, onPatchLayer, fieldDefs, loadingFieldDefs, onLoadFieldDefs, sourceCtMeta }: Props) {
  if (!selected) return null

  return (
    <div className={cn("space-y-2 rounded-xl border border-border bg-card p-3 text-xs", selected.locked && "opacity-50 pointer-events-none")}>
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold">Properties</span>
        <button
          onClick={() => onPatchLayer(selected.id, { locked: !selected.locked })}
          className="pointer-events-auto text-muted-foreground hover:text-foreground transition-colors"
          title={selected.locked ? "Unlock" : "Lock"}
        >
          {selected.locked ? <Lock className="h-3.5 w-3.5" /> : <LockOpen className="h-3.5 w-3.5" />}
        </button>
      </div>
      <label className="block">
        <span className="text-muted-foreground">Name</span>
        <Input value={selected.name} onChange={(e) => onPatchLayer(selected.id, { name: e.target.value })} className="mt-1 h-8 text-xs" />
      </label>
      <div className="grid grid-cols-4 gap-2">
        {(["x", "y", "width", "height"] as const).map((k) => (
          <label key={k} className="block">
            <span className="uppercase text-muted-foreground">{k[0]}</span>
            <Input
              type="number"
              value={selected[k]}
              onChange={(e) => onPatchLayer(selected.id, { [k]: Number(e.target.value) || 0 } as Partial<Layer>)}
              className="mt-1 h-8 px-1.5 text-xs"
            />
          </label>
        ))}
        <label className="block">
          <span className="uppercase text-muted-foreground">Opacity %</span>
          <Input
            type="number"
            min={0}
            max={100}
            value={Math.round(selected.opacity * 100)}
            onChange={(e) => onPatchLayer(selected.id, { opacity: Math.min(1, Math.max(0, Number(e.target.value) / 100)) })}
            className="mt-1 h-8 px-1.5 text-xs"
          />
        </label>
      </div>

      {selected.type === "text" && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="space-y-1.5">
            <span className="text-muted-foreground">Source</span>
            <div className="flex gap-1.5">
              <button
                onClick={() => onPatchContent(selected.id, { aprimoField: undefined })}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1 text-xs transition-colors",
                  !selected.content.aprimoField
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border text-muted-foreground hover:border-ring"
                )}
              >
                Free text
              </button>
              <button
                onClick={() => {
                  if (!selected.content.aprimoField) {
                    onPatchContent(selected.id, { aprimoField: { id: "", name: "" } })
                    void onLoadFieldDefs()
                  }
                }}
                className={cn(
                  "flex-1 rounded-md border px-2 py-1 text-xs transition-colors",
                  selected.content.aprimoField
                    ? "border-primary bg-primary/10 text-primary font-medium"
                    : "border-border text-muted-foreground hover:border-ring"
                )}
              >
                Aprimo field
              </button>
            </div>

            {selected.content.aprimoField !== undefined && (
              <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-2">
                {(() => {
                  const visible = (sourceCtMeta
                    ? (fieldDefs ?? []).filter((f) =>
                        f.scope === "RecordContentGlobal" ||
                        f.scope === "RecordContentFloating" ||
                        f.scope === "RecordContentClassDependent" ||
                        f.scope === "FileGlobal" ||
                        f.scope === "FileFloating" ||
                        sourceCtMeta.directFieldIds.has(f.id) ||
                        f.memberships.some((m) => sourceCtMeta.groupIds.has(m))
                      )
                    : (fieldDefs ?? [])
                  ).sort((a, b) => a.label.localeCompare(b.label))
                  return (
                    <label className="block">
                      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Field{sourceCtMeta ? ` (${visible.length})` : ""}
                      </span>
                      <select
                        value={selected.content.aprimoField.id}
                        onFocus={() => void onLoadFieldDefs()}
                        onChange={(e) => {
                          const def = fieldDefs?.find((f) => f.id === e.target.value)
                          if (def)
                            onPatchContent(selected.id, {
                              aprimoField: { id: def.id, name: def.name },
                            })
                        }}
                        className="mt-0.5 h-7 w-full rounded-md border border-border bg-background px-2 text-xs"
                      >
                        <option value="">Select field…</option>
                        {loadingFieldDefs && <option disabled value="__loading__">Loading…</option>}
                        {visible.map((f) => (
                          <option key={f.id} value={f.id}>{f.label}</option>
                        ))}
                      </select>
                    </label>
                  )
                })()}
                {selected.content.aprimoField.id && (
                  <p className="text-[10px] text-muted-foreground">
                    Value filled from <strong className="text-foreground">{selected.content.aprimoField.name}</strong> when using Fill from record.
                  </p>
                )}
              </div>
            )}
          </div>

          {!selected.content.spans ? (
            <>
              <textarea
                value={selected.content.text}
                onChange={(e) => onPatchContent(selected.id, { text: e.target.value })}
                rows={2}
                className="w-full rounded-md border border-border bg-background p-2 text-xs outline-none focus:border-ring"
              />
              <button
                onClick={() => onPatchContent(selected.id, { spans: splitIntoRuns(selected.content.text, selected.content.color) })}
                className="w-full rounded-md border border-dashed border-border py-1 text-[10px] text-muted-foreground hover:border-ring hover:text-foreground"
              >
                + Add color runs
              </button>
            </>
          ) : (
            <div className="space-y-1 rounded-md border border-border bg-muted/30 p-2">
              <div className="flex items-center justify-between pb-1">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Color runs</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => {
                      const newSpan: TextSpan = { text: "", color: selected.content.color }
                      onPatchContent(selected.id, { spans: [...selected.content.spans!, newSpan] })
                    }}
                    className="text-[10px] text-muted-foreground underline hover:text-foreground"
                  >
                    + Run
                  </button>
                  <button
                    onClick={() => onPatchContent(selected.id, { spans: undefined })}
                    className="text-[10px] text-muted-foreground underline hover:text-foreground"
                  >
                    Clear
                  </button>
                </div>
              </div>
              {selected.content.spans.map((span, i) => {
                const spans = selected.content.spans!
                const updateSpan = (patch: Partial<TextSpan>) => {
                  const next = spans.map((s, j) => j === i ? { ...s, ...patch } : s)
                  onPatchContent(selected.id, { spans: next, text: next.map((s) => s.text).join("") })
                }
                return (
                  <div key={i} className="flex items-center gap-1.5">
                    <input
                      type="color"
                      value={toHex(span.color ?? selected.content.color)}
                      onChange={(e) => updateSpan({ color: e.target.value })}
                      className="h-6 w-6 shrink-0 cursor-pointer rounded border border-border"
                      title="Run color"
                    />
                    <input
                      type="text"
                      value={span.text}
                      onChange={(e) => updateSpan({ text: e.target.value })}
                      className="min-w-0 flex-1 rounded border border-border bg-background px-1.5 py-1 font-mono text-[10px] outline-none focus:border-ring"
                      placeholder="Run text…"
                    />
                    {spans.length > 1 && (
                      <button
                        onClick={() => {
                          const next = spans.filter((_, j) => j !== i)
                          onPatchContent(selected.id, { spans: next, text: next.map((s) => s.text).join("") })
                        }}
                        className="shrink-0 text-muted-foreground/60 hover:text-destructive"
                        title="Remove run"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          <label className="block">
            <span className="text-muted-foreground">Font family</span>
            <input
              list="font-family-suggestions"
              value={selected.content.fontFamily}
              onChange={(e) => onPatchContent(selected.id, { fontFamily: e.target.value })}
              className="mt-1 h-8 w-full rounded-md border border-border bg-background px-2 text-xs outline-none focus:border-ring"
              placeholder="Inter, sans-serif"
            />
            <datalist id="font-family-suggestions">
              <option value="Inter, sans-serif" />
              <option value="Roboto, sans-serif" />
              <option value="Open Sans, sans-serif" />
              <option value="Lato, sans-serif" />
              <option value="Montserrat, sans-serif" />
              <option value="Poppins, sans-serif" />
              <option value="Raleway, sans-serif" />
              <option value="Nunito, sans-serif" />
              <option value="Ubuntu, sans-serif" />
              <option value="Playfair Display, serif" />
              <option value="Merriweather, serif" />
              <option value="Georgia, serif" />
              <option value="Fraunces, Georgia, serif" />
              <option value="JetBrains Mono, monospace" />
              <option value="Source Code Pro, monospace" />
            </datalist>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-muted-foreground">Size</span>
              <Input type="number" value={selected.content.fontSize} onChange={(e) => onPatchContent(selected.id, { fontSize: Number(e.target.value) || 1 })} className="mt-1 h-8 text-xs" />
            </label>
            <label className="block">
              <span className="text-muted-foreground">Weight</span>
              <Input type="number" value={selected.content.fontWeight} onChange={(e) => onPatchContent(selected.id, { fontWeight: Number(e.target.value) || 400 })} className="mt-1 h-8 text-xs" />
            </label>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={!!selected.content.noWrap}
              onChange={(e) => onPatchContent(selected.id, { noWrap: e.target.checked })}
              className="rounded border-border"
            />
            <span className="text-muted-foreground">No wrap</span>
          </label>
          <div className="flex items-center gap-2">
            <input type="color" value={toHex(selected.content.color)} onChange={(e) => onPatchContent(selected.id, { color: e.target.value })} className="h-8 w-8 rounded border border-border" title={selected.content.spans ? "Fallback color" : "Text color"} />
            <select
              value={selected.content.align}
              onChange={(e) => onPatchContent(selected.id, { align: e.target.value as Align })}
              className="h-8 flex-1 rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="left">Left</option>
              <option value="center">Center</option>
              <option value="right">Right</option>
            </select>
          </div>
        </div>
      )}

      {selected.type === "image" && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="space-y-1.5">
            <span className="text-muted-foreground">Source</span>
            <div className="flex gap-1.5">
              {(["free", "asset"] as const).map((mode) => (
                <button key={mode}
                  onClick={() => onPatchContent(selected.id, { source: mode })}
                  className={cn(
                    "flex-1 rounded-md border px-2 py-1 text-xs transition-colors",
                    (selected.content.source ?? "asset") === mode
                      ? "border-primary bg-primary/10 text-primary font-medium"
                      : "border-border text-muted-foreground hover:border-ring"
                  )}
                >
                  {mode === "asset" ? "Source asset" : "Free select"}
                </button>
              ))}
            </div>
            {(selected.content.source ?? "asset") === "asset" && (
              <p className="text-[10px] text-muted-foreground">Image filled from the source asset when using Fill from record.</p>
            )}
          </div>
          {(selected.content.source ?? "asset") === "free" && (
            <label className="block">
              <span className="text-muted-foreground">Preview URL</span>
              <Input value={selected.content.src} onChange={(e) => onPatchContent(selected.id, { src: e.target.value })} placeholder="https://…" className="mt-1 h-8 text-xs" />
            </label>
          )}
          <select
            value={selected.content.fit}
            onChange={(e) => onPatchContent(selected.id, { fit: e.target.value as Fit })}
            className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
          >
            <option value="cover">Cover</option>
            <option value="contain">Contain</option>
            <option value="fill">Fill</option>
          </select>
          <label className="block">
            <span className="text-muted-foreground">Corner radius</span>
            <Input
              type="number" min={0} max={999}
              value={selected.content.radius ?? 0}
              onChange={(e) => onPatchContent(selected.id, { radius: Math.max(0, Number(e.target.value)) })}
              className="mt-1 h-8 text-xs"
            />
          </label>
        </div>
      )}

      {selected.type === "shape" && (
        <div className="space-y-2 border-t border-border pt-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={selected.content.shape}
              onChange={(e) => onPatchContent(selected.id, { shape: e.target.value as ShapeContent["shape"] })}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="rectangle">Rectangle</option>
              <option value="ellipse">Ellipse</option>
            </select>
            <select
              value={selected.content.fillType}
              onChange={(e) => onPatchContent(selected.id, { fillType: e.target.value as ShapeContent["fillType"] })}
              className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
            >
              <option value="color">Color fill</option>
              <option value="none">Transparent</option>
              <option value="image">Image fill</option>
            </select>
          </div>

          {selected.content.fillType === "color" && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Fill</span>
              <input type="color" value={selected.content.fill} onChange={(e) => onPatchContent(selected.id, { fill: e.target.value })} className="h-8 w-8 rounded border border-border" />
            </div>
          )}
          {selected.content.fillType === "image" && (
            <div className="space-y-2">
              <Input value={selected.content.src} onChange={(e) => onPatchContent(selected.id, { src: e.target.value })} placeholder="Image URL https://…" className="h-8 text-xs" />
              <select
                value={selected.content.imageFit}
                onChange={(e) => onPatchContent(selected.id, { imageFit: e.target.value as Fit })}
                className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
              >
                <option value="cover">Cover</option>
                <option value="contain">Contain</option>
                <option value="fill">Fill</option>
              </select>
            </div>
          )}

          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Stroke</span>
            <input type="color" value={selected.content.stroke} onChange={(e) => onPatchContent(selected.id, { stroke: e.target.value })} className="h-8 w-8 rounded border border-border" />
            <label className="flex flex-1 items-center gap-1">
              <span className="text-muted-foreground">w</span>
              <Input type="number" value={selected.content.strokeWidth} onChange={(e) => onPatchContent(selected.id, { strokeWidth: Number(e.target.value) || 0 })} className="h-8 text-xs" />
            </label>
            <label className="flex flex-1 items-center gap-1">
              <span className="text-muted-foreground">r</span>
              <Input type="number" value={selected.content.radius} onChange={(e) => onPatchContent(selected.id, { radius: Number(e.target.value) || 0 })} className="h-8 text-xs" disabled={selected.content.shape === "ellipse"} />
            </label>
          </div>
          <p className="text-[10px] text-muted-foreground">Add layers while this shape is selected to nest them inside it.</p>
        </div>
      )}

      {selected.type === "button" && (
        <div className="space-y-2 border-t border-border pt-2">
          <label className="block">
            <span className="text-muted-foreground">Label</span>
            <Input value={selected.content.label} onChange={(e) => onPatchContent(selected.id, { label: e.target.value })} className="mt-1 h-8 text-xs" />
          </label>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Text</span>
            <input type="color" value={selected.content.color} onChange={(e) => onPatchContent(selected.id, { color: e.target.value })} className="h-8 w-8 rounded border border-border" />
            <span className="text-muted-foreground">Fill</span>
            <input type="color" value={selected.content.background} onChange={(e) => onPatchContent(selected.id, { background: e.target.value })} className="h-8 w-8 rounded border border-border" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="text-muted-foreground">Size</span>
              <Input type="number" value={selected.content.fontSize} onChange={(e) => onPatchContent(selected.id, { fontSize: Number(e.target.value) || 1 })} className="mt-1 h-8 text-xs" />
            </label>
            <label className="block">
              <span className="text-muted-foreground">Radius</span>
              <Input type="number" value={selected.content.radius} onChange={(e) => onPatchContent(selected.id, { radius: Number(e.target.value) || 0 })} className="mt-1 h-8 text-xs" />
            </label>
          </div>
        </div>
      )}
    </div>
  )
}
