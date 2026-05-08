"use client"

import { useCallback, useState } from "react"
import { useTemplateBuilder } from "../stores/use-template-builder"
import type { FormatId } from "../types"
import "./format-switcher.css"

export interface FormatSwitcherProps {
  onSelectFormat: (id: FormatId) => void
  onDeleteFormat: (id: FormatId) => void
}

export function FormatSwitcher({
  onSelectFormat,
  onDeleteFormat,
}: FormatSwitcherProps) {
  const formats = useTemplateBuilder((s) => s.formats)
  const activeSettingsId = useTemplateBuilder((s) => s.activeSettingsId)

  const [menuOpen, setMenuOpen] = useState(false)
  const [editingId, setEditingId] = useState<FormatId | null>(null)
  const [editingLabel, setEditingLabel] = useState("")

  function closeMenu() {
    setMenuOpen(false)
    setEditingId(null)
  }

  function selectFormat(id: FormatId) {
    onSelectFormat(id)
    closeMenu()
  }

  function startRename(id: FormatId, label: string, e: React.MouseEvent) {
    e.stopPropagation()
    setEditingId(id)
    setEditingLabel(label)
  }

  function commitRename() {
    if (editingId && editingLabel.trim()) {
      useTemplateBuilder.getState().updateFormat(editingId, "label", editingLabel.trim())
    }
    setEditingId(null)
  }

  function deleteFormat(id: FormatId, e: React.MouseEvent) {
    e.stopPropagation()
    onDeleteFormat(id)
  }

  function onMenuBlur(e: React.FocusEvent<HTMLDivElement>) {
    // Defer so focus can settle on the new target — when a button is
    // replaced by an input mid-render, focus briefly routes through
    // body before the ref callback's .select() lands on the input.
    const root = e.currentTarget
    setTimeout(() => {
      if (root.contains(document.activeElement)) return
      closeMenu()
    }, 0)
  }

  // Stable so React only invokes it on mount/unmount, not every render —
  // an inline ref callback would re-select-all on each keystroke and wipe
  // the user's input on the next character.
  const renameInputRef = useCallback((el: HTMLInputElement | null) => {
    if (el) el.select()
  }, [])

  return (
    <div className="format-switcher" onBlur={onMenuBlur}>
      <button className="fmt-btn" onClick={() => setMenuOpen((o) => !o)}>
        <span className="fmt-btn-label">Formats</span>
        <span className="fmt-btn-count">{formats.length}</span>
        <ChevronIcon />
      </button>

      {menuOpen && (
        <div className="fmt-menu" onClick={(e) => e.stopPropagation()}>
          <div className="fmt-list">
            {formats.map((fmt) => (
              <div
                key={fmt.id}
                className={`fmt-item${fmt.id === activeSettingsId ? " active" : ""}`}
              >
                {editingId === fmt.id ? (
                  <input
                    ref={renameInputRef}
                    className="fmt-rename-input"
                    value={editingLabel}
                    onChange={(e) => setEditingLabel(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename()
                      else if (e.key === "Escape") setEditingId(null)
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <>
                    <button className="fmt-item-btn" onClick={() => selectFormat(fmt.id)}>
                      <div className="fmt-item-info">
                        <span className="fmt-item-name">{fmt.label}</span>
                        <span className="fmt-item-dims">
                          {fmt.w} × {fmt.h}
                        </span>
                      </div>
                    </button>
                    <div className="fmt-item-actions">
                      <button
                        className="fmt-act"
                        onClick={(e) => startRename(fmt.id, fmt.label, e)}
                        title="Rename"
                      >
                        <PencilIcon />
                      </button>
                      {formats.length > 1 && (
                        <button
                          className="fmt-act fmt-act-danger"
                          onClick={(e) => deleteFormat(fmt.id, e)}
                          title="Delete"
                        >
                          <TrashIcon />
                        </button>
                      )}
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ChevronIcon() {
  return (
    <svg
      className="chevron"
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M2.5 3.75 5 6.25 7.5 3.75" />
    </svg>
  )
}

function PencilIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  )
}
