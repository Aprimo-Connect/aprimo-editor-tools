"use client"

import { useEffect, useMemo, useState } from "react"
import {
  selectProjectList,
  useProjectManager,
} from "../stores/use-project-manager"
import type { Asset } from "../types"
import { useShallow } from "zustand/react/shallow"
import "./dam-hook-project-picker-modal.css"

export type ConfirmPayload =
  | { isNew: true; newName: string; assets: Asset[] }
  | { isNew: false; projectId: string; assets: Asset[] }

export interface DamHookProjectPickerModalProps {
  recordIds: string[]
  /** Pre-fetched assets (page handles SDK orchestration). Null = still loading. */
  assets: Asset[] | null
  error?: string | null
  onConfirm: (payload: ConfirmPayload) => void
  onCancel: () => void
}

const NEW_PROJECT_SENTINEL = "__new__"

function defaultNewProjectName(): string {
  const d = new Date()
  const yyyy = d.getFullYear()
  const mm = String(d.getMonth() + 1).padStart(2, "0")
  const dd = String(d.getDate()).padStart(2, "0")
  return `Imported from DAM, ${yyyy}-${mm}-${dd}`
}

export function DamHookProjectPickerModal({
  recordIds,
  assets,
  error,
  onConfirm,
  onCancel,
}: DamHookProjectPickerModalProps) {
  const projects = useProjectManager(useShallow(selectProjectList))

  const [selectedProjectId, setSelectedProjectId] = useState("")
  const [newProjectName, setNewProjectName] = useState(defaultNewProjectName())

  const isLoading = assets === null && !error
  const isReady = !!assets && !error

  const fetchStatus = useMemo(() => {
    if (error) return null
    if (isLoading) {
      return (
        <span>
          <span className="dhpp-spinner" aria-hidden="true" /> Loading metadata
          for {recordIds.length} record{recordIds.length === 1 ? "" : "s"}…
        </span>
      )
    }
    if (assets) {
      const skipped = recordIds.length - assets.length
      return (
        <span className="ready">
          ✓ Ready to import {assets.length} asset{assets.length === 1 ? "" : "s"}
          {skipped > 0 && (
            <span className="dhpp-warn">
              {" "}
              ({skipped} skipped — no file)
            </span>
          )}
        </span>
      )
    }
    return null
  }, [assets, error, isLoading, recordIds.length])

  const canConfirm = useMemo(() => {
    if (!isReady || !selectedProjectId) return false
    if (selectedProjectId === NEW_PROJECT_SENTINEL && !newProjectName.trim()) return false
    return true
  }, [isReady, selectedProjectId, newProjectName])

  function handleConfirm() {
    if (!canConfirm || !assets) return
    if (selectedProjectId === NEW_PROJECT_SENTINEL) {
      onConfirm({ isNew: true, newName: newProjectName.trim(), assets })
    } else {
      onConfirm({ isNew: false, projectId: selectedProjectId, assets })
    }
  }

  // ESC to cancel
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onCancel])

  return (
    <div
      className="dhpp-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel()
      }}
    >
      <div className="dhpp-modal" role="dialog" aria-modal="true" aria-labelledby="dhpp-title">
        <header className="dhpp-header">
          <h2 id="dhpp-title">
            Import {recordIds.length} asset{recordIds.length === 1 ? "" : "s"} from DAM
          </h2>
          <p className="dhpp-sub">
            Choose where to add the selected asset{recordIds.length === 1 ? "" : "s"}.
          </p>
        </header>

        {error ? (
          <section className="dhpp-state error">
            <p>{error}</p>
          </section>
        ) : (
          <section className="dhpp-body">
            <div className={`dhpp-fetch-status${isReady ? " ready" : ""}`}>
              {fetchStatus}
            </div>

            <div className="dhpp-options">
              {projects.map((p) => {
                const assetCount = p.snapshot?.assets?.length ?? 0
                return (
                  <label
                    key={p.id}
                    className={`dhpp-option${selectedProjectId === p.id ? " selected" : ""}`}
                  >
                    <input
                      type="radio"
                      name="dhpp-project"
                      value={p.id}
                      checked={selectedProjectId === p.id}
                      onChange={() => setSelectedProjectId(p.id)}
                    />
                    <span className="dhpp-option-name">{p.name}</span>
                    <span className="dhpp-option-meta">
                      {assetCount} asset{assetCount === 1 ? "" : "s"}
                    </span>
                  </label>
                )
              })}

              <label
                className={`dhpp-option dhpp-option-new${selectedProjectId === NEW_PROJECT_SENTINEL ? " selected" : ""
                  }`}
              >
                <input
                  type="radio"
                  name="dhpp-project"
                  value={NEW_PROJECT_SENTINEL}
                  checked={selectedProjectId === NEW_PROJECT_SENTINEL}
                  onChange={() => setSelectedProjectId(NEW_PROJECT_SENTINEL)}
                />
                <span className="dhpp-option-name">+ Create new project</span>
                {selectedProjectId === NEW_PROJECT_SENTINEL && (
                  <input
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    type="text"
                    className="dhpp-newname-input"
                    placeholder="Project name"
                    onClick={(e) => e.stopPropagation()}
                  />
                )}
              </label>
            </div>
          </section>
        )}

        <footer className="dhpp-footer">
          <button className="dhpp-btn dhpp-btn-secondary" onClick={onCancel}>
            Cancel
          </button>
          <button
            className="dhpp-btn dhpp-btn-primary"
            disabled={!canConfirm}
            onClick={handleConfirm}
          >
            Import
          </button>
        </footer>
      </div>
    </div>
  )
}
