"use client"

import { useCallback, useEffect, useState, Suspense } from "react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { Expander, AprimoRateLimitError } from "aprimo-js"
import { buildClassificationTree, flattenForPicker } from "@/lib/classifications"
import type { ClassificationNode } from "@/models/aprimo"
import { Loader2, Eye, Download, Zap, Play, Users, ExternalLink, RefreshCw, Layers, Tag, ImageOff, FileImage, CircleUser, ChevronsUpDown, Check, X, ChevronRight, ChevronDown } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts"
import Link from "next/link"
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command"

// ── Types ─────────────────────────────────────────────────────────────────────

type DateRangeKey = "30d" | "90d" | "6m" | "1y" | "all"
type ActiveMetric = "topassets" | "users" | "views" | "downloads" | "impressions" | "plays" | null

interface KPIs {
  activeUsers: number
  views: number
  downloads: number
  impressions: number
  plays: number
}

interface ChartPoint {
  date: string
  views: number
  downloads: number
  impressions: number
  plays: number
}

interface AssetRow {
  recordId: string
  count: number
}

interface UserRow {
  user: string
  count: number
}

interface UtmRow {
  utmKey: string
  utmValue: string
  count: number
}

interface UserActivity {
  totalViews: number
  totalDownloads: number
  activeDays: number
  chartData: ChartPoint[]
  topViewedAssets: AssetRow[]
  topDownloadedAssets: AssetRow[]
}

interface CollectionRow {
  id: string
  name: string
  type: "Static" | "Dynamic"
  description: string
  createdOn: string
  modifiedOn: string
}

interface ClassificationFlatItem {
  id: string          // GUID — React key
  identifier: string  // analytics identifier — used in filter values
  label: string       // localized display label
  depth: number       // tree depth (0 = top-level child of root)
  hasChildren: boolean
  parentId: string | null  // id of nearest visible ancestor (null for depth-0 nodes)
  disabled: boolean   // true when identifier is empty — shown in tree but not selectable
}

function getEnglishLabel(labels: Array<{ languageId: string; value: string }> | undefined, fallback: string): string {
  if (!labels?.length) return fallback
  for (const lang of ["c2bd4f9b-bb95-4bcb-80c3-1e924c9c26dc", "c2bd4f9bbb954bcb80c31e924c9c26dc"]) {
    const match = labels.find(l => l.languageId.toLowerCase() === lang.toLowerCase())
    if (match?.value) return match.value
  }
  const enPrefix = labels.find(l => l.languageId.toLowerCase().startsWith("en"))
  return enPrefix?.value ?? labels[0]?.value ?? fallback
}

function isAncestorExpanded(item: ClassificationFlatItem, byId: Map<string, ClassificationFlatItem>, expanded: Set<string>): boolean {
  let cur: ClassificationFlatItem | undefined = item
  while (cur.parentId) {
    if (!expanded.has(cur.parentId)) return false
    cur = byId.get(cur.parentId)
    if (!cur) break
  }
  return true
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DATE_RANGE_OPTIONS: { key: DateRangeKey; label: string }[] = [
  { key: "30d", label: "30 days" },
  { key: "90d", label: "90 days" },
  { key: "6m", label: "6 months" },
  { key: "1y", label: "1 year" },
  { key: "all", label: "All time" },
]

function getDateRange(key: DateRangeKey): [string, string] | undefined {
  if (key === "all") return undefined
  const now = new Date()
  const start = new Date()
  if (key === "30d") start.setDate(now.getDate() - 30)
  else if (key === "90d") start.setDate(now.getDate() - 90)
  else if (key === "6m") start.setMonth(now.getMonth() - 6)
  else if (key === "1y") start.setFullYear(now.getFullYear() - 1)
  return [start.toISOString().slice(0, 10), now.toISOString().slice(0, 10)]
}

function getGranularity(key: DateRangeKey): "day" | "month" {
  return key === "30d" || key === "90d" ? "day" : "month"
}

async function queryAnalytics(environment: string, authHeader: string, query: object): Promise<any[]> {
  const url = `https://${environment}.aprimo.com/analytics/?query=${encodeURIComponent(JSON.stringify(query))}`
  const res = await fetch(url, { headers: { Authorization: authHeader } })
  if (!res.ok) throw new Error(`Analytics API error: ${res.status} ${res.statusText}`)
  const json = await res.json()
  return json.data ?? []
}

function parseCount(val: string | undefined): number {
  return parseInt(val ?? "0", 10) || 0
}

function toGuid(id: string): string {
  if (id.includes("-") || id.length !== 32) return id
  return `${id.slice(0,8)}-${id.slice(8,12)}-${id.slice(12,16)}-${id.slice(16,20)}-${id.slice(20)}`
}

// Run tasks with limited concurrency, returning settled results in input order.
async function throttledSettled<T>(
  tasks: Array<() => Promise<T>>,
  concurrency: number
): Promise<PromiseSettledResult<T>[]> {
  const results: PromiseSettledResult<T>[] = new Array(tasks.length)
  let next = 0
  async function run() {
    while (next < tasks.length) {
      const i = next++
      try { results[i] = { status: "fulfilled", value: await tasks[i]() } }
      catch (reason) { results[i] = { status: "rejected", reason } }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, run))
  return results
}

function extractDate(row: any, dim: string): string {
  return (
    (row[`${dim}.day`] as string | undefined)?.slice(0, 10) ??
    (row[`${dim}.month`] as string | undefined)?.slice(0, 10) ??
    (row[dim] as string | undefined)?.slice(0, 10) ??
    ""
  )
}

// ── Dashboard content ─────────────────────────────────────────────────────────

function DashboardContent() {
  const { isConnected, connection, getAuthHeader, client } = useAprimo()

  const [dateRange, setDateRange] = useState<DateRangeKey>("30d")
  const [kpis, setKpis] = useState<KPIs | null>(null)
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [topViewed, setTopViewed] = useState<AssetRow[]>([])
  const [topDownloaded, setTopDownloaded] = useState<AssetRow[]>([])
  const [topImpressed, setTopImpressed] = useState<AssetRow[]>([])
  const [topPlayed, setTopPlayed] = useState<AssetRow[]>([])
  const [viewsByUser, setViewsByUser] = useState<UserRow[]>([])
  const [downloadsByUser, setDownloadsByUser] = useState<UserRow[]>([])
  const [playsByUser, setPlaysByUser] = useState<UserRow[]>([])
  const [utmData, setUtmData] = useState<UtmRow[]>([])
  const [collections, setCollections] = useState<CollectionRow[]>([])
  const [collectionsLoading, setCollectionsLoading] = useState(false)
  const [collectionsError, setCollectionsError] = useState<string | null>(null)
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null)
  const [collectionComboOpen, setCollectionComboOpen] = useState(false)
  const [collectionFilterSupported, setCollectionFilterSupported] = useState<boolean | null>(null)
  const [dynamicCollectionsSupported, setDynamicCollectionsSupported] = useState<boolean | null>(null)
  const [selectedClassificationId, setSelectedClassificationId] = useState<string | null>(null)   // GUID — UI selection key
  const [selectedClassificationFilter, setSelectedClassificationFilter] = useState<string | null>(null) // analytics filter value
  const [classifications, setClassifications] = useState<ClassificationFlatItem[]>([])
  const [classificationsLoading, setClassificationsLoading] = useState(false)
  const [classificationComboOpen, setClassificationComboOpen] = useState(false)
  const [classificationSearch, setClassificationSearch] = useState("")
  const [expandedClassifications, setExpandedClassifications] = useState<Set<string>>(new Set())
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [userActivity, setUserActivity] = useState<UserActivity | null>(null)
  const [userActivityLoading, setUserActivityLoading] = useState(false)
  const [userActivityError, setUserActivityError] = useState<string | null>(null)
  const [recordLabels, setRecordLabels] = useState<Map<string, string>>(new Map())
  const [recordThumbnails, setRecordThumbnails] = useState<Map<string, string>>(new Map())
  const [recordUnavailable, setRecordUnavailable] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [totalAssetCount, setTotalAssetCount] = useState<number | null>(null)
  const [activeMetric, setActiveMetric] = useState<ActiveMetric>("topassets")

  const fetchData = useCallback(async () => {
    if (!connection || !isConnected) return
    const authHeader = getAuthHeader()
    if (!authHeader) return

    setLoading(true)
    setError(null)

    try {
      const dr = getDateRange(dateRange)
      const granularity = getGranularity(dateRange)
      const env = connection.environment

      const drRange = (dim: string) => dr ? { timeDimensions: [{ dimension: dim, dateRange: dr }] } : {}

      // Classification filter → use ContentEngagement cube (supports Classifications joins)
      const classFilter = selectedClassificationFilter
        ? [{ member: "Classifications.identifier", operator: "equals" as const, values: [selectedClassificationFilter] }]
        : []

      // Collection filter — also available in the CE path via ContentEngagement.collectionId
      const colGuid = selectedCollectionId ? toGuid(selectedCollectionId) : null
      const ceColFilter = colGuid
        ? [{ member: "ContentEngagement.collectionId", operator: "equals" as const, values: [colGuid] }]
        : []

      let resolvedRecordIds: string[] = []

      if (classFilter.length > 0) {
        // ── ContentEngagement path ────────────────────────────────────────────
        const ceDrTime = (extra?: object) => ({
          timeDimensions: [{ dimension: "ContentEngagement.date", granularity, ...(dr ? { dateRange: dr } : {}), ...extra }],
        })
        const ceDrFilter = dr ? [{ dimension: "ContentEngagement.date", dateRange: dr }] : []
        // Combine classification + optional collection filter
        const ceFilters = [...classFilter, ...ceColFilter]

        const [ceTotal, ceChart, ceTopV, ceTopD, ceTopP] = await Promise.all([
          queryAnalytics(env, authHeader, {
            measures: ["ContentEngagement.viewsCount", "ContentEngagement.downloadsCount", "ContentEngagement.previewPlaybacksCount"],
            filters: ceFilters,
            ...(ceDrFilter.length ? { timeDimensions: ceDrFilter } : {}),
          }),
          queryAnalytics(env, authHeader, {
            measures: ["ContentEngagement.viewsCount", "ContentEngagement.downloadsCount", "ContentEngagement.previewPlaybacksCount"],
            filters: ceFilters,
            ...ceDrTime(),
            order: { "ContentEngagement.date": "asc" },
            limit: 1000,
          }),
          queryAnalytics(env, authHeader, { measures: ["ContentEngagement.viewsCount"], dimensions: ["ContentEngagement.recordId"], filters: ceFilters, ...(ceDrFilter.length ? { timeDimensions: ceDrFilter } : {}), order: { "ContentEngagement.viewsCount": "desc" }, limit: 20 }),
          queryAnalytics(env, authHeader, { measures: ["ContentEngagement.downloadsCount"], dimensions: ["ContentEngagement.recordId"], filters: ceFilters, ...(ceDrFilter.length ? { timeDimensions: ceDrFilter } : {}), order: { "ContentEngagement.downloadsCount": "desc" }, limit: 20 }),
          queryAnalytics(env, authHeader, { measures: ["ContentEngagement.previewPlaybacksCount"], dimensions: ["ContentEngagement.recordId"], filters: ceFilters, ...(ceDrFilter.length ? { timeDimensions: ceDrFilter } : {}), order: { "ContentEngagement.previewPlaybacksCount": "desc" }, limit: 20 }),
        ])

        setKpis({
          activeUsers: 0,
          views:       parseCount(ceTotal[0]?.["ContentEngagement.viewsCount"]),
          downloads:   parseCount(ceTotal[0]?.["ContentEngagement.downloadsCount"]),
          impressions: 0,
          plays:       parseCount(ceTotal[0]?.["ContentEngagement.previewPlaybacksCount"]),
        })

        const dateMap = new Map<string, ChartPoint>()
        for (const row of ceChart) {
          const date = extractDate(row, "ContentEngagement.date")
          if (!date) continue
          if (!dateMap.has(date)) dateMap.set(date, { date, views: 0, downloads: 0, impressions: 0, plays: 0 })
          const pt = dateMap.get(date)!
          pt.views     = parseCount(row["ContentEngagement.viewsCount"])
          pt.downloads = parseCount(row["ContentEngagement.downloadsCount"])
          pt.plays     = parseCount(row["ContentEngagement.previewPlaybacksCount"])
        }
        setChartData(Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date)))

        const ceRows = (data: any[], countKey: string): AssetRow[] =>
          data.map((r: any) => ({ recordId: r["ContentEngagement.recordId"] ?? "", count: parseCount(r[countKey]) })).filter((r: AssetRow) => r.recordId)

        const tvd = ceRows(ceTopV, "ContentEngagement.viewsCount")
        const tdd = ceRows(ceTopD, "ContentEngagement.downloadsCount")
        const tpd = ceRows(ceTopP, "ContentEngagement.previewPlaybacksCount")

        setTopViewed(tvd)
        setTopDownloaded(tdd)
        setTopImpressed([])
        setTopPlayed(tpd)
        setViewsByUser([])
        setDownloadsByUser([])
        setPlaysByUser([])
        setUtmData([])

        resolvedRecordIds = Array.from(new Set([...tvd, ...tdd, ...tpd].map(r => r.recordId)))

      } else {
        // ── Individual cubes path ─────────────────────────────────────────────
        // Views and PreviewPlaybacks cubes expose a collectionId dimension; Downloads/Impressions do not
        // colGuid is computed above (shared with CE path)
        const vcf = colGuid ? [{ member: "Views.collectionId", operator: "equals" as const, values: [colGuid] }] : []
        const pcf = colGuid ? [{ member: "PreviewPlaybacks.collectionId", operator: "equals" as const, values: [colGuid] }] : []

        const [
          viewsTotal, downloadsTotal, impressionsTotal, playsTotal,
          viewsChart, downloadsChart, impressionsChart, playsChart,
          topViewedData, topDownloadedData, topImpressedData, topPlayedData,
          viewsUserData, downloadsUserData, playsUserData, utmRaw,
        ] = await Promise.all([
          // KPI totals
          queryAnalytics(env, authHeader, { measures: ["Views.count"], filters: vcf, ...drRange("DateDimension.date") }),
          queryAnalytics(env, authHeader, { measures: ["Downloads.count"], ...drRange("Downloads.downloadDate") }),
          queryAnalytics(env, authHeader, { measures: ["Impressions.count"], ...drRange("Impressions.hitDateTime") }),
          queryAnalytics(env, authHeader, { measures: ["PreviewPlaybacks.count"], filters: pcf, ...drRange("PreviewPlaybacks.previewPlaybackDate") }),
          // Time series
          queryAnalytics(env, authHeader, { measures: ["Views.count"], filters: vcf, timeDimensions: [{ dimension: "DateDimension.date", granularity, ...(dr ? { dateRange: dr } : {}) }], order: { "DateDimension.date": "asc" }, limit: 1000 }),
          queryAnalytics(env, authHeader, { measures: ["Downloads.count"], timeDimensions: [{ dimension: "Downloads.downloadDate", granularity, ...(dr ? { dateRange: dr } : {}) }], order: { "Downloads.downloadDate": "asc" }, limit: 1000 }),
          queryAnalytics(env, authHeader, { measures: ["Impressions.count"], timeDimensions: [{ dimension: "Impressions.hitDateTime", granularity, ...(dr ? { dateRange: dr } : {}) }], order: { "Impressions.hitDateTime": "asc" }, limit: 1000 }),
          queryAnalytics(env, authHeader, { measures: ["PreviewPlaybacks.count"], filters: pcf, timeDimensions: [{ dimension: "PreviewPlaybacks.previewPlaybackDate", granularity, ...(dr ? { dateRange: dr } : {}) }], order: { "PreviewPlaybacks.previewPlaybackDate": "asc" }, limit: 1000 }),
          // Top assets by metric
          queryAnalytics(env, authHeader, { measures: ["Views.count"], dimensions: ["Views.recordId"], filters: vcf, ...drRange("DateDimension.date"), order: { "Views.count": "desc" }, limit: 20 }),
          queryAnalytics(env, authHeader, { measures: ["Downloads.count"], dimensions: ["Downloads.recordId"], ...drRange("Downloads.downloadDate"), order: { "Downloads.count": "desc" }, limit: 20 }),
          queryAnalytics(env, authHeader, { measures: ["Impressions.count"], dimensions: ["Impressions.recordId"], ...drRange("Impressions.hitDateTime"), order: { "Impressions.count": "desc" }, limit: 20 }),
          queryAnalytics(env, authHeader, { measures: ["PreviewPlaybacks.count"], dimensions: ["PreviewPlaybacks.recordId"], filters: pcf, ...drRange("PreviewPlaybacks.previewPlaybackDate"), order: { "PreviewPlaybacks.count": "desc" }, limit: 20 }),
          // Users by activity
          queryAnalytics(env, authHeader, { measures: ["Views.count"], dimensions: ["Users.loginId"], filters: vcf, ...drRange("DateDimension.date"), order: { "Views.count": "desc" }, limit: 50 }),
          queryAnalytics(env, authHeader, { measures: ["Downloads.count"], dimensions: ["Users.loginId"], ...drRange("Downloads.downloadDate"), order: { "Downloads.count": "desc" }, limit: 50 }),
          queryAnalytics(env, authHeader, { measures: ["PreviewPlaybacks.count"], dimensions: ["Users.loginId"], filters: pcf, ...drRange("PreviewPlaybacks.previewPlaybackDate"), order: { "PreviewPlaybacks.count": "desc" }, limit: 50 }),
          // UTM breakdown
          queryAnalytics(env, authHeader, { measures: ["Impressions.count"], dimensions: ["Impressions.recordId", "ImpressionTrackingTypes.queryStringKey", "ImpressionTrackingTypeValues.value"], ...drRange("Impressions.hitDateTime"), order: { "Impressions.count": "desc" }, limit: 100 }),
        ])

        const uniqueUsers = new Set([
          ...viewsUserData.map((r: any) => r["Users.loginId"]).filter(Boolean),
          ...downloadsUserData.map((r: any) => r["Users.loginId"]).filter(Boolean),
        ])
        setKpis({
          activeUsers: uniqueUsers.size,
          views:       parseCount(viewsTotal[0]?.["Views.count"]),
          downloads:   parseCount(downloadsTotal[0]?.["Downloads.count"]),
          impressions: parseCount(impressionsTotal[0]?.["Impressions.count"]),
          plays:       parseCount(playsTotal[0]?.["PreviewPlaybacks.count"]),
        })

        const dateMap = new Map<string, ChartPoint>()
        const put = (date: string, field: keyof Omit<ChartPoint, "date">, value: number) => {
          if (!date) return
          if (!dateMap.has(date)) dateMap.set(date, { date, views: 0, downloads: 0, impressions: 0, plays: 0 })
          dateMap.get(date)![field] = value
        }
        for (const row of viewsChart)       put(extractDate(row, "DateDimension.date"),                   "views",       parseCount(row["Views.count"]))
        for (const row of downloadsChart)   put(extractDate(row, "Downloads.downloadDate"),               "downloads",   parseCount(row["Downloads.count"]))
        for (const row of impressionsChart) put(extractDate(row, "Impressions.hitDateTime"),              "impressions", parseCount(row["Impressions.count"]))
        for (const row of playsChart)       put(extractDate(row, "PreviewPlaybacks.previewPlaybackDate"), "plays",       parseCount(row["PreviewPlaybacks.count"]))
        setChartData(Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date)))

        setTopViewed(topViewedData.map((r: any) => ({ recordId: r["Views.recordId"] ?? "", count: parseCount(r["Views.count"]) })).filter((r: AssetRow) => r.recordId))
        setTopDownloaded(topDownloadedData.map((r: any) => ({ recordId: r["Downloads.recordId"] ?? "", count: parseCount(r["Downloads.count"]) })).filter((r: AssetRow) => r.recordId))
        setTopImpressed(topImpressedData.map((r: any) => ({ recordId: r["Impressions.recordId"] ?? "", count: parseCount(r["Impressions.count"]) })).filter((r: AssetRow) => r.recordId))
        setTopPlayed(topPlayedData.map((r: any) => ({ recordId: r["PreviewPlaybacks.recordId"] ?? "", count: parseCount(r["PreviewPlaybacks.count"]) })).filter((r: AssetRow) => r.recordId))
        setViewsByUser(viewsUserData.map((r: any) => ({ user: r["Users.loginId"] || "Unknown", count: parseCount(r["Views.count"]) })))
        setDownloadsByUser(downloadsUserData.map((r: any) => ({ user: r["Users.loginId"] || "Unknown", count: parseCount(r["Downloads.count"]) })))
        setPlaysByUser(playsUserData.map((r: any) => ({ user: r["Users.loginId"] || "Unknown", count: parseCount(r["PreviewPlaybacks.count"]) })))
        setUtmData(utmRaw.map((r: any) => ({ utmKey: r["ImpressionTrackingTypes.queryStringKey"] ?? "", utmValue: r["ImpressionTrackingTypeValues.value"] ?? "", count: parseCount(r["Impressions.count"]) })))

        resolvedRecordIds = Array.from(new Set([
          ...topViewedData.map((r: any) => r["Views.recordId"]),
          ...topDownloadedData.map((r: any) => r["Downloads.recordId"]),
          ...topImpressedData.map((r: any) => r["Impressions.recordId"]),
          ...topPlayedData.map((r: any) => r["PreviewPlaybacks.recordId"]),
        ].filter(Boolean) as string[]))
      }

      // Record data — thumbnails always; labels when NEXT_PUBLIC_DAM_DASHBOARD_LABEL_FIELD is set
      try {
        const labelField = process.env.NEXT_PUBLIC_DAM_DASHBOARD_LABEL_FIELD
        if (client) {
          const ids = resolvedRecordIds
          if (ids.length > 0) {
            const needsFields = labelField && labelField.toLowerCase() !== "title"
            const expander = needsFields
              ? Expander.create().for<any>("Record").expand("masterfilelatestversion", "fields").for<any>("FileVersion").expand("thumbnail")
              : Expander.create().for<any>("Record").expand("masterfilelatestversion").for<any>("FileVersion").expand("thumbnail")
            // Throttle to 5 concurrent requests to avoid 429s; retry up to 3×
            // on rate-limit using the server's retryAfter hint (or exponential backoff).
            const results = await throttledSettled(
              ids.map(id => async () => {
                for (let attempt = 0; attempt < 4; attempt++) {
                  const res = await client!.records.getById(toGuid(id), expander as any)
                  if (res.ok || !(res.error instanceof AprimoRateLimitError)) return res
                  const hint = parseInt((res.error as AprimoRateLimitError).retryAfter ?? "0", 10)
                  await new Promise(r => setTimeout(r, (hint > 0 ? hint : Math.pow(2, attempt)) * 1000))
                }
                return { ok: false as const }
              }),
              5
            )
            const labelMap = new Map<string, string>()
            const thumbnailMap = new Map<string, string>()
            const unavailable = new Set<string>()
            for (let i = 0; i < results.length; i++) {
              const r = results[i]
              if (r.status !== "fulfilled" || !r.value.ok) {
                unavailable.add(ids[i])
                continue
              }
              const rec = r.value.data as any
              const thumbUri = rec._embedded?.masterfilelatestversion?._embedded?.thumbnail?.uri as string | undefined
              if (thumbUri) thumbnailMap.set(ids[i], thumbUri)
              if (labelField) {
                let label = (rec.title as string | undefined) ?? ""
                if (needsFields) {
                  const f = ((rec._embedded?.fields?.items ?? []) as any[]).find(
                    (f: any) => f.fieldName?.toLowerCase() === labelField.toLowerCase()
                  )
                  const val = f?.localizedValues?.[0]?.value ?? f?.localizedValues?.[0]?.values?.[0]
                  if (val) label = String(val)
                }
                // Key by original analytics ID (no dashes) — that's what getLabel looks up
                labelMap.set(ids[i], label || `${ids[i].slice(0, 8)}…`)
              }
            }
            setRecordLabels(labelMap)
            setRecordThumbnails(thumbnailMap)
            setRecordUnavailable(unavailable)
          }
        }
      } catch {
        // record data fetch is non-critical — silently ignore
      }

    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }

  }, [connection, isConnected, getAuthHeader, dateRange, selectedCollectionId, selectedClassificationFilter])

  useEffect(() => { fetchData() }, [fetchData])

  const fetchAssetCount = useCallback(async () => {
    if (!client || !isConnected) return
    setTotalAssetCount(null)
    try {
      let expression = `NOT id = ''`
      if (selectedCollectionId) {
        expression = `collectionid = '${selectedCollectionId}'`
      } else if (selectedClassificationId) {
        expression = `classificationid = '${selectedClassificationId}'`
      }
      const res = await client.search.records({ searchExpression: { expression }, page: 1, pageSize: 1 } as never)
      const data = res.data as unknown as { totalCount?: number }
      setTotalAssetCount(data?.totalCount ?? null)
    } catch {
      setTotalAssetCount(null)
    }
  }, [client, isConnected, selectedCollectionId, selectedClassificationId])

  useEffect(() => { fetchAssetCount() }, [fetchAssetCount])

  const fetchCollections = useCallback(async () => {
    if (!client || !isConnected || !connection) return
    setCollectionsLoading(true)
    setCollectionsError(null)
    try {
      const all: CollectionRow[] = []
      for await (const pageResult of client.collections.getPaged({ pageSize: 1000 })) {
        if (!pageResult.ok) throw new Error((pageResult as any).error?.message ?? "Failed to fetch collections")
        const items = (pageResult.data?.items ?? []) as any[]
        for (const c of items) {
          all.push({ id: c.id, name: c.name, type: c.type, description: c.description ?? "", createdOn: c.createdOn, modifiedOn: c.modifiedOn })
        }
      }
      const sorted = all.sort((a, b) => a.name.localeCompare(b.name))
      setCollections(sorted)

      // Probe whether the analytics API supports collection filters.
      // Test static first (cheaper), then dynamic if available.
      const auth = getAuthHeader()
      if (auth && sorted.length > 0) {
        const env = connection.environment
        const testFilter = (id: string) =>
          queryAnalytics(env, auth, {
            measures: ["Views.count"],
            filters: [{ member: "Views.collectionId", operator: "equals", values: [toGuid(id)] }],
          })

        const staticCol = sorted.find(c => c.type === "Static")
        const dynamicCol = sorted.find(c => c.type === "Dynamic")

        if (staticCol) {
          try {
            await testFilter(staticCol.id)
            setCollectionFilterSupported(true)
            if (dynamicCol) {
              try { await testFilter(dynamicCol.id); setDynamicCollectionsSupported(true) }
              catch { setDynamicCollectionsSupported(false) }
            }
          } catch { setCollectionFilterSupported(false) }
        } else if (dynamicCol) {
          try {
            await testFilter(dynamicCol.id)
            setCollectionFilterSupported(true)
            setDynamicCollectionsSupported(true)
          } catch {
            setCollectionFilterSupported(false)
            setDynamicCollectionsSupported(false)
          }
        }
      }
    } catch (e) {
      setCollectionsError(e instanceof Error ? e.message : String(e))
    } finally {
      setCollectionsLoading(false)
    }
  }, [client, isConnected, connection, getAuthHeader])

  useEffect(() => { fetchCollections() }, [fetchCollections])

  const fetchClassifications = useCallback(async () => {
    if (!client || !isConnected) return
    setClassificationsLoading(true)
    try {
      const allRaw: any[] = []
      for await (const result of client.classifications.getPaged(undefined, undefined, "*")) {
        if (!result.ok) break
        allRaw.push(...(result.data?.items ?? []))
      }


      // Normalize a classification ID: strip curly braces, lowercase, convert 32-char hex → UUID
      const normalizeId = (id: string) => toGuid(id.trim().replace(/^\{|\}$/g, "").toLowerCase())

      // Normalize all IDs from the API so comparisons are case/format insensitive
      const idToIdentifier = new Map<string, string>(
        allRaw
          .filter((c: any) => c.identifier)
          .map((c: any) => [normalizeId(c.id as string), c.identifier as string])
      )
      const nodes: ClassificationNode[] = allRaw.map((c: any) => ({
        id: normalizeId(c.id),
        name: c.name,
        labelPath: c.labelPath ?? "",
        parentId: c.parentId ? normalizeId(c.parentId) : undefined,
        labels: c.labels,
      }))

      const rawRootId = process.env.NEXT_PUBLIC_DAM_DASHBOARD_CLASSIFICATION_ROOT_ID
      const rootId = rawRootId ? normalizeId(rawRootId) : null

      const tree = rootId ? buildClassificationTree(rootId, nodes) : null

      // Look up nodes by normalized ID so we can call getEnglishLabel directly from labels[]
      const nodeById = new Map(nodes.map(n => [n.id, n]))

      let flat: Array<{ id: string; label: string; depth: number }>

      if (tree) {
        // flattenForPicker drives tree order/depth; labels come directly from each node's labels[]
        flat = flattenForPicker(tree, 0).slice(1).map(f => {
          const n = nodeById.get(f.id)
          return {
            id: f.id,
            label: n ? getEnglishLabel(n.labels, n.name) : f.label,
            depth: f.depth - 1,
          }
        })
      } else {
        // No root configured (or root not found): show all top-level classifications flat
        flat = nodes
          .filter(n => !n.parentId)
          .sort((a, b) => (a.labelPath || a.name).localeCompare(b.labelPath || b.name))
          .map(n => ({ id: n.id, label: getEnglishLabel(n.labels, n.name), depth: 0 }))
      }

      // Compute hasChildren and parentId in a single pass over the flat list
      const parentStack: (string | null)[] = []
      const items: ClassificationFlatItem[] = flat
        .map((f, i, arr) => {
          parentStack.length = f.depth + 1
          const parentId = f.depth > 0 ? (parentStack[f.depth - 1] ?? null) : null
          parentStack[f.depth] = f.id
          const hasChildren = i + 1 < arr.length && arr[i + 1].depth > f.depth
          return {
            id: f.id,
            identifier: idToIdentifier.get(f.id) ?? "",
            label: f.label,
            depth: f.depth,
            hasChildren,
            parentId,
            disabled: !idToIdentifier.has(f.id),
          }
        })
      setClassifications(items)
    } catch {
      // non-critical
    } finally {
      setClassificationsLoading(false)
    }
  }, [client, isConnected])

  useEffect(() => { fetchClassifications() }, [fetchClassifications])

  const fetchUserActivity = useCallback(async () => {
    if (!selectedUser || !connection || !isConnected) return
    const authHeader = getAuthHeader()
    if (!authHeader) return

    setUserActivityLoading(true)
    setUserActivityError(null)
    setUserActivity(null)

    try {
      const dr = getDateRange(dateRange)
      const granularity = getGranularity(dateRange)
      const env = connection.environment
      const userFilter = { member: "Users.loginId", operator: "equals", values: [selectedUser] }
      const colGuid = selectedCollectionId ? toGuid(selectedCollectionId) : null
      const vf = colGuid ? [userFilter, { member: "Views.collectionId", operator: "equals" as const, values: [colGuid] }] : [userFilter]
      const pf = colGuid ? [userFilter, { member: "PreviewPlaybacks.collectionId", operator: "equals" as const, values: [colGuid] }] : [userFilter]
      const df = [userFilter]
      const drTime = (dim: string) => dr ? { timeDimensions: [{ dimension: dim, dateRange: dr }] } : {}

      const [viewsTotal, downloadsTotal, viewsChart, downloadsChart, topViewedData, topDownloadedData] = await Promise.all([
        queryAnalytics(env, authHeader, { measures: ["Views.count"], filters: vf, ...drTime("DateDimension.date") }),
        queryAnalytics(env, authHeader, { measures: ["Downloads.count"], filters: df, ...drTime("Downloads.downloadDate") }),
        queryAnalytics(env, authHeader, {
          measures: ["Views.count"], filters: vf,
          timeDimensions: [{ dimension: "DateDimension.date", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "DateDimension.date": "asc" }, limit: 1000,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Downloads.count"], filters: df,
          timeDimensions: [{ dimension: "Downloads.downloadDate", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "Downloads.downloadDate": "asc" }, limit: 1000,
        }),
        queryAnalytics(env, authHeader, { measures: ["Views.count"], dimensions: ["Views.recordId"], filters: vf, ...drTime("DateDimension.date"), order: { "Views.count": "desc" }, limit: 20 }),
        queryAnalytics(env, authHeader, { measures: ["Downloads.count"], dimensions: ["Downloads.recordId"], filters: df, ...drTime("Downloads.downloadDate"), order: { "Downloads.count": "desc" }, limit: 20 }),
      ])

      const dateMap = new Map<string, ChartPoint>()
      const put = (date: string, field: keyof Omit<ChartPoint, "date">, value: number) => {
        if (!date) return
        if (!dateMap.has(date)) dateMap.set(date, { date, views: 0, downloads: 0, impressions: 0, plays: 0 })
        dateMap.get(date)![field] = value
      }
      for (const row of viewsChart)     put(extractDate(row, "DateDimension.date"),  "views",     parseCount(row["Views.count"]))
      for (const row of downloadsChart) put(extractDate(row, "Downloads.downloadDate"), "downloads", parseCount(row["Downloads.count"]))
      const chartData = Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date))

      setUserActivity({
        totalViews:       parseCount(viewsTotal[0]?.["Views.count"]),
        totalDownloads:   parseCount(downloadsTotal[0]?.["Downloads.count"]),
        activeDays:       chartData.filter(p => p.views > 0 || p.downloads > 0).length,
        chartData,
        topViewedAssets:  topViewedData.map((r: any) => ({ recordId: r["Views.recordId"] ?? "", count: parseCount(r["Views.count"]) })).filter((r: AssetRow) => r.recordId),
        topDownloadedAssets: topDownloadedData.map((r: any) => ({ recordId: r["Downloads.recordId"] ?? "", count: parseCount(r["Downloads.count"]) })).filter((r: AssetRow) => r.recordId),
      })
    } catch (e) {
      setUserActivityError(e instanceof Error ? e.message : String(e))
    } finally {
      setUserActivityLoading(false)
    }
  }, [selectedUser, connection, isConnected, getAuthHeader, dateRange, selectedCollectionId])

  useEffect(() => { fetchUserActivity() }, [fetchUserActivity])

  if (!isConnected) {
    return <main className="p-8"><p className="text-sm text-muted-foreground">Connect to Aprimo to use this tool.</p></main>
  }

  const lineOpacity  = (key: string) => activeMetric === null || activeMetric === "topassets" || activeMetric === "users" || activeMetric === key ? 1 : 0.12
  const lineWidth    = (key: string) => activeMetric === null || activeMetric === "topassets" || activeMetric === "users" || activeMetric === key ? 2.5 : 1
  const getLabel     = (recordId: string) => recordLabels.get(recordId) ?? `${recordId.slice(0, 8)}…`
  const labelCellCls = (recordId: string) => recordLabels.has(recordId) ? "px-4 py-2" : "px-4 py-2 font-mono text-xs"

  const kpiTiles = [
    { key: "topassets"   as const, label: "Assets",        value: totalAssetCount ?? undefined, icon: Layers, iconColor: "text-orange-500", activeBorder: "border-orange-500", activeBg: "bg-orange-500/5" },
    { key: "users"       as const, label: "Active Users", value: kpis?.activeUsers, icon: Users,    iconColor: "text-sky-500",    activeBorder: "border-sky-500",    activeBg: "bg-sky-500/5"    },
    { key: "views"       as const, label: "Views",        value: kpis?.views,       icon: Eye,      iconColor: "text-[var(--chart-1)]", activeBorder: "border-[var(--chart-1)]", activeBg: "bg-[var(--chart-1)]/10" },
    { key: "downloads"   as const, label: "Downloads",    value: kpis?.downloads,   icon: Download, iconColor: "text-[var(--chart-2)]", activeBorder: "border-[var(--chart-2)]", activeBg: "bg-[var(--chart-2)]/10" },
    { key: "impressions" as const, label: "Impressions",  value: kpis?.impressions, icon: Zap,      iconColor: "text-[var(--chart-3)]", activeBorder: "border-[var(--chart-3)]", activeBg: "bg-[var(--chart-3)]/10" },
    { key: "plays"       as const, label: "Plays",        value: kpis?.plays,       icon: Play,     iconColor: "text-[var(--chart-4)]", activeBorder: "border-[var(--chart-4)]", activeBg: "bg-[var(--chart-4)]/10" },
  ]

  const drillConfig: Record<string, { assets: AssetRow[]; assetLabel: string; users: UserRow[]; userLabel: string }> = {
    views:     { assets: topViewed,     assetLabel: "Views",       users: viewsByUser,     userLabel: "Views"     },
    downloads: { assets: topDownloaded, assetLabel: "Downloads",   users: downloadsByUser, userLabel: "Downloads" },
    impressions: { assets: topImpressed, assetLabel: "Impressions", users: [],          userLabel: "" },
    plays:       { assets: topPlayed,    assetLabel: "Plays",       users: playsByUser, userLabel: "Plays" },
  }

  const showDrillDown = activeMetric !== null

  return (
    <main className="flex-1 p-6 flex flex-col gap-6">

      {/* Header */}
      <div className="flex items-center justify-end">
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* API note */}
      <div className="rounded-lg border border-border bg-muted/30 px-4 py-3 text-sm text-muted-foreground">
        This dashboard demonstrates what's possible with the Aprimo Analytics API — every metric is queried live, no data warehouse required.
        For production reporting, scheduled exports, and enterprise-scale visualisations, a dedicated BI tool such as Power BI connected to the Analytics API is strongly recommended.
      </div>

      {/* Date range selector + collection filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-center gap-2 flex-wrap">
          {DATE_RANGE_OPTIONS.map(opt => (
            <button
              key={opt.key}
              onClick={() => setDateRange(opt.key)}
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                dateRange === opt.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:text-foreground"
              }`}
            >
              {opt.label}
            </button>
          ))}
          {loading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
        </div>

        {/* Filter dropdowns — collection + classification */}
        <div className="flex items-center gap-3 flex-wrap">
          {/* Collection filter */}
          <div className="flex items-center gap-1.5">
            <Popover open={collectionComboOpen} onOpenChange={setCollectionComboOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1.5 border border-border rounded-md px-3 py-1.5 text-sm bg-card hover:bg-muted/50 transition-colors min-w-[160px] justify-between"
                  aria-label="Filter by collection"
                >
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Layers className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                    <span className="truncate text-left">
                      {collectionsLoading
                        ? "Loading…"
                        : selectedCollectionId
                          ? (collections.find(c => c.id === selectedCollectionId)?.name ?? "Collection")
                          : <span className="text-muted-foreground">All Assets</span>
                      }
                    </span>
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 ml-1" />
                </button>
              </PopoverTrigger>
              <PopoverContent className="p-0 w-72" align="end">
                <Command>
                  <CommandInput placeholder="Search collections…" />
                  <CommandList>
                    <CommandEmpty>No collections found.</CommandEmpty>
                    <CommandGroup>
                      <CommandItem
                        value="__all__"
                        onSelect={() => { setSelectedCollectionId(null); setCollectionComboOpen(false) }}
                      >
                        <Check className={`h-4 w-4 mr-2 ${!selectedCollectionId ? "opacity-100" : "opacity-0"}`} />
                        All Assets
                      </CommandItem>
                      {collections
                        .filter(c => c.type === "Static")
                        .map(c => (
                          <CommandItem
                            key={c.id}
                            value={c.name}
                            onSelect={() => { setSelectedCollectionId(c.id); setSelectedClassificationId(null); setCollectionComboOpen(false) }}
                          >
                            <Check className={`h-4 w-4 mr-2 ${selectedCollectionId === c.id ? "opacity-100" : "opacity-0"}`} />
                            <span className="flex-1 truncate">{c.name}</span>
                          </CommandItem>
                        ))}
                    </CommandGroup>
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
            {selectedCollectionId && (
              <button
                onClick={() => setSelectedCollectionId(null)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                aria-label="Clear collection filter"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {/* Classification filter — tree picker */}
          {(classificationsLoading || classifications.length > 0) && (() => {
            const byId = new Map(classifications.map(c => [c.id, c]))
            const searching = classificationSearch.trim() !== ""
            const visible = searching
              ? classifications.filter(c => c.label.toLowerCase().includes(classificationSearch.toLowerCase()))
              : classifications.filter(c => c.depth === 0 || isAncestorExpanded(c, byId, expandedClassifications))
            const toggleExpand = (id: string) => setExpandedClassifications(prev => {
              const next = new Set(prev)
              next.has(id) ? next.delete(id) : next.add(id)
              return next
            })
            const selectClass = (id: string, analyticsFilter: string) => {
              setSelectedClassificationId(id)
              setSelectedClassificationFilter(analyticsFilter)
              setSelectedCollectionId(null)
              setClassificationComboOpen(false)
              setClassificationSearch("")
            }
            const clearClass = () => {
              setSelectedClassificationId(null)
              setSelectedClassificationFilter(null)
              setClassificationComboOpen(false)
              setClassificationSearch("")
            }
            return (
              <div className="flex items-center gap-1.5">
                <Popover open={classificationComboOpen} onOpenChange={open => { setClassificationComboOpen(open); if (!open) setClassificationSearch("") }}>
                  <PopoverTrigger asChild>
                    <button
                      className="flex items-center gap-1.5 border border-border rounded-md px-3 py-1.5 text-sm bg-card hover:bg-muted/50 transition-colors min-w-[160px] justify-between"
                      aria-label="Filter by classification"
                    >
                      <span className="flex items-center gap-1.5 min-w-0">
                        <Tag className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0" />
                        <span className="truncate text-left">
                          {classificationsLoading
                            ? "Loading…"
                            : selectedClassificationId
                              ? (classifications.find(c => c.id === selectedClassificationId)?.label ?? "Classification")
                              : <span className="text-muted-foreground">All Classifications</span>
                          }
                        </span>
                      </span>
                      <ChevronsUpDown className="h-3.5 w-3.5 text-muted-foreground flex-shrink-0 ml-1" />
                    </button>
                  </PopoverTrigger>
                  <PopoverContent className="p-0 w-72" align="end">
                    {/* Search input */}
                    <div className="flex items-center gap-1 border-b border-border px-3 py-2">
                      <input
                        className="flex-1 text-sm bg-transparent outline-none placeholder:text-muted-foreground"
                        placeholder="Search classifications…"
                        value={classificationSearch}
                        onChange={e => setClassificationSearch(e.target.value)}
                      />
                      {classificationSearch && (
                        <button onClick={() => setClassificationSearch("")} className="text-muted-foreground hover:text-foreground">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      )}
                    </div>
                    {/* Tree list */}
                    <div className="max-h-72 overflow-y-auto p-1">
                      {/* All Classifications option */}
                      <button
                        onClick={clearClass}
                        className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-sm text-sm hover:bg-muted transition-colors ${!selectedClassificationId ? "font-medium" : ""}`}
                      >
                        <Check className={`h-4 w-4 flex-shrink-0 ${!selectedClassificationId ? "opacity-100" : "opacity-0"}`} />
                        <span>All Classifications</span>
                      </button>
                      {/* Classification tree items */}
                      {visible.map(c => (
                        <div key={c.id} className="flex items-center" style={{ paddingLeft: `${c.depth * 16}px` }}>
                          {/* Expand/collapse toggle for parent nodes (hidden when searching) */}
                          {!searching && c.hasChildren ? (
                            <button
                              onClick={() => toggleExpand(c.id)}
                              className="h-6 w-6 flex items-center justify-center text-muted-foreground hover:text-foreground flex-shrink-0"
                            >
                              {expandedClassifications.has(c.id)
                                ? <ChevronDown className="h-3.5 w-3.5" />
                                : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                          ) : (
                            <span className="h-6 w-6 flex-shrink-0" />
                          )}
                          <button
                            onClick={c.disabled ? undefined : () => selectClass(c.id, c.identifier)}
                            disabled={c.disabled}
                            className={`flex-1 flex items-center gap-2 px-1 py-1 rounded-sm text-sm text-left min-w-0 ${c.disabled ? "opacity-40 cursor-not-allowed" : "hover:bg-muted transition-colors"} ${selectedClassificationId === c.id ? "font-medium" : ""}`}
                          >
                            <Check className={`h-4 w-4 flex-shrink-0 ${selectedClassificationId === c.id ? "opacity-100" : "opacity-0"}`} />
                            <span className="truncate">{c.label}</span>
                          </button>
                        </div>
                      ))}
                      {!classificationsLoading && visible.length === 0 && (
                        <p className="px-2 py-3 text-sm text-muted-foreground text-center">No classifications found.</p>
                      )}
                      {classificationsLoading && (
                        <p className="px-2 py-3 text-sm text-muted-foreground text-center">Loading…</p>
                      )}
                    </div>
                  </PopoverContent>
                </Popover>
                {selectedClassificationId && (
                  <button
                    onClick={() => { setSelectedClassificationId(null); setSelectedClassificationFilter(null) }}
                    className="text-muted-foreground hover:text-foreground transition-colors"
                    aria-label="Clear classification filter"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
            )
          })()}
        </div>
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
      )}

      {/* Activity chart */}
      {chartData.length > 0 && (
        <div className="border border-border rounded-lg p-4 flex flex-col gap-3 bg-card">
          <h2 className="text-sm font-medium">Activity over time</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="views"        stroke="var(--chart-1)" strokeWidth={lineWidth("views")}       strokeOpacity={lineOpacity("views")}       dot={false} name="Views" />
              {!selectedCollectionId && <Line type="monotone" dataKey="downloads"    stroke="var(--chart-2)" strokeWidth={lineWidth("downloads")}   strokeOpacity={lineOpacity("downloads")}   dot={false} name="Downloads" />}
              {!selectedCollectionId && !selectedClassificationId && <Line type="monotone" dataKey="impressions"  stroke="var(--chart-3)" strokeWidth={lineWidth("impressions")} strokeOpacity={lineOpacity("impressions")} dot={false} name="Impressions" />}
              <Line type="monotone" dataKey="plays"        stroke="var(--chart-4)" strokeWidth={lineWidth("plays")}       strokeOpacity={lineOpacity("plays")}       dot={false} name="Plays" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* KPI tiles — click to drill down, click again to collapse */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpiTiles.map(({ key, label, value, icon: Icon, iconColor, activeBorder, activeBg }) => {
          // users tile grayed out when any filter is active; impressions grayed out when classification filter is active (CE cube has no impressions measure); downloads/impressions grayed out only when collection filter is active
          const collectionUnsupported =
            (key === "users" && (!!selectedCollectionId || !!selectedClassificationId)) ||
            (key === "impressions" && !!selectedClassificationId) ||
            (!!selectedCollectionId && !selectedClassificationId && (key === "downloads" || key === "impressions"))
          return (
            <button
              key={key}
              onClick={() => !collectionUnsupported && setActiveMetric(prev => prev === key ? null : key)}
              disabled={collectionUnsupported}
              className={`border rounded-lg p-4 flex flex-col gap-2 text-left transition-colors bg-card ${
                collectionUnsupported
                  ? "border-border opacity-40 cursor-not-allowed"
                  : activeMetric === key
                    ? activeBorder
                    : "border-border hover:bg-muted/50"
              }`}
            >
              <div className="flex items-center gap-2">
                <Icon className={`h-4 w-4 ${iconColor}`} />
                <span className="text-xs text-muted-foreground">{label}</span>
              </div>
              <p className="text-2xl font-bold">
                {collectionUnsupported
                  ? <span className="text-muted-foreground">—</span>
                  : loading
                    ? <span className="text-muted-foreground">—</span>
                    : value === undefined
                      ? <span className="text-muted-foreground">—</span>
                      : value.toLocaleString()
                }
              </p>
            </button>
          )
        })}
      </div>

      {/* Drill-down: views / downloads / impressions / plays */}
      {showDrillDown && activeMetric !== "users" && drillConfig[activeMetric!] && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Left: top assets */}
          <div className="border border-border rounded-lg flex flex-col bg-card">
            <div className="px-4 py-3 border-b border-border">
              <h2 className="text-sm font-medium">Top assets by {drillConfig[activeMetric!].assetLabel.toLowerCase()}</h2>
            </div>
            {drillConfig[activeMetric!].assets.length > 0 ? (
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Record ID</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">{drillConfig[activeMetric!].assetLabel}</th>
                  </tr>
                </thead>
                <tbody>
                  {drillConfig[activeMetric!].assets.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className={labelCellCls(row.recordId)}>
                        {recordUnavailable.has(row.recordId) ? (
                          <span className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded flex-shrink-0 bg-muted flex items-center justify-center">
                              <ImageOff className="h-4 w-4 text-muted-foreground/40" />
                            </div>
                            <span className="flex items-center gap-1.5">
                              {getLabel(row.recordId)}
                              <span className="text-muted-foreground text-xs font-normal">(Unavailable)</span>
                            </span>
                          </span>
                        ) : (
                          <Link href={`/asset-usage?record=${row.recordId}`} className="flex items-center gap-2 text-primary hover:underline">
                            {recordThumbnails.has(row.recordId) ? (
                              <img src={recordThumbnails.get(row.recordId)} alt="" className="h-8 w-8 rounded object-cover flex-shrink-0 bg-muted" />
                            ) : (
                              <div className="h-8 w-8 rounded flex-shrink-0 bg-primary/10 flex items-center justify-center">
                                <FileImage className="h-4 w-4 text-primary/50" />
                              </div>
                            )}
                            {getLabel(row.recordId)}
                            <ExternalLink className="h-3 w-3 flex-shrink-0" />
                          </Link>
                        )}
                      </td>
                      <td className="px-4 py-2 text-right font-medium">{row.count.toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
              <p className="px-4 py-3 text-sm text-muted-foreground">No data for this period.</p>
            )}
          </div>

          {/* Right: users (views/downloads/plays) or UTM (impressions) */}
          <div className="border border-border rounded-lg flex flex-col bg-card">
            {activeMetric === "impressions" ? (
              <>
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="text-sm font-medium">Impressions by UTM parameter</h2>
                </div>
                {utmData.length > 0 ? (
                  <div className="overflow-auto max-h-80">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Parameter</th>
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Value</th>
                          <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Count</th>
                        </tr>
                      </thead>
                      <tbody>
                        {utmData.map((row, i) => (
                          <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                            <td className="px-4 py-2 text-muted-foreground">{row.utmKey || <span className="italic opacity-60">none</span>}</td>
                            <td className="px-4 py-2 text-muted-foreground">{row.utmValue || <span className="italic opacity-60">—</span>}</td>
                            <td className="px-4 py-2 text-right font-medium">{row.count.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No UTM data for this period.</p>
                )}
              </>
            ) : (
              <>
                <div className="px-4 py-3 border-b border-border">
                  <h2 className="text-sm font-medium">{drillConfig[activeMetric!].assetLabel} by user</h2>
                </div>
                {drillConfig[activeMetric!].users.length > 0 ? (
                  <div className="overflow-auto max-h-80">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b border-border bg-muted/40">
                          <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">User</th>
                          <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">{drillConfig[activeMetric!].userLabel}</th>
                        </tr>
                      </thead>
                      <tbody>
                        {drillConfig[activeMetric!].users.map((row, i) => (
                          <tr key={i} onClick={() => setSelectedUser(row.user)} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer">
                            <td className="px-4 py-2 text-primary font-medium">
                              <span className="flex items-center gap-2">
                                <div className="h-8 w-8 rounded-full flex-shrink-0 bg-primary/10 flex items-center justify-center">
                                  <CircleUser className="h-4 w-4 text-primary/50" />
                                </div>
                                {row.user}
                              </span>
                            </td>
                            <td className="px-4 py-2 text-right font-medium">{row.count.toLocaleString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <p className="px-4 py-3 text-sm text-muted-foreground">No data for this period.</p>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Drill-down: active users */}
      {activeMetric === "users" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[
            { title: "Views by user",     rows: viewsByUser,     countLabel: "Views"     },
            { title: "Downloads by user", rows: downloadsByUser, countLabel: "Downloads" },
          ].map(({ title, rows, countLabel }) => (
            <div key={title} className="border border-border rounded-lg flex flex-col bg-card">
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-medium">{title}</h2>
              </div>
              {rows.length > 0 ? (
                <div className="overflow-auto max-h-72">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-muted/40">
                        <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">User</th>
                        <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">{countLabel}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((row, i) => (
                        <tr key={i} onClick={() => setSelectedUser(row.user)} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors cursor-pointer">
                          <td className="px-4 py-2 text-primary font-medium">
                            <span className="flex items-center gap-2">
                              <div className="h-8 w-8 rounded-full flex-shrink-0 bg-primary/10 flex items-center justify-center">
                                <CircleUser className="h-4 w-4 text-primary/50" />
                              </div>
                              {row.user}
                            </span>
                          </td>
                          <td className="px-4 py-2 text-right font-medium">{row.count.toLocaleString()}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">No data for this period.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Drill-down: top assets */}
      {activeMetric === "topassets" && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {[
            { title: "Top Viewed Assets",     rows: topViewed,     countLabel: "Views",     unsupported: false },
            { title: "Top Downloaded Assets", rows: topDownloaded, countLabel: "Downloads", unsupported: !!selectedCollectionId },
          ].map(({ title, rows, countLabel, unsupported }) => (
            <div key={title} className={`border border-border rounded-lg flex flex-col bg-card ${unsupported ? "opacity-40" : ""}`}>
              <div className="px-4 py-3 border-b border-border">
                <h2 className="text-sm font-medium">{title}</h2>
              </div>
              {unsupported ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Not available when filtering by collection.</p>
              ) : rows.length > 0 ? (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border bg-muted/40">
                      <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Asset</th>
                      <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">{countLabel}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 10).map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                        <td className={labelCellCls(row.recordId)}>
                          {recordUnavailable.has(row.recordId) ? (
                            <span className="flex items-center gap-2">
                              <div className="h-8 w-8 rounded flex-shrink-0 bg-muted flex items-center justify-center">
                                <ImageOff className="h-4 w-4 text-muted-foreground/40" />
                              </div>
                              <span className="flex items-center gap-1.5">
                                {getLabel(row.recordId)}
                                <span className="text-muted-foreground text-xs font-normal">(Unavailable)</span>
                              </span>
                            </span>
                          ) : (
                            <Link href={`/asset-usage?record=${row.recordId}`} className="flex items-center gap-2 text-primary hover:underline">
                              {recordThumbnails.has(row.recordId) ? (
                                <img src={recordThumbnails.get(row.recordId)} alt="" className="h-8 w-8 rounded object-cover flex-shrink-0 bg-muted" />
                              ) : (
                                <div className="h-8 w-8 rounded flex-shrink-0 bg-primary/10 flex items-center justify-center">
                                  <FileImage className="h-4 w-4 text-primary/50" />
                                </div>
                              )}
                              {getLabel(row.recordId)}
                              <ExternalLink className="h-3 w-3 flex-shrink-0" />
                            </Link>
                          )}
                        </td>
                        <td className="px-4 py-2 text-right font-medium">{row.count.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : loading ? (
                <p className="px-4 py-3 text-sm text-muted-foreground">Loading…</p>
              ) : (
                <p className="px-4 py-3 text-sm text-muted-foreground">No data for this period.</p>
              )}
            </div>
          ))}
        </div>
      )}

      {/* User activity modal */}

      <Dialog open={!!selectedUser} onOpenChange={(open) => { if (!open) { setSelectedUser(null); setUserActivity(null) } }}>
        <DialogContent className="sm:max-w-3xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="font-mono text-base">{selectedUser}</DialogTitle>
            <DialogDescription>User activity — {DATE_RANGE_OPTIONS.find(o => o.key === dateRange)?.label}</DialogDescription>
          </DialogHeader>

          {userActivityLoading && (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          )}

          {userActivityError && (
            <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{userActivityError}</p>
          )}

          {userActivity && (
            <div className="flex flex-col gap-5">

              {/* KPI tiles */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: "Active Days", value: userActivity.activeDays,      icon: Users,    iconColor: "text-sky-500"   },
                  { label: "Views",       value: userActivity.totalViews,      icon: Eye,      iconColor: "text-blue-500"  },
                  { label: "Downloads",   value: userActivity.totalDownloads,  icon: Download, iconColor: "text-green-500" },
                ].map(({ label, value, icon: Icon, iconColor }) => (
                  <div key={label} className="border border-border rounded-lg p-3 flex flex-col gap-1.5 bg-card">
                    <div className="flex items-center gap-2">
                      <Icon className={`h-3.5 w-3.5 ${iconColor}`} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                    </div>
                    <p className="text-xl font-bold">
                      {value === null ? <span className="text-sm text-muted-foreground">—</span> : value.toLocaleString()}
                    </p>
                  </div>
                ))}
              </div>

              {/* Activity chart */}
              {userActivity.chartData.length > 0 && (
                <div className="border border-border rounded-lg p-4 flex flex-col gap-3 bg-card">
                  <h3 className="text-sm font-medium">Activity over time</h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={userActivity.chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="views"     stroke="var(--chart-1)" strokeWidth={2} dot={false} name="Views"     />
                      <Line type="monotone" dataKey="downloads" stroke="var(--chart-2)" strokeWidth={2} dot={false} name="Downloads" />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              )}

              {/* Top assets */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { title: "Top Viewed Assets",     rows: userActivity.topViewedAssets,     countLabel: "Views"     },
                  { title: "Top Downloaded Assets", rows: userActivity.topDownloadedAssets, countLabel: "Downloads" },
                ].map(({ title, rows, countLabel }) => (
                  <div key={title} className="border border-border rounded-lg flex flex-col bg-card">
                    <div className="px-3 py-2.5 border-b border-border">
                      <h3 className="text-xs font-medium">{title}</h3>
                    </div>
                    {rows.length > 0 ? (
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border bg-muted/40">
                            <th className="text-left px-3 py-1.5 text-xs font-medium text-muted-foreground">Record</th>
                            <th className="text-right px-3 py-1.5 text-xs font-medium text-muted-foreground">{countLabel}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {rows.slice(0, 10).map((row, i) => (
                            <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                              <td className={labelCellCls(row.recordId)}>
                                {recordUnavailable.has(row.recordId) ? (
                                  <span className="flex items-center gap-2">
                                    <div className="h-8 w-8 rounded flex-shrink-0 bg-muted flex items-center justify-center">
                                      <ImageOff className="h-4 w-4 text-muted-foreground/40" />
                                    </div>
                                    <span className="flex items-center gap-1.5">
                                      {getLabel(row.recordId)}
                                      <span className="text-muted-foreground text-xs font-normal">(Unavailable)</span>
                                    </span>
                                  </span>
                                ) : (
                                  <Link href={`/asset-usage?record=${row.recordId}`} onClick={() => setSelectedUser(null)} className="flex items-center gap-2 text-primary hover:underline">
                                    {recordThumbnails.has(row.recordId) ? (
                                      <img src={recordThumbnails.get(row.recordId)} alt="" className="h-8 w-8 rounded object-cover flex-shrink-0 bg-muted" />
                                    ) : (
                                      <div className="h-8 w-8 rounded flex-shrink-0 bg-muted flex items-center justify-center">
                                        <FileImage className="h-4 w-4 text-muted-foreground/40" />
                                      </div>
                                    )}
                                    {getLabel(row.recordId)}
                                    <ExternalLink className="h-3 w-3 flex-shrink-0" />
                                  </Link>
                                )}
                              </td>
                              <td className="px-3 py-2 text-right font-medium">{row.count.toLocaleString()}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    ) : (
                      <p className="px-3 py-2.5 text-sm text-muted-foreground">No data for this period.</p>
                    )}
                  </div>
                ))}
              </div>

            </div>
          )}
        </DialogContent>
      </Dialog>

    </main>
  )
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function DamDashboardPage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <Suspense fallback={
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      }>
        <DashboardContent />
      </Suspense>
      <Footer />
    </div>
  )
}
