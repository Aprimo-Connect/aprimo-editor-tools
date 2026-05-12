"use client"

import {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Expander } from "aprimo-js"
import type { Record as AprimoRecord, FileVersion } from "aprimo-js/model"
import { useShallow } from "zustand/react/shallow"
import { Navbar } from "@/components/navbar"
import { useAprimo } from "@/context/aprimo-context"
import { supabase } from "@/lib/supabase"
import {
  useContentSelector,
  type SelectedRecord,
} from "@/lib/use-content-selector"

import {
  selectActiveFormat,
  selectDrawState,
  useTemplateBuilder,
} from "./stores/use-template-builder"
import { useProjectManager } from "./stores/use-project-manager"
import { useBulkData } from "./stores/use-bulk-data"

import { useSourceLoader } from "./hooks/use-source-loader"
import { useLogoLoader } from "./hooks/use-logo-loader"
import { useInfiniteCanvas } from "./hooks/use-infinite-canvas"
import { useTemplateExport } from "./hooks/use-template-export"
import { useBulkExport } from "./hooks/use-bulk-export"
import { usePublishRenditions } from "./hooks/use-publish-renditions"

import { TemplateControls } from "./components/template-controls"
import {
  TemplateCanvas,
  type TemplateCanvasHandle,
} from "./components/template-canvas"
import { RightPanel } from "./components/right-panel"
import { ProjectSwitcher } from "./components/project-switcher"
import { FormatSwitcher } from "./components/format-switcher"
import {
  DamHookProjectPickerModal,
  type ConfirmPayload,
} from "./components/dam-hook-project-picker-modal"

import { loadTemplateFonts } from "./lib/google-fonts"
import {
  detectInterference,
  type InterferenceResult,
} from "./lib/renderer"
import type { Anchor, Asset, AssetId, Format, FormatId, LayerId } from "./types"
import "./templates.css"

// ── DAM page-hook handoff ────────────────────────────────────────

interface DamHookState {
  recordIds: string[]
  assets: Asset[] | null
  error: string | null
}

type PublicUriItem = { renditionName?: string; uri?: string }

// The aprimo-js SDK can return `publicuris` flattened (camelCase property
// on the parent) or nested under `_embedded` (HAL-style). Try several
// paths so a small mismatch in SDK output doesn't break the import flow.
function findPublicUriItems(r: Record<string, unknown>): PublicUriItem[] | null {
  const candidates: unknown[] = [
    (r as { masterFileLatestVersion?: { publicUris?: { items?: unknown } } })
      ?.masterFileLatestVersion?.publicUris?.items,
    (r as { masterFileLatestVersion?: { publicuris?: { items?: unknown } } })
      ?.masterFileLatestVersion?.publicuris?.items,
    (
      r as {
        masterFileLatestVersion?: {
          _embedded?: { publicuris?: { items?: unknown } }
        }
      }
    )?.masterFileLatestVersion?._embedded?.publicuris?.items,
    (
      r as {
        _embedded?: {
          masterfilelatestversion?: {
            _embedded?: { publicuris?: { items?: unknown } }
          }
        }
      }
    )?._embedded?.masterfilelatestversion?._embedded?.publicuris?.items,
    (
      r as {
        _embedded?: {
          masterfilelatestversion?: { publicUris?: { items?: unknown } }
        }
      }
    )?._embedded?.masterfilelatestversion?.publicUris?.items,
  ]
  for (const c of candidates) {
    if (Array.isArray(c) && c.length > 0) return c as PublicUriItem[]
  }
  return null
}

function buildAssetFromRecord(record: unknown): Asset | null {
  const r = record as Record<string, unknown>
  const items = findPublicUriItems(r)
  if (!items) {
    console.warn("[Templates] Record has no publicUris — skipping import.", r)
    return null
  }
  const original =
    items.find((u) => u.renditionName === "Original file") ?? items[0]
  const url = original?.uri
  if (!url) {
    console.warn("[Templates] publicUris had no URI — skipping import.", original)
    return null
  }
  return {
    id: "asset_" + Math.random().toString(36).slice(2, 10),
    url,
    label: (r as { title?: string }).title ?? "",
    focalX: 0.5,
    focalY: 0.5,
    focalW: 0.3,
    focalH: 0.3,
    focalFit: "cover",
    contentAwareFocal: false,
    useSmartCrop: false,
  }
}

// ── Format clipboard ─────────────────────────────────────────────

const FMT_COPY_PROPS = [
  "anchor",
  "layerAnchors",
  "logoAnchor",
  "visibleLayers",
  "logoSize",
  "contentScale",
  "contentWidth",
  "ctaScale",
  "padding",
] as const

type ClipboardFormat = { type: "format"; data: Format }
type ClipboardStyle = {
  type: "style"
  data: Pick<Format, "logoSize" | "contentScale" | "contentWidth"> & {
    ctaScale?: number
    padding?: number
  }
}
type ClipboardAnchors = {
  type: "anchors"
  data: {
    anchor: Anchor
    layerAnchors: Record<LayerId, Anchor>
    logoAnchor: Anchor
  }
}
type ClipboardEntry = ClipboardFormat | ClipboardStyle | ClipboardAnchors

interface CtxMenuState {
  visible: boolean
  x: number
  y: number
  formatId: FormatId | null
}

function TemplatesContent() {
  const { isConnected, client } = useAprimo()
  const searchParams = useSearchParams()
  const router = useRouter()

  // ── Store subscriptions ──────────────────────────────────────
  const formats = useTemplateBuilder((s) => s.formats)
  const styles = useTemplateBuilder((s) => s.styles)
  const layers = useTemplateBuilder((s) => s.layers)
  const canvasPositions = useTemplateBuilder((s) => s.canvasPositions)
  const activeFormat = useTemplateBuilder(selectActiveFormat)
  // Active asset: subscribed for interference detection + smart-crop watcher.
  // Asset object refs are stable in the store between updates that don't
  // touch this asset, so this only re-fires when the active asset's data
  // genuinely changes.
  const activeAsset = useTemplateBuilder(
    (s) => s.assets.find((a) => a.id === s.activeAssetId) ?? null,
  )
  // selectDrawState builds a new object each call → wrap with useShallow so
  // Zustand's snapshot stays stable when the underlying values haven't changed.
  const storeDrawState = useTemplateBuilder(useShallow(selectDrawState))

  const bulkActive = useBulkData((s) => s.isActive)
  const bulkActiveRowIndex = useBulkData((s) => s.activeRowIndex)
  // Subscribe to the column mapping + per-row source overrides so drawState
  // re-memoizes when the user configures columns (otherwise the preview is
  // stale until activeRowIndex changes).
  const bulkColumnMapping = useBulkData((s) => s.columnMapping)
  const bulkSourceCol = useBulkData((s) => s.sourceImageColumn)
  const bulkLogoCol = useBulkData((s) => s.logoColumn)
  const bulkRows = useBulkData((s) => s.rows)
  const buildRowDrawState = useBulkData((s) => s.buildRowDrawState)

  // ── Source / logo loaders ────────────────────────────────────
  const source = useSourceLoader()
  const logo = useLogoLoader()

  // ── Page state ───────────────────────────────────────────────
  const [damHookModal, setDamHookModal] = useState<DamHookState | null>(null)
  const [ctxMenu, setCtxMenu] = useState<CtxMenuState>({
    visible: false,
    x: 0,
    y: 0,
    formatId: null,
  })
  const [clipboard, setClipboard] = useState<ClipboardEntry | null>(null)

  // ── Canvas viewport DOM ref (composite — page + hook) ────────
  const viewportElRef = useRef<HTMLDivElement | null>(null)

  // ── Per-format canvas handles ────────────────────────────────
  const canvasHandlesRef = useRef<Record<FormatId, TemplateCanvasHandle | null>>({})
  const canvasElsRef = useRef<Record<FormatId, HTMLCanvasElement | null>>({})

  useEffect(() => {
    const next: Record<FormatId, HTMLCanvasElement | null> = {}
    for (const fmt of formats) {
      next[fmt.id] = canvasHandlesRef.current[fmt.id]?.canvasEl ?? null
    }
    canvasElsRef.current = next
  })

  const renderAllCanvases = useCallback(() => {
    for (const fmt of useTemplateBuilder.getState().formats) {
      canvasHandlesRef.current[fmt.id]?.render()
    }
  }, [])

  // ── Source orchestration ─────────────────────────────────────
  const loadSource = useCallback(() => {
    const builder = useTemplateBuilder.getState()
    if (builder.assets.length === 0 || !builder.activeAssetId) return
    source.loadSource({
      onImageLoaded: (_img, url) => {
        source.loadSmartCrops(url)
      },
      onVideoReady: () => {
        source.startVideoLoop(renderAllCanvases)
      },
    })
  }, [source, renderAllCanvases])

  // ── Content selector ─────────────────────────────────────────
  // The Aprimo Content Selector sometimes returns records with a direct
  // `publicContentUri`, but often returns just `{ id, title }`. For the
  // latter we batch-fetch via SDK with the masterfilelatestversion +
  // publicuris expander to resolve the CDN URL — same pattern the page-hook
  // handoff uses.
  const onContentSelectorAccept = useCallback(
    async (records: SelectedRecord[]) => {
      const builder = useTemplateBuilder.getState()
      let added = 0

      const directUrls: Array<{ url: string; title: string }> = []
      const idsToFetch: Array<{ id: string; title: string }> = []

      for (const r of records) {
        const url = (r as SelectedRecord).publicContentUri
        if (typeof url === "string" && url) {
          directUrls.push({ url, title: r.title ?? "" })
        } else if (r.id) {
          idsToFetch.push({ id: r.id, title: r.title ?? "" })
        }
      }

      // Fast path: records that already have a CDN URL
      for (const { url, title } of directUrls) {
        builder.addAsset(url, title)
        added++
      }

      // SDK fetch for the rest
      if (idsToFetch.length > 0 && client) {
        builder.setStatus(
          `Fetching ${idsToFetch.length} asset${idsToFetch.length === 1 ? "" : "s"}…`,
          "load",
        )
        try {
          const expander = Expander.create()
            .for<AprimoRecord>("Record").expand("masterfilelatestversion")
            .for<FileVersion>("FileVersion").expand("publicuris")

          const BATCH_SIZE = 50
          const ids = idsToFetch.map((i) => i.id)
          const titleById = new Map(idsToFetch.map((i) => [i.id, i.title]))

          const batches: string[][] = []
          for (let i = 0; i < ids.length; i += BATCH_SIZE) {
            batches.push(ids.slice(i, i + BATCH_SIZE))
          }

          const results = await Promise.all(
            batches.map((batch) => {
              const expression = batch.map((id) => `id='${id}'`).join(" OR ")
              return client.search.records(
                { searchExpression: { expression } },
                expander,
              )
            }),
          )

          for (const r of results) {
            if (!r.ok) continue
            const items = (r.data as { items?: unknown[] })?.items ?? []
            for (const rec of items) {
              const a = buildAssetFromRecord(rec)
              if (!a) continue
              const recId = (rec as { id?: string }).id
              const title = (recId && titleById.get(recId)) || a.label
              builder.addAsset(a.url, title)
              added++
            }
          }
        } catch (err) {
          console.error("[content-selector] Fetch failed", err)
        }
      }

      if (added > 0) {
        builder.setStatus(`${added} asset${added === 1 ? "" : "s"} loaded`, "ok")
        setTimeout(() => loadSource(), 0)
      } else {
        builder.setStatus(
          "No assets could be loaded — check that records have a master file",
          "err",
        )
      }
    },
    [client, loadSource],
  )

  const contentSelector = useContentSelector({
    select: "multiple",
    onAccept: onContentSelectorAccept,
  })

  // ── drawState ────────────────────────────────────────────────
  const drawState = useMemo(() => {
    const base = {
      ...storeDrawState,
      el: source.sourceEl,
      logo: logo.logoEl,
    }
    if (bulkActive) {
      return buildRowDrawState(bulkActiveRowIndex, base)
    }
    return base
  }, [
    storeDrawState,
    source.sourceEl,
    logo.logoEl,
    bulkActive,
    bulkActiveRowIndex,
    bulkColumnMapping,
    bulkSourceCol,
    bulkLogoCol,
    bulkRows,
    buildRowDrawState,
  ])

  // ── Exporters / publisher ────────────────────────────────────
  const exporter = useTemplateExport({
    drawState,
    croppedEls: source.croppedEls,
    logoEl: logo.logoEl,
    sourceEl: source.sourceEl,
    sourceType: source.sourceType,
    sourceReady: source.sourceReady,
    canvasRefs: canvasElsRef,
  })
  const bulkExporter = useBulkExport({
    drawState,
    croppedEls: source.croppedEls,
    logoEl: logo.logoEl,
    sourceEl: source.sourceEl,
  })
  const publisher = usePublishRenditions({
    drawState,
    croppedEls: source.croppedEls,
    logoEl: logo.logoEl,
  })

  // ── Infinite canvas ──────────────────────────────────────────
  const canvas = useInfiniteCanvas({
    canDraw: () => source.sourceReady,
    onFormatCreated: (id) => {
      const builder = useTemplateBuilder.getState()
      const fmt = builder.formats.find((f) => f.id === id)
      const active = builder.assets.find((a) => a.id === builder.activeAssetId)
      if (
        fmt &&
        source.sourceType === "image" &&
        active?.useSmartCrop &&
        active.url
      ) {
        source.loadSmartCropForFormat(active.url, id, fmt.w, fmt.h)
      }
    },
  })

  // Mirror canvas + clipboard into refs so the document-level keydown
  // handler can read fresh values without re-binding on each render.
  const canvasRef = useRef(canvas)
  canvasRef.current = canvas
  const clipboardRef = useRef<ClipboardEntry | null>(null)
  clipboardRef.current = clipboard

  // Composite ref — assigns the DOM element to both the page-local ref
  // and the hook's wheel-listener callback ref.
  const setViewport = useCallback(
    (el: HTMLDivElement | null) => {
      viewportElRef.current = el
      canvas.containerRef(el)
    },
    [canvas.containerRef],
  )

  // ── Initial mount ────────────────────────────────────────────
  const initRanRef = useRef(false)
  useEffect(() => {
    if (!isConnected || initRanRef.current) return
    initRanRef.current = true

    const pm = useProjectManager.getState()
    pm.init()
    const url = useTemplateBuilder.getState().loadSavedState()

    const s = useTemplateBuilder.getState().styles
    loadTemplateFonts(
      s.headlineFont,
      s.textFont,
      s.ctaFont,
      s.headlineFontWeight,
      s.textFontWeight,
      s.ctaFontWeight,
    ).then(() => renderAllCanvases())

    canvas.autoLayout()
    if (url) setTimeout(() => loadSource(), 0)

    const logoUrl = useTemplateBuilder.getState().logoUrl
    if (logoUrl.trim()) logo.loadLogoImg(logoUrl.trim())

    setTimeout(() => requestAnimationFrame(() => canvas.fitAll()), 0)

    if (typeof document !== "undefined" && document.fonts) {
      document.fonts.ready.then(() => {
        if (source.sourceReady) renderAllCanvases()
      })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected])

  // ── DAM page-hook handoff ────────────────────────────────────
  const handoffRanRef = useRef(false)
  useEffect(() => {
    if (!isConnected || !client || handoffRanRef.current) return
    const requestId = searchParams.get("requestId")
    const recordParam = searchParams.get("record")
    if (!requestId && !recordParam) return
    handoffRanRef.current = true

    async function handleHandoff() {
      let recordIds: string[] = []
      let consumeError: string | null = null

      if (requestId) {
        const { data: row, error: dbError } = await supabase
          .from("requested_records")
          .select("recordList")
          .eq("requestId", requestId)
          .single()
        if (dbError || !row) {
          consumeError = dbError?.message ?? "Request not found"
          recordIds = []
        } else {
          recordIds = row.recordList ?? []
          await supabase
            .from("requested_records")
            .delete()
            .eq("requestId", requestId)
        }
      } else if (recordParam) {
        recordIds = [recordParam]
      }

      router.replace("/templates")

      if (consumeError) {
        setDamHookModal({ recordIds: [], assets: [], error: consumeError })
        return
      }
      if (!recordIds.length) return

      setDamHookModal({ recordIds, assets: null, error: null })

      try {
        if (!client) throw new Error("Not connected")

        const expander = Expander.create()
        ;(
          expander.for("record") as { expand: (...f: string[]) => Expander }
        ).expand("masterfilelatestversion")
        ;(
          expander.for("fileversion") as { expand: (...f: string[]) => Expander }
        ).expand("publicuris")

        const BATCH_SIZE = 50
        const batches: string[][] = []
        for (let i = 0; i < recordIds.length; i += BATCH_SIZE) {
          batches.push(recordIds.slice(i, i + BATCH_SIZE))
        }

        const results = await Promise.all(
          batches.map((batch) => {
            const expression = batch.map((id) => `id='${id}'`).join(" OR ")
            return client.search.records(
              { searchExpression: { expression } },
              expander,
            )
          }),
        )

        const built: Asset[] = []
        for (const r of results) {
          if (!r.ok) continue
          const items = (r.data as { items?: unknown[] })?.items ?? []
          for (const rec of items) {
            const a = buildAssetFromRecord(rec)
            if (a) built.push(a)
          }
        }

        setDamHookModal({ recordIds, assets: built, error: null })
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to load records"
        setDamHookModal({ recordIds, assets: [], error: msg })
      }
    }

    handleHandoff()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, client])

  // ── Re-render on font-related style changes ──────────────────
  useEffect(() => {
    loadTemplateFonts(
      styles.headlineFont,
      styles.textFont,
      styles.ctaFont,
      styles.headlineFontWeight,
      styles.textFontWeight,
      styles.ctaFontWeight,
    ).then(() => renderAllCanvases())
  }, [
    styles.headlineFont,
    styles.textFont,
    styles.ctaFont,
    styles.headlineFontWeight,
    styles.textFontWeight,
    styles.ctaFontWeight,
    renderAllCanvases,
  ])

  // ── Smart-crop watcher ───────────────────────────────────────
  // Toggle the active asset's useSmartCrop flag → fetch (or clear) per-format
  // smart-cropped variants. loadSmartCrops is idempotent: it always clears
  // first, then re-loads only when the flag is on.
  useEffect(() => {
    if (!source.sourceReady || source.sourceType !== "image") return
    if (!activeAsset?.url) return
    source.loadSmartCrops(activeAsset.url)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeAsset?.useSmartCrop, source.sourceReady, source.sourceType])

  // ── Interference detection ───────────────────────────────────
  // Maps formatId → InterferenceResult for any format whose content overlay
  // overlaps the focal subject area. Skipped when smart crop is on (the
  // server-side crop already handles positioning) or when there's no
  // active asset / source.
  const interferenceMap = useMemo<Record<string, InterferenceResult>>(() => {
    if (!source.sourceEl || !source.sourceReady) return {}
    if (!activeAsset || activeAsset.useSmartCrop) return {}

    const el = source.sourceEl
    const sw =
      (el as HTMLImageElement).naturalWidth || (el as HTMLImageElement).width || 0
    const sh =
      (el as HTMLImageElement).naturalHeight || (el as HTMLImageElement).height || 0
    if (!sw || !sh) return {}

    const builder = useTemplateBuilder.getState()
    const map: Record<string, InterferenceResult> = {}
    for (const fmt of formats) {
      const visibleLayers = layers.filter((l) =>
        fmt.visibleLayers ? fmt.visibleLayers.includes(l.id) : true,
      )
      const contentInfo = {
        layers: visibleLayers,
        styles,
        contentScale: fmt.contentScale || 1,
        ctaScale: fmt.ctaScale || 1,
        fmt,
      }
      const result = detectInterference(
        fmt.w,
        fmt.h,
        sw,
        sh,
        builder.resolveAnchor(fmt),
        activeAsset.focalX,
        activeAsset.focalY,
        activeAsset.contentAwareFocal !== false,
        activeAsset.focalW,
        activeAsset.focalH,
        fmt.contentWidth ?? 60,
        contentInfo,
        activeAsset.focalFit || "cover",
      )
      if (result.interferes) map[fmt.id] = result
    }
    return map
  }, [formats, layers, styles, source.sourceEl, source.sourceReady, activeAsset])

  function fixAnchor(fmtId: FormatId) {
    const info = interferenceMap[fmtId]
    if (!info?.suggestedAnchor) return
    const builder = useTemplateBuilder.getState()
    if (builder.assets.length > 1) {
      builder.setAssetAnchor(fmtId, info.suggestedAnchor)
    } else {
      builder.updateFormat(fmtId, "anchor", info.suggestedAnchor)
    }
  }

  function fixAllAnchors() {
    const builder = useTemplateBuilder.getState()
    for (const [fmtId, info] of Object.entries(interferenceMap)) {
      if (builder.assets.length > 1) {
        builder.setAssetAnchor(fmtId, info.suggestedAnchor)
      } else {
        builder.updateFormat(fmtId, "anchor", info.suggestedAnchor)
      }
    }
  }

  // ── Callbacks ────────────────────────────────────────────────
  function onSwitchAsset(_id: AssetId) {
    publisher.reset()
    if (useTemplateBuilder.getState().activeAssetId) {
      loadSource()
    }
  }

  function onSelectFormat(id: FormatId) {
    canvas.setSelectedFormatId(id)
    setTimeout(() => canvas.zoomToFormat(id), 0)
  }

  function onDeleteFormat(id: FormatId) {
    useTemplateBuilder.getState().removeFormat(id)
    if (canvas.selectedFormatId === id) canvas.setSelectedFormatId(null)
  }

  function switchProject(newProjectId: string) {
    const pm = useProjectManager.getState()
    const tb = useTemplateBuilder.getState()

    pm.saveProjectSnapshot(tb.toSnapshot())

    source.reset()
    publisher.reset()
    tb.setStatus("")

    pm.setActiveProject(newProjectId)
    const url = tb.hydrateFromSnapshot(pm.getProjectSnapshot(newProjectId))

    setTimeout(() => {
      canvas.autoLayout()
      if (url) loadSource()
      else renderAllCanvases()
      const logoUrl = useTemplateBuilder.getState().logoUrl
      if (logoUrl.trim()) logo.loadLogoImg(logoUrl.trim())
      else logo.clearLogo()
      setTimeout(() => requestAnimationFrame(() => canvas.fitAll()), 0)
    }, 0)
  }

  function onDeleteProject(id: string) {
    const pm = useProjectManager.getState()
    if (pm.projectOrder.length <= 1) return
    const wasCurrent = id === pm.activeProjectId
    pm.deleteProject(id)
    if (wasCurrent) {
      const newActive = useProjectManager.getState().activeProjectId
      if (newActive) {
        const tb = useTemplateBuilder.getState()
        source.reset()
        publisher.reset()
        tb.setStatus("")
        const url = tb.hydrateFromSnapshot(pm.getProjectSnapshot(newActive))
        setTimeout(() => {
          canvas.autoLayout()
          if (url) loadSource()
          else renderAllCanvases()
          const logoUrl = useTemplateBuilder.getState().logoUrl
          if (logoUrl.trim()) logo.loadLogoImg(logoUrl.trim())
          else logo.clearLogo()
        }, 0)
      }
    }
  }

  function onDamHookImport(payload: ConfirmPayload) {
    setDamHookModal(null)
    if (!payload.assets.length) return

    const pm = useProjectManager.getState()
    const tb = useTemplateBuilder.getState()

    pm.saveProjectSnapshot(tb.toSnapshot())

    const targetId = payload.isNew
      ? pm.createProject(payload.newName)
      : payload.projectId
    if (!targetId) return

    source.reset()
    publisher.reset()
    tb.setStatus("")
    pm.setActiveProject(targetId)
    tb.hydrateFromSnapshot(pm.getProjectSnapshot(targetId))

    for (const a of payload.assets) {
      useTemplateBuilder.getState().addAsset(a.url, a.label)
    }

    pm.saveProjectSnapshot(useTemplateBuilder.getState().toSnapshot())

    setTimeout(() => {
      canvas.autoLayout()
      const builder = useTemplateBuilder.getState()
      if (builder.activeAssetId) loadSource()
      else renderAllCanvases()
      const logoUrl = builder.logoUrl
      if (logoUrl.trim()) logo.loadLogoImg(logoUrl.trim())
      setTimeout(() => requestAnimationFrame(() => canvas.fitAll()), 0)
    }, 0)
  }

  function onDamHookCancel() {
    setDamHookModal(null)
  }

  function setCanvasHandle(id: FormatId, h: TemplateCanvasHandle | null) {
    if (h) canvasHandlesRef.current[id] = h
    else delete canvasHandlesRef.current[id]
  }

  // ── Context menu / clipboard ─────────────────────────────────
  function closeCtxMenu() {
    setCtxMenu((prev) => ({ ...prev, visible: false }))
  }

  function onContextMenu(e: React.MouseEvent<HTMLDivElement>) {
    e.preventDefault()
    const target = e.target as HTMLElement
    const card = target.closest<HTMLElement>(".world-card")
    const fmtId = card?.dataset.formatId ?? null
    if (!fmtId) {
      // Right-click on empty canvas — show menu only if a format is in clipboard
      if (clipboard?.type === "format") {
        setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, formatId: null })
      }
      return
    }
    canvas.setSelectedFormatId(fmtId)
    setCtxMenu({ visible: true, x: e.clientX, y: e.clientY, formatId: fmtId })
  }

  function pasteFormatAt(data: Format, screenX: number | null, screenY: number | null) {
    const el = viewportElRef.current
    let wx = 0
    let wy = 0
    if (el && screenX != null && screenY != null) {
      const rect = el.getBoundingClientRect()
      const local = canvas.screenToWorld(screenX - rect.left, screenY - rect.top)
      wx = Math.round(local.x)
      wy = Math.round(local.y)
    } else if (el) {
      const centre = canvas.screenToWorld(el.clientWidth / 2, el.clientHeight / 2)
      wx = Math.round(centre.x - data.w / 2)
      wy = Math.round(centre.y - data.h / 2)
    }
    const newId = useTemplateBuilder
      .getState()
      .addFormat(data.label + " copy", data.w, data.h, wx, wy)
    for (const p of FMT_COPY_PROPS) {
      const v = (data as unknown as Record<string, unknown>)[p]
      if (v !== undefined) {
        const val = typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v
        useTemplateBuilder
          .getState()
          .updateFormat(newId, p as keyof Format, val as never)
      }
    }
    canvas.setSelectedFormatId(newId)
    return newId
  }

  function ctxCopy() {
    if (!ctxMenu.formatId) return
    const fmt = useTemplateBuilder
      .getState()
      .formats.find((f) => f.id === ctxMenu.formatId)
    if (!fmt) return
    setClipboard({ type: "format", data: JSON.parse(JSON.stringify(fmt)) })
    closeCtxMenu()
  }

  function ctxDuplicate() {
    if (!ctxMenu.formatId) return
    const fmt = useTemplateBuilder
      .getState()
      .formats.find((f) => f.id === ctxMenu.formatId)
    if (!fmt) return
    const pos = useTemplateBuilder.getState().canvasPositions[fmt.id] ?? { x: 0, y: 0 }
    const newId = useTemplateBuilder
      .getState()
      .addFormat(fmt.label + " copy", fmt.w, fmt.h, pos.x + 40, pos.y + 40)
    for (const p of FMT_COPY_PROPS) {
      const v = (fmt as unknown as Record<string, unknown>)[p]
      if (v !== undefined) {
        const val = typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v
        useTemplateBuilder
          .getState()
          .updateFormat(newId, p as keyof Format, val as never)
      }
    }
    canvas.setSelectedFormatId(newId)
    closeCtxMenu()
  }

  function ctxCopyStyle() {
    if (!ctxMenu.formatId) return
    const fmt = useTemplateBuilder
      .getState()
      .formats.find((f) => f.id === ctxMenu.formatId)
    if (!fmt) return
    setClipboard({
      type: "style",
      data: {
        logoSize: fmt.logoSize,
        contentScale: fmt.contentScale,
        contentWidth: fmt.contentWidth,
        ctaScale: fmt.ctaScale,
        padding: fmt.padding,
      },
    })
    closeCtxMenu()
  }

  function ctxCopyAnchors() {
    if (!ctxMenu.formatId) return
    const fmt = useTemplateBuilder
      .getState()
      .formats.find((f) => f.id === ctxMenu.formatId)
    if (!fmt) return
    setClipboard({
      type: "anchors",
      data: {
        anchor: fmt.anchor,
        layerAnchors: JSON.parse(JSON.stringify(fmt.layerAnchors ?? {})),
        logoAnchor: fmt.logoAnchor ?? "",
      },
    })
    closeCtxMenu()
  }

  function ctxPaste() {
    if (!clipboard) return
    if (clipboard.type === "format") {
      pasteFormatAt(clipboard.data, ctxMenu.x, ctxMenu.y)
    } else if (clipboard.type === "style") {
      const targetId = ctxMenu.formatId
      if (!targetId) return
      const props: Array<keyof typeof clipboard.data> = [
        "logoSize",
        "contentScale",
        "contentWidth",
        "ctaScale",
        "padding",
      ]
      for (const p of props) {
        const v = clipboard.data[p]
        if (v !== undefined) {
          useTemplateBuilder
            .getState()
            .updateFormat(targetId, p as keyof Format, v as never)
        }
      }
    } else if (clipboard.type === "anchors") {
      const targetId = ctxMenu.formatId
      if (!targetId) return
      useTemplateBuilder.getState().updateFormat(targetId, "anchor", clipboard.data.anchor)
      useTemplateBuilder
        .getState()
        .updateFormat(
          targetId,
          "layerAnchors",
          JSON.parse(JSON.stringify(clipboard.data.layerAnchors)),
        )
      useTemplateBuilder
        .getState()
        .updateFormat(targetId, "logoAnchor", clipboard.data.logoAnchor)
    }
    closeCtxMenu()
  }

  function ctxPasteLabel(): string {
    if (!clipboard) return ""
    if (clipboard.type === "format") return "Paste Format"
    if (clipboard.type === "style") return "Paste Style"
    if (clipboard.type === "anchors") return "Paste Anchors"
    return "Paste"
  }

  // ── Document-level event listeners ───────────────────────────
  // Close context menu on any click outside
  useEffect(() => {
    function onDocClick() {
      if (ctxMenu.visible) closeCtxMenu()
    }
    document.addEventListener("click", onDocClick)
    return () => document.removeEventListener("click", onDocClick)
  }, [ctxMenu.visible])

  // Keyboard shortcuts: Ctrl/Cmd + C/V/D for format copy/paste/duplicate.
  // Re-binds only on mount; reads canvas/clipboard via refs for freshness.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null
      const tag = target?.tagName
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return
      if (!e.ctrlKey && !e.metaKey) return

      const cv = canvasRef.current
      const cb = clipboardRef.current

      if (e.key === "c") {
        const fmtId = cv.selectedFormatId
        if (!fmtId) return
        const fmt = useTemplateBuilder.getState().formats.find((f) => f.id === fmtId)
        if (!fmt) return
        setClipboard({ type: "format", data: JSON.parse(JSON.stringify(fmt)) })
        e.preventDefault()
      } else if (e.key === "v") {
        if (!cb || cb.type !== "format") return
        const data = cb.data
        const el = viewportElRef.current
        let wx = 0
        let wy = 0
        if (el) {
          const centre = cv.screenToWorld(el.clientWidth / 2, el.clientHeight / 2)
          wx = Math.round(centre.x - data.w / 2)
          wy = Math.round(centre.y - data.h / 2)
        }
        const newId = useTemplateBuilder
          .getState()
          .addFormat(data.label + " copy", data.w, data.h, wx, wy)
        for (const p of FMT_COPY_PROPS) {
          const v = (data as unknown as Record<string, unknown>)[p]
          if (v !== undefined) {
            const val = typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v
            useTemplateBuilder
              .getState()
              .updateFormat(newId, p as keyof Format, val as never)
          }
        }
        cv.setSelectedFormatId(newId)
        e.preventDefault()
      } else if (e.key === "d") {
        const fmtId = cv.selectedFormatId
        if (!fmtId) return
        const fmt = useTemplateBuilder.getState().formats.find((f) => f.id === fmtId)
        if (!fmt) return
        const pos = useTemplateBuilder.getState().canvasPositions[fmt.id] ?? {
          x: 0,
          y: 0,
        }
        const newId = useTemplateBuilder
          .getState()
          .addFormat(fmt.label + " copy", fmt.w, fmt.h, pos.x + 40, pos.y + 40)
        for (const p of FMT_COPY_PROPS) {
          const v = (fmt as unknown as Record<string, unknown>)[p]
          if (v !== undefined) {
            const val = typeof v === "object" ? JSON.parse(JSON.stringify(v)) : v
            useTemplateBuilder
              .getState()
              .updateFormat(newId, p as keyof Format, val as never)
          }
        }
        cv.setSelectedFormatId(newId)
        e.preventDefault()
      }
    }
    document.addEventListener("keydown", onKeyDown)
    return () => document.removeEventListener("keydown", onKeyDown)
  }, [])

  // ── Auth gate ────────────────────────────────────────────────
  if (!isConnected) {
    return (
      <div className="flex-1 flex items-center justify-center p-8">
        <p className="text-sm text-muted-foreground">
          Connect to Aprimo to use the Dynamic Content workspace.
        </p>
      </div>
    )
  }

  // ── Render ───────────────────────────────────────────────────
  return (
    // min-h-0 lets flex-1 actually shrink below intrinsic content size, so
    // the child .tpl-page can constrain its panels to the viewport. Without
    // this the flex-1 element grows to fit content and breaks scrolling.
    <div className="tpl-scope flex-1 min-h-0 flex flex-col">
      <div className="tpl-page">
        {/* Left controls */}
        <div className="tpl-controls">
          <TemplateControls
            sourceReady={source.sourceReady}
            sourceType={source.sourceType}
            showBrowseDam={contentSelector.canOpen}
            showPublish={publisher.canPublish}
            publishing={publisher.publishing}
            publishProgress={publisher.progress}
            publishedDamUrl={publisher.damUrl}
            onLoadSource={loadSource}
            onClearLogo={logo.clearLogo}
            onBrowseDam={contentSelector.open}
            onExportAll={exporter.exportAll}
            onExportBulk={bulkExporter.exportAllRows}
            onSwitchAsset={onSwitchAsset}
            onPublishRenditions={publisher.publishAll}
          />
        </div>

        {/* Canvas area */}
        <div className="tpl-canvas-area">
          {/* Toolbar */}
          <div className="tpl-canvas-toolbar">
            <div className="toolbar-left">
              <ProjectSwitcher
                onSwitchProject={switchProject}
                onDeleteProject={onDeleteProject}
              />
              <span className="toolbar-sep" />
              <FormatSwitcher
                onSelectFormat={onSelectFormat}
                onDeleteFormat={onDeleteFormat}
              />
              {Object.keys(interferenceMap).length > 0 && (
                <button
                  className="toolbar-interference"
                  onClick={fixAllAnchors}
                  title="Fix content overlap on affected formats"
                >
                  <WarningIcon />
                  {Object.keys(interferenceMap).length} overlap
                  {Object.keys(interferenceMap).length > 1 ? "s" : ""} — Fix
                </button>
              )}
            </div>
            <div className="toolbar-right">
              <div className="zoom-controls">
                <button
                  className="zoom-btn"
                  onClick={canvas.zoomOut}
                  title="Zoom out"
                  aria-label="Zoom out"
                >
                  −
                </button>
                <button
                  className="zoom-display"
                  onClick={canvas.fitAll}
                  title="Fit all"
                >
                  {canvas.zoomPercent}%
                </button>
                <button
                  className="zoom-btn"
                  onClick={canvas.zoomIn}
                  title="Zoom in"
                  aria-label="Zoom in"
                >
                  +
                </button>
              </div>
            </div>
          </div>

          {/* Canvas viewport */}
          <div
            ref={setViewport}
            className={`canvas-viewport ${canvas.cursorClass}`}
            onPointerDown={canvas.onPointerDown}
            onPointerMove={canvas.onPointerMove}
            onPointerUp={canvas.onPointerUp}
            onContextMenu={onContextMenu}
          >
            {!source.sourceReady && !source.sourceLoading && (
              <div className="empty-state">
                <h3>Paste an asset URL to get started</h3>
                <p>
                  Load any Aprimo CDN image or video URL, then drag on the canvas to
                  create formats.
                </p>
              </div>
            )}

            {source.sourceReady && (
              <div className="world-wrapper" style={canvas.worldStyle}>
                {formats.map((fmt) => {
                  const pos = canvasPositions[fmt.id] ?? { x: 0, y: 0 }
                  const isSelected = canvas.selectedFormatId === fmt.id
                  // Resolve per-asset anchor override before passing to the
                  // canvas — drawTemplate reads fmt.anchor directly, so we
                  // wrap with the effective anchor when there's an override
                  // for the active asset. Returns the original fmt object
                  // when no override applies, to keep ref-equality stable.
                  const resolvedAnchor = useTemplateBuilder
                    .getState()
                    .resolveAnchor(fmt)
                  const resolvedFmt =
                    resolvedAnchor === fmt.anchor
                      ? fmt
                      : { ...fmt, anchor: resolvedAnchor }
                  return (
                    <div
                      key={fmt.id}
                      className={`world-card${isSelected ? " is-selected" : ""}`}
                      data-format-id={fmt.id}
                      style={{
                        left: pos.x + "px",
                        top: pos.y + "px",
                        width: fmt.w + "px",
                        height: fmt.h + "px",
                      }}
                    >
                      <TemplateCanvas
                        ref={(h) => setCanvasHandle(fmt.id, h)}
                        format={resolvedFmt}
                        drawState={drawState}
                        croppedEl={source.croppedEls[fmt.id] ?? null}
                        sourceType={source.sourceType}
                        selected={isSelected}
                      />
                      {isSelected && (
                        <>
                          <div
                            className="resize-handle rh-n"
                            data-resize-handle="n"
                            style={{ transform: `scaleY(${1 / canvas.zoom})` }}
                          />
                          <div
                            className="resize-handle rh-s"
                            data-resize-handle="s"
                            style={{ transform: `scaleY(${1 / canvas.zoom})` }}
                          />
                          <div
                            className="resize-handle rh-e"
                            data-resize-handle="e"
                            style={{ transform: `scaleX(${1 / canvas.zoom})` }}
                          />
                          <div
                            className="resize-handle rh-w"
                            data-resize-handle="w"
                            style={{ transform: `scaleX(${1 / canvas.zoom})` }}
                          />
                          <div
                            className="resize-handle rh-nw"
                            data-resize-handle="nw"
                            style={{ transform: `scale(${1 / canvas.zoom})` }}
                          />
                          <div
                            className="resize-handle rh-ne"
                            data-resize-handle="ne"
                            style={{ transform: `scale(${1 / canvas.zoom})` }}
                          />
                          <div
                            className="resize-handle rh-sw"
                            data-resize-handle="sw"
                            style={{ transform: `scale(${1 / canvas.zoom})` }}
                          />
                          <div
                            className="resize-handle rh-se"
                            data-resize-handle="se"
                            style={{ transform: `scale(${1 / canvas.zoom})` }}
                          />
                        </>
                      )}
                      {canvas.isResizingCard &&
                        canvas.dragCardId === fmt.id && (
                          <div
                            className="resize-dims"
                            style={{
                              transform: `translate(-50%, -50%) scale(${1 / canvas.zoom})`,
                            }}
                          >
                            {fmt.w} × {fmt.h}
                          </div>
                        )}
                      {interferenceMap[fmt.id] && (
                        <button
                          className="interference-badge"
                          title={`Subject may be behind text — click to move anchor to ${interferenceMap[fmt.id].suggestedAnchor.toUpperCase()}`}
                          onClick={(e) => {
                            e.stopPropagation()
                            fixAnchor(fmt.id)
                          }}
                        >
                          <WarningIcon />
                          Fix
                        </button>
                      )}
                    </div>
                  )
                })}

                {canvas.snapGuides.map((g, idx) => (
                  <div
                    key={`snap-${idx}`}
                    className={`snap-guide ${g.axis === "x" ? "snap-guide-v" : "snap-guide-h"}`}
                    style={
                      g.axis === "x"
                        ? {
                            left: g.pos + "px",
                            top: "-10000px",
                            height: "20000px",
                            borderLeftWidth: 1 / canvas.zoom + "px",
                          }
                        : {
                            top: g.pos + "px",
                            left: "-10000px",
                            width: "20000px",
                            borderTopWidth: 1 / canvas.zoom + "px",
                          }
                    }
                  />
                ))}

                {canvas.drawRect.active && canvas.drawRectStyle && (
                  <div className="draw-rect" style={canvas.drawRectStyle} />
                )}
              </div>
            )}

            {source.sourceLoading && (
              <div className="canvas-loading-overlay visible">
                <div className="spinner" />
                <span style={{ fontSize: 13, color: "#64748b", fontWeight: 500 }}>
                  {source.sourceType === "video"
                    ? "Loading video…"
                    : "Loading image…"}
                </span>
              </div>
            )}

            {source.sourceReady && (
              <div className="canvas-hint">
                Scroll to zoom · Middle-click or Space+drag to pan · Draw on empty area
                to create
              </div>
            )}
          </div>
        </div>

        {/* Right panel */}
        <RightPanel
          format={activeFormat}
          canDelete={formats.length > 1}
          sourceType={source.sourceType}
          onClose={() => useTemplateBuilder.getState().setActiveSettingsId(null)}
          onDelete={onDeleteFormat}
          onExport={() => activeFormat && exporter.exportFormat(activeFormat.id)}
        />
      </div>

      {/* Hidden video element for source loader */}
      <video
        ref={source.hiddenVideoRef}
        crossOrigin="anonymous"
        loop
        muted
        playsInline
        style={{ display: "none" }}
      />

      {/* DAM page-hook arrival modal */}
      {damHookModal && (
        <DamHookProjectPickerModal
          recordIds={damHookModal.recordIds}
          assets={damHookModal.assets}
          error={damHookModal.error}
          onConfirm={onDamHookImport}
          onCancel={onDamHookCancel}
        />
      )}

      {/* Right-click context menu (position: fixed, escapes clipping) */}
      {ctxMenu.visible && (
        <div
          className="ctx-menu"
          style={{ left: ctxMenu.x + "px", top: ctxMenu.y + "px" }}
          onClick={(e) => e.stopPropagation()}
        >
          {ctxMenu.formatId ? (
            <>
              <button className="ctx-item" onClick={ctxCopy}>
                <CopyIcon /> Copy Format
              </button>
              <button className="ctx-item" onClick={ctxDuplicate}>
                <DuplicateIcon /> Duplicate
              </button>
              <div className="ctx-divider" />
              <button className="ctx-item" onClick={ctxCopyStyle}>
                <BrushIcon /> Copy Style
              </button>
              <button className="ctx-item" onClick={ctxCopyAnchors}>
                <AnchorIcon /> Copy Anchors
              </button>
              {clipboard && (
                <>
                  <div className="ctx-divider" />
                  <button className="ctx-item ctx-paste" onClick={ctxPaste}>
                    <PasteIcon /> {ctxPasteLabel()}
                  </button>
                </>
              )}
              <div className="ctx-divider" />
              <button
                className="ctx-item ctx-danger"
                onClick={() => {
                  if (ctxMenu.formatId) onDeleteFormat(ctxMenu.formatId)
                  closeCtxMenu()
                }}
              >
                <TrashIcon /> Delete
              </button>
            </>
          ) : (
            <button
              className="ctx-item ctx-paste"
              disabled={!clipboard || clipboard.type !== "format"}
              onClick={ctxPaste}
            >
              <PasteIcon /> Paste Format
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ── Inline icons for the context menu ────────────────────────────

function CopyIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

function DuplicateIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1" />
    </svg>
  )
}

function BrushIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.121 2.121 0 113 3L7 19l-4 1 1-4L16.5 3.5z" />
    </svg>
  )
}

function AnchorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 8v8M8 12h8" />
    </svg>
  )
}

function PasteIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 4h2a2 2 0 012 2v14a2 2 0 01-2 2H6a2 2 0 01-2-2V6a2 2 0 012-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  )
}

function TrashIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
    </svg>
  )
}

function WarningIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" />
      <line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}

export default function TemplatesPage() {
  return (
    // h-screen + overflow-hidden so the workspace fills exactly the viewport
    // height and the internal panels scroll instead of the whole page. Other
    // tools use min-h-screen because they want a scrollable page; Templates
    // is a fixed workspace where the canvas should stay put.
    // Footer intentionally omitted on this page — workspace tools want all
    // available vertical space for the canvas.
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      <Navbar showPageHeader={false} />
      <Suspense>
        <TemplatesContent />
      </Suspense>
    </div>
  )
}
