"use client"

import { useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import {
  selectActiveProject,
  selectProjectList,
  useProjectManager,
} from "../stores/use-project-manager"
import "./project-switcher.css"

export interface ProjectSwitcherProps {
  onSwitchProject: (id: string) => void
  onDeleteProject: (id: string) => void
}

export function ProjectSwitcher({
  onSwitchProject,
  onDeleteProject,
}: ProjectSwitcherProps) {
  const activeProject = useProjectManager(selectActiveProject)
  // selectProjectList builds a new array each call → wrap with useShallow
  // so the array reference stays stable across unrelated store updates.
  const projects = useProjectManager(useShallow(selectProjectList))
  const projectOrder = useProjectManager((s) => s.projectOrder)
  const activeProjectId = useProjectManager((s) => s.activeProjectId)

  const [menuOpen, setMenuOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editingName, setEditingName] = useState("")
  const importInputRef = useRef<HTMLInputElement>(null)

  function closeMenu() {
    setMenuOpen(false)
    setEditingId(null)
  }

  function switchTo(id: string) {
    if (id === activeProjectId) {
      closeMenu()
      return
    }
    onSwitchProject(id)
    closeMenu()
  }

  function startRename(id: string, name: string) {
    setEditingId(id)
    setEditingName(name)
  }

  function commitRename() {
    if (editingId && editingName.trim()) {
      useProjectManager.getState().renameProject(editingId, editingName.trim())
    }
    setEditingId(null)
  }

  function createNew() {
    const id = useProjectManager.getState().createProject("Untitled Project")
    onSwitchProject(id)
    closeMenu()
    // Re-open menu after a tick to start renaming the new project
    setTimeout(() => {
      setMenuOpen(true)
      setTimeout(() => startRename(id, "Untitled Project"), 0)
    }, 0)
  }

  function duplicate(id: string) {
    const newId = useProjectManager.getState().duplicateProject(id)
    if (newId) {
      onSwitchProject(newId)
      closeMenu()
    }
  }

  function deleteProject(id: string) {
    if (projectOrder.length <= 1) return
    onDeleteProject(id)
    closeMenu()
  }

  function exportProject(id: string) {
    useProjectManager.getState().exportProject(id)
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const newId = await useProjectManager.getState().importProject(file)
    if (newId) {
      onSwitchProject(newId)
      closeMenu()
    }
    if (importInputRef.current) importInputRef.current.value = ""
  }

  function triggerImport() {
    importInputRef.current?.click()
  }

  function onMenuBlur() {
    setTimeout(() => {
      if (!editingId) closeMenu()
    }, 200)
  }

  function renameInputCallback(el: HTMLInputElement | null) {
    if (el) el.select()
  }

  return (
    <div className="project-switcher" onBlur={onMenuBlur}>
      <button
        className="project-btn"
        onClick={() => setMenuOpen((o) => !o)}
        title={activeProject?.name ?? "Project"}
      >
        <FolderIcon />
        <span className="project-name">{activeProject?.name ?? "Project"}</span>
        <ChevronIcon />
      </button>

      {menuOpen && (
        <div className="project-menu" onClick={(e) => e.stopPropagation()}>
          <div className="pm-list">
            {projects.map((proj) => (
              <div
                key={proj.id}
                className={`pm-item${proj.id === activeProjectId ? " active" : ""}`}
              >
                {editingId === proj.id ? (
                  <input
                    ref={renameInputCallback}
                    className="pm-rename-input"
                    value={editingName}
                    onChange={(e) => setEditingName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename()
                      else if (e.key === "Escape") setEditingId(null)
                    }}
                    onBlur={commitRename}
                  />
                ) : (
                  <>
                    <button className="pm-item-btn" onClick={() => switchTo(proj.id)}>
                      <span
                        className={`pm-item-dot${proj.id === activeProjectId ? " on" : ""}`}
                      />
                      <span className="pm-item-name">{proj.name}</span>
                    </button>
                    <div className="pm-item-actions">
                      <button
                        className="pm-act"
                        onClick={(e) => {
                          e.stopPropagation()
                          startRename(proj.id, proj.name)
                        }}
                        title="Rename"
                      >
                        <PencilIcon />
                      </button>
                      <button
                        className="pm-act"
                        onClick={(e) => {
                          e.stopPropagation()
                          duplicate(proj.id)
                        }}
                        title="Duplicate"
                      >
                        <DuplicateIcon />
                      </button>
                      <button
                        className="pm-act"
                        onClick={(e) => {
                          e.stopPropagation()
                          exportProject(proj.id)
                        }}
                        title="Export"
                      >
                        <ExportIcon />
                      </button>
                      {projectOrder.length > 1 && (
                        <button
                          className="pm-act pm-act-danger"
                          onClick={(e) => {
                            e.stopPropagation()
                            deleteProject(proj.id)
                          }}
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
          <div className="pm-divider" />
          <div className="pm-bottom-actions">
            <button className="pm-new" onClick={createNew}>
              <PlusIcon />
              New Project
            </button>
            <button className="pm-import" onClick={triggerImport}>
              <ImportIcon />
              Import Project
            </button>
          </div>
          <input
            ref={importInputRef}
            type="file"
            accept=".json"
            style={{ display: "none" }}
            onChange={handleImport}
          />
        </div>
      )}
    </div>
  )
}

function FolderIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
    </svg>
  )
}

function ChevronIcon() {
  return (
    <svg className="chevron" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
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

function DuplicateIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

function ExportIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  )
}

function ImportIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" />
      <polyline points="17 8 12 3 7 8" />
      <line x1="12" y1="3" x2="12" y2="15" />
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

function PlusIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <path d="M6 1v10M1 6h10" />
    </svg>
  )
}
