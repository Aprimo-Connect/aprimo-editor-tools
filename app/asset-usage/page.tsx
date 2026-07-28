"use client"

import { useCallback, useEffect, useState, Suspense } from "react"
import { useSearchParams } from "next/navigation"
import { Navbar } from "@/components/navbar"
import { Footer } from "@/components/footer"
import { useAprimo } from "@/context/aprimo-context"
import { Expander } from "aprimo-js"
import type { Record as AprimoRecord, FileVersion } from "aprimo-js/model"
import { Loader2, Eye, Download, Zap, Play } from "lucide-react"
import { Separator } from "@/components/ui/separator"
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts"

// ── Types ─────────────────────────────────────────────────────────────────────

type DateRangeKey = "30d" | "90d" | "6m" | "1y" | "all"

interface Stats {
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

interface ImpressionRow {
  date: string
  utmKey: string
  utmValue: string
  count: number
}

interface UserRow {
  date: string
  user: string
  count: number
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

// ── Main content ──────────────────────────────────────────────────────────────

function AssetUsageContent() {
  const searchParams = useSearchParams()
  const recordId = searchParams.get("record")
  const { client, isConnected, connection, getAuthHeader } = useAprimo()

  const [record, setRecord] = useState<any>(null)
  const [recordLoading, setRecordLoading] = useState(false)
  const [recordError, setRecordError] = useState<string | null>(null)

  const [dateRange, setDateRange] = useState<DateRangeKey>("30d")
  const [stats, setStats] = useState<Stats | null>(null)
  const [chartData, setChartData] = useState<ChartPoint[]>([])
  const [impressionDetail, setImpressionDetail] = useState<ImpressionRow[]>([])
  const [viewsByUser, setViewsByUser] = useState<UserRow[]>([])
  const [downloadsByUser, setDownloadsByUser] = useState<UserRow[]>([])
  const [playsByUser, setPlaysByUser] = useState<UserRow[]>([])
  const [analyticsLoading, setAnalyticsLoading] = useState(false)
  const [analyticsError, setAnalyticsError] = useState<string | null>(null)
  const [activeMetric, setActiveMetric] = useState<"views" | "downloads" | "impressions" | "plays" | null>(null)

  const recordTitle: string = record?.title ?? recordId ?? ""
  const thumbnailUrl = record?._embedded?.masterfilelatestversion?._embedded?.thumbnail?.uri as string | undefined

  // ── Fetch record ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (!recordId || !client || !isConnected) return
    setRecordLoading(true)
    const expander = Expander.create()
      .for<AprimoRecord>("Record").expand("masterfilelatestversion")
      .for<FileVersion>("FileVersion").expand("thumbnail")
    client.records.getById(recordId, expander)
      .then(res => {
        if (!res.ok) throw new Error(res.error?.message ?? "Failed to fetch record")
        setRecord(res.data as any)
      })
      .catch(e => setRecordError(e instanceof Error ? e.message : String(e)))
      .finally(() => setRecordLoading(false))
  }, [recordId, client, isConnected])

  // ── Fetch analytics ────────────────────────────────────────────────────────

  const fetchAnalytics = useCallback(async () => {
    if (!recordId || !connection || !isConnected) return
    const authHeader = getAuthHeader()
    if (!authHeader) return

    setAnalyticsLoading(true)
    setAnalyticsError(null)

    try {
      const dr = getDateRange(dateRange)
      const granularity = getGranularity(dateRange)
      const env = connection.environment
      const guid = toGuid(recordId)

      const drFilter = (dim: string) => dr ? { timeDimensions: [{ dimension: dim, dateRange: dr }] } : {}

      const [viewsData, downloadsData, impressionsData, playsData, viewsChart, downloadsChart, impressionsChart, playsChart, impressionsDetail, viewsUsers, downloadsUsers, playsUsers] = await Promise.all([
        queryAnalytics(env, authHeader, {
          measures: ["Views.count"],
          filters: [{ member: "Views.recordId", operator: "equals", values: [guid] }],
          ...drFilter("DateDimension.date"),
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Downloads.count"],
          filters: [{ member: "Downloads.recordId", operator: "equals", values: [guid] }],
          ...drFilter("Downloads.downloadDate"),
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Impressions.count"],
          filters: [{ member: "Impressions.recordId", operator: "equals", values: [guid] }],
          ...drFilter("Impressions.hitDateTime"),
        }),
        queryAnalytics(env, authHeader, {
          measures: ["PreviewPlaybacks.count"],
          filters: [{ member: "PreviewPlaybacks.recordId", operator: "equals", values: [guid] }],
          ...drFilter("PreviewPlaybacks.previewPlaybackDate"),
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Views.count"],
          filters: [{ member: "Views.recordId", operator: "equals", values: [guid] }],
          timeDimensions: [{ dimension: "DateDimension.date", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "DateDimension.date": "asc" },
          limit: 1000,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Downloads.count"],
          filters: [{ member: "Downloads.recordId", operator: "equals", values: [guid] }],
          timeDimensions: [{ dimension: "Downloads.downloadDate", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "Downloads.downloadDate": "asc" },
          limit: 1000,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Impressions.count"],
          filters: [{ member: "Impressions.recordId", operator: "equals", values: [guid] }],
          timeDimensions: [{ dimension: "Impressions.hitDateTime", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "Impressions.hitDateTime": "asc" },
          limit: 1000,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["PreviewPlaybacks.count"],
          filters: [{ member: "PreviewPlaybacks.recordId", operator: "equals", values: [guid] }],
          timeDimensions: [{ dimension: "PreviewPlaybacks.previewPlaybackDate", granularity, ...(dr ? { dateRange: dr } : {}) }],
          order: { "PreviewPlaybacks.previewPlaybackDate": "asc" },
          limit: 1000,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Impressions.count"],
          dimensions: [
            "ImpressionTrackingTypes.queryStringKey",
            "ImpressionTrackingTypeValues.value",
          ],
          filters: [{ member: "Impressions.recordId", operator: "equals", values: [guid] }],
          timeDimensions: [{ dimension: "Impressions.hitDateTime", granularity: "day", ...(dr ? { dateRange: dr } : {}) }],
          order: { "Impressions.hitDateTime": "asc", "Impressions.count": "desc" },
          limit: 5000,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Views.count"],
          dimensions: ["Users.loginId"],
          filters: [{ member: "Views.recordId", operator: "equals", values: [guid] }],
          timeDimensions: [{ dimension: "DateDimension.date", granularity: "day", ...(dr ? { dateRange: dr } : {}) }],
          order: { "DateDimension.date": "desc", "Views.count": "desc" },
          limit: 500,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["Downloads.count"],
          dimensions: ["Users.loginId"],
          filters: [{ member: "Downloads.recordId", operator: "equals", values: [guid] }],
          timeDimensions: [{ dimension: "Downloads.downloadDate", granularity: "day", ...(dr ? { dateRange: dr } : {}) }],
          order: { "Downloads.downloadDate": "desc", "Downloads.count": "desc" },
          limit: 500,
        }),
        queryAnalytics(env, authHeader, {
          measures: ["PreviewPlaybacks.count"],
          dimensions: ["Users.loginId"],
          filters: [{ member: "PreviewPlaybacks.recordId", operator: "equals", values: [guid] }],
          timeDimensions: [{ dimension: "PreviewPlaybacks.previewPlaybackDate", granularity: "day", ...(dr ? { dateRange: dr } : {}) }],
          order: { "PreviewPlaybacks.previewPlaybackDate": "desc", "PreviewPlaybacks.count": "desc" },
          limit: 500,
        }),
      ])

      setStats({
        views:       parseCount(viewsData[0]?.["Views.count"]),
        downloads:   parseCount(downloadsData[0]?.["Downloads.count"]),
        impressions: parseCount(impressionsData[0]?.["Impressions.count"]),
        plays:       parseCount(playsData[0]?.["PreviewPlaybacks.count"]),
      })

      // Merge views + downloads + impressions time-series by date
      const dateMap = new Map<string, ChartPoint>()
      for (const row of viewsChart) {
        const date = (row["DateDimension.date"] as string)?.slice(0, 10) ?? ""
        if (date) dateMap.set(date, { date, views: parseCount(row["Views.count"]), downloads: 0, impressions: 0, plays: 0 })
      }
      for (const row of downloadsChart) {
        const date = (row["Downloads.downloadDate"] as string)?.slice(0, 10) ?? ""
        if (date) {
          const existing = dateMap.get(date)
          if (existing) existing.downloads = parseCount(row["Downloads.count"])
          else dateMap.set(date, { date, views: 0, downloads: parseCount(row["Downloads.count"]), impressions: 0, plays: 0 })
        }
      }
      for (const row of impressionsChart) {
        const date = (row["Impressions.hitDateTime.day"] as string)?.slice(0, 10)
                  ?? (row["Impressions.hitDateTime.month"] as string)?.slice(0, 10) ?? ""
        if (date) {
          const existing = dateMap.get(date)
          if (existing) existing.impressions = parseCount(row["Impressions.count"])
          else dateMap.set(date, { date, views: 0, downloads: 0, impressions: parseCount(row["Impressions.count"]), plays: 0 })
        }
      }
      for (const row of playsChart) {
        const date = (row["PreviewPlaybacks.previewPlaybackDate.day"] as string)?.slice(0, 10)
                  ?? (row["PreviewPlaybacks.previewPlaybackDate.month"] as string)?.slice(0, 10) ?? ""
        if (date) {
          const existing = dateMap.get(date)
          if (existing) existing.plays = parseCount(row["PreviewPlaybacks.count"])
          else dateMap.set(date, { date, views: 0, downloads: 0, impressions: 0, plays: parseCount(row["PreviewPlaybacks.count"]) })
        }
      }
      setChartData(Array.from(dateMap.values()).sort((a, b) => a.date.localeCompare(b.date)))

      setImpressionDetail(
        impressionsDetail.map((row: any) => ({
          date:     (row["Impressions.hitDateTime.day"] as string)?.slice(0, 10) ?? "",
          utmKey:   (row["ImpressionTrackingTypes.queryStringKey"] as string) ?? "",
          utmValue: (row["ImpressionTrackingTypeValues.value"] as string) ?? "",
          count:    parseCount(row["Impressions.count"]),
        }))
      )

      setViewsByUser(
        viewsUsers.map((row: any) => ({
          date:  (row["DateDimension.date.day"] as string)?.slice(0, 10) ?? "",
          user:  (row["Users.loginId"] as string) || "Unknown",
          count: parseCount(row["Views.count"]),
        }))
      )

      setDownloadsByUser(
        downloadsUsers.map((row: any) => ({
          date:  (row["Downloads.downloadDate.day"] as string)?.slice(0, 10) ?? "",
          user:  (row["Users.loginId"] as string) || "Unknown",
          count: parseCount(row["Downloads.count"]),
        }))
      )

      setPlaysByUser(
        playsUsers.map((row: any) => ({
          date:  (row["PreviewPlaybacks.previewPlaybackDate.day"] as string)?.slice(0, 10) ?? "",
          user:  (row["Users.loginId"] as string) || "Unknown",
          count: parseCount(row["PreviewPlaybacks.count"]),
        }))
      )
    } catch (e) {
      setAnalyticsError(e instanceof Error ? e.message : String(e))
    } finally {
      setAnalyticsLoading(false)
    }
  }, [recordId, connection, isConnected, getAuthHeader, dateRange])

  useEffect(() => { fetchAnalytics() }, [fetchAnalytics])


  // ── Early returns ──────────────────────────────────────────────────────────

  if (!recordId) {
    return <main className="p-8"><p className="text-sm text-muted-foreground">No record ID provided. Pass <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">?record=&lt;id&gt;</code> in the URL.</p></main>
  }
  if (!isConnected) {
    return <main className="p-8"><p className="text-sm text-muted-foreground">Connect to Aprimo to use this tool.</p></main>
  }
  if (recordLoading) {
    return <main className="flex-1 flex items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></main>
  }
  if (recordError) {
    return <main className="p-8"><p className="text-sm text-destructive">{recordError}</p></main>
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  const metricTiles = [
    { key: "views"       as const, label: "Views",       value: stats?.views,       icon: Eye,      iconColor: "text-blue-500",   activeBorder: "border-blue-500",   activeBg: "bg-blue-500/5"   },
    { key: "downloads"   as const, label: "Downloads",   value: stats?.downloads,   icon: Download, iconColor: "text-green-500",  activeBorder: "border-green-500",  activeBg: "bg-green-500/5"  },
    { key: "impressions" as const, label: "Impressions", value: stats?.impressions, icon: Zap,      iconColor: "text-amber-500",  activeBorder: "border-amber-500",  activeBg: "bg-amber-500/5"  },
    { key: "plays"       as const, label: "Plays",       value: stats?.plays,       icon: Play,     iconColor: "text-purple-500", activeBorder: "border-purple-500", activeBg: "bg-purple-500/5" },
  ]

  const lineOpacity = (key: string) => activeMetric === null || activeMetric === key ? 1 : 0.12
  const lineWidth   = (key: string) => activeMetric === null || activeMetric === key ? 2.5 : 1

  const userTables = {
    views:     { title: "Views by user",     rows: viewsByUser,     countLabel: "Views"     },
    downloads: { title: "Downloads by user", rows: downloadsByUser, countLabel: "Downloads" },
    plays:     { title: "Plays by user",     rows: playsByUser,     countLabel: "Plays"     },
  }
  const activeUserTable = activeMetric && activeMetric !== "impressions" ? userTables[activeMetric] : null

  return (
    <main className="flex-1 p-6 flex flex-col gap-6 max-w-4xl mx-auto w-full">

      {/* Record header */}
      {record && (
        <>
          <div className="flex items-start gap-4">
            {thumbnailUrl && (
              <img src={thumbnailUrl} alt={recordTitle} className="h-20 w-32 object-cover rounded-md bg-muted flex-shrink-0" />
            )}
            <div className="flex flex-col gap-1 min-w-0">
              <h1 className="text-xl font-semibold leading-tight">{recordTitle}</h1>
              <p className="text-xs text-muted-foreground font-mono">{recordId}</p>
            </div>
          </div>
          <Separator />
        </>
      )}

      {/* Date range selector */}
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
        {analyticsLoading && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
      </div>

      {analyticsError && (
        <p className="text-sm text-destructive bg-destructive/10 rounded-md px-3 py-2">{analyticsError}</p>
      )}

      {/* Engagement chart */}
      {chartData.length > 0 && (
        <div className="border border-border rounded-lg p-4 flex flex-col gap-3">
          <h2 className="text-sm font-medium">Engagement over time</h2>
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

      {/* Metric tiles — toggle buttons that isolate chart lines and switch tables */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {metricTiles.map(({ key, label, value, icon: Icon, iconColor, activeBorder, activeBg }) => (
          <button
            key={key}
            onClick={() => setActiveMetric(prev => prev === key ? null : key)}
            className={`border rounded-lg p-4 flex flex-col gap-2 text-left transition-colors ${
              activeMetric === key
                ? `${activeBorder} ${activeBg}`
                : "border-border hover:bg-muted/50"
            }`}
          >
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${iconColor}`} />
              <span className="text-xs text-muted-foreground">{label}</span>
            </div>
            <p className="text-2xl font-bold">
              {analyticsLoading ? <span className="text-muted-foreground">—</span> : (value?.toLocaleString() ?? "0")}
            </p>
          </button>
        ))}
      </div>

      {/* Detail table — controlled by active tile */}

      {activeUserTable && (
        <div className="border border-border rounded-lg flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium">{activeUserTable.title}</h2>
          </div>
          {activeUserTable.rows.length > 0 ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted/40">
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Date</th>
                  <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">User</th>
                  <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">{activeUserTable.countLabel}</th>
                </tr>
              </thead>
              <tbody>
                {activeUserTable.rows.map((row, i) => (
                  <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                    <td className="px-4 py-2 font-mono text-xs">{row.date}</td>
                    <td className="px-4 py-2">{row.user}</td>
                    <td className="px-4 py-2 text-right font-medium">{row.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="px-4 py-3 text-sm text-muted-foreground">No data for this period.</p>
          )}
        </div>
      )}

      {activeMetric === "impressions" && (
        <div className="border border-border rounded-lg flex flex-col">
          <div className="px-4 py-3 border-b border-border">
            <h2 className="text-sm font-medium">Impressions by day &amp; UTM</h2>
          </div>
          {impressionDetail.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-muted/40">
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">Date</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">UTM Parameter</th>
                    <th className="text-left px-4 py-2 text-xs font-medium text-muted-foreground">UTM Value</th>
                    <th className="text-right px-4 py-2 text-xs font-medium text-muted-foreground">Impressions</th>
                  </tr>
                </thead>
                <tbody>
                  {impressionDetail.map((row, i) => (
                    <tr key={i} className="border-b border-border last:border-0 hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-2 font-mono text-xs">{row.date}</td>
                      <td className="px-4 py-2 text-muted-foreground">{row.utmKey || <span className="italic text-muted-foreground/60">none</span>}</td>
                      <td className="px-4 py-2 text-muted-foreground">{row.utmValue || <span className="italic text-muted-foreground/60">—</span>}</td>
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
      )}

      {!analyticsLoading && !analyticsError && stats && chartData.length === 0 && (
        <p className="text-sm text-muted-foreground">No engagement data for this period.</p>
      )}

    </main>
  )
}

// ── Page shell ────────────────────────────────────────────────────────────────

export default function AssetUsagePage() {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      <Navbar />
      <Suspense fallback={
        <main className="flex-1 flex items-center justify-center">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </main>
      }>
        <AssetUsageContent />
      </Suspense>
      <Footer />
    </div>
  )
}
