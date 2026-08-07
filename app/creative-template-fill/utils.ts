import type { Fit, Layer, Layout, TextSpan } from "@/lib/creative-template-render"

// ── Shared types ──────────────────────────────────────────────────────────────

export type CanvasTemplate = { id: string; name: string; savedAt: number; layouts: Layout[] }

export type TextEdit  = { type: "text";  text: string; spans?: TextSpan[] }
export type ImageEdit = { type: "image"; src: string; fit?: Fit }
export type FieldEdit = TextEdit | ImageEdit
export type PendingField = { id: string; kind: "image" }

// ── HTML helpers ──────────────────────────────────────────────────────────────

export function isHtml(s: string): boolean { return /<[a-z][\s\S]*>/i.test(s) }

export function stripHtml(s: string): string {
  return s
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"')
    .replace(/&mdash;/g, "—").replace(/&ndash;/g, "–").replace(/&hellip;/g, "…").replace(/&lsquo;/g, "'").replace(/&rsquo;/g, "'").replace(/&ldquo;/g, "“").replace(/&rdquo;/g, "”")
    .replace(/&#8212;/g, "—").replace(/&#8211;/g, "–").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\n{2,}/g, "\n")
    .trim()
}

// ── Tree helpers ──────────────────────────────────────────────────────────────

export function collectEditable(layers: Layer[]): Layer[] {
  const out: Layer[] = []
  for (const l of layers) {
    if (!l.locked) out.push(l)
    if (l.type === "shape") out.push(...collectEditable(l.children))
  }
  return out
}

export function applyEdits(layers: Layer[], edits: Record<string, FieldEdit>): Layer[] {
  return layers.map((l) => {
    const edit = edits[l.id]
    let updated: Layer = l
    if (edit?.type === "text"  && l.type === "text")  updated = { ...l, content: { ...l.content, text: edit.text, spans: edit.spans } }
    if (edit?.type === "image" && l.type === "image") updated = { ...l, content: { ...l.content, src: edit.src, ...(edit.fit ? { fit: edit.fit } : {}) } }
    if (updated.type === "shape") return { ...updated, children: applyEdits(updated.children, edits) }
    return updated
  })
}
