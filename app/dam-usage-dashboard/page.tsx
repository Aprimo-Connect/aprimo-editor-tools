"use client"

import { useCallback, useEffect, useState, Suspense } from "react"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { Expander, AprimoRateLimitError } from "aprimo-js"
import { Loader2, Eye, Download, Zap, Play, Users, ExternalLink, RefreshCw, Layers, ImageOff, FileImage, CircleUser, ChevronsUpDown, Check, X } from "lucide-react"
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
  const [selectedUser, setSelectedUser] = useState<string | null>(null)
  const [userActivity, setUserActivity] = useState<UserActivity | null>(null)
  const [userActivityLoading, setUserActivityLoading] = useState(false)
  const [userActivityError, setUserActivityError] = useState<string | null>(null)
  const [recordLabels, setRecordLabels] = useState<Map<string, string>>(new Map())
  const [recordThumbnails, setRecordThumbnails] = useState<Map<string, string>>(new Map())
  const [recordUnavailable, setRecordUnavailable] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
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

      // Views and PreviewPlaybacks cubes expose a collectionId dimension; Downloads/Impressions do not
      const colGuid = selectedCollectionId ? toGuid(selectedCollectionId) : null
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
        queryAnalytics(env, authHeader, {
          measures: ["Views.count"],
          filters: vcf,
          timeDimensions: [{ dimension: "DateDimension.date", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "DateDimension.date": "asc" },
          limit: 1000,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Downloads.count"],
          timeDimensions: [{ dimension: "Downloads.downloadDate", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "Downloads.downloadDate": "asc" },
          limit: 1000,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Impressions.count"],
          timeDimensions: [{ dimension: "Impressions.hitDateTime", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "Impressions.hitDateTime": "asc" },
          limit: 1000,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["PreviewPlaybacks.count"],
          filters: pcf,
          timeDimensions: [{ dimension: "PreviewPlaybacks.previewPlaybackDate", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "PreviewPlaybacks.previewPlaybackDate": "asc" },
          limit: 1000,
        }),
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
        queryAnalytics(env, authHeader, {
          measures: ["Impressions.count"],
          dimensions: ["ImpressionTrackingTypes.queryStringKey", "ImpressionTrackingTypeValues.value"],
          ...drRange("Impressions.hitDateTime"),
          order: { "Impressions.count": "desc" },
          limit: 100,
        }),
      ])

      // Active users = distinct login IDs across views + downloads
      const uniqueUsers = new Set([
        ...viewsUserData.map((r: any) => r["Users.loginId"]).filter(Boolean),
        ...downloadsUserData.map((r: any) => r["Users.loginId"]).filter(Boolean),
      ])
      setKpis({
        activeUsers: uniqueUsers.size,
        views:        parseCount(viewsTotal[0]?.["Views.count"]),
        downloads:    parseCount(downloadsTotal[0]?.["Downloads.count"]),
        impressions:  parseCount(impressionsTotal[0]?.["Impressions.count"]),
        plays:        parseCount(playsTotal[0]?.["PreviewPlaybacks.count"]),
      })

      // Merge time series into a single date-keyed map
      const dateMap = new Map<string, ChartPoint>()
      const put = (date: string, field: keyof Omit<ChartPoint, "date">, value: number) => {
        if (!date) return
        if (!dateMap.has(date)) dateMap.set(date, { date, views: 0, downloads: 0, impressions: 0, plays: 0 })
        dateMap.get(date)![field] = value
      }
      for (const row of viewsChart)      put(extractDate(row, "DateDimension.date"),                   "views",       parseCount(row["Views.count"]))
      for (const row of downloadsChart)  put(extractDate(row, "Downloads.downloadDate"),               "downloads",   parseCount(row["Downloads.count"]))
      for (const row of impressionsChart) put(extractDate(row, "Impressions.hitDateTime"),             "impressions", parseCount(row["Impressions.count"]))
      for (const row of playsChart)      put(extractDate(row, "PreviewPlaybacks.previewPlaybackDate"), "plays",       parseCount(row["PreviewPlaybacks.count"]))
setChartData(Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date)))

      // Top assets
      setTopViewed(topViewedData.map((r: any) => ({ recordId: r["Views.recordId"] ?? "", count: parseCount(r["Views.count"]) })).filter((r: AssetRow) => r.recordId))
      setTopDownloaded(topDownloadedData.map((r: any) => ({ recordId: r["Downloads.recordId"] ?? "", count: parseCount(r["Downloads.count"]) })).filter((r: AssetRow) => r.recordId))
      setTopImpressed(topImpressedData.map((r: any) => ({ recordId: r["Impressions.recordId"] ?? "", count: parseCount(r["Impressions.count"]) })).filter((r: AssetRow) => r.recordId))
      setTopPlayed(topPlayedData.map((r: any) => ({ recordId: r["PreviewPlaybacks.recordId"] ?? "", count: parseCount(r["PreviewPlaybacks.count"]) })).filter((r: AssetRow) => r.recordId))

      // Users
      setViewsByUser(viewsUserData.map((r: any) => ({ user: r["Users.loginId"] || "Unknown", count: parseCount(r["Views.count"]) })))
      setDownloadsByUser(downloadsUserData.map((r: any) => ({ user: r["Users.loginId"] || "Unknown", count: parseCount(r["Downloads.count"]) })))
      setPlaysByUser(playsUserData.map((r: any) => ({ user: r["Users.loginId"] || "Unknown", count: parseCount(r["PreviewPlaybacks.count"]) })))

      // UTM
      setUtmData(utmRaw.map((r: any) => ({
        utmKey:   r["ImpressionTrackingTypes.queryStringKey"] ?? "",
        utmValue: r["ImpressionTrackingTypeValues.value"] ?? "",
        count:    parseCount(r["Impressions.count"]),
      })))

      // Record data — thumbnails always; labels when NEXT_PUBLIC_DAM_DASHBOARD_LABEL_FIELD is set
      try {
        const labelField = process.env.NEXT_PUBLIC_DAM_DASHBOARD_LABEL_FIELD
        if (client) {
          const ids = Array.from(new Set([
            ...topViewedData.map((r: any) => r["Views.recordId"]),
            ...topDownloadedData.map((r: any) => r["Downloads.recordId"]),
            ...topImpressedData.map((r: any) => r["Impressions.recordId"]),
            ...topPlayedData.map((r: any) => r["PreviewPlaybacks.recordId"]),
          ].filter(Boolean) as string[]))
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

  }, [connection, isConnected, getAuthHeader, dateRange, selectedCollectionId])

  useEffect(() => { fetchData() }, [fetchData])

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
    { key: "topassets"   as const, label: "Top Assets",   value: undefined,         icon: Layers,   iconColor: "text-orange-500", activeBorder: "border-orange-500", activeBg: "bg-orange-500/5" },
    { key: "users"       as const, label: "Active Users", value: kpis?.activeUsers, icon: Users,    iconColor: "text-sky-500",    activeBorder: "border-sky-500",    activeBg: "bg-sky-500/5"    },
    { key: "views"       as const, label: "Views",        value: kpis?.views,       icon: Eye,      iconColor: "text-blue-500",   activeBorder: "border-blue-500",   activeBg: "bg-blue-500/5"   },
    { key: "downloads"   as const, label: "Downloads",    value: kpis?.downloads,   icon: Download, iconColor: "text-green-500",  activeBorder: "border-green-500",  activeBg: "bg-green-500/5"  },
    { key: "impressions" as const, label: "Impressions",  value: kpis?.impressions, icon: Zap,      iconColor: "text-amber-500",  activeBorder: "border-amber-500",  activeBg: "bg-amber-500/5"  },
    { key: "plays"       as const, label: "Plays",        value: kpis?.plays,       icon: Play,     iconColor: "text-purple-500", activeBorder: "border-purple-500", activeBg: "bg-purple-500/5" },
  ]

  const drillConfig: Record<string, { assets: AssetRow[]; assetLabel: string; users: UserRow[]; userLabel: string }> = {
    views:     { assets: topViewed,     assetLabel: "Views",       users: viewsByUser,     userLabel: "Views"     },
    downloads: { assets: topDownloaded, assetLabel: "Downloads",   users: downloadsByUser, userLabel: "Downloads" },
    impressions: { assets: topImpressed, assetLabel: "Impressions", users: [],          userLabel: "" },
    plays:       { assets: topPlayed,    assetLabel: "Plays",       users: playsByUser, userLabel: "Plays" },
  }

  const showDrillDown = activeMetric !== null

  return (
    <main className="flex-1 p-6 flex flex-col gap-6 max-w-6xl mx-auto w-full">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">DAM Usage Dashboard</h1>
          <p className="text-xs text-muted-foreground mt-0.5">{connection?.environment}</p>
        </div>
        <button
          onClick={fetchData}
          disabled={loading}
          className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      </div>

      {/* Date range selector + collection filter */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
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

        {/* Collection filter combobox */}
        <div className="flex items-center gap-2">
            <Popover open={collectionComboOpen} onOpenChange={setCollectionComboOpen}>
              <PopoverTrigger asChild>
                <button
                  className="flex items-center gap-1.5 border border-border rounded-md px-3 py-1.5 text-sm bg-background hover:bg-muted/50 transition-colors min-w-[180px] justify-between"
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
                            onSelect={() => { setSelectedCollectionId(c.id); setCollectionComboOpen(false) }}
                          >
                            <Check className={`h-4 w-4 mr-2 ${selectedCollectionId === c.id ? "opacity-100" : "opacity-0"}`} />
                            <span className="flex-1 truncate">{c.name}</span>
                            {c.type === "Dynamic" && (
                              <span className="ml-2 text-xs text-blue-500 flex-shrink-0">Dynamic</span>
                            )}
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
      </div>

      {error && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{error}</p>
      )}

      {/* Activity chart */}
      {chartData.length > 0 && (
        <div className="border border-border rounded-lg p-4 flex flex-col gap-3">
          <h2 className="text-sm font-medium">Activity over time</h2>
          <ResponsiveContainer width="100%" height={240}>
            <LineChart data={chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Line type="monotone" dataKey="impressions" stroke="#f59e0b" strokeWidth={lineWidth("impressions")} strokeOpacity={lineOpacity("impressions")} dot={false} name="Impressions" />
              <Line type="monotone" dataKey="views"        stroke="#3b82f6" strokeWidth={lineWidth("views")}       strokeOpacity={lineOpacity("views")}       dot={false} name="Views" />
              <Line type="monotone" dataKey="downloads"    stroke="#22c55e" strokeWidth={lineWidth("downloads")}   strokeOpacity={lineOpacity("downloads")}   dot={false} name="Downloads" />
              <Line type="monotone" dataKey="plays"        stroke="#a855f7" strokeWidth={lineWidth("plays")}       strokeOpacity={lineOpacity("plays")}       dot={false} name="Plays" />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* KPI tiles — click to drill down, click again to collapse */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-4">
        {kpiTiles.map(({ key, label, value, icon: Icon, iconColor, activeBorder, activeBg }) => {
          const collectionUnsupported = !!selectedCollectionId && (key === "downloads" || key === "impressions" || key === "users")
          return (
            <button
              key={key}
              onClick={() => !collectionUnsupported && setActiveMetric(prev => prev === key ? null : key)}
              disabled={collectionUnsupported}
              className={`border rounded-lg p-4 flex flex-col gap-2 text-left transition-colors ${
                collectionUnsupported
                  ? "border-border opacity-40 cursor-not-allowed"
                  : activeMetric === key
                    ? `${activeBorder} ${activeBg}`
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
          <div className="border border-border rounded-lg flex flex-col">
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
                              <div className="h-8 w-8 rounded flex-shrink-0 bg-green-500/10 flex items-center justify-center">
                                <FileImage className="h-4 w-4 text-green-600/50" />
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
          <div className="border border-border rounded-lg flex flex-col">
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
                                <div className="h-8 w-8 rounded-full flex-shrink-0 bg-green-500/10 flex items-center justify-center">
                                  <CircleUser className="h-4 w-4 text-green-600/50" />
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
            <div key={title} className="border border-border rounded-lg flex flex-col">
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
                              <div className="h-8 w-8 rounded-full flex-shrink-0 bg-green-500/10 flex items-center justify-center">
                                <CircleUser className="h-4 w-4 text-green-600/50" />
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
            <div key={title} className={`border border-border rounded-lg flex flex-col ${unsupported ? "opacity-40" : ""}`}>
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
                                <div className="h-8 w-8 rounded flex-shrink-0 bg-green-500/10 flex items-center justify-center">
                                  <FileImage className="h-4 w-4 text-green-600/50" />
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
                  <div key={label} className="border border-border rounded-lg p-3 flex flex-col gap-1.5">
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
                <div className="border border-border rounded-lg p-4 flex flex-col gap-3">
                  <h3 className="text-sm font-medium">Activity over time</h3>
                  <ResponsiveContainer width="100%" height={180}>
                    <LineChart data={userActivity.chartData} margin={{ top: 4, right: 16, left: 0, bottom: 4 }}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                      <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} allowDecimals={false} />
                      <Tooltip />
                      <Legend />
                      <Line type="monotone" dataKey="views"     stroke="#3b82f6" strokeWidth={2} dot={false} name="Views"     />
                      <Line type="monotone" dataKey="downloads" stroke="#22c55e" strokeWidth={2} dot={false} name="Downloads" />
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
                  <div key={title} className="border border-border rounded-lg flex flex-col">
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
