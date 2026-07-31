"use client"

import { useEffect, useRef, useState } from "react"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog"
import {
  Copy, Check, ExternalLink, FolderOpen, X, Clapperboard, Film, Music2, ImageIcon, Type, Loader2, RefreshCw,
  ArrowUpLeft, ArrowUp, ArrowUpRight,
  ArrowLeft, ArrowRight,
  ArrowDownLeft, ArrowDown, ArrowDownRight,
} from "lucide-react"
import { toast } from "sonner"
import { useAprimo } from "@/context/aprimo-context"
import { SelectedAsset, TextPosition, TEXT_FONTS, TRANSITIONS, detectMediaType } from "../types"

const POSITION_GRID: { pos: TextPosition; icon: React.ElementType | null }[] = [
  { pos: "top-left",     icon: ArrowUpLeft   }, { pos: "top-center",    icon: ArrowUp    }, { pos: "top-right",    icon: ArrowUpRight   },
  { pos: "middle-left",  icon: ArrowLeft     }, { pos: "middle-center", icon: null       }, { pos: "middle-right", icon: ArrowRight     },
  { pos: "bottom-left",  icon: ArrowDownLeft }, { pos: "bottom-center", icon: ArrowDown  }, { pos: "bottom-right", icon: ArrowDownRight },
]

interface StudioSidebarProps {
  assets: SelectedAsset[]
  setAssets: React.Dispatch<React.SetStateAction<SelectedAsset[]>>
  setDurations: React.Dispatch<React.SetStateAction<Record<string, number>>>
  draggingId: string | null
  setDraggingId: (id: string | null) => void
  draggingTransitionType: string | null
  setDraggingTransitionType: (t: string | null) => void
  isConnected: boolean
  connection: { environment: string } | null
  pendingBasketAssets: { id: string; title: string }[]
}

export function StudioSidebar({
  assets,
  setAssets,
  setDurations,
  draggingId,
  setDraggingId,
  draggingTransitionType,
  setDraggingTransitionType,
  isConnected,
  connection,
  pendingBasketAssets,
}: StudioSidebarProps) {
  const { client } = useAprimo()
  const clientRef = useRef(client)
  useEffect(() => { clientRef.current = client }, [client])

  const [sidebarTab, setSidebarTab] = useState<"assets" | "transitions">("assets")
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [textDialogOpen, setTextDialogOpen] = useState(false)
  const [textHeading, setTextHeading] = useState("")
  const [headingSize, setHeadingSize] = useState(48)
  const [textBody, setTextBody] = useState("")
  const [textSize, setTextSize] = useState(32)
  const [textColor, setTextColor] = useState("#ffffff")

  const [textPosition, setTextPosition] = useState<TextPosition>("middle-center")
  const [textFont, setTextFont] = useState(TEXT_FONTS[0].value)
  const [textOpacity, setTextOpacity] = useState(100)

  // Inject Google Fonts CSS for dialog preview whenever font changes
  useEffect(() => {
    const font = TEXT_FONTS.find((f) => f.value === textFont)
    if (!font) return
    const id = `gfont-${font.value.replace(/\s+/g, "-")}`
    if (document.getElementById(id)) return
    const link = document.createElement("link")
    link.id = id
    link.rel = "stylesheet"
    link.href = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(font.value)}&display=swap`
    document.head.appendChild(link)
  }, [textFont])
  const [editingTextId, setEditingTextId] = useState<string | null>(null)
  const downloadedIdsRef = useRef<Set<string>>(new Set())
  const processedBasketIds = useRef<Set<string>>(new Set())

  useEffect(() => {
    const unprocessed = pendingBasketAssets.filter((a) => !processedBasketIds.current.has(a.id))
    if (unprocessed.length === 0) return
    unprocessed.forEach((a) => {
      processedBasketIds.current.add(a.id)
      downloadedIdsRef.current.add(a.id)
      setAssets((prev) => {
        if (prev.some((p) => p.id === a.id)) return prev
        return [...prev, { id: a.id, title: a.title, thumbnailUrl: null, publicLink: null, loading: true, error: null, mediaType: "unknown" as const }]
      })
      fetchAssetUrl(a.id, a.title)
    })
  }, [pendingBasketAssets])

  async function detectMediaTypeFromUrl(url: string): Promise<import("../types").MediaType> {
    try {
      const res = await fetch(url, { method: "HEAD" })
      const ct = res.headers.get("content-type") ?? ""
      if (ct.startsWith("video/")) return "video"
      if (ct.startsWith("audio/")) return "audio"
      if (ct.startsWith("image/")) return "image"
    } catch { /* fall through to extension check */ }
    return detectMediaType(url)
  }

  async function fetchAssetUrl(assetId: string, title: string) {
    const c = clientRef.current
    if (!c) return

    setAssets((prev) => {
      if (prev.some((a) => a.id === assetId)) return prev
      return [...prev, { id: assetId, title, thumbnailUrl: null, publicLink: null, loading: true, error: null, mediaType: "unknown" }]
    })

    try {
      const orderRes = await c.orders.create({
        type: "download",
        targets: [{ recordId: assetId, targetTypes: ["Document"], assetType: "LatestVersionOfMasterFile" } as never],
      })
      if (!orderRes.ok || !orderRes.data) throw new Error(orderRes.error?.message ?? "Failed to create order")

      const orderId = orderRes.data.id
      let url: string | null = null

      for (let attempt = 0; attempt < 60; attempt++) {
        await new Promise((r) => setTimeout(r, 1000))
        const pollRes = await c.orders.getById(orderId)
        const order = pollRes.data as any
        if (!order) continue
        if (order.status === "Failed") throw new Error("Download order failed")
        if (order.status === "Completed" || order.status === "Success") {
          const delivered = order.deliveredFiles
          if (Array.isArray(delivered) && delivered.length > 0) { url = delivered[0]; break }
          try {
            const dlRes = await c.downloadLinks.getById(orderId)
            const u = (dlRes.data as any)?.deliveredFiles?.[0]
            if (u) { url = u; break }
          } catch { /* keep polling */ }
        }
      }

      if (!url) throw new Error("Download order timed out")
      const mediaType = await detectMediaTypeFromUrl(url)
      setAssets((prev) => prev.map((a) => a.id === assetId ? { ...a, publicLink: url, loading: false, mediaType } : a))
      probeDuration(assetId, url)
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Failed to download"
      setAssets((prev) => prev.map((a) => a.id === assetId ? { ...a, loading: false, error: msg } : a))
      toast.error(`Failed to load "${title}": ${msg}`)
    }
  }

  function probeDuration(assetId: string, url: string) {
    const video = document.createElement("video")
    video.preload = "metadata"
    video.src = url
    video.onloadedmetadata = () => {
      if (isFinite(video.duration) && video.duration > 0) {
        setDurations((prev) => ({ ...prev, [assetId]: video.duration }))
      }
      video.src = ""
    }
  }

  useEffect(() => {
    const tenantUrl = connection ? `https://${connection.environment}.dam.aprimo.com` : null

    function handleMessage(event: MessageEvent) {
      if (tenantUrl && event.origin !== tenantUrl) return
      const data = event.data
      if (!data || data.result !== "accept") return

      const selection: Array<{ id: string; title?: string }> = data.selection ?? []
      if (selection.length === 0) return

      selection.forEach((r) => {
        if (downloadedIdsRef.current.has(r.id)) return
        downloadedIdsRef.current.add(r.id)
        fetchAssetUrl(r.id, r.title ?? r.id)
      })
    }

    window.addEventListener("message", handleMessage)
    return () => window.removeEventListener("message", handleMessage)
  }, [connection])

  function openSelector() {
    if (!connection) return
    const tenantUrl = `https://${connection.environment}.dam.aprimo.com`
    const options = {
      targetOrigin: window.location.origin,
      select: "multiple",
    }
    const encoded = window.btoa(JSON.stringify(options))
    const url = `${tenantUrl}/dam/selectcontent#options=${encoded}`
    window.open(url, "aprimo-select", "width=1200,height=800,resizable=yes,scrollbars=yes")
  }

  async function copyLink(asset: SelectedAsset) {
    if (!asset.publicLink) return
    await navigator.clipboard.writeText(asset.publicLink)
    setCopiedId(asset.id)
    toast.success("Link copied to clipboard")
    setTimeout(() => setCopiedId((id) => (id === asset.id ? null : id)), 2000)
  }

  function removeAsset(id: string) {
    setAssets((prev) => prev.filter((a) => a.id !== id))
  }

  function refreshAssets() {
    const aprimoAssets = assets.filter((a) => a.mediaType !== "text")
    if (aprimoAssets.length === 0) return
    setAssets((prev) => prev.map((a) =>
      a.mediaType !== "text" ? { ...a, loading: true, publicLink: null, error: null } : a
    ))
    aprimoAssets.forEach((a) => fetchAssetUrl(a.id, a.title))
  }

  const aprimoAssetCount = assets.filter((a) => a.mediaType !== "text").length
  const anyLoading = assets.some((a) => a.loading)

  return (
    <div className="w-72 shrink-0 border-r border-border flex flex-col bg-card">
      <div className="flex border-b border-border shrink-0">
        <button
          onClick={() => setSidebarTab("assets")}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${sidebarTab === "assets" ? "text-foreground border-b-2 border-primary -mb-px" : "text-muted-foreground hover:text-foreground"}`}
        >
          Assets
        </button>
        <button
          onClick={() => setSidebarTab("transitions")}
          className={`flex-1 py-2 text-xs font-medium transition-colors ${sidebarTab === "transitions" ? "text-foreground border-b-2 border-primary -mb-px" : "text-muted-foreground hover:text-foreground"}`}
        >
          Transitions
        </button>
      </div>

      {sidebarTab === "assets" && (
        <>
          <div className="flex items-center justify-between px-3 py-1.5 border-b border-border shrink-0">
            {aprimoAssetCount > 0 ? (
              <Button variant="ghost" size="sm" className="h-6 w-6 p-0" title="Refresh asset URLs" onClick={refreshAssets} disabled={anyLoading}>
                <RefreshCw className="h-3 w-3" />
              </Button>
            ) : <div />}
            <div className="flex items-center gap-1">
              <Button variant="outline" size="sm" className="h-6 text-xs px-2" onClick={() => { setTextDialogOpen(true); setEditingTextId(null); setTextHeading(""); setHeadingSize(48); setTextBody(""); setTextSize(32); setTextColor("#ffffff"); setTextPosition("middle-center"); setTextFont(TEXT_FONTS[0].value); setTextOpacity(100) }}>
                <Type className="h-3 w-3" />
                Add Text
              </Button>
              <Button size="sm" className="h-6 text-xs px-2" onClick={openSelector} disabled={!isConnected}>
                <FolderOpen className="h-3 w-3" />
                Add Assets
              </Button>
            </div>
          </div>

          <Dialog open={textDialogOpen} onOpenChange={setTextDialogOpen}>
            <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>{editingTextId ? "Edit Text Asset" : "New Text Asset"}</DialogTitle>
              </DialogHeader>
              <div className="flex flex-col gap-3 py-1">

                {/* Heading */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-muted-foreground flex-1">Heading</label>
                    <input
                      type="number" min={8} max={200} value={headingSize}
                      onChange={(e) => setHeadingSize(Math.max(8, Math.min(200, Number(e.target.value))))}
                      className="text-xs px-2 py-0.5 rounded border border-border bg-background outline-none focus:ring-1 focus:ring-ring w-14 text-center"
                    />
                    <span className="text-xs text-muted-foreground">px</span>
                  </div>
                  <input
                    autoFocus
                    placeholder="Large title text…"
                    value={textHeading}
                    onChange={(e) => setTextHeading(e.target.value)}
                    className="text-sm px-3 py-1.5 rounded border border-border bg-background w-full outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                {/* Body */}
                <div className="flex flex-col gap-1">
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-medium text-muted-foreground flex-1">Text</label>
                    <input
                      type="number" min={8} max={200} value={textSize}
                      onChange={(e) => setTextSize(Math.max(8, Math.min(200, Number(e.target.value))))}
                      className="text-xs px-2 py-0.5 rounded border border-border bg-background outline-none focus:ring-1 focus:ring-ring w-14 text-center"
                    />
                    <span className="text-xs text-muted-foreground">px</span>
                  </div>
                  <input
                    placeholder="Smaller body text…"
                    value={textBody}
                    onChange={(e) => setTextBody(e.target.value)}
                    className="text-sm px-3 py-1.5 rounded border border-border bg-background w-full outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                {/* Font + Color */}
                <div className="flex gap-3 items-end">
                  <div className="flex flex-col gap-1 flex-1">
                    <label className="text-xs font-medium text-muted-foreground">Font</label>
                    <select
                      value={textFont}
                      onChange={(e) => setTextFont(e.target.value)}
                      className="text-xs px-2 py-1.5 rounded border border-border bg-background outline-none focus:ring-1 focus:ring-ring w-full"
                    >
                      {TEXT_FONTS.map((f) => (
                        <option key={f.value} value={f.value}>{f.label}</option>
                      ))}
                    </select>
                  </div>
                  <div className="flex flex-col gap-1">
                    <label className="text-xs font-medium text-muted-foreground">Color</label>
                    <div className="flex items-center gap-1.5">
                      <input type="color" value={textColor} onChange={(e) => setTextColor(e.target.value)}
                        className="h-[30px] w-10 rounded border border-border cursor-pointer p-0.5 bg-background" />
                      <span className="text-xs font-mono text-muted-foreground">{textColor}</span>
                    </div>
                  </div>
                </div>

                {/* Opacity */}
                <div className="flex flex-col gap-1">
                  <label className="text-xs font-medium text-muted-foreground">Opacity — {textOpacity}%</label>
                  <input
                    type="range" min={0} max={100} value={textOpacity}
                    onChange={(e) => setTextOpacity(Number(e.target.value))}
                    className="w-full accent-primary"
                  />
                </div>

                {/* Position + Preview */}
                <div className="flex gap-3">
                  <div className="flex flex-col gap-1 shrink-0">
                    <label className="text-xs font-medium text-muted-foreground">Position</label>
                    <div className="grid grid-cols-3 gap-1">
                      {POSITION_GRID.map(({ pos, icon: Icon }) => {
                        const selected = textPosition === pos
                        return (
                          <button
                            key={pos}
                            type="button"
                            onClick={() => setTextPosition(pos)}
                            className={`h-8 w-8 flex items-center justify-center rounded border transition-colors ${selected ? "bg-primary border-primary text-primary-foreground" : "border-border text-muted-foreground hover:border-primary/50 hover:text-foreground"}`}
                            title={pos.replace("-", " ")}
                          >
                            {Icon ? <Icon className="h-3.5 w-3.5" /> : <span className="h-2 w-2 rounded-full bg-current block" />}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                  <div className="flex flex-col gap-1 flex-1">
                    <label className="text-xs font-medium text-muted-foreground">Preview</label>
                    <div
                      className="flex-1 rounded border border-border overflow-hidden flex items-center justify-center"
                      style={{ backgroundImage: "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16'%3E%3Crect width='8' height='8' fill='%23ccc'/%3E%3Crect x='8' y='8' width='8' height='8' fill='%23ccc'/%3E%3C/svg%3E\")", backgroundColor: "#eee" }}
                    >
                      <div style={{ opacity: textOpacity / 100, fontFamily: `'${textFont}', sans-serif`, color: textColor, lineHeight: 1.4, textAlign: "center", padding: "8px" }}>
                        {textHeading && <div style={{ fontSize: Math.min(headingSize, 28), whiteSpace: "pre-wrap" }}>{textHeading}</div>}
                        {textBody && <div style={{ fontSize: Math.min(textSize, 18), whiteSpace: "pre-wrap" }}>{textBody}</div>}
                        {!textHeading && !textBody && <div style={{ fontSize: 13, opacity: 0.4 }}>Preview</div>}
                      </div>
                    </div>
                  </div>
                </div>

              </div>
              <DialogFooter>
                <Button variant="outline" size="sm" onClick={() => setTextDialogOpen(false)}>Cancel</Button>
                <Button size="sm" disabled={!textHeading.trim() && !textBody.trim()} onClick={() => {
                  if (!textHeading.trim() && !textBody.trim()) return
                  const textFields = { heading: textHeading, headingSize, body: textBody, textColor, textPosition, textFont, textOpacity, textSize }
                  if (editingTextId) {
                    setAssets((prev) => prev.map((a) => a.id === editingTextId
                      ? { ...a, title: textHeading.trim() || textBody.trim(), ...textFields }
                      : a))
                  } else {
                    setAssets((prev) => [...prev, {
                      id: crypto.randomUUID(),
                      title: textHeading.trim() || textBody.trim(),
                      ...textFields,
                      mediaType: "text",
                      publicLink: null,
                      thumbnailUrl: null,
                      loading: false,
                      error: null,
                    }])
                  }
                  setTextDialogOpen(false)
                  setTextHeading("")
                  setHeadingSize(48)
                  setTextBody("")
                  setTextSize(32)
                  setTextColor("#ffffff")
                  setTextPosition("middle-center")
                  setTextFont(TEXT_FONTS[0].value)
                  setTextOpacity(100)
                  setEditingTextId(null)
                }}>
                  {editingTextId ? "Save" : "Add"}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <div className="flex-1 min-h-0 overflow-auto">
            {assets.length === 0 && (
              <div className="flex flex-col items-center justify-center gap-2 h-full text-muted-foreground p-4">
                <Clapperboard className="h-6 w-6 opacity-40" />
                <p className="text-xs text-center">No assets yet. Click Add to select from Aprimo.</p>
              </div>
            )}
            {assets.map((asset) => (
              <div
                key={asset.id}
                draggable={!asset.loading && (!!asset.publicLink || asset.mediaType === "text")}
                onDragStart={() => setDraggingId(asset.id)}
                onDragEnd={() => setDraggingId(null)}
                className={`flex items-center gap-2 px-3 py-2 border-b border-border group ${asset.loading ? "cursor-wait" : "cursor-grab active:cursor-grabbing"} ${draggingId === asset.id ? "opacity-50" : ""} ${
                  asset.mediaType === "audio" ? "bg-green-500/10 hover:bg-green-500/20"
                  : asset.mediaType === "text" ? "bg-orange-500/10 hover:bg-orange-500/20"
                  : "bg-blue-500/10 hover:bg-blue-500/20"
                }`}
              >
                <div className="w-12 h-8 shrink-0 rounded overflow-hidden flex items-center justify-center bg-black/5">
                  {asset.loading
                    ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                    : asset.thumbnailUrl && asset.mediaType !== "audio" && asset.mediaType !== "text"
                      ? <img src={asset.thumbnailUrl} alt={asset.title} className="w-full h-full object-cover" />
                      : asset.mediaType === "audio"
                        ? <Music2 className="h-4 w-4 text-green-600 dark:text-green-400" />
                        : asset.mediaType === "text"
                          ? <Type className="h-4 w-4 text-orange-500" />
                          : asset.mediaType === "image"
                            ? <ImageIcon className="h-4 w-4 text-blue-500" />
                            : <Film className="h-4 w-4 text-blue-500" />
                  }
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate leading-tight" title={asset.title}>{asset.title}</p>
                  {asset.mediaType === "text" && asset.body && (
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">{asset.body}</p>
                  )}
                  {asset.loading && <p className="text-xs text-muted-foreground mt-0.5">Preparing…</p>}
                  {asset.error && <p className="text-xs text-destructive mt-0.5 truncate">{asset.error}</p>}
                  {asset.publicLink && (
                    <div className="flex items-center gap-1 mt-0.5">
                      <Button size="sm" variant="ghost" className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground" onClick={() => copyLink(asset)}>
                        {copiedId === asset.id ? <Check className="h-2.5 w-2.5" /> : <Copy className="h-2.5 w-2.5" />}
                      </Button>
                      <Button size="sm" variant="ghost" className="h-4 w-4 p-0 text-muted-foreground hover:text-foreground" asChild>
                        <a href={asset.publicLink} target="_blank" rel="noopener noreferrer">
                          <ExternalLink className="h-2.5 w-2.5" />
                        </a>
                      </Button>
                    </div>
                  )}
                </div>
                <div className="shrink-0 flex items-center gap-1 opacity-0 group-hover:opacity-100">
                  {asset.mediaType === "text" && (
                    <button onClick={() => {
                      setEditingTextId(asset.id)
                      setTextHeading(asset.heading ?? asset.title)
                      setHeadingSize(asset.headingSize ?? 48)
                      setTextBody(asset.body ?? "")
                      setTextSize(asset.textSize ?? 32)
                      setTextColor(asset.textColor ?? "#ffffff")
                      setTextPosition(asset.textPosition ?? "middle-center")
                      setTextFont(asset.textFont ?? TEXT_FONTS[0].value)
                      setTextOpacity(asset.textOpacity ?? 100)
                      setTextDialogOpen(true)
                    }} className="shrink-0 flex items-center gap-0.5 px-1.5 py-0.5 rounded text-xs font-medium transition-colors bg-orange-200 hover:bg-orange-300 text-orange-800">
                      <Type className="h-3 w-3" /><span>Edit</span>
                    </button>
                  )}
                  <button onClick={() => removeAsset(asset.id)} className="text-muted-foreground hover:text-foreground">
                    <X className="h-3 w-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {sidebarTab === "transitions" && (
        <div className="flex-1 min-h-0 overflow-auto p-2">
          <div className="grid grid-cols-2 gap-1">
            {TRANSITIONS.map((t) => (
              <div
                key={t}
                draggable
                onDragStart={() => setDraggingTransitionType(t)}
                onDragEnd={() => setDraggingTransitionType(null)}
                className={`text-xs px-2 py-1.5 rounded border border-purple-500/30 bg-purple-500/10 text-purple-600 dark:text-purple-400 cursor-grab active:cursor-grabbing truncate select-none ${draggingTransitionType === t ? "opacity-50" : "hover:bg-purple-500/20"}`}
                title={t}
              >
                {t}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
