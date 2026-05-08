"use client"

import { create } from "zustand"
import { persist } from "zustand/middleware"
import type { Project, Snapshot } from "../types"

const STORAGE_KEY = "templates.projects.v8"

interface ProjectManagerState {
  projects: Record<string, Project>
  activeProjectId: string
  projectOrder: string[]

  init: () => void
  createProject: (name?: string) => string
  deleteProject: (id: string) => boolean
  renameProject: (id: string, name: string) => void
  duplicateProject: (id: string) => string | null
  setActiveProject: (id: string) => void
  saveProjectSnapshot: (snapshot: Snapshot) => void
  getProjectSnapshot: (id: string) => Snapshot | null
  exportProject: (id: string) => void
  importProject: (file: File) => Promise<string | null>
}

function generateId(): string {
  return Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 7)
}

function nowIso(): string {
  return new Date().toISOString()
}

const DEFAULT_SNAPSHOT: Snapshot = {
  layers: [
    { id: "headline", type: "headline", label: "Headline", value: "Aprimo DAM", mappedField: null, gapAfter: 20 },
    { id: "text", type: "text", label: "Text", value: "Build dynamic content with CDN served assets.", mappedField: null, gapAfter: 12 },
    { id: "cta", type: "cta", label: "CTA", value: "Have fun", mappedField: null, gapAfter: 12 },
  ],
  formats: [
    { id: "linkedin", label: "LinkedIn / OG", w: 734, h: 221, anchor: "tl", logoSize: 0, visibleLayers: ["headline", "text", "cta"], contentWidth: 31, contentScale: 1.2, ctaScale: 1, layerAnchors: { cta: "br" }, logoAnchor: "" },
    { id: "ig-square", label: "Instagram Square", w: 483, h: 903, anchor: "tr", logoSize: 0.11, visibleLayers: ["headline", "text", "cta"], contentWidth: 68, contentScale: 1.26, layerAnchors: {}, logoAnchor: "" },
    { id: "ig-story", label: "Instagram Story", w: 512, h: 512, anchor: "tr", logoSize: 0.1, visibleLayers: ["headline", "text", "cta"], contentWidth: 60, contentScale: 1.38, layerAnchors: {}, logoAnchor: "" },
    { id: "facebook", label: "Facebook Post", w: 512, h: 360, anchor: "tl", logoSize: 0.09, visibleLayers: ["headline", "text", "cta"], contentScale: 1.3, contentWidth: 45, layerAnchors: { cta: "br" }, logoAnchor: "bl" },
    { id: "rectangle", label: "Display Rectangle", w: 261, h: 221, anchor: "tc", logoSize: 0, visibleLayers: ["headline", "cta"], ctaScale: 0.81, contentWidth: 100, contentScale: 1, layerAnchors: { cta: "bc", text: "bc" }, logoAnchor: "" },
  ],
  styles: {
    headlineFont: "Playfair Display", headlineFontSize: 27, headlineFontWeight: "400", headlineColor: "#ffffff",
    textFont: "Plus Jakarta Sans", textFontSize: 14, textFontWeight: "400", textColor: "#ffffff",
    ctaFont: "Josefin Sans", ctaFontSize: 16, ctaFontWeight: "700", ctaTextColor: "#e2cd83",
    accentColor: "#0e5700", ctaPadH: 20, ctaPadV: 10, ctaRadius: 24, contentGap: 12,
    overlayColor: "#52430f", overlayOpacity: 0.58,
    bgMode: "radial", bgColor1: "#8ea989", bgColor2: "#4a7321", bgAngle: 180, bgDistance: 72,
  },
  assets: [],
  activeAssetId: "",
  logoUrl: "",
  canvasPositions: {
    linkedin: { x: 13, y: -50 },
    rectangle: { x: 773, y: -50 },
    "ig-story": { x: 13, y: 198 },
    "ig-square": { x: 551, y: 198 },
    facebook: { x: 13, y: 741 },
  },
}

export const useProjectManager = create<ProjectManagerState>()(
  persist(
    (set, get) => ({
      projects: {},
      activeProjectId: "",
      projectOrder: [],

      init: () => {
        if (get().projectOrder.length > 0) return
        const id = generateId()
        const project: Project = {
          id,
          name: "Demo Project",
          createdAt: nowIso(),
          updatedAt: nowIso(),
          snapshot: JSON.parse(JSON.stringify(DEFAULT_SNAPSHOT)),
        }
        set({
          projects: { [id]: project },
          activeProjectId: id,
          projectOrder: [id],
        })
      },

      createProject: (name = "Untitled Project") => {
        const id = generateId()
        const project: Project = {
          id, name, createdAt: nowIso(), updatedAt: nowIso(), snapshot: null,
        }
        set((s) => ({
          projects: { ...s.projects, [id]: project },
          projectOrder: [...s.projectOrder, id],
        }))
        return id
      },

      deleteProject: (id) => {
        const { projectOrder, projects, activeProjectId } = get()
        if (projectOrder.length <= 1) return false
        const nextProjects = { ...projects }
        delete nextProjects[id]
        const nextOrder = projectOrder.filter((p) => p !== id)
        const nextActive = activeProjectId === id ? (nextOrder[0] ?? "") : activeProjectId
        set({ projects: nextProjects, projectOrder: nextOrder, activeProjectId: nextActive })
        return true
      },

      renameProject: (id, name) => {
        const p = get().projects[id]
        if (!p) return
        set((s) => ({
          projects: { ...s.projects, [id]: { ...p, name, updatedAt: nowIso() } },
        }))
      },

      duplicateProject: (id) => {
        const src = get().projects[id]
        if (!src) return null
        const newId = generateId()
        const dup: Project = {
          id: newId,
          name: src.name + " (copy)",
          createdAt: nowIso(),
          updatedAt: nowIso(),
          snapshot: src.snapshot ? JSON.parse(JSON.stringify(src.snapshot)) : null,
        }
        set((s) => {
          const idx = s.projectOrder.indexOf(id)
          const nextOrder = [...s.projectOrder]
          nextOrder.splice(idx + 1, 0, newId)
          return {
            projects: { ...s.projects, [newId]: dup },
            projectOrder: nextOrder,
          }
        })
        return newId
      },

      setActiveProject: (id) => {
        if (!get().projects[id]) return
        set({ activeProjectId: id })
      },

      saveProjectSnapshot: (snapshot) => {
        const { projects, activeProjectId } = get()
        const p = projects[activeProjectId]
        if (!p) return
        set({
          projects: {
            ...projects,
            [activeProjectId]: { ...p, snapshot, updatedAt: nowIso() },
          },
        })
      },

      getProjectSnapshot: (id) => get().projects[id]?.snapshot ?? null,

      exportProject: (id) => {
        const p = get().projects[id]
        if (!p) return
        const payload = {
          _type: "dynamic_content_project",
          _version: 1,
          name: p.name,
          exportedAt: nowIso(),
          snapshot: p.snapshot,
        }
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
        const url = URL.createObjectURL(blob)
        const a = Object.assign(document.createElement("a"), {
          href: url,
          download: `${p.name.replace(/[^a-zA-Z0-9_ -]/g, "_")}.json`,
        })
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 10_000)
      },

      importProject: async (file) => {
        try {
          const text = await file.text()
          const data = JSON.parse(text)
          if (data._type !== "dynamic_content_project" || !data.snapshot) {
            throw new Error("Invalid project file")
          }
          const id = generateId()
          const name = data.name || file.name.replace(/\.json$/i, "") || "Imported Project"
          const project: Project = {
            id, name, createdAt: nowIso(), updatedAt: nowIso(),
            snapshot: data.snapshot,
          }
          set((s) => ({
            projects: { ...s.projects, [id]: project },
            projectOrder: [...s.projectOrder, id],
          }))
          return id
        } catch {
          return null
        }
      },
    }),
    {
      name: STORAGE_KEY,
      partialize: (s) => ({
        projects: s.projects,
        activeProjectId: s.activeProjectId,
        projectOrder: s.projectOrder,
      }) as Partial<ProjectManagerState>,
    },
  ),
)

export const selectActiveProject = (s: ProjectManagerState): Project | null =>
  s.projects[s.activeProjectId] ?? null

export const selectProjectList = (s: ProjectManagerState): Project[] =>
  s.projectOrder.map((id) => s.projects[id]).filter((p): p is Project => !!p)
