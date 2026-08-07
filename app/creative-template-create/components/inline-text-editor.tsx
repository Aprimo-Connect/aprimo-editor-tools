import { useRef } from "react"
import type { TextLayer } from "@/lib/creative-template-render"
import { M } from "../utils"

type Props = {
  layer: TextLayer
  onSave: (text: string) => void
  onCancel: () => void
}

export function InlineTextEditor({ layer, onSave, onCancel }: Props) {
  const didEscape = useRef(false)
  return (
    <textarea
      autoFocus
      defaultValue={layer.content.text}
      onKeyDown={(e) => {
        if (e.key === "Escape") { didEscape.current = true; onCancel() }
        e.stopPropagation()
      }}
      onBlur={(e) => { if (!didEscape.current) onSave(e.target.value) }}
      style={{
        position: "absolute",
        inset: 0,
        width: "100%",
        height: "100%",
        background: "rgba(255,255,255,0.90)",
        border: `2px solid ${M.primaryColor}`,
        borderRadius: 4,
        padding: 4,
        fontFamily: layer.content.fontFamily,
        fontSize: layer.content.fontSize,
        fontWeight: layer.content.fontWeight,
        color: layer.content.color,
        lineHeight: layer.content.lineHeight,
        resize: "none",
        outline: "none",
        cursor: "text",
        zIndex: 10,
      }}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
    />
  )
}
